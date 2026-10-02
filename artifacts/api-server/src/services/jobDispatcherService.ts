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
import {
  claimJob,
  executeJob,
  completeJob,
  retryJob,
  JobOwnershipLostError,
} from "./jobWorkerService.js";
import { validateJobCompletion } from "./jobCompletionGuard.js";
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
import { publishSafe } from "./aiEventBusService.js";
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
  {
    // Sprint P2.1.1 — dedicated worker for background archiving / optimization /
    // thumbnailing so these never wait behind (or compete with) image generation.
    suffix:            "3",
    workerType:        "storage_worker",
    capabilities:      WORKER_TYPE_CAPABILITIES["storage_worker"]!,
    maxConcurrentJobs: 4,
  },
  {
    // Coding workstream jobs are executed by the Core AI process itself.
    // The Ollama runtime registers a coding_worker for model inference/heartbeat,
    // but it does not poll ai_jobs, so a dispatcher-owned coding worker is
    // required to claim coding_workstream / coding_ai_execution queue items.
    suffix:            "4",
    workerType:        "coding_worker",
    capabilities:      WORKER_TYPE_CAPABILITIES["coding_worker"]!,
    maxConcurrentJobs: 5,
  },
];

if (process.env["BLENDER_WORKER_RUNTIME_ENABLED"] === "true") {
  DISPATCHER_WORKERS.push({
    suffix: "5",
    workerType: "3d_worker",
    capabilities: WORKER_TYPE_CAPABILITIES["3d_worker"]!,
    maxConcurrentJobs: 1,
  });
}

// ── Module state ──────────────────────────────────────────────────────────────

const _settings: DispatcherSettings = {
  dispatcherEnabled:        true,
  workerPollIntervalMs:     5_000,
  workerHeartbeatIntervalMs: 10_000,
  workerTimeoutMs:          60_000,
  jobTimeoutMs:            300_000,
  maxConcurrentJobs:             10,
};

let _running         = false;
let _starting        = false;
let _queuePaused     = false;
let _pollTimer: NodeJS.Timeout | null      = null;
let _heartbeatTimer: NodeJS.Timeout | null = null;
let _lastTick:        Date | null          = null;
let _lastHeartbeat:   Date | null          = null;
let _lastRecoveryAt: Date | null          = null;
const RECOVERY_INTERVAL_MS = 30_000;
let _processedToday  = 0;
let _failedToday     = 0;

// Phase 5.2: each entry holds worker identity + heartbeat token for lease renewal.
interface ManagedWorker { id: number; token: string; workerName: string; }
const _workers: ManagedWorker[] = [];

const CLUSTER_ID = "dispatcher";
// PID alone is not unique across overlapping deployment containers. A random
// process instance id prevents two rolling-deploy dispatchers from presenting
// the same lease owner and stealing each other's heartbeat token.
const DISPATCHER_INSTANCE_ID = randomUUID();
const DISPATCHER_NODE_ID =
  `node-${process.pid}-${DISPATCHER_INSTANCE_ID.slice(0, 8)}`;
const LEASE_OWNER =
  `dispatcher-${process.pid}-${DISPATCHER_INSTANCE_ID}`;

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
    SELECT COUNT(*)::int AS count FROM ai_platform.ai_jobs WHERE status IN ('queued', 'retrying')
  `).then((r) => (r as unknown as { rows: { count: number }[] }).rows[0]);

  const runningRow = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM ai_platform.ai_jobs WHERE status = 'running'
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
  const managedNames = new Set(_workers.map((worker) => worker.workerName));

  for (const cfg of DISPATCHER_WORKERS) {
    const workerName = `dispatcher-${cfg.suffix}`;
    if (managedNames.has(workerName)) continue;

    const token = randomUUID();
    const worker = await registerWorker({
      workerName,
      workerType: cfg.workerType,
      clusterId: CLUSTER_ID,
      nodeId: DISPATCHER_NODE_ID,
      region: "local",
      version: "5.2.0",
      capabilities: cfg.capabilities,
      maxConcurrentJobs: cfg.maxConcurrentJobs,
      leaseOwner: LEASE_OWNER,
      heartbeatToken: token,
      leaseTtlMs: DEFAULT_LEASE_TTL_MS,
    });

    // During a rolling deploy another live dispatcher instance may still own
    // this logical worker. In that case registerWorker() deliberately leaves
    // the existing lease untouched; this process simply retries later.
    if (worker.leaseOwner !== LEASE_OWNER) {
      logger.info(
        {
          workerId: worker.id,
          workerName,
          leaseOwner: worker.leaseOwner,
          requestedLeaseOwner: LEASE_OWNER,
        },
        "[dispatcher] Worker acquisition deferred to current live lease owner",
      );
      continue;
    }

    const [owned] = await db
      .update(aiWorkersTable)
      .set({
        status: "idle",
        currentJob: null,
        runningJobs: 0,
      })
      .where(
        and(
          eq(aiWorkersTable.id, worker.id),
          eq(aiWorkersTable.leaseOwner, LEASE_OWNER),
          eq(aiWorkersTable.heartbeatToken, token),
        ),
      )
      .returning({ id: aiWorkersTable.id });

    if (!owned) {
      logger.warn(
        { workerId: worker.id, workerName },
        "[dispatcher] Worker lease changed before local ownership was confirmed",
      );
      continue;
    }

    _workers.push({ id: worker.id, token, workerName });
    managedNames.add(workerName);
  }

  logger.info(
    {
      instanceId: DISPATCHER_INSTANCE_ID,
      leaseOwner: LEASE_OWNER,
      workers: _workers.map((worker) => ({
        id: worker.id,
        workerName: worker.workerName,
      })),
    },
    "[dispatcher] Workers ensured",
  );
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
    // A stopped/restarted dispatcher must rebuild its local token set from the
    // database rather than trusting stale in-memory lease handles.
    _workers.length = 0;
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
    instanceId: DISPATCHER_INSTANCE_ID,
    leaseOwner: LEASE_OWNER,
    settings: _settings,
  });

  publishSafe({ eventType: "dispatcher.started", sourceModule: "job-dispatcher", sourceId: "dispatcher",
    payload: { workerIds, pid: process.pid, instanceId: DISPATCHER_INSTANCE_ID } });
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
  publishSafe({ eventType: "dispatcher.stopped", sourceModule: "job-dispatcher", sourceId: "dispatcher", payload: {} });
}

/**
 * Execute one full dispatch cycle.
 */
export async function tick(): Promise<TickResult> {
  _lastTick = new Date();
  const result: TickResult = { claimed: 0, completed: 0, failed: 0 };

  try {
    // 1. Recovery is intentionally lower-frequency than queue polling.
    // Running stale-worker + stuck-job scans every 5s created avoidable DB load,
    // especially during deploys when heartbeat/audit traffic is already high.
    const nowMs = Date.now();
    if (!_lastRecoveryAt || nowMs - _lastRecoveryAt.getTime() >= RECOVERY_INTERVAL_MS) {
      _lastRecoveryAt = new Date(nowMs);
      await recover();
    }

    // 2. Skip claim/dispatch when paused
    if (_queuePaused) {
      logger.debug("[dispatcher] Queue paused — skipping claim phase");
      return result;
    }

    if (_workers.length === 0) return result;

    // 3. Find managed workers that still have capacity. A worker may stay
    // "busy" while it has free slots, so status=idle alone would serialize it.
    const workerIds = _workers.map((w) => w.id);
    const managedWorkers = await db
      .select()
      .from(aiWorkersTable)
      .where(
        and(
          inArray(aiWorkersTable.id, workerIds),
          inArray(aiWorkersTable.status, ["idle", "busy"]),
        ),
      );

    if (managedWorkers.length === 0) return result;

    // 4. Cap total dispatcher concurrency, then fill free worker slots in a
    // round-robin plan so one worker cannot monopolize every global slot.
    const currentRunning = managedWorkers.reduce(
      (sum, worker) => sum + Math.max(0, worker.runningJobs),
      0,
    );
    const globalSlots = Math.max(
      0,
      _settings.maxConcurrentJobs - currentRunning,
    );
    if (globalSlots === 0) return result;

    const slotState = managedWorkers.map((worker) => ({
      workerId: worker.id,
      remaining: Math.max(
        0,
        worker.maxConcurrentJobs - worker.runningJobs,
      ),
    }));
    const dispatchWorkerIds: number[] = [];

    while (dispatchWorkerIds.length < globalSlots) {
      let added = false;
      for (const slot of slotState) {
        if (slot.remaining <= 0) continue;
        dispatchWorkerIds.push(slot.workerId);
        slot.remaining -= 1;
        added = true;
        if (dispatchWorkerIds.length >= globalSlots) break;
      }
      if (!added) break;
    }

    if (dispatchWorkerIds.length === 0) return result;

    // 5. Dispatch all available slots in parallel. claimJob() serializes
    // capacity admission per worker in the database before each claim.
    const outcomes = await Promise.allSettled(
      dispatchWorkerIds.map((workerId) => dispatch(workerId)),
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
      // ── Phase 1B: completion guard ──────────────────────────────────────
      // File-producing jobs must have a real asset reference in their result.
      // If validation fails it throws DeliverableValidationError, which is
      // caught below and treated as a job failure — never as a completion.
      validateJobCompletion(job.jobType, result);
      await completeJob(job.id, workerId, result);
      _processedToday++;
      logger.debug({ jobId: job.id }, "[dispatcher] Job completed");
      return "completed";
    } catch (execErr) {
      const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
      if (execErr instanceof JobOwnershipLostError) {
        logger.warn({ jobId: job.id, workerId }, "[dispatcher] Job ownership lost — recovery won the race");
        return "failed";
      }
      await retryJob(job.id, workerId, errMsg);
      _failedToday++;
      logger.warn({ jobId: job.id, jobType: job.jobType, err: errMsg }, "[dispatcher] Job failed — retried");
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
    const staleIds = await markStaleWorkers();
    await rebalanceJobs();
    for (const workerId of staleIds) {
      publishSafe({ eventType: "worker.stale", sourceModule: "job-dispatcher", sourceId: String(workerId),
        payload: { workerId } });
    }
  } catch (err) {
    logger.error({ err }, "[dispatcher] Cluster stale recovery error");
  }

  // ── Stuck job detector ────────────────────────────────────────────────────
  try {
    const jobCutoff = new Date(now.getTime() - _settings.jobTimeoutMs).toISOString();

    const rawStuck = await db.execute(sql`
      SELECT * FROM ai_platform.ai_jobs
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
        const retryCount = Number(row["retry_count"] ?? 0);
        const maxRetry = Number(row["max_retry"] ?? 0);
        const nextRetryCount = retryCount + 1;
        const exhausted = nextRetryCount > maxRetry;

        await db
          .update(aiJobsTable)
          .set({
            status: exhausted ? "failed" : "queued",
            errorMessage: "Job execution timeout",
            retryCount: nextRetryCount,
            startedAt: exhausted ? undefined : null,
            completedAt: exhausted ? now : null,
            updatedAt: now,
          })
          .where(and(eq(aiJobsTable.id, jobId), eq(aiJobsTable.status, "running")));
      }

      await logAudit("job-dispatcher", "job_timeout", String(jobId), "ai_job", "failure", {
        startedAt: row["started_at"],
        timeoutMs: _settings.jobTimeoutMs,
        hadWorker: !!holder,
        retryCount: Number(row["retry_count"] ?? 0),
        maxRetry: Number(row["max_retry"] ?? 0),
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

  const releasedWorkerIds = _workers.map((w) => w.id);
  _workers.length = 0;

  logger.info("[dispatcher] Shutdown complete");
  await logAudit("job-dispatcher", "dispatcher_shutdown", "dispatcher", "system", "success", {
    workerIds: releasedWorkerIds,
    instanceId: DISPATCHER_INSTANCE_ID,
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
  _lastHeartbeat = new Date();

  // A newly started rolling-deploy instance can legitimately own zero workers
  // while the previous instance still holds live leases. Keep attempting to
  // acquire missing workers instead of requiring another process restart.
  if (_workers.length < DISPATCHER_WORKERS.length) {
    await ensureWorkers().catch((err) =>
      logger.error({ err }, "[dispatcher] Worker reacquisition failed"),
    );
  }

  if (_workers.length === 0) return;

  const snapshot = [..._workers];
  const results = await Promise.allSettled(
    snapshot.map(async (worker) => ({
      worker,
      renewed: await renewLease(
        worker.id,
        worker.token,
        DEFAULT_LEASE_TTL_MS,
      ),
    })),
  );

  const lostNames = new Set<string>();
  for (const result of results) {
    if (result.status === "rejected") {
      logger.error(
        { err: result.reason },
        "[dispatcher] Lease renewal failed",
      );
      continue;
    }

    if (result.value.renewed) continue;

    lostNames.add(result.value.worker.workerName);
    logger.warn(
      {
        workerId: result.value.worker.id,
        workerName: result.value.worker.workerName,
        leaseOwner: LEASE_OWNER,
      },
      "[dispatcher] Lease ownership lost; scheduling worker reacquisition",
    );
  }

  if (lostNames.size > 0) {
    for (let index = _workers.length - 1; index >= 0; index -= 1) {
      if (lostNames.has(_workers[index]!.workerName)) {
        _workers.splice(index, 1);
      }
    }
  }

  if (_workers.length < DISPATCHER_WORKERS.length) {
    await ensureWorkers().catch((err) =>
      logger.error({ err }, "[dispatcher] Worker reacquisition failed"),
    );
  }
}
