/**
 * jobs.ts — AI Job Engine API (Phase 5)
 *
 * GET    /ai/jobs                    — list jobs (filter: status, jobType, deptId, limit, offset)
 * POST   /ai/jobs                    — enqueue a new job
 * GET    /ai/jobs/stats              — queue stats dashboard
 * GET    /ai/jobs/:id                — get single job
 * PATCH  /ai/jobs/:id/cancel         — cancel job
 * PATCH  /ai/jobs/:id/retry          — manually trigger retry
 * PATCH  /ai/jobs/:id/priority       — reprioritize
 * GET    /ai/workers                 — list workers
 * POST   /ai/workers                 — register / upsert worker
 * PATCH  /ai/workers/:id/heartbeat   — worker heartbeat
 * PATCH  /ai/workers/:id/status      — update worker status
 * POST   /ai/queue/pause             — pause queue (queued → waiting)
 * POST   /ai/queue/resume            — resume queue (waiting → queued)
 */

import { Router } from "express";
import { eq, and, inArray, desc, sql, gte } from "drizzle-orm";
import {
  CreateJobBodySchema,
  ListJobsQueryParams,
  ReprioritizeJobBodySchema,
  RegisterWorkerBodySchema,
  QueueFilterBodySchema,
} from "@workspace/api-zod";
import { db, aiJobsTable, aiWorkersTable } from "@workspace/db";
import {
  enqueue,
  reprioritize,
  pauseQueue,
  resumeQueue,
} from "../services/queueManagerService.js";
import {
  cancelJob,
  heartbeat as workerHeartbeat,
} from "../services/jobWorkerService.js";
import { logAudit } from "../services/aiAuditService.js";

const router = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const JOB_STATUSES = [
  "queued", "waiting", "running", "retrying",
  "completed", "failed", "cancelled", "blocked",
] as const;

const WORKER_STATUSES = ["online", "offline", "maintenance", "busy", "idle"] as const;

// Aliases matching the original local names for readability
const EnqueueBody      = CreateJobBodySchema;
const ListJobsQuery    = ListJobsQueryParams;
const ReprioritizeBody = ReprioritizeJobBodySchema;
const RegisterWorkerBody = RegisterWorkerBodySchema;
const QueueFilterBody  = QueueFilterBodySchema;

// ── List Jobs ─────────────────────────────────────────────────────────────────

router.get("/ai/jobs", async (req, res): Promise<void> => {
  const q = ListJobsQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const { status, jobType, departmentId, limit, offset } = q.data;

  const conditions: ReturnType<typeof eq>[] = [];
  if (status) {
    const parts = status.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 1) {
      conditions.push(eq(aiJobsTable.status, parts[0]!));
    } else {
      conditions.push(inArray(aiJobsTable.status, parts as typeof JOB_STATUSES[number][]));
    }
  }
  if (jobType)      conditions.push(eq(aiJobsTable.jobType, jobType));
  if (departmentId) conditions.push(eq(aiJobsTable.departmentId, departmentId));

  const [jobs, [{ total }]] = await Promise.all([
    db
      .select()
      .from(aiJobsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(aiJobsTable.priorityScore), aiJobsTable.createdAt)
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(aiJobsTable)
      .where(conditions.length ? and(...conditions) : undefined),
  ]);

  res.json({
    items: jobs.map(serializeJob),
    total,
    limit,
    offset,
  });
});

// ── Enqueue Job ───────────────────────────────────────────────────────────────

router.post("/ai/jobs", async (req, res): Promise<void> => {
  const body = EnqueueBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const d = body.data;
  const job = await enqueue({
    jobType:           d.jobType,
    payloadJson:       d.payloadJson,
    priority:          d.priority,
    executionPlanId:   d.executionPlanId ?? null,
    departmentId:      d.departmentId ?? null,
    employeeId:        d.employeeId ?? null,
    scheduledAt:       d.scheduledAt ? new Date(d.scheduledAt) : null,
    maxRetry:          d.maxRetry,
    retryStrategy:     d.retryStrategy,
    estimatedCost:     d.estimatedCost ?? null,
    estimatedDuration: d.estimatedDuration ?? null,
    managerOverride:   d.managerOverride ?? null,
  });

  res.status(201).json(serializeJob(job));
});

// ── Queue Stats (BEFORE /:id) ─────────────────────────────────────────────────

router.get("/ai/jobs/stats", async (_req, res): Promise<void> => {
  const [statusCounts, workerCounts, timingRows] = await Promise.all([
    db
      .select({
        status: aiJobsTable.status,
        count:  sql<number>`count(*)::int`,
      })
      .from(aiJobsTable)
      .groupBy(aiJobsTable.status),

    db
      .select({
        status: aiWorkersTable.status,
        count:  sql<number>`count(*)::int`,
      })
      .from(aiWorkersTable)
      .groupBy(aiWorkersTable.status),

    db
      .select({
        avgWaitMs: sql<number | null>`
          avg(extract(epoch from (started_at - created_at)) * 1000)
        `,
        avgExecMs: sql<number | null>`
          avg(actual_duration)
        `,
      })
      .from(aiJobsTable)
      .where(
        and(
          eq(aiJobsTable.status, "completed"),
          gte(aiJobsTable.completedAt, sql`NOW() - INTERVAL '24 hours'`),
        ),
      ),
  ]);

  const byStatus = Object.fromEntries(
    JOB_STATUSES.map((s) => [s, statusCounts.find((r) => r.status === s)?.count ?? 0]),
  );
  const byWorkerStatus = Object.fromEntries(
    WORKER_STATUSES.map((s) => [s, workerCounts.find((r) => r.status === s)?.count ?? 0]),
  );

  const timing = timingRows[0];

  res.json({
    jobs:              byStatus,
    totalQueued:       byStatus.queued  + byStatus.waiting,
    totalActive:       byStatus.running + byStatus.retrying,
    totalBlocked:      byStatus.blocked,
    totalFailed:       byStatus.failed,
    completedToday:    byStatus.completed,
    workers:           byWorkerStatus,
    avgWaitMs:         timing?.avgWaitMs != null ? Number(timing.avgWaitMs) : null,
    avgExecutionMs:    timing?.avgExecMs  != null ? Number(timing.avgExecMs)  : null,
  });
});

// ── Get Single Job ────────────────────────────────────────────────────────────

router.get("/ai/jobs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid job id" }); return; }

  const [job] = await db
    .select()
    .from(aiJobsTable)
    .where(eq(aiJobsTable.id, id));

  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json(serializeJob(job));
});

// ── Cancel Job ────────────────────────────────────────────────────────────────

router.patch("/ai/jobs/:id/cancel", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid job id" }); return; }

  const { reason } = req.body as { reason?: string };

  try {
    const job = await cancelJob(id, reason);
    res.json(serializeJob(job));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Cancel failed";
    res.status(400).json({ error: msg });
  }
});

// ── Manual Retry ──────────────────────────────────────────────────────────────

router.patch("/ai/jobs/:id/retry", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid job id" }); return; }

  const [job] = await db
    .select()
    .from(aiJobsTable)
    .where(eq(aiJobsTable.id, id));

  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const retriable = ["failed", "blocked", "cancelled"].includes(job.status);
  if (!retriable) {
    res.status(400).json({ error: `Job is ${job.status} — cannot retry` });
    return;
  }

  const [updated] = await db
    .update(aiJobsTable)
    .set({
      status:       "queued",
      errorMessage: null,
      nextRetryAt:  null,
      updatedAt:    new Date(),
    })
    .where(eq(aiJobsTable.id, id))
    .returning();

  await logAudit("job-engine", "job_manual_retry", String(id), "ai_job", "success", {});

  res.json(serializeJob(updated));
});

// ── Reprioritize ──────────────────────────────────────────────────────────────

router.patch("/ai/jobs/:id/priority", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid job id" }); return; }

  const body = ReprioritizeBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  try {
    const updated = await reprioritize(id, body.data.priority, body.data.managerOverride ?? null);
    res.json(serializeJob(updated));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Reprioritize failed";
    res.status(404).json({ error: msg });
  }
});

// ── List Workers ──────────────────────────────────────────────────────────────

router.get("/ai/workers", async (_req, res): Promise<void> => {
  const workers = await db
    .select()
    .from(aiWorkersTable)
    .orderBy(aiWorkersTable.workerName);
  res.json(workers.map(serializeWorker));
});

// ── Register / Upsert Worker ──────────────────────────────────────────────────

router.post("/ai/workers", async (req, res): Promise<void> => {
  const body = RegisterWorkerBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { workerName, version } = body.data;

  const [existing] = await db
    .select()
    .from(aiWorkersTable)
    .where(eq(aiWorkersTable.workerName, workerName));

  if (existing) {
    const [updated] = await db
      .update(aiWorkersTable)
      .set({ version, status: "idle", lastHeartbeat: new Date(), updatedAt: new Date() })
      .where(eq(aiWorkersTable.id, existing.id))
      .returning();
    res.json(serializeWorker(updated));
    return;
  }

  const [worker] = await db
    .insert(aiWorkersTable)
    .values({ workerName, version, status: "idle" })
    .returning();

  res.status(201).json(serializeWorker(worker));
});

// ── Worker Heartbeat ──────────────────────────────────────────────────────────

router.patch("/ai/workers/:id/heartbeat", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid worker id" }); return; }

  try {
    const worker = await workerHeartbeat(id);
    res.json(serializeWorker(worker));
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Not found" });
  }
});

// ── Update Worker Status ──────────────────────────────────────────────────────

router.patch("/ai/workers/:id/status", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid worker id" }); return; }

  const { status } = req.body as { status?: string };
  if (!status || !WORKER_STATUSES.includes(status as typeof WORKER_STATUSES[number])) {
    res.status(400).json({ error: `status must be one of: ${WORKER_STATUSES.join(", ")}` });
    return;
  }

  const [worker] = await db
    .update(aiWorkersTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(aiWorkersTable.id, id))
    .returning();

  if (!worker) { res.status(404).json({ error: "Worker not found" }); return; }
  res.json(serializeWorker(worker));
});

// ── Queue Management ──────────────────────────────────────────────────────────

router.post("/ai/queue/pause", async (req, res): Promise<void> => {
  const body = QueueFilterBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const count = await pauseQueue({
    departmentId: body.data.departmentId ?? undefined,
    jobType:      body.data.jobType ?? undefined,
  });
  res.json({ paused: count });
});

router.post("/ai/queue/resume", async (req, res): Promise<void> => {
  const body = QueueFilterBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const count = await resumeQueue({
    departmentId: body.data.departmentId ?? undefined,
    jobType:      body.data.jobType ?? undefined,
  });
  res.json({ resumed: count });
});

// ── Serializers ───────────────────────────────────────────────────────────────

function serializeJob(job: Record<string, unknown> & {
  id: number; createdAt: Date; updatedAt: Date;
  startedAt?: Date | null; completedAt?: Date | null;
  scheduledAt?: Date | null; nextRetryAt?: Date | null;
  estimatedCost?: string | null; actualCost?: string | null;
  priorityScore?: string | null;
}) {
  return {
    ...job,
    estimatedCost:  job.estimatedCost  != null ? parseFloat(String(job.estimatedCost))  : null,
    actualCost:     job.actualCost     != null ? parseFloat(String(job.actualCost))     : null,
    priorityScore:  job.priorityScore  != null ? parseFloat(String(job.priorityScore))  : null,
    createdAt:      job.createdAt.toISOString(),
    updatedAt:      job.updatedAt.toISOString(),
    startedAt:      job.startedAt     ? job.startedAt.toISOString()     : null,
    completedAt:    job.completedAt   ? job.completedAt.toISOString()   : null,
    scheduledAt:    job.scheduledAt   ? job.scheduledAt.toISOString()   : null,
    nextRetryAt:    job.nextRetryAt   ? job.nextRetryAt.toISOString()   : null,
  };
}

function serializeWorker(w: Record<string, unknown> & {
  id: number; createdAt: Date; updatedAt: Date; lastHeartbeat: Date;
  averageLatency?: string | null;
}) {
  return {
    ...w,
    averageLatency: w.averageLatency != null ? parseFloat(String(w.averageLatency)) : null,
    lastHeartbeat:  w.lastHeartbeat.toISOString(),
    createdAt:      w.createdAt.toISOString(),
    updatedAt:      w.updatedAt.toISOString(),
  };
}

export default router;
