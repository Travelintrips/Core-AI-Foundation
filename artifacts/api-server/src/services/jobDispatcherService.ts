/**
 * Job Dispatcher Service — Phase 5.1 / 5.2 Worker Dispatcher Runtime
 *
 * Phase 5.2 additions:
 *  - Workers registered via workerClusterService (cluster identity + lease)
 *  - Heartbeat renews leases for all managed workers
 *  - Dispatcher workers differentiated by capability (text vs image vs system)
 *  - Stale detection delegated to workerClusterService.markStaleWorkers()
 *
 * startDispatcher()       — register workers with leases, start poll + heartbeat timers
 * stopDispatcher()        — clear timers, release worker leases
 * tick()                  — one poll cycle: recover → claim → execute
 * dispatch()              — claim and execute one job for a given worker
 * recover()               — stale workers + stuck jobs recovery
 * shutdown()              — graceful shutdown with lease release
 * getStatus()             — runtime snapshot
 */

import { eq, and, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, aiJobsTable, aiWorkersTable } from "@workspace/db";
import { claimJob, executeJob, completeJob, retryJob } from "./jobWorkerService.js";
import {
  registerWorker,
  renewLease,
  releaseLease,
  markStaleWorkers,
  rebalanceJobs,
  DEFAULT_LEASE_TTL_MS,
  WORKER_TYPE_CAPABILITIES,
} from "./workerClusterService.js";
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

// ── Dispatcher worker configs (Phase 5.2) ─────────────────────────────────────

interface WorkerConfig {
  suffix: string;
  workerType: string;
  capabilities: string[];
  maxConcurrentJobs: number;
}

const DISPATCHER_WORKERS: WorkerConfig[] = [
  {
    suffix:            "1",
    workerType:        "text_worker",
    capabilities:      WORKER_TYPE_CAPABILITIES["text_worker"]!,
    maxConcurrentJobs: 3,
  },
  {
    suffix:            "2",
    workerType:        "image_worker",
    capabilities:      [
      ...WORKER_TYPE_CAPABILITIES["image_worker"]!,
      ...WORKER_TYPE_CAPABILITIES["export_worker"]!,
      ...WORKER_TYPE_CAPABILITIES["system_worker"]!,
      "noop",
      "custom",
    ],
    maxConcurrentJobs: 3,
  },
];

// ── Module state ──────────────────────────────────────────────────────────────

const _settings: DispatcherSettings = {
  dispatcherEnabled:        true,
  workerPollIntervalMs:     5_000,
  workerHeartbeatIntervalMs: 10_000,
  workerTimeoutMs:          60_000,
  jobTimeoutMs:            300_000,
  maxConcurrentJobs:             5,
};

let _running         = false;
let _starting        = false;
let _queuePaused     = false;
let _pollTimer: NodeJS.Timeout | null      = null;
let _heartbeatTimer: NodeJS.Timeout | null = null;
let _lastTick:        Date | null          = null;
let _lastHeartbeat:   Date | null          = null;
let _processedToday  = 0;
let _failedToday     = 0;

// Phase 5.2: each entry holds worker id + heartbeat token for lease renewal
interface ManagedWorker { id: number; token: string; }
const _workers: ManagedWorker[] = [];

const CLUSTER_ID   = "dispatcher";
const LEASE_OWNER  = `dispatcher-pid-${process.pid}`;

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

  const workerIds = _workers.map((w) => w.id);

  if (workerIds.length > 0) {
    const workers = await db
      .select()
      .from(aiWorkersTable)
      .where(inArray(aiWorkersTable.id, workerIds));

    idleWorkers = workers.filter((w) => w.status === "idle" || w.status === "online").length;
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
    workerCount:    workerIds.length,
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
 * Register dispatcher-owned workers via the cluster service (Phase 5.2).
 * Each worker gets cluster identity, capability set, and a fresh lease.
 */
export async function ensureWorkers(): Promise<void> {
  _workers.length = 0;

  const nodeId = `node-${process.pid}`;

  for (const cfg of DISPATCHER_WORKERS) {
    const workerName = `dispatcher-${cfg.suffix}`;
    const token      = randomUUID();

    const worker = await registerWorker({
      workerName,
      workerType:       cfg.workerType,
      clusterId:        CLUSTER_ID,
      nodeId,
      region:           "local",
      version:          "5.2.0",
      capabilities:     cfg.capabilities,
      maxConcurrentJobs: cfg.maxConcurrentJobs,
      leaseOwner:       LEASE_OWNER,
      leaseTtlMs:       DEFAULT_LEASE_TTL_MS,
    });

    // Overwrite the heartbeat_token with one we control (registerWorker generates its own,
    // but we need to track it for lease renewal)
    await db
      .update(aiWorkersTable)
      .set({ heartbeatToken: token, status: "idle", currentJob: null, runningJobs: 0 })
      .where(eq(aiWorkersTable.id, worker.id));

    _workers.push({ id: worker.id, token });
  }

  logger.info({ workers: _workers.map((w) => w.id) }, "[dispatcher] Workers ensured");
}

/**
 * Notify dispatcher that the job queue has been paused or resumed.
 */
export function setQueuePaused(paused: boolean): void {
  _queuePaused = paused;
  logger.info({ paused }, "[dispatcher] Queue paused state updated");
}

/**
 * Start the dispatcher. Safe to call multiple times.
 */
export async function start(): Promise<void> {
  if (_running || _starting) {
    logger.warn("[dispatcher] Already running or starting — ignoring start()");
    return;
  }

  _starting = true;
  try {
    await ensureWorkers();
  } catch (err) {
    _starting = false;
    throw err;
  }

  _running  = true;
  _starting = false;
  _startTimers();

  const workerIds = _workers.map((w) => w.id);
  logger.info({ pollIntervalMs: _settings.workerPollIntervalMs, workers: workerIds }, "[dispatcher] Started");
  await logAudit("job-dispatcher", "dispatcher_started", "dispatcher", "system", "success", {
    workerIds,
    settings: _settings,
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
 * Execute one full dispatch cycle.
 */
export async function tick(): Promise<TickResult> {
  _lastTick = new Date();
  const result: TickResult = { claimed: 0, completed: 0, failed: 0 };

  try {
    // 1. Recovery (stale workers + stuck jobs) — always runs
    await recover();

    // 2. Skip claim/dispatch when paused
    if (_queuePaused) {
      logger.debug("[dispatcher] Queue paused — skipping claim phase");
      return result;
    }

    if (_workers.length === 0) return result;

    // 3. Find idle managed workers
    const workerIds = _workers.map((w) => w.id);
    const idleWorkers = await db
      .select()
      .from(aiWorkersTable)
      .where(
        and(
          inArray(aiWorkersTable.id, workerIds),
          eq(aiWorkersTable.status, "idle"),
        ),
      );

    if (idleWorkers.length === 0) return result;

    // 4. Cap by maxConcurrentJobs setting
    const currentBusy = workerIds.length - idleWorkers.length;
    const slots       = Math.max(0, _settings.maxConcurrentJobs - currentBusy);
    const toDispatch  = idleWorkers.slice(0, slots);

    // 5. Dispatch in parallel
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
 * Detect stale workers and stuck jobs, recover them.
 * Phase 5.2: delegates stale detection to workerClusterService.
 */
export async function recover(): Promise<void> {
  const now = new Date();

  // ── Phase 5.2: lease-based stale detection ──────────────────────────────
  try {
    await markStaleWorkers();
    await rebalanceJobs();
  } catch (err) {
    logger.error({ err }, "[dispatcher] Cluster stale recovery error");
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
        await db
          .update(aiJobsTable)
          .set({ status: "queued", startedAt: null, updatedAt: now })
          .where(and(eq(aiJobsTable.id, jobId), eq(aiJobsTable.status, "running")));
      }

      await logAudit("job-dispatcher", "job_timeout", String(jobId), "ai_job", "failure", {
        startedAt: row["started_at"],
        timeoutMs: _settings.jobTimeoutMs,
        hadWorker: !!holder,
      });
    }
  } catch (err) {
    logger.error({ err }, "[dispatcher] Stuck job recovery error");
  }
}

/**
 * Graceful shutdown — stop polling, release leases, mark workers offline.
 */
export async function shutdown(): Promise<void> {
  _running = false;
  _clearTimers();

  // Release leases for all managed workers
  for (const w of _workers) {
    try {
      await releaseLease(w.id, w.token);
    } catch (err) {
      logger.error({ err, workerId: w.id }, "[dispatcher] Failed to release lease on shutdown");
    }
  }

  logger.info("[dispatcher] Shutdown complete");
  await logAudit("job-dispatcher", "dispatcher_shutdown", "dispatcher", "system", "success", {
    workerIds: _workers.map((w) => w.id),
  });
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

/**
 * Write heartbeat to DB and renew leases for all managed workers.
 */
async function _heartbeat(): Promise<void> {
  if (_workers.length === 0) return;
  _lastHeartbeat = new Date();

  await Promise.allSettled(
    _workers.map((w) =>
      renewLease(w.id, w.token, DEFAULT_LEASE_TTL_MS).catch((err) =>
        logger.error({ err, workerId: w.id }, "[dispatcher] Lease renewal failed"),
      ),
    ),
  );
}
