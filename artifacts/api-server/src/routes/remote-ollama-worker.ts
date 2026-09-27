import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import {
  assertRemoteOllamaEnrollmentSecret,
  authenticateRemoteOllamaWorker,
  claimRemoteOllamaInvocation,
  completeRemoteOllamaInvocation,
  heartbeatRemoteOllamaWorker,
  registerRemoteOllamaWorker,
  retryRemoteOllamaInvocation,
  JobOwnershipLostError,
} from "../services/remoteOllamaWorkerService.js";
import { logger } from "../lib/logger.js";

const router = Router();
const registerSchema = z.object({
  workerName: z.string().min(1).max(160),
  nodeId: z.string().min(1).max(160),
  modelId: z.string().min(1).max(300),
  maxConcurrentJobs: z.number().int().min(1).max(8).optional(),
  region: z.string().min(1).max(80).optional(),
  version: z.string().min(1).max(80).optional(),
}).strict();
const resultSchema = z.object({ result: z.record(z.string(), z.unknown()) }).strict();
const retrySchema = z.object({ error: z.string().min(1).max(2_000) }).strict();

function routeParam(req: Request, key: string): string {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function workerToken(req: Request): string | undefined {
  const direct = req.headers["x-ollama-worker-token"];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const auth = req.headers.authorization;
  return auth?.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;
}

async function requireWorker(req: Request, res: Response, next: NextFunction): Promise<void> {
  const workerId = Number.parseInt(routeParam(req, "id"), 10);
  if (!Number.isInteger(workerId) || workerId <= 0) {
    res.status(400).json({ error: "Invalid worker id" });
    return;
  }
  try {
    const worker = await authenticateRemoteOllamaWorker(workerId, workerToken(req));
    if (!worker) {
      res.status(401).json({ error: "Invalid or inactive remote Ollama worker credential" });
      return;
    }
    res.locals["remoteOllamaWorker"] = worker;
    next();
  } catch (error) {
    logger.error({ err: error, workerId }, "[remote-ollama] authentication failed");
    res.status(500).json({ error: "Remote Ollama authentication failed" });
  }
}

router.post("/ai/ollama-workers/register", async (req, res): Promise<void> => {
  try {
    assertRemoteOllamaEnrollmentSecret(
      typeof req.headers["x-ollama-enrollment-secret"] === "string"
        ? req.headers["x-ollama-enrollment-secret"]
        : undefined,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    res.status(code === "REMOTE_OLLAMA_NOT_CONFIGURED" ? 503 : 401).json({
      error: code === "REMOTE_OLLAMA_NOT_CONFIGURED"
        ? "Remote Ollama enrollment is not configured"
        : "Invalid remote Ollama enrollment credential",
    });
    return;
  }

  const body = registerSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    const worker = await registerRemoteOllamaWorker(body.data);
    res.status(201).json({
      workerId: worker.id,
      heartbeatToken: worker.heartbeatToken,
      leaseExpiresAt: worker.leaseExpiresAt?.toISOString() ?? null,
      modelId: worker.modelId,
      runtimeKind: worker.runtimeKind,
    });
  } catch (error) {
    logger.error({ err: error }, "[remote-ollama] registration failed");
    res.status(500).json({ error: "Remote Ollama registration failed" });
  }
});

router.post("/ai/ollama-workers/:id/heartbeat", requireWorker, async (req, res): Promise<void> => {
  const workerId = Number.parseInt(routeParam(req, "id"), 10);
  const token = workerToken(req)!;
  const worker = await heartbeatRemoteOllamaWorker(workerId, token);
  if (!worker) {
    res.status(409).json({ error: "Worker lease was not renewed" });
    return;
  }
  res.json({ ok: true, leaseExpiresAt: worker.leaseExpiresAt?.toISOString() ?? null });
});

router.post("/ai/ollama-workers/:id/claim", requireWorker, async (req, res): Promise<void> => {
  const workerId = Number.parseInt(routeParam(req, "id"), 10);
  const job = await claimRemoteOllamaInvocation(workerId);
  if (!job) {
    res.status(204).end();
    return;
  }
  const payload = { ...((job.payloadJson ?? {}) as Record<string, unknown>) };
  delete payload["_claimedByWorkerId"];
  res.json({ jobId: job.id, jobCode: job.jobCode, payload });
});

router.post("/ai/ollama-workers/:id/jobs/:jobId/complete", requireWorker, async (req, res): Promise<void> => {
  const body = resultSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const workerId = Number.parseInt(routeParam(req, "id"), 10);
  const jobId = Number.parseInt(routeParam(req, "jobId"), 10);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  try {
    const job = await completeRemoteOllamaInvocation(workerId, jobId, body.data.result);
    res.json({ jobId: job.id, status: job.status });
  } catch (error) {
    if (error instanceof JobOwnershipLostError) {
      res.status(409).json({ error: "Worker no longer owns this job" });
      return;
    }
    if (error instanceof Error && error.message === "REMOTE_OLLAMA_RESULT_TOO_LARGE") {
      res.status(413).json({ error: "Remote Ollama result exceeds the allowed size" });
      return;
    }
    throw error;
  }
});

router.post("/ai/ollama-workers/:id/jobs/:jobId/retry", requireWorker, async (req, res): Promise<void> => {
  const body = retrySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const workerId = Number.parseInt(routeParam(req, "id"), 10);
  const jobId = Number.parseInt(routeParam(req, "jobId"), 10);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const job = await retryRemoteOllamaInvocation(workerId, jobId, body.data.error);
  res.json({ jobId: job.id, status: job.status, retryCount: job.retryCount });
});

export default router;
