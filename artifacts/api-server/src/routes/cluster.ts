/**
 * Cluster Routes — Phase 5.2 Distributed Worker Cluster
 *
 * GET  /api/ai/cluster/status
 * GET  /api/ai/cluster/workers
 * POST /api/ai/cluster/workers/register
 * PATCH /api/ai/cluster/workers/:id/lease
 * POST /api/ai/cluster/rebalance
 * POST /api/ai/cluster/recover-stale
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import { RegisterClusterWorkerBody, RenewLeaseBody } from "@workspace/api-zod";
import { db, aiWorkersTable } from "@workspace/db";
import {
  registerWorker,
  renewLease,
  markStaleWorkers,
  rebalanceJobs,
  getClusterStatus,
  getWorkerCapacity,
  WORKER_TYPE_CAPABILITIES,
} from "../services/workerClusterService.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── GET /api/ai/cluster/status ────────────────────────────────────────────────

router.get("/ai/cluster/status", async (_req, res): Promise<void> => {
  try {
    const statuses = await getClusterStatus();
    res.json(statuses);
  } catch (err) {
    logger.error({ err }, "[cluster] getClusterStatus failed");
    res.status(500).json({ error: "Failed to get cluster status" });
  }
});

// ── GET /api/ai/cluster/workers ────────────────────────────────────────────────

router.get("/ai/cluster/workers", async (_req, res): Promise<void> => {
  try {
    const workers = await getWorkerCapacity();
    res.json(workers);
  } catch (err) {
    logger.error({ err }, "[cluster] getWorkerCapacity failed");
    res.status(500).json({ error: "Failed to get worker capacity" });
  }
});

// ── POST /api/ai/cluster/workers/register ─────────────────────────────────────

router.post("/ai/cluster/workers/register", async (req, res): Promise<void> => {
  const body = RegisterClusterWorkerBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const {
    workerName,
    workerType,
    clusterId = "default",
    nodeId = "local",
    region = "local",
    version = "1.0.0",
    capabilities,
    maxConcurrentJobs = 2,
    leaseOwner = "api",
    leaseTtlMs,
  } = body.data;

  // Derive capabilities from workerType if not provided
  const resolvedCapabilities =
    capabilities ??
    WORKER_TYPE_CAPABILITIES[workerType] ??
    [];

  try {
    const worker = await registerWorker({
      workerName,
      workerType,
      clusterId,
      nodeId,
      region,
      version,
      capabilities: resolvedCapabilities,
      maxConcurrentJobs,
      leaseOwner,
      leaseTtlMs,
    });
    res.status(201).json(worker);
  } catch (err) {
    logger.error({ err }, "[cluster] registerWorker failed");
    res.status(500).json({ error: "Failed to register worker" });
  }
});

// ── PATCH /api/ai/cluster/workers/:id/lease ────────────────────────────────────

router.patch("/ai/cluster/workers/:id/lease", async (req, res): Promise<void> => {
  const workerId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(workerId)) {
    res.status(400).json({ error: "Invalid worker id" });
    return;
  }

  const body = RenewLeaseBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { heartbeatToken, leaseTtlMs } = body.data;

  try {
    const worker = await renewLease(workerId, heartbeatToken, leaseTtlMs);
    if (!worker) {
      res.status(409).json({ error: "Lease not renewed — token mismatch or worker not found" });
      return;
    }
    res.json(worker);
  } catch (err) {
    logger.error({ err }, "[cluster] renewLease failed");
    res.status(500).json({ error: "Failed to renew lease" });
  }
});

// ── POST /api/ai/cluster/rebalance ────────────────────────────────────────────

router.post("/ai/cluster/rebalance", async (_req, res): Promise<void> => {
  try {
    const staleIds = await markStaleWorkers();
    const recovered = await rebalanceJobs();
    res.json({ staleWorkers: staleIds.length, recoveredJobs: recovered });
  } catch (err) {
    logger.error({ err }, "[cluster] rebalance failed");
    res.status(500).json({ error: "Rebalance failed" });
  }
});

// ── POST /api/ai/cluster/recover-stale ────────────────────────────────────────

router.post("/ai/cluster/recover-stale", async (_req, res): Promise<void> => {
  try {
    const staleIds = await markStaleWorkers();
    const recovered = await rebalanceJobs();
    res.json({ staleWorkers: staleIds, recoveredJobs: recovered });
  } catch (err) {
    logger.error({ err }, "[cluster] recover-stale failed");
    res.status(500).json({ error: "Recovery failed" });
  }
});

export default router;
