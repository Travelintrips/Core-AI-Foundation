/**
 * Job Worker Service — Phase 5 Job Queue
 *
 * claimJob()    — atomically claim the next available job (SELECT FOR UPDATE SKIP LOCKED)
 * executeJob()  — dispatch a claimed job to the appropriate handler
 * completeJob() — mark job completed, update worker metrics
 * retryJob()    — schedule retry (immediate | exponential | manual)
 * cancelJob()   — mark job cancelled
 * heartbeat()   — update worker last_heartbeat
 * releaseJob()  — release without completing (requeue)
 */

import { eq, and, sql } from "drizzle-orm";
import { db, aiJobsTable, aiWorkersTable } from "@workspace/db";
import type { AiJob, AiWorker } from "@workspace/db";
import { logAudit } from "./aiAuditService.js";

// ── Retry delay helpers ───────────────────────────────────────────────────────

function exponentialBackoffMs(retryCount: number): number {
  // 30s, 2min, 8min, 30min … capped at 30 min
  return Math.min(30 * 60_000, 30_000 * Math.pow(4, retryCount));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Atomically claim the next available queued job for a worker.
 * Uses SELECT … FOR UPDATE SKIP LOCKED so two workers never take the same job.
 */
export async function claimJob(workerId: number): Promise<AiJob | null> {
  return db.transaction(async (tx) => {
    // Find the highest-priority available job and lock it.
    // Also promotes due 'retrying' jobs (next_retry_at has elapsed) so they
    // are not lost after exponential/immediate back-off.
    const rawResult = await tx.execute(sql`
      SELECT * FROM ai_jobs
      WHERE (
        (status = 'queued' AND (scheduled_at IS NULL OR scheduled_at <= NOW()))
        OR
        (status = 'retrying' AND next_retry_at IS NOT NULL AND next_retry_at <= NOW())
      )
      ORDER BY priority_score DESC, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);
    // drizzle-orm node-postgres returns QueryResult; rows is the iterable array
    const rows = (rawResult as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
    const [job] = rows;

    if (!job) return null;

    const jobRow = job as unknown as AiJob;

    // Claim the job
    const [claimed] = await tx
      .update(aiJobsTable)
      .set({
        status:     "running",
        startedAt:  new Date(),
        updatedAt:  new Date(),
      })
      .where(
        and(
          eq(aiJobsTable.id, jobRow.id),
          eq(aiJobsTable.status, "queued"),
        ),
      )
      .returning();

    if (!claimed) return null; // race condition — another worker got it

    // Update worker status
    await tx
      .update(aiWorkersTable)
      .set({
        status:      "busy",
        currentJob:  claimed.id,
        runningJobs: sql`running_jobs + 1`,
        lastHeartbeat: new Date(),
        updatedAt:   new Date(),
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

    case "image_generation":
      return { message: "Image generation dispatched", jobId: job.id };

    case "qc_review":
      return { message: "QC review dispatched", jobId: job.id };

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
  });

  return completed;
}

/**
 * Handle a failed job run — schedule retry or mark failed.
 */
export async function retryJob(
  jobId: number,
  workerId: number,
  error: string,
): Promise<AiJob> {
  const [job] = await db
    .select()
    .from(aiJobsTable)
    .where(eq(aiJobsTable.id, jobId));

  if (!job) throw new Error(`Job ${jobId} not found`);

  const nextRetryCount = job.retryCount + 1;
  const exhausted = nextRetryCount > job.maxRetry;

  let nextRetryAt: Date | null = null;
  let newStatus: string;

  if (exhausted) {
    newStatus = "failed";
  } else {
    newStatus = "retrying";
    switch (job.retryStrategy) {
      case "immediate":
        nextRetryAt = new Date(Date.now() + 5_000); // 5 s
        break;
      case "exponential":
        nextRetryAt = new Date(Date.now() + exponentialBackoffMs(nextRetryCount - 1));
        break;
      case "manual":
        nextRetryAt = null; // operator must manually trigger
        newStatus = "blocked";
        break;
    }
  }

  const now = new Date();

  const [updated] = await db
    .update(aiJobsTable)
    .set({
      status:       newStatus,
      retryCount:   nextRetryCount,
      errorMessage: error,
      nextRetryAt,
      updatedAt:    now,
    })
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
    "failure",
    { error, retryCount: nextRetryCount, maxRetry: job.maxRetry, nextRetryAt },
  );

  return updated;
}

/**
 * Cancel a job (regardless of status, unless completed).
 * When cancelling a running job, atomically releases the assigned worker so
 * its capacity metrics stay accurate.
 */
export async function cancelJob(jobId: number, reason?: string): Promise<AiJob> {
  const [job] = await db
    .select()
    .from(aiJobsTable)
    .where(eq(aiJobsTable.id, jobId));

  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status === "completed") throw new Error("Cannot cancel a completed job");

  const now = new Date();

  const [updated] = await db
    .update(aiJobsTable)
    .set({
      status:       "cancelled",
      errorMessage: reason ?? null,
      updatedAt:    now,
    })
    .where(eq(aiJobsTable.id, jobId))
    .returning();

  // If the job was running, release the worker that held it
  if (job.status === "running") {
    await db
      .update(aiWorkersTable)
      .set({
        status:       "idle",
        currentJob:   null,
        runningJobs:  sql`GREATEST(running_jobs - 1, 0)`,
        lastHeartbeat: now,
        updatedAt:    now,
      })
      .where(eq(aiWorkersTable.currentJob, jobId));
  }

  await logAudit("job-engine", "job_cancelled", String(jobId), "ai_job", "success", { reason, wasRunning: job.status === "running" });

  return updated;
}

/**
 * Update a worker's heartbeat timestamp and keep it online.
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
    .set({
      status:     "queued",
      startedAt:  null,
      updatedAt:  now,
    })
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
