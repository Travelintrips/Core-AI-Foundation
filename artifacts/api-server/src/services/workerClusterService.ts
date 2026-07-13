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

import { eq, and, lt, inArray, sql, isNotNull, ne } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, aiWorkersTable, aiJobsTable } from "@workspace/db";
import type { AiWorker } from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { logger } from "../lib/logger.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEFAULT_LEASE_TTL_MS  = 60_000;  // 60 s
export const STALE_HEARTBEAT_MS    = 90_000;  // 90 s without heartbeat → stale

// ── Capability map ────────────────────────────────────────────────────────────

export const WORKER_TYPE_CAPABILITIES: Record<string, string[]> = {
  text_worker:   ["llm_inference", "creative_text", "qc_review", "creative_brief"],
  image_worker:  ["image_generation", "image_qc", "image_upscale"],
  export_worker: ["pdf_export", "pptx_export", "csv_export", "report_generation"],
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
  leaseTtlMs?: number;
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
  const token = randomUUID();
  const leaseExpires = new Date(now.getTime() + (input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS));

  const [worker] = await db
    .insert(aiWorkersTable)
    .values({
      workerName:       input.workerName,
      workerType:       input.workerType,
      clusterId:        input.clusterId,
      nodeId:           input.nodeId,
      region:           input.region ?? "local",
      version:          input.version ?? "1.0.0",
      capabilities:     input.capabilities,
      maxConcurrentJobs: input.maxConcurrentJobs ?? 2,
      status:           "online",
      leaseOwner:       input.leaseOwner,
      leaseExpiresAt:   leaseExpires,
      heartbeatToken:   token,
      lockVersion:      0,
      lastHeartbeat:    now,
    })
    .onConflictDoUpdate({
      target: aiWorkersTable.workerName,
      set: {
        workerType:       input.workerType,
        clusterId:        input.clusterId,
        nodeId:           input.nodeId,
        region:           input.region ?? "local",
        version:          input.version ?? "1.0.0",
        capabilities:     input.capabilities,
        maxConcurrentJobs: input.maxConcurrentJobs ?? 2,
        status:           "online",
        leaseOwner:       input.leaseOwner,
        leaseExpiresAt:   leaseExpires,
        heartbeatToken:   token,
        lockVersion:      sql`ai_workers.lock_version + 1`,
        lastHeartbeat:    now,
        updatedAt:        now,
      },
    })
    .returning();

  await logAudit(
    "worker-cluster",
    "worker_registered",
    String(worker.id),
    "ai_worker",
    "success",
    { workerName: worker.workerName, workerType: worker.workerType, capabilities: input.capabilities },
  );

  logger.info(
    { workerId: worker.id, workerName: worker.workerName, workerType: worker.workerType },
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

  const [worker] = await db
    .update(aiWorkersTable)
    .set({
      leaseExpiresAt: expires,
      lockVersion:    sql`lock_version + 1`,
      lastHeartbeat:  now,
      updatedAt:      now,
    })
    .where(
      and(
        eq(aiWorkersTable.id, workerId),
        eq(aiWorkersTable.heartbeatToken, heartbeatToken),
      ),
    )
    .returning();

  if (worker) {
    await logAudit("worker-cluster", "lease_renewed", String(workerId), "ai_worker", "success", {
      expiresAt: expires.toISOString(),
    });
  }

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
  // Find stale workers with running jobs
  const staleWorkers = await db
    .select({ id: aiWorkersTable.id })
    .from(aiWorkersTable)
    .where(eq(aiWorkersTable.status, "stale"));

  if (staleWorkers.length === 0) return 0;

  const staleIds = staleWorkers.map((w) => w.id);
  const now = new Date();

  // Return their running jobs to queued
  const recovered = await db
    .update(aiJobsTable)
    .set({
      status:    "queued",
      startedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(aiJobsTable.status, "running"),
        sql`employee_id IN (${sql.join(staleIds.map((id) => sql`${id}`), sql`, `)})`,
      ),
    )
    .returning({ id: aiJobsTable.id });

  // Also recover jobs where the stale worker's current_job field matches
  // (these may have no employee_id reference — find via running jobs without worker)
  const recoveredGeneral = await db
    .update(aiJobsTable)
    .set({ status: "queued", startedAt: null, updatedAt: now })
    .where(
      and(
        eq(aiJobsTable.status, "running"),
        sql`NOT EXISTS (
          SELECT 1 FROM ai_workers
          WHERE ai_workers.current_job = ai_jobs.id
          AND ai_workers.status NOT IN ('stale', 'offline')
        )`,
      ),
    )
    .returning({ id: aiJobsTable.id });

  // Reset stale workers
  await db
    .update(aiWorkersTable)
    .set({
      status:     "offline",
      currentJob: null,
      runningJobs: 0,
      leaseOwner:     null,
      leaseExpiresAt: null,
      heartbeatToken: null,
      updatedAt:  now,
    })
    .where(inArray(aiWorkersTable.id, staleIds));

  const total = recovered.length + recoveredGeneral.length;

  if (total > 0) {
    await logAudit("worker-cluster", "job_rebalanced", "cluster", "ai_cluster", "success", {
      recoveredJobs: total,
      staleWorkers: staleIds,
    });
    logger.info({ recoveredJobs: total, staleWorkers: staleIds }, "[cluster] Jobs rebalanced");
  }

  // Log each recovered job
  const allRecovered = [...recovered, ...recoveredGeneral];
  for (const j of allRecovered) {
    await logAudit("worker-cluster", "stale_job_recovered", String(j.id), "ai_job", "success", {});
  }

  return total;
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
    const totalCapacity = wlist.reduce((s, w) => s + w.maxConcurrentJobs, 0);
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
    maxConcurrentJobs: w.maxConcurrentJobs,
    runningJobs:       w.runningJobs,
    availableSlots:    Math.max(0, w.maxConcurrentJobs - w.runningJobs),
    leaseValid:        !!(w.leaseExpiresAt && w.leaseExpiresAt > now),
    leaseExpiresAt:    w.leaseExpiresAt?.toISOString() ?? null,
    lastHeartbeat:     w.lastHeartbeat.toISOString(),
  }));
}
