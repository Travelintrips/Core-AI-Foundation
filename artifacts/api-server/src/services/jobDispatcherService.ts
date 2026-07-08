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
 * Automatic polling dispatcher that claims and executes queued jobs.
 *
 * start()    — begin polling loop
 * stop()     — halt polling loop
 * tick()     — one full dispatch cycle (recover → claim → execute → complete/retry)
 * dispatch() — claim + execute one job on a given worker
 * recover()  — detect stale workers and stuck jobs, recover them
 * shutdown() — graceful shutdown (stop polling, mark workers offline)
 */

import { eq, and, or, inArray, sql } from "drizzle-orm";
import { db, aiJobsTable, aiWorkersTable } from "@workspace/db";
import { claimJob, executeJob, completeJob, retryJob } from "./jobWorkerService.js";
import { logAudit } from "./aiAuditService.js";
import { logger } from "../lib/logger.js";

// ── Settings ──────────────────────────────────────────────────────────────────

export interface DispatcherSettings {
  dispatcherEnabled: boolean;
  workerPollIntervalMs: number;
  workerHeartbeatIntervalMs: number;
  workerTimeoutMs: number;
  jobTimeoutMs: number;
  maxConcurrentJobs: number;
}

export interface DispatcherStatus {
  enabled: boolean;
  running: boolean;
  workerCount: number;
  idleWorkers: number;
  busyWorkers: number;
  queueLength: number;
  runningJobs: number;
  lastTick: string | null;
  lastHeartbeat: string | null;
  processedToday: number;
  failedToday: number;
}

export interface TickResult {
  claimed: number;
  completed: number;
  failed: number;
}

// ── Module state ──────────────────────────────────────────────────────────────

const _settings: DispatcherSettings = {
  dispatcherEnabled: true,
  workerPollIntervalMs:       5_000,
  workerHeartbeatIntervalMs: 10_000,
  workerTimeoutMs:           60_000,
  jobTimeoutMs:             300_000,
  maxConcurrentJobs:              5,
};

let _running         = false;   // true once fully started (timers active)
let _starting        = false;   // mutex: prevents concurrent start() calls
let _queuePaused     = false;   // mirrors the job-queue pause state
let _pollTimer: NodeJS.Timeout | null     = null;
let _heartbeatTimer: NodeJS.Timeout | null = null;
let _lastTick:       Date | null = null;
let _lastHeartbeat:  Date | null = null;
let _processedToday  = 0;
let _failedToday     = 0;
const _workerIds: number[] = [];

const WORKER_PREFIX = "dispatcher";
const WORKER_COUNT  = 2;   // virtual workers managed by this dispatcher

// ── Settings API ──────────────────────────────────────────────────────────────

export function getSettings(): DispatcherSettings {
  return { ..._settings };
}

export function updateSettings(patch: Partial<DispatcherSettings>): DispatcherSettings {
  const intervalChanged  = patch.workerPollIntervalMs !== undefined
    && patch.workerPollIntervalMs !== _settings.workerPollIntervalMs;
  const heartbeatChanged = patch.workerHeartbeatIntervalMs !== undefined
    && patch.workerHeartbeatIntervalMs !== _settings.workerHeartbeatIntervalMs;

  Object.assign(_settings, patch);

  // Restart timers if intervals changed while running
  if (_running && (intervalChanged || heartbeatChanged)) {
    _clearTimers();
    _startTimers();
  }

  return { ..._settings };
}

// ── Status API ────────────────────────────────────────────────────────────────

export async function getStatus(): Promise<DispatcherStatus> {
  let idleWorkers = 0;
  let busyWorkers = 0;

  if (_workerIds.length > 0) {
    const workers = await db
      .select()
      .from(aiWorkersTable)
      .where(inArray(aiWorkersTable.id, _workerIds));

    idleWorkers = workers.filter((w) => w.status === "idle").length;
    busyWorkers = workers.filter((w) => w.status === "busy").length;
  }

  const queueRow = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM ai_jobs WHERE status IN ('queued', 'retrying')
  `).then((r) => (r as unknown as { rows: { count: number }[] }).rows[0]);

  const runningRow = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM ai_jobs WHERE status = 'running'
  `).then((r) => (r as unknown as { rows: { count: number }[] }).rows[0]);

  return {
    enabled:        _settings.dispatcherEnabled,
    running:        _running,
    workerCount:    _workerIds.length,
    idleWorkers,
    busyWorkers,
    queueLength:    queueRow?.count ?? 0,
    runningJobs:    runningRow?.count ?? 0,
    lastTick:       _lastTick?.toISOString() ?? null,
    lastHeartbeat:  _lastHeartbeat?.toISOString() ?? null,
    processedToday: _processedToday,
    failedToday:    _failedToday,
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/**
 * Upsert dispatcher-owned workers in DB and cache their IDs.
 */
export async function ensureWorkers(): Promise<void> {
  _workerIds.length = 0;

  for (let i = 1; i <= WORKER_COUNT; i++) {
    const name = `${WORKER_PREFIX}-${i}`;

    const [existing] = await db
      .select()
      .from(aiWorkersTable)
      .where(eq(aiWorkersTable.workerName, name));

    if (existing) {
      const [updated] = await db
        .update(aiWorkersTable)
        .set({
          status:       "idle",
          currentJob:   null,
          runningJobs:  0,
          lastHeartbeat: new Date(),
          updatedAt:    new Date(),
        })
        .where(eq(aiWorkersTable.id, existing.id))
        .returning();
      _workerIds.push(updated!.id);
    } else {
      const [created] = await db
        .insert(aiWorkersTable)
        .values({
          workerName:    name,
          status:        "idle",
          runningJobs:   0,
          completedToday: 0,
          failedToday:   0,
          version:       "1.0.0",
        })
        .returning();
      _workerIds.push(created!.id);
    }
  }

  logger.info({ workerIds: _workerIds }, "[dispatcher] Workers ensured");
}

/**
 * Notify dispatcher that the job queue has been paused or resumed.
 * Called by the queue pause/resume routes so tick() can skip claiming.
 */
export function setQueuePaused(paused: boolean): void {
  _queuePaused = paused;
  logger.info({ paused }, "[dispatcher] Queue paused state updated");
}

/**
 * Start the dispatcher. Safe to call multiple times — ignored if already running.
 * Uses `_starting` mutex to prevent duplicate timer creation from concurrent calls.
 */
export async function start(): Promise<void> {
  if (_running || _starting) {
    logger.warn("[dispatcher] Already running or starting — ignoring start()");
    return;
  }

  _starting = true;   // acquire mutex before any await
  try {
    await ensureWorkers();
  } catch (err) {
    _starting = false;
    throw err;
  }

  _running  = true;
  _starting = false;
  _startTimers();

  logger.info({ pollIntervalMs: _settings.workerPollIntervalMs, workers: _workerIds }, "[dispatcher] Started");
  await logAudit("job-dispatcher", "dispatcher_started", "dispatcher", "system", "success", {
    workerIds: _workerIds,
    settings:  _settings,
  });
}

/**
 * Stop polling. Workers remain registered and idle in DB.
 */
export async function stop(): Promise<void> {
  if (!_running) return;

  _running = false;
  _clearTimers();

  logger.info("[dispatcher] Stopped");
  await logAudit("job-dispatcher", "dispatcher_stopped", "dispatcher", "system", "success", {});
}

/**
 * Execute one full dispatch cycle regardless of the timer state.
 */
export async function tick(): Promise<TickResult> {
  _lastTick = new Date();
  const result: TickResult = { claimed: 0, completed: 0, failed: 0 };

  try {
    // 1. Recovery first (stale workers + stuck jobs) — always runs, even when paused
    await recover();

    // 2. Skip claim/dispatch when job queue is paused
    if (_queuePaused) {
      logger.debug("[dispatcher] Queue paused — skipping claim phase");
      return result;
    }

    if (_workerIds.length === 0) return result;

    // 3. Find idle workers managed by this dispatcher
    const idleWorkers = await db
      .select()
      .from(aiWorkersTable)
      .where(
        and(
          inArray(aiWorkersTable.id, _workerIds),
          eq(aiWorkersTable.status, "idle"),
        ),
      );

    if (idleWorkers.length === 0) return result;

    // 3. Cap by maxConcurrentJobs
    const currentBusy = _workerIds.length - idleWorkers.length;
    const slots       = Math.max(0, _settings.maxConcurrentJobs - currentBusy);
    const toDispatch  = idleWorkers.slice(0, slots);

    // 4. Dispatch jobs in parallel
    const outcomes = await Promise.allSettled(
      toDispatch.map((w) => dispatch(w.id)),
    );

    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled" && outcome.value !== null) {
        result.claimed++;
        if (outcome.value === "completed") result.completed++;
        else                               result.failed++;
      }
    }
  } catch (err) {
    logger.error({ err }, "[dispatcher] Uncaught error in tick()");
  }

  return result;
}

/**
 * Claim and execute one job for a given worker.
 * Returns "completed" | "failed" | null (if no job available).
 */
export async function dispatch(workerId: number): Promise<"completed" | "failed" | null> {
  try {
    const job = await claimJob(workerId);
    if (!job) return null;

    logger.debug({ jobId: job.id, jobType: job.jobType, workerId }, "[dispatcher] Job claimed");

    try {
      const result = await executeJob(job, workerId);
      await completeJob(job.id, workerId, result);
      _processedToday++;
      logger.debug({ jobId: job.id }, "[dispatcher] Job completed");
      return "completed";
    } catch (execErr) {
      const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
      await retryJob(job.id, workerId, errMsg);
      _failedToday++;
      logger.warn({ jobId: job.id, err: errMsg }, "[dispatcher] Job failed — retried");
      return "failed";
    }
  } catch (err) {
    logger.error({ err, workerId }, "[dispatcher] dispatch() error");
    return "failed";
  }
}

/**
 * Detect stale workers (heartbeat timeout) and stuck jobs (running too long).
 * Recover both, emit audit logs.
 */
export async function recover(): Promise<void> {
  const now = new Date();

  // ── Stale worker recovery ────────────────────────────────────────────────
  if (_workerIds.length > 0) {
    try {
      const cutoff    = new Date(now.getTime() - _settings.workerTimeoutMs).toISOString();
      const idList    = _workerIds.join(",");

      const rawStale = await db.execute(sql`
        SELECT * FROM ai_workers
        WHERE id IN (${sql.raw(idList)})
          AND status != 'offline'
          AND last_heartbeat < ${cutoff}::timestamptz
      `);
      const staleWorkers = (rawStale as unknown as { rows: Record<string, unknown>[] }).rows ?? [];

      for (const row of staleWorkers) {
        const workerId   = Number(row["id"]);
        const workerName = String(row["worker_name"] ?? "");
        const currentJob = row["current_job"] != null ? Number(row["current_job"]) : null;

        logger.warn({ workerId, workerName }, "[dispatcher] Stale worker — heartbeat timeout");

        // Release running job first (retryJob updates worker to idle)
        if (currentJob != null) {
          try {
            await retryJob(currentJob, workerId, "Worker heartbeat timeout");
          } catch (err) {
            logger.error({ err, jobId: currentJob }, "[dispatcher] Failed to retry stale job");
          }
        }

        // Mark worker offline
        await db
          .update(aiWorkersTable)
          .set({ status: "offline", currentJob: null, runningJobs: 0, updatedAt: now })
          .where(eq(aiWorkersTable.id, workerId));

        await logAudit("job-dispatcher", "worker_timeout", String(workerId), "ai_worker", "failure", {
          workerName,
          lastHeartbeat: row["last_heartbeat"],
          releasedJob:   currentJob,
        });
      }
    } catch (err) {
      logger.error({ err }, "[dispatcher] Stale worker recovery error");
    }
  }

  // ── Stuck job detector ────────────────────────────────────────────────────
  try {
    const jobCutoff = new Date(now.getTime() - _settings.jobTimeoutMs).toISOString();

    const rawStuck = await db.execute(sql`
      SELECT * FROM ai_jobs
      WHERE status = 'running'
        AND started_at < ${jobCutoff}::timestamptz
    `);
    const stuckJobs = (rawStuck as unknown as { rows: Record<string, unknown>[] }).rows ?? [];

    for (const row of stuckJobs) {
      const jobId = Number(row["id"]);
      logger.warn({ jobId }, "[dispatcher] Stuck job — execution timeout");

      // Find the worker holding this job
      const [holder] = await db
        .select()
        .from(aiWorkersTable)
        .where(eq(aiWorkersTable.currentJob, jobId));

      if (holder) {
        try {
          await retryJob(jobId, holder.id, "Job execution timeout");
        } catch (err) {
          logger.error({ err, jobId }, "[dispatcher] Failed to retry stuck job");
        }
      } else {
        // Orphaned running job — force back to queued
        await db
          .update(aiJobsTable)
          .set({ status: "queued", startedAt: null, updatedAt: now })
          .where(
            and(
              eq(aiJobsTable.id, jobId),
              eq(aiJobsTable.status, "running"),
            ),
          );
      }

      await logAudit("job-dispatcher", "job_timeout", String(jobId), "ai_job", "failure", {
        startedAt:  row["started_at"],
        timeoutMs:  _settings.jobTimeoutMs,
        hadWorker:  !!holder,
      });
    }
  } catch (err) {
    logger.error({ err }, "[dispatcher] Stuck job recovery error");
  }
}

/**
 * Graceful shutdown — stop polling and mark dispatcher workers offline.
 */
export async function shutdown(): Promise<void> {
  _running = false;
  _clearTimers();

  if (_workerIds.length > 0) {
    await db
      .update(aiWorkersTable)
      .set({ status: "offline", updatedAt: new Date() })
      .where(inArray(aiWorkersTable.id, _workerIds));
  }

  logger.info("[dispatcher] Shutdown complete");
  await logAudit("job-dispatcher", "dispatcher_shutdown", "dispatcher", "system", "success", {});
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _startTimers(): void {
  _pollTimer = setInterval(() => {
    tick().catch((err) => logger.error({ err }, "[dispatcher] Unhandled tick error"));
  }, _settings.workerPollIntervalMs);

  _heartbeatTimer = setInterval(() => {
    _heartbeat().catch((err) => logger.error({ err }, "[dispatcher] Heartbeat error"));
  }, _settings.workerHeartbeatIntervalMs);
}

function _clearTimers(): void {
  if (_pollTimer)      { clearInterval(_pollTimer);      _pollTimer      = null; }
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
}

async function _heartbeat(): Promise<void> {
  if (_workerIds.length === 0) return;

  _lastHeartbeat = new Date();

  await db
    .update(aiWorkersTable)
    .set({ lastHeartbeat: _lastHeartbeat, updatedAt: _lastHeartbeat })
    .where(
      and(
        inArray(aiWorkersTable.id, _workerIds),
        sql`status != 'offline'`,
      ),
    );
}
