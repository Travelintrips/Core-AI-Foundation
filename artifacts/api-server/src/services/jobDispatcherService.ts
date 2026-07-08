/**
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
