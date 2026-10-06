/**
 * Worker Cluster Service — Phase 5.2 Distributed Worker Cluster
 *
 * registerNode()      — record a cluster node (returns node descriptor)
 * registerWorker()    — create/upsert a worker with cluster identity + lease
 * renewLease()        — extend lease TTL and increment lock_version
 * releaseLease()      — clear lease, mark worker offline
 * markStaleWorkers()  — find workers with expired leases → status "stale"
 * rebalanceJobs()     — return running jobs from stale workers to the queue
 * getClusterStatus()  — aggregate cluster health snapshot
 * getWorkerCapacity() — per-worker capacity breakdown
 */

import { eq, and, inArray, sql, ne } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, aiWorkersTable, aiJobsTable, withTransientDatabaseRetry } from "@workspace/db";
import type { AiWorker } from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { failRepositoryAnalyzerRun } from "./repositoryAnalyzerService.js";
import { recoverFailedCodingWorkstreamJob } from "./localCodingMultiWorkerExecutionService.js";
import {
  CODING_WORKSTREAM_AI_JOB_TYPE,
  recoverFailedCodingWorkstreamAiJob,
} from "./localCodingWorkstreamAiExecutionService.js";
import { logger } from "../lib/logger.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEFAULT_LEASE_TTL_MS  = 60_000;  // 60 s
export const STALE_HEARTBEAT_MS    = 90_000;  // 90 s without heartbeat → stale
export const MAX_ACTIVE_JOBS_PER_WORKER = 1;
const WORKER_CLAIM_PAYLOAD_KEY = "_claimedByWorkerId";

// ── Capability map ────────────────────────────────────────────────────────────

export const WORKER_TYPE_CAPABILITIES: Record<string, string[]> = {
  text_worker:   ["llm_inference", "creative_text", "qc_review", "creative_brief", "coding_repository_analyzer"],
  coding_worker: ["coding_ai_execution", "coding_workstream", "coding_multi_task_planner"],
  image_worker:  ["image_generation", "image_qc", "image_upscale", "universal_render"],
  "3d_worker":     ["3d_scene_build", "3d_render", "3d_turntable", "3d_export_glb", "3d_export_gltf", "3d_material_apply", "3d_camera_render"],
  export_worker: ["pdf_export", "pptx_export", "csv_export", "report_generation", "image_batch_export"],
  system_worker: ["analytics", "cleanup", "custom", "scoring", "notification"],
  // Sprint P2.1.1 — dedicated storage/archive worker so archiving/thumbnailing
  // never contends with (or blocks on) image generation slots.
  storage_worker: ["archive_asset", "optimize_asset", "generate_thumbnail"],
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NodeDescriptor {
  clusterId: string;
  nodeId: string;
  region: string;
  version: string;
  pid: number;
}

export interface RegisterWorkerInput {
  workerName: string;
  workerType: string;
  clusterId: string;
  nodeId: string;
  region?: string;
  version?: string;
  capabilities: string[];
  maxConcurrentJobs?: number;
  leaseOwner: string;
  heartbeatToken?: string;
  leaseTtlMs?: number;
  providerSlug?: string | null;
  modelId?: string | null;
  endpointUrl?: string | null;
  runtimeKind?: string | null;
}

export interface ClusterStatus {
  clusterId: string;
  totalWorkers: number;
  onlineWorkers: number;
  idleWorkers: number;
  busyWorkers: number;
  staleWorkers: number;
  offlineWorkers: number;
  totalCapacity: number;
  usedCapacity: number;
  capacityPct: number;
  nodes: string[];
}

export interface WorkerCapacityItem {
  id: number;
  workerName: string;
  workerType: string;
  status: string;
  clusterId: string;
  nodeId: string;
  region: string;
  capabilities: string[];
  maxConcurrentJobs: number;
  runningJobs: number;
  availableSlots: number;
  providerSlug: string | null;
  modelId: string | null;
  endpointUrl: string | null;
  runtimeKind: string | null;
  leaseValid: boolean;
  leaseExpiresAt: string | null;
  lastHeartbeat: string;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record a cluster node descriptor (informational — no DB row for nodes).
 */
export function registerNode(input: {
  clusterId?: string;
  region?: string;
  version?: string;
}): NodeDescriptor {
  return {
    clusterId: input.clusterId ?? "default",
    nodeId: `node-${randomUUID().slice(0, 8)}`,
    region: input.region ?? "local",
    version: input.version ?? "1.0.0",
    pid: process.pid,
  };
}

/**
 * Create or upsert a worker with cluster identity and fresh lease.
 */
export async function registerWorker(input: RegisterWorkerInput): Promise<AiWorker> {
  const now = new Date();
  const token = input.heartbeatToken ?? randomUUID();
  const leaseExpires = new Date(
    now.getTime() + (input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS),
  );
  const lockKey = `worker-register:${input.workerName}`;

  const registration = await withTransientDatabaseRetry(
    () =>
      db.transaction(async (tx) => {
        // Serialize registration for one logical worker name so overlapping
        // rolling-deploy instances cannot overwrite each other's heartbeat
        // token between SELECT and UPDATE.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`,
        );

        const [existing] = await tx
          .select()
          .from(aiWorkersTable)
          .where(eq(aiWorkersTable.workerName, input.workerName))
          .for("update");

        const heldByAnotherLiveOwner =
          Boolean(existing) &&
          existing!.leaseOwner !== input.leaseOwner &&
          existing!.leaseExpiresAt !== null &&
          existing!.leaseExpiresAt > now &&
          !["offline", "stale"].includes(existing!.status);

        if (existing && heldByAnotherLiveOwner) {
          return { worker: existing, acquired: false };
        }

        const workerValues = {
          workerType: input.workerType,
          clusterId: input.clusterId,
          nodeId: input.nodeId,
          region: input.region ?? "local",
          version: input.version ?? "1.0.0",
          capabilities: input.capabilities,
          maxConcurrentJobs: MAX_ACTIVE_JOBS_PER_WORKER,
          providerSlug: input.providerSlug ?? null,
          modelId: input.modelId ?? null,
          endpointUrl: input.endpointUrl ?? null,
          runtimeKind: input.runtimeKind ?? null,
          status: "online" as const,
          leaseOwner: input.leaseOwner,
          leaseExpiresAt: leaseExpires,
          heartbeatToken: token,
          lastHeartbeat: now,
          updatedAt: now,
        };

        if (existing) {
          const [worker] = await tx
            .update(aiWorkersTable)
            .set({
              ...workerValues,
              lockVersion: sql`lock_version + 1`,
            })
            .where(eq(aiWorkersTable.id, existing.id))
            .returning();
          return { worker, acquired: true };
        }

        const [worker] = await tx
          .insert(aiWorkersTable)
          .values({
            workerName: input.workerName,
            ...workerValues,
            lockVersion: 0,
          })
          .returning();
        return { worker, acquired: true };
      }),
    { attempts: 3, baseDelayMs: 250 },
  );

  const worker = registration.worker;
  if (!worker) {
    throw new Error(`Failed to register worker ${input.workerName}`);
  }

  if (!registration.acquired) {
    logger.info(
      {
        workerId: worker.id,
        workerName: worker.workerName,
        leaseOwner: worker.leaseOwner,
        requestedLeaseOwner: input.leaseOwner,
        leaseExpiresAt: worker.leaseExpiresAt,
      },
      "[cluster] Worker registration deferred; live lease is owned by another dispatcher instance",
    );
    return worker;
  }

  await logAudit(
    "worker-cluster",
    "worker_registered",
    String(worker.id),
    "ai_worker",
    "success",
    {
      workerName: worker.workerName,
      workerType: worker.workerType,
      capabilities: input.capabilities,
      leaseOwner: input.leaseOwner,
    },
  );

  logger.info(
    {
      workerId: worker.id,
      workerName: worker.workerName,
      workerType: worker.workerType,
      leaseOwner: input.leaseOwner,
    },
    "[cluster] Worker registered",
  );

  return worker;
}

/**
 * Extend a worker's lease TTL and bump lock_version.
 */
export async function renewLease(
  workerId: number,
  heartbeatToken: string,
  leaseTtlMs = DEFAULT_LEASE_TTL_MS,
): Promise<AiWorker | null> {
  const now = new Date();
  const expires = new Date(now.getTime() + leaseTtlMs);

  const [worker] = await withTransientDatabaseRetry(() => db
    .update(aiWorkersTable)
    .set({
      leaseExpiresAt: expires,
      lockVersion:    sql`lock_version + 1`,
      lastHeartbeat:  now,
      maxConcurrentJobs: MAX_ACTIVE_JOBS_PER_WORKER,
      // Keep updated_at as a state-transition/reservation timestamp. If a
      // heartbeat refreshed it every few seconds, stale hosted-Ollama
      // reservations could never age out in recoverStaleOllamaReservations().
      updatedAt:      sql`updated_at`,
    })
    .where(
      and(
        eq(aiWorkersTable.id, workerId),
        eq(aiWorkersTable.heartbeatToken, heartbeatToken),
      ),
    )
    .returning(), { attempts: 3, baseDelayMs: 200 });

  // Successful lease heartbeats are high-frequency state maintenance, not
  // business events. Do not emit an audit INSERT every 10 seconds per worker;
  // that extra write amplified DB pressure and could destabilize the very lease
  // we are trying to keep alive. Registration/stale/recovery events remain audited.
  return worker ?? null;
}

/**
 * Release a worker's lease and mark it offline.
 */
export async function releaseLease(workerId: number, heartbeatToken: string): Promise<void> {
  await db
    .update(aiWorkersTable)
    .set({
      status:         "offline",
      leaseOwner:     null,
      leaseExpiresAt: null,
      heartbeatToken: null,
      updatedAt:      new Date(),
    })
    .where(
      and(
        eq(aiWorkersTable.id, workerId),
        eq(aiWorkersTable.heartbeatToken, heartbeatToken),
      ),
    );

  await logAudit("worker-cluster", "worker_shutdown", String(workerId), "ai_worker", "success", {});
}

/**
 * Mark workers with expired leases (or stale heartbeats) as "stale".
 * Returns the list of stale worker IDs.
 */
export async function markStaleWorkers(): Promise<number[]> {
  const now = new Date();
  const staleHeartbeatCutoff = new Date(now.getTime() - STALE_HEARTBEAT_MS);

  const stale = await db
    .update(aiWorkersTable)
    .set({ status: "stale", updatedAt: now })
    .where(
      and(
        ne(aiWorkersTable.status, "offline"),
        ne(aiWorkersTable.status, "stale"),
        sql`(
          (lease_expires_at IS NOT NULL AND lease_expires_at < ${now})
          OR
          last_heartbeat < ${staleHeartbeatCutoff}
        )`,
      ),
    )
    .returning({ id: aiWorkersTable.id, workerName: aiWorkersTable.workerName });

  for (const w of stale) {
    // Emit lease_expired when the stale condition is lease-driven
    await logAudit("worker-cluster", "lease_expired", String(w.id), "ai_worker", "failure", {
      workerName: w.workerName,
    });
    await logAudit("worker-cluster", "worker_stale", String(w.id), "ai_worker", "failure", {
      workerName: w.workerName,
    });
    logger.warn({ workerId: w.id, workerName: w.workerName }, "[cluster] Worker marked stale");
  }

  return stale.map((w) => w.id);
}

/**
 * Recover running jobs owned by stale workers — requeue them.
 * Returns count of recovered jobs.
 */
export async function rebalanceJobs(): Promise<number> {
  const recovery = await db.transaction(async (tx) => {
    const staleWorkers = await tx
      .select({ id: aiWorkersTable.id, currentJob: aiWorkersTable.currentJob })
      .from(aiWorkersTable)
      .where(eq(aiWorkersTable.status, "stale"));

    if (staleWorkers.length === 0) {
      return { staleIds: [], recovered: [] as Record<string, unknown>[] };
    }

    const staleIds = staleWorkers.map((worker) => worker.id);
    const currentJobIds = staleWorkers
      .map((worker) => worker.currentJob)
      .filter((jobId): jobId is number => jobId != null);
    const ownershipClauses = [
      ...(currentJobIds.length > 0
        ? [sql`j.id IN (${sql.join(currentJobIds.map((id) => sql`${id}`), sql`, `)})`]
        : []),
      sql`j.payload_json->>${WORKER_CLAIM_PAYLOAD_KEY} IN (${sql.join(
        staleIds.map((id) => sql`${String(id)}`),
        sql`, `,
      )})`,
    ];
    const now = new Date();
    const ownership = sql.join(ownershipClauses, sql` OR `);

    const rawRecovered = await tx.execute(sql`
      UPDATE ai_platform.ai_jobs AS j
      SET
        status = CASE WHEN j.retry_count + 1 > j.max_retry THEN 'failed' ELSE 'retrying' END,
        retry_count = j.retry_count + 1,
        next_retry_at = CASE WHEN j.retry_count + 1 > j.max_retry THEN NULL ELSE ${now}::timestamptz END,
        started_at = NULL,
        completed_at = CASE WHEN j.retry_count + 1 > j.max_retry THEN ${now}::timestamptz ELSE j.completed_at END,
        error_message = 'Worker lease expired before completion',
        payload_json = COALESCE(j.payload_json, '{}'::jsonb) - ${WORKER_CLAIM_PAYLOAD_KEY},
        updated_at = ${now}::timestamptz
      WHERE j.status = 'running'
        AND (${ownership})
      RETURNING j.id, j.status, j.job_type, j.payload_json
    `);
    const recovered =
      (rawRecovered as unknown as { rows: Record<string, unknown>[] }).rows ?? [];

    await tx
      .update(aiWorkersTable)
      .set({
        status: "offline",
        currentJob: null,
        runningJobs: 0,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatToken: null,
        updatedAt: now,
      })
      .where(inArray(aiWorkersTable.id, staleIds));

    return { staleIds, recovered };
  });

  for (const row of recovery.recovered) {
    if (row["status"] !== "failed") continue;
    if (row["job_type"] === "coding_repository_analyzer") {
      await failRepositoryAnalyzerRun(
        (row["payload_json"] ?? {}) as Record<string, unknown>,
        "Worker lease expired before completion",
      );
    }
    if (row["job_type"] === "coding_workstream_execution") {
      await recoverFailedCodingWorkstreamJob(
        (row["payload_json"] ?? {}) as Record<string, unknown>,
        "Worker lease expired before completion",
      );
    }
    if (row["job_type"] === CODING_WORKSTREAM_AI_JOB_TYPE) {
      await recoverFailedCodingWorkstreamAiJob(
        (row["payload_json"] ?? {}) as Record<string, unknown>,
        "Worker lease expired before completion",
      );
    }
  }

  if (recovery.recovered.length > 0) {
    await logAudit("worker-cluster", "job_rebalanced", "cluster", "ai_cluster", "success", {
      recoveredJobs: recovery.recovered.length,
      staleWorkers: recovery.staleIds,
    });
    logger.info(
      { recoveredJobs: recovery.recovered.length, staleWorkers: recovery.staleIds },
      "[cluster] Jobs rebalanced",
    );
  }

  for (const row of recovery.recovered) {
    await logAudit("worker-cluster", "stale_job_recovered", String(row["id"]), "ai_job", "success", {
      terminal: row["status"] === "failed",
    });
  }

  return recovery.recovered.length;
}

/**
 * Return an aggregate snapshot of the cluster.
 */
export async function getClusterStatus(): Promise<ClusterStatus[]> {
  const workers = await db.select().from(aiWorkersTable);

  // Group by cluster
  const byCluster: Record<string, typeof workers> = {};
  for (const w of workers) {
    const c = w.clusterId;
    if (!byCluster[c]) byCluster[c] = [];
    byCluster[c].push(w);
  }

  const now = new Date();

  return Object.entries(byCluster).map(([clusterId, wlist]) => {
    const totalCapacity = wlist.length * MAX_ACTIVE_JOBS_PER_WORKER;
    const usedCapacity  = wlist.reduce((s, w) => s + w.runningJobs, 0);
    const nodes = [...new Set(wlist.map((w) => w.nodeId))];

    return {
      clusterId,
      totalWorkers:   wlist.length,
      onlineWorkers:  wlist.filter((w) => w.status === "online" || w.status === "idle").length,
      idleWorkers:    wlist.filter((w) => w.status === "idle").length,
      busyWorkers:    wlist.filter((w) => w.status === "busy").length,
      staleWorkers:   wlist.filter((w) => w.status === "stale").length,
      offlineWorkers: wlist.filter((w) => w.status === "offline").length,
      totalCapacity,
      usedCapacity,
      capacityPct: totalCapacity > 0 ? Math.round((usedCapacity / totalCapacity) * 100) : 0,
      nodes,
    };
  });
}

/**
 * Return per-worker capacity and lease details.
 */
export async function getWorkerCapacity(): Promise<WorkerCapacityItem[]> {
  const workers = await db.select().from(aiWorkersTable);
  const now = new Date();

  return workers.map((w) => ({
    id:                w.id,
    workerName:        w.workerName,
    workerType:        w.workerType,
    status:            w.status,
    clusterId:         w.clusterId,
    nodeId:            w.nodeId,
    region:            w.region,
    capabilities:      (w.capabilities as string[]) ?? [],
    maxConcurrentJobs: MAX_ACTIVE_JOBS_PER_WORKER,
    runningJobs:       w.runningJobs,
    availableSlots:    Math.max(0, MAX_ACTIVE_JOBS_PER_WORKER - w.runningJobs),
    providerSlug:      w.providerSlug ?? null,
    modelId:           w.modelId ?? null,
    endpointUrl:       w.endpointUrl ?? null,
    runtimeKind:       w.runtimeKind ?? null,
    leaseValid:        !!(w.leaseExpiresAt && w.leaseExpiresAt > now),
    leaseExpiresAt:    w.leaseExpiresAt?.toISOString() ?? null,
    lastHeartbeat:     w.lastHeartbeat.toISOString(),
  }));
}
