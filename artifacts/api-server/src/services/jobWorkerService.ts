/**
 * Job Worker Service — Phase 5 Job Queue / Phase 5.2 Distributed Worker Cluster
 *
 * claimJob()    — atomically claim the next available job (SELECT FOR UPDATE SKIP LOCKED)
 *                 Phase 5.2: capability-aware + lease-validated claiming
 * executeJob()  — dispatch a claimed job to the appropriate handler
 * completeJob() — mark job completed, update worker metrics
 * retryJob()    — schedule retry (immediate | exponential | manual)
 * cancelJob()   — mark job cancelled
 * heartbeat()   — update worker last_heartbeat
 * releaseJob()  — release without completing (requeue)
 */

import { eq, and, inArray, sql } from "drizzle-orm";
import { db, aiJobsTable, aiWorkersTable } from "@workspace/db";
import type { AiJob, AiWorker } from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { publishSafe } from "./aiEventBusService.js";

// ── Retry delay helpers ───────────────────────────────────────────────────────

function exponentialBackoffMs(retryCount: number): number {
  // 30s, 2min, 8min, 30min … capped at 30 min
  return Math.min(30 * 60_000, 30_000 * Math.pow(4, retryCount));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Atomically claim the next available queued job for a worker.
 *
 * Phase 5.2 additions:
 *  - Validates worker lease before claiming (workers without valid lease are skipped)
 *  - Respects max_concurrent_jobs per worker
 *  - Filters jobs by required_capability — only workers whose capabilities array
 *    includes the job's required_capability (or the job has no required_capability) are eligible
 *
 * Uses SELECT … FOR UPDATE SKIP LOCKED so multiple workers never take the same job.
 */
export async function claimJob(workerId: number): Promise<AiJob | null> {
  // ── Pre-flight: validate worker lease and capacity ───────────────────────
  const [worker] = await db
    .select()
    .from(aiWorkersTable)
    .where(eq(aiWorkersTable.id, workerId));

  if (!worker) return null;

  // Reject stale/offline workers
  if (worker.status === "offline" || worker.status === "stale") return null;

  // Lease check: if a lease is configured, it must be valid
  if (worker.leaseExpiresAt !== null && worker.leaseExpiresAt < new Date()) {
    return null; // lease expired — worker is stale
  }

  // Capacity check: respect max_concurrent_jobs
  if (worker.runningJobs >= worker.maxConcurrentJobs) return null;

  // Capabilities for this worker (Phase 5.2 capability routing)
  const capabilities = (worker.capabilities as string[] | null) ?? [];
  // Serialise as a JSON string for the JSONB ? operator in PostgreSQL
  const capJson = JSON.stringify(capabilities);

  return db.transaction(async (tx) => {
    // Find the highest-priority available job and lock it.
    // Also promotes due 'retrying' jobs (next_retry_at has elapsed).
    //
    // Phase 5.2: adds required_capability filter —
    //   (required_capability IS NULL)                          → any worker can claim
    //   OR ($capJson::jsonb ? required_capability)             → worker has the capability
    const rawResult = await tx.execute(sql`
      SELECT * FROM ai_jobs
      WHERE (
        (status = 'queued' AND (scheduled_at IS NULL OR scheduled_at <= NOW()))
        OR
        (status = 'retrying' AND next_retry_at IS NOT NULL AND next_retry_at <= NOW())
      )
      AND (
        required_capability IS NULL
        OR ${capJson}::jsonb ? required_capability
      )
      ORDER BY priority_score DESC, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);

    const rows = (rawResult as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
    const [job] = rows;

    if (!job) return null;

    const jobRow = job as unknown as AiJob;

    // Claim: accepts both 'queued' and 'retrying'
    const [claimed] = await tx
      .update(aiJobsTable)
      .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(aiJobsTable.id, jobRow.id),
          inArray(aiJobsTable.status, ["queued", "retrying"]),
        ),
      )
      .returning();

    if (!claimed) {
      // Race condition — another worker won; return null
      return null;
    }

    // Update worker occupancy
    await tx
      .update(aiWorkersTable)
      .set({
        status:        "busy",
        currentJob:    claimed.id,
        runningJobs:   sql`running_jobs + 1`,
        lastHeartbeat: new Date(),
        updatedAt:     new Date(),
      })
      .where(eq(aiWorkersTable.id, workerId));

    return claimed;
  });
}

/**
 * Dispatch a running job to the appropriate handler.
 * Extend this switch to add new job types as the platform grows.
 */
export async function executeJob(job: AiJob, workerId: number): Promise<Record<string, unknown>> {
  switch (job.jobType) {
    case "llm_inference":
      return { message: "LLM inference dispatched", jobId: job.id };

    case "creative_brief":
      return { message: "Creative brief workflow dispatched", jobId: job.id };

    case "creative_text":
      return { message: "Creative text generation dispatched", jobId: job.id };

    case "qc_review":
      return { message: "QC review dispatched", jobId: job.id };

    case "image_generation":
      return { message: "Image generation dispatched", jobId: job.id };

    case "image_qc":
      return { message: "Image QC dispatched", jobId: job.id };

    case "pdf_export":
      return { message: "PDF export dispatched", jobId: job.id };

    case "csv_export":
      return { message: "CSV export dispatched", jobId: job.id };

    case "analytics":
      return { message: "Analytics job dispatched", jobId: job.id };

    case "cleanup":
      return { message: "Cleanup job dispatched", jobId: job.id };

    case "noop":
      // Used for seed / testing
      return { message: "No-op job executed", jobId: job.id };

    default:
      return { message: `Job type '${job.jobType}' dispatched`, jobId: job.id };
  }
}

/**
 * Mark a job as completed and update worker metrics.
 */
export async function completeJob(
  jobId: number,
  workerId: number,
  result: Record<string, unknown>,
  actualCost?: number,
): Promise<AiJob> {
  const now = new Date();

  const [job] = await db
    .select()
    .from(aiJobsTable)
    .where(eq(aiJobsTable.id, jobId));

  const actualDuration = job?.startedAt
    ? now.getTime() - job.startedAt.getTime()
    : null;

  const [completed] = await db
    .update(aiJobsTable)
    .set({
      status:          "completed",
      completedAt:     now,
      resultJson:      result,
      actualCost:      actualCost != null ? String(actualCost) : null,
      actualDuration:  actualDuration,
      updatedAt:       now,
    })
    .where(eq(aiJobsTable.id, jobId))
    .returning();

  // Update worker — rolling latency average
  const [worker] = await db
    .select()
    .from(aiWorkersTable)
    .where(eq(aiWorkersTable.id, workerId));

  const prevAvg = worker?.averageLatency != null ? Number(worker.averageLatency) : null;
  const newAvg = prevAvg != null && actualDuration != null
    ? Math.round((prevAvg + actualDuration) / 2)
    : actualDuration;

  await db
    .update(aiWorkersTable)
    .set({
      status:          "idle",
      currentJob:      null,
      runningJobs:     sql`GREATEST(running_jobs - 1, 0)`,
      completedToday:  sql`completed_today + 1`,
      averageLatency:  newAvg != null ? String(newAvg) : null,
      lastHeartbeat:   now,
      updatedAt:       now,
    })
    .where(eq(aiWorkersTable.id, workerId));

  await logAudit("job-engine", "job_completed", String(jobId), "ai_job", "success", {
    actualDuration,
    actualCost,
    workerId,
  });

  publishSafe({
    eventType:    "job.completed",
    sourceModule: "job-engine",
    sourceId:     String(jobId),
    payload:      { jobId, workerId, jobCode: completed!.jobCode, jobType: completed!.jobType, actualDuration, actualCost },
  });

  return completed!;
}

/**
 * Schedule a retry or mark the job failed if max retries exceeded.
 */
export async function retryJob(
  jobId: number,
  workerId: number,
  errorMessage: string,
): Promise<AiJob> {
  const now = new Date();

  const [job] = await db
    .select()
    .from(aiJobsTable)
    .where(eq(aiJobsTable.id, jobId));

  if (!job) throw new Error(`Job ${jobId} not found`);

  const newRetryCount = job.retryCount + 1;
  const exhausted     = newRetryCount > job.maxRetry;

  let update: Parameters<typeof db.update<typeof aiJobsTable>>[0] extends infer T ? object : object;

  if (exhausted) {
    update = {
      status:       "failed",
      errorMessage,
      retryCount:   newRetryCount,
      completedAt:  now,
      updatedAt:    now,
    };
  } else {
    let nextRetryAt: Date | null = null;
    if (job.retryStrategy === "exponential") {
      nextRetryAt = new Date(now.getTime() + exponentialBackoffMs(newRetryCount - 1));
    } else if (job.retryStrategy === "immediate") {
      nextRetryAt = now;
    }
    // "manual" → stays in "retrying" with no nextRetryAt

    update = {
      status:       "retrying",
      errorMessage,
      retryCount:   newRetryCount,
      nextRetryAt:  nextRetryAt,
      startedAt:    null,
      updatedAt:    now,
    };
  }

  const [updated] = await db
    .update(aiJobsTable)
    .set(update as Parameters<typeof db.update>[0] extends infer T ? object : object)
    .where(eq(aiJobsTable.id, jobId))
    .returning();

  // Release worker
  await db
    .update(aiWorkersTable)
    .set({
      status:       "idle",
      currentJob:   null,
      runningJobs:  sql`GREATEST(running_jobs - 1, 0)`,
      failedToday:  sql`failed_today + 1`,
      lastHeartbeat: now,
      updatedAt:    now,
    })
    .where(eq(aiWorkersTable.id, workerId));

  await logAudit(
    "job-engine",
    exhausted ? "job_failed" : "job_retrying",
    String(jobId),
    "ai_job",
    exhausted ? "failure" : "success",
    { errorMessage, retryCount: newRetryCount, maxRetry: job.maxRetry, exhausted },
  );

  publishSafe({
    eventType:    exhausted ? "job.failed" : "job.retrying",
    sourceModule: "job-engine",
    sourceId:     String(jobId),
    payload:      { jobId, workerId, errorMessage, retryCount: newRetryCount, exhausted, jobCode: updated!.jobCode, jobType: updated!.jobType },
  });

  return updated!;
}

/**
 * Cancel a job (terminal state).
 */
export async function cancelJob(jobId: number, workerId?: number): Promise<AiJob> {
  const now = new Date();

  const [cancelled] = await db
    .update(aiJobsTable)
    .set({ status: "cancelled", completedAt: now, updatedAt: now })
    .where(
      and(
        eq(aiJobsTable.id, jobId),
        inArray(aiJobsTable.status, ["queued", "waiting", "retrying", "running"]),
      ),
    )
    .returning();

  if (!cancelled) throw new Error(`Job ${jobId} cannot be cancelled in its current state`);

  // Release worker if the job was running
  if (workerId && cancelled.status === "cancelled") {
    await db
      .update(aiWorkersTable)
      .set({
        status:      "idle",
        currentJob:  null,
        runningJobs: sql`GREATEST(running_jobs - 1, 0)`,
        updatedAt:   now,
      })
      .where(eq(aiWorkersTable.id, workerId));
  }

  await logAudit("job-engine", "job_cancelled", String(jobId), "ai_job", "success", { workerId });

  publishSafe({
    eventType:    "job.failed",
    sourceModule: "job-engine",
    sourceId:     String(jobId),
    payload:      { jobId, workerId, reason: "cancelled", jobCode: cancelled.jobCode, jobType: cancelled.jobType },
  });

  return cancelled;
}

/**
 * Update a worker's last_heartbeat (called by heartbeat route).
 */
export async function heartbeat(workerId: number): Promise<AiWorker> {
  const now = new Date();

  const [worker] = await db
    .update(aiWorkersTable)
    .set({
      lastHeartbeat: now,
      status:        sql`CASE WHEN status = 'offline' THEN 'idle' ELSE status END`,
      updatedAt:     now,
    })
    .where(eq(aiWorkersTable.id, workerId))
    .returning();

  if (!worker) throw new Error(`Worker ${workerId} not found`);
  return worker;
}

/**
 * Release a running job back to queued (worker is aborting without completing).
 */
export async function releaseJob(jobId: number, workerId: number): Promise<AiJob> {
  const now = new Date();

  const [released] = await db
    .update(aiJobsTable)
    .set({ status: "queued", startedAt: null, updatedAt: now })
    .where(
      and(
        eq(aiJobsTable.id, jobId),
        eq(aiJobsTable.status, "running"),
      ),
    )
    .returning();

  if (!released) throw new Error(`Job ${jobId} is not running`);

  await db
    .update(aiWorkersTable)
    .set({
      status:       "idle",
      currentJob:   null,
      runningJobs:  sql`GREATEST(running_jobs - 1, 0)`,
      lastHeartbeat: now,
      updatedAt:    now,
    })
    .where(eq(aiWorkersTable.id, workerId));

  await logAudit("job-engine", "job_released", String(jobId), "ai_job", "success", { workerId });

  return released;
}
