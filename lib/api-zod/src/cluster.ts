/**
 * Phase 5.2 — Cluster request body schemas (manual, not generated).
 * Keeps the same conventions as the generated api.ts file.
 */
import * as zod from "zod";

export const RegisterClusterWorkerBody = zod.object({
  workerName:        zod.string().min(1),
  workerType:        zod.enum(["text_worker", "image_worker", "export_worker", "system_worker"]),
  clusterId:         zod.string().optional(),
  nodeId:            zod.string().optional(),
  region:            zod.string().optional(),
  version:           zod.string().optional(),
  capabilities:      zod.array(zod.string()).optional(),
  maxConcurrentJobs: zod.number().int().min(1).max(32).optional(),
  leaseOwner:        zod.string().optional(),
  leaseTtlMs:        zod.number().int().min(5000).max(300_000).optional(),
});

export const RenewLeaseBody = zod.object({
  heartbeatToken: zod.string().min(1),
  leaseTtlMs:     zod.number().int().min(5000).max(300_000).optional(),
});
