/**
 * Job Dispatcher Service — Phase 5.1 Worker Dispatcher Runtime
 *
 * In-process background worker that polls the job queue and automatically
 * claims + executes jobs without manual HTTP calls.
 *
 * startDispatcher()       — register worker, start poll + heartbeat timers
 * stopDispatcher()        — clear timers, mark worker offline
 * tick()                  — one poll cycle: dispatch + maintenance
 * dispatchAvailableJobs() — claim and process jobs up to concurrency limit
 * processClaimedJob()     — execute a claimed job, complete or retry on failure
 * handleWorkerHeartbeat() — write heartbeat to DB
 * handleStaleWorkers()    — mark workers without recent heartbeat as offline
 * handleStuckJobs()       — release / retry jobs running beyond timeout
 * getDispatcherStatus()   — return current runtime status snapshot
 * isDispatcherEnabled()   — read env/settings to decide whether to auto-start
 */

import { eq, and, lt, not, inArray, sql } from "drizzle-orm";
import { db, aiJobsTable, aiWorkersTable } from "@workspace/db";
import type { AiJob } from "@workspace/db";
import {
  claimJob,
  executeJob,
  completeJob,
  retryJob,
  heartbeat,
} from "./jobWorkerService.js";
import { logAudit } from "./aiAuditService.js";
import { logger } from "../lib/logger.js";

// ── Configuration ─────────────────────────────────────────────────────────────

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

const DEFAULT_POLL_INTERVAL_MS      = envInt("AI_WORKER_POLL_INTERVAL_MS",      5_000);
const DEFAULT_HEARTBEAT_INTERVAL_MS = envInt("AI_WORKER_HEARTBEAT_INTERVAL_MS", 30_000);
const DEFAULT_MAX_CONCURRENT_JOBS   = envInt("AI_WORKER_MAX_CONCURRENT_JOBS",   1);
const DEFAULT_HEARTBEAT_TIMEOUT_MS  = 2 * 60_000; // 2 min → worker considered stale
const DEFAULT_STUCK_JOB_TIMEOUT_MS  = 5 * 60_000; // 5 min → job considered stuck
const WORKER_NAME = process.env["AI_WORKER_NAME"] ?? `dispatcher-${process.pid}`;

// ── Singleton state ───────────────────────────────────────────────────────────

interface DispatcherState {
  running: boolean;
  workerId: number | null;
  workerName: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  maxConcurrentJobs: number;
  heartbeatTimeoutMs: number;
  stuckJobTimeoutMs: number;
  currentJobs: Set<number>;
  lastTickAt: Date | null;
  lastHeartbeatAt: Date | null;
  processedToday: number;
  failedToday: number;
  _tickTimer: ReturnType<typeof setInterval> | null;
  _heartbeatTimer: ReturnType<typeof setInterval> | null;
}

const state: DispatcherState = {
  running:             false,
  workerId:            null,
  workerName:          WORKER_NAME,
  pollIntervalMs:      DEFAULT_POLL_INTERVAL_MS,
  heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
  maxConcurrentJobs:   DEFAULT_MAX_CONCURRENT_JOBS,
  heartbeatTimeoutMs:  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  stuckJobTimeoutMs:   DEFAULT_STUCK_JOB_TIMEOUT_MS,
  currentJobs:         new Set(),
  lastTickAt:          null,
  lastHeartbeatAt:     null,
  processedToday:      0,
  failedToday:         0,
  _tickTimer:          null,
  _heartbeatTimer:     null,
};

// ── Worker registration ───────────────────────────────────────────────────────

async function registerWorker(): Promise<number> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(aiWorkersTable)
    .where(eq(aiWorkersTable.workerName, state.workerName));

  if (existing) {
    await db
      .update(aiWorkersTable)
      .set({ status: "idle", lastHeartbeat: now, updatedAt: now })
      .where(eq(aiWorkersTable.id, existing.id));
    return existing.id;
  }

  const [worker] = await db
    .insert(aiWorkersTable)
    .values({ workerName: state.workerName, status: "idle", version: "5.1.0" })
    .returning();

  return worker.id;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function isDispatcherEnabled(): boolean {
  const flag = process.env["AI_WORKER_ENABLED"];
  if (flag === "true")  return true;
  if (flag === "false") return false;
  // Default: on in development, off in production
  return process.env["NODE_ENV"] === "development";
}

export async function startDispatcher(): Promise<void> {
  if (state.running) {
    logger.info("Dispatcher: already running — skipping double-start");
    return;
  }

  logger.info({ workerName: state.workerName }, "Dispatcher: starting");

  state.workerId = await registerWorker();
  state.running  = true;
  state.lastTickAt = null;

  // Tick interval
  state._tickTimer = setInterval(() => {
    tick().catch((err) => logger.error({ err }, "Dispatcher: unhandled tick error"));
  }, state.pollIntervalMs);

  // Heartbeat interval
  state._heartbeatTimer = setInterval(() => {
    handleWorkerHeartbeat().catch((err) =>
      logger.error({ err }, "Dispatcher: unhandled heartbeat error"),
    );
  }, state.heartbeatIntervalMs);

  // First tick immediately
  tick().catch((err) => logger.error({ err }, "Dispatcher: first tick error"));

  await logAudit("dispatcher", "dispatcher_started", "system", "dispatcher", "success", {
    workerName: state.workerName,
    workerId:   state.workerId,
    pollIntervalMs: state.pollIntervalMs,
    maxConcurrentJobs: state.maxConcurrentJobs,
  });

  logger.info(
    { workerId: state.workerId, pollIntervalMs: state.pollIntervalMs },
    "Dispatcher: started",
  );
}

export async function stopDispatcher(): Promise<void> {
  if (!state.running) return;

  logger.info("Dispatcher: stopping");

  if (state._tickTimer)      { clearInterval(state._tickTimer);      state._tickTimer = null; }
  if (state._heartbeatTimer) { clearInterval(state._heartbeatTimer); state._heartbeatTimer = null; }

  state.running = false;

  if (state.workerId) {
    await db
      .update(aiWorkersTable)
      .set({ status: "offline", updatedAt: new Date() })
      .where(eq(aiWorkersTable.id, state.workerId))
      .catch((err) => logger.error({ err }, "Dispatcher: failed to mark worker offline"));
  }

  await logAudit("dispatcher", "dispatcher_stopped", "system", "dispatcher", "success", {
    processedToday: state.processedToday,
    failedToday:    state.failedToday,
  });

  logger.info({ processedToday: state.processedToday, failedToday: state.failedToday }, "Dispatcher: stopped");
}

export async function tick(): Promise<void> {
  if (!state.running || !state.workerId) return;

  state.lastTickAt = new Date();

  // Run all maintenance tasks in parallel; errors in one don't abort others
  await Promise.allSettled([
    dispatchAvailableJobs(),
    handleStaleWorkers(),
    handleStuckJobs(),
  ]);
}

export async function dispatchAvailableJobs(): Promise<void> {
  if (!state.workerId) return;

  const slots = state.maxConcurrentJobs - state.currentJobs.size;
  if (slots <= 0) return;

  for (let i = 0; i < slots; i++) {
    let job: AiJob | null = null;
    try {
      job = await claimJob(state.workerId);
    } catch (err) {
      logger.error({ err }, "Dispatcher: claimJob error");
      break;
    }

    if (!job) break; // Queue empty or all jobs locked

    // Fire-and-forget — keeps dispatcher loop non-blocking
    processClaimedJob(job).catch((err) =>
      logger.error({ err, jobId: job?.id }, "Dispatcher: processClaimedJob unhandled error"),
    );
  }
}

export async function processClaimedJob(job: AiJob): Promise<void> {
  state.currentJobs.add(job.id);
  logger.info({ jobId: job.id, jobType: job.jobType }, "Dispatcher: executing job");

  try {
    const result = await executeJob(job, state.workerId!);
    await completeJob(job.id, state.workerId!, result);
    state.processedToday++;
    logger.info({ jobId: job.id }, "Dispatcher: job completed");
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ jobId: job.id, error }, "Dispatcher: job failed — scheduling retry");

    try {
      await retryJob(job.id, state.workerId!, error);
    } catch (retryErr) {
      logger.error({ err: retryErr, jobId: job.id }, "Dispatcher: retryJob failed");
    }

    state.failedToday++;

    await logAudit("dispatcher", "dispatcher_job_error", String(job.id), "ai_job", "failure", {
      error,
      jobType: job.jobType,
    }).catch(() => {});
  } finally {
    state.currentJobs.delete(job.id);
  }
}

export async function handleWorkerHeartbeat(): Promise<void> {
  if (!state.workerId) return;
  try {
    await heartbeat(state.workerId);
    state.lastHeartbeatAt = new Date();
  } catch (err) {
    logger.error({ err }, "Dispatcher: heartbeat failed");
  }
}

export async function handleStaleWorkers(): Promise<void> {
  const threshold = new Date(Date.now() - state.heartbeatTimeoutMs);

  const staleWorkers = await db
    .select()
    .from(aiWorkersTable)
    .where(
      and(
        not(eq(aiWorkersTable.status, "offline")),
        lt(aiWorkersTable.lastHeartbeat, threshold),
        // Never consider ourselves stale
        state.workerId
          ? not(eq(aiWorkersTable.id, state.workerId))
          : sql`TRUE`,
      ),
    );

  for (const worker of staleWorkers) {
    logger.warn(
      { workerId: worker.id, workerName: worker.workerName },
      "Dispatcher: marking stale worker offline",
    );

    await db
      .update(aiWorkersTable)
      .set({ status: "offline", currentJob: null, runningJobs: 0, updatedAt: new Date() })
      .where(eq(aiWorkersTable.id, worker.id));

    // Release any running job the stale worker held
    if (worker.currentJob) {
      const [job] = await db
        .select()
        .from(aiJobsTable)
        .where(
          and(
            eq(aiJobsTable.id, worker.currentJob),
            eq(aiJobsTable.status, "running"),
          ),
        );

      if (job) {
        const exhausted = job.retryCount >= job.maxRetry;
        await db
          .update(aiJobsTable)
          .set({
            status:       exhausted ? "failed" : "retrying",
            errorMessage: `Worker "${worker.workerName}" went offline while running this job`,
            nextRetryAt:  exhausted ? null : new Date(Date.now() + 30_000),
            updatedAt:    new Date(),
          })
          .where(eq(aiJobsTable.id, job.id));

        await logAudit(
          "dispatcher", "stale_worker_job_released", String(job.id), "ai_job", "failure",
          { workerId: worker.id, workerName: worker.workerName, exhausted },
        ).catch(() => {});
      }
    }
  }
}

export async function handleStuckJobs(): Promise<void> {
  const threshold = new Date(Date.now() - state.stuckJobTimeoutMs);

  const conditions = [
    eq(aiJobsTable.status, "running"),
    lt(aiJobsTable.startedAt, threshold),
  ];

  // Don't interrupt jobs we're actively processing in this dispatcher
  if (state.currentJobs.size > 0) {
    conditions.push(not(inArray(aiJobsTable.id, [...state.currentJobs])));
  }

  const stuckJobs = await db
    .select()
    .from(aiJobsTable)
    .where(and(...conditions));

  for (const job of stuckJobs) {
    const ranForMs = Date.now() - (job.startedAt?.getTime() ?? 0);
    logger.warn({ jobId: job.id, ranForMs }, "Dispatcher: releasing stuck job");

    const exhausted = job.retryCount >= job.maxRetry;

    await db
      .update(aiJobsTable)
      .set({
        status:       exhausted ? "failed" : "retrying",
        errorMessage: "Job exceeded maximum execution time and was released by dispatcher",
        nextRetryAt:  exhausted ? null : new Date(Date.now() + 30_000),
        updatedAt:    new Date(),
      })
      .where(eq(aiJobsTable.id, job.id));

    // Release the worker that held this job
    await db
      .update(aiWorkersTable)
      .set({
        status:      "idle",
        currentJob:  null,
        runningJobs: sql`GREATEST(running_jobs - 1, 0)`,
        failedToday: sql`failed_today + 1`,
        updatedAt:   new Date(),
      })
      .where(eq(aiWorkersTable.currentJob, job.id));

    await logAudit(
      "dispatcher", "stuck_job_released", String(job.id), "ai_job", "failure",
      { exhausted, ranForMs },
    ).catch(() => {});
  }
}

export function getDispatcherStatus() {
  return {
    enabled:             isDispatcherEnabled(),
    running:             state.running,
    workerName:          state.workerName,
    pollIntervalMs:      state.pollIntervalMs,
    heartbeatIntervalMs: state.heartbeatIntervalMs,
    maxConcurrentJobs:   state.maxConcurrentJobs,
    currentJobs:         state.currentJobs.size,
    lastTickAt:          state.lastTickAt?.toISOString() ?? null,
    lastHeartbeatAt:     state.lastHeartbeatAt?.toISOString() ?? null,
    processedToday:      state.processedToday,
    failedToday:         state.failedToday,
  };
}
