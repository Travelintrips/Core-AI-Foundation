import { Router, type Request, type Response, type NextFunction } from "express";
import {
  isTransientDatabaseConnectionError,
  type AiWorker,
} from "@workspace/db";
import { z } from "zod";
import {
  assertRemoteOllamaEnrollmentSecret,
  authenticateRemoteOllamaWorker,
  claimRemoteOllamaInvocation,
  completeRemoteOllamaInvocation,
  heartbeatRemoteOllamaWorker,
  enqueueRemotePowerShellSelfTest,
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
    if (isTransientDatabaseConnectionError(error)) {
      res.status(503).json({ error: "Remote Ollama authentication temporarily unavailable" });
      return;
    }
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

  if (process.env.CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED === "true") {
    // The DEV-only pilot can enroll exactly one model-only DELL worker.
    // Never turn enrollment into a general-purpose PowerShell executor.
    if (process.env.APP_ENV !== "development" ||
        process.env.NODE_ENV !== "development" ||
        !process.env.CST_TEAM_DEV_APPROVED_WORKER_NAME ||
        body.data.workerName !== process.env.CST_TEAM_DEV_APPROVED_WORKER_NAME ||
        body.data.nodeId !== process.env.CST_TEAM_DEV_APPROVED_WORKER_NAME ||
        body.data.modelId !== "qwen2.5:3b" ||
        body.data.maxConcurrentJobs !== 1) {
      res.status(403).json({ error: "DEV_MODEL_PILOT_WORKER_NOT_APPROVED" });
      return;
    }
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


router.post("/ai/ollama-workers/:id/self-test", requireWorker, async (req, res): Promise<void> => {
  if (process.env.CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED === "true") {
    res.status(403).json({ error: "DEV_MODEL_PILOT_POWERSHELL_SELF_TEST_DISABLED" });
    return;
  }
  const workerId = Number.parseInt(routeParam(req, "id"), 10);
  try {
    const job = await enqueueRemotePowerShellSelfTest(workerId);
    res.status(202).json({ jobId: job.id, jobCode: job.jobCode, status: job.status });
  } catch (error) {
    logger.error({ err: error, workerId }, "[remote-ollama] self-test enqueue failed");
    res.status(503).json({ error: "Remote Ollama self-test could not be queued" });
  }
});

router.post("/ai/ollama-workers/:id/heartbeat", requireWorker, async (req, res): Promise<void> => {
  const workerId = Number.parseInt(routeParam(req, "id"), 10);
  const token = workerToken(req)!;
  try {
    const worker = await heartbeatRemoteOllamaWorker(workerId, token);
    if (!worker) {
      res.status(409).json({ error: "Worker lease was not renewed" });
      return;
    }
    res.json({ ok: true, leaseExpiresAt: worker.leaseExpiresAt?.toISOString() ?? null });
  } catch (error) {
    logger.error({ err: error, workerId }, "[remote-ollama] heartbeat failed");
    res.status(503).json({ error: "Remote Ollama heartbeat temporarily unavailable" });
  }
});

router.post("/ai/ollama-workers/:id/claim", requireWorker, async (req, res): Promise<void> => {
  const workerId = Number.parseInt(routeParam(req, "id"), 10);
  const worker = res.locals["remoteOllamaWorker"] as AiWorker;
  // Optional DEV-only one-job claim for an explicitly admitted model-worker
  // pilot. This is not a general scheduler and does not grant new capabilities.
  const requestedJobId = (req.body as Record<string, unknown> | undefined)?.devExpectedJobId;
  const hasJobScope = requestedJobId !== undefined;
  const pilotEnabled = process.env.CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED === "true";
  const isDev = process.env.APP_ENV === "development" && process.env.NODE_ENV === "development";
  // With the DEV pilot flag on, no authenticated worker can fall back to
  // the legacy shared-queue claim by omitting devExpectedJobId.
  if (pilotEnabled && (!isDev || !hasJobScope)) {
    res.status(403).json({ error: "DEV_SCOPED_MODEL_JOB_REQUIRED" });
    return;
  }
  if (hasJobScope && (!isDev || !pilotEnabled)) {
    res.status(403).json({ error: "DEV_SCOPED_MODEL_CLAIM_DISABLED" });
    return;
  }
  const parsedJobId = hasJobScope ? z.number().int().min(1).max(2147483647).safeParse(requestedJobId) : null;
  if (parsedJobId && !parsedJobId.success) {
    res.status(400).json({ error: "INVALID_DEV_EXPECTED_JOB_ID" });
    return;
  }
  if (pilotEnabled) {
    const approvedId = z.coerce.number().int().min(1).max(2147483647).safeParse(
      process.env.CST_TEAM_DEV_APPROVED_JOB_ID ?? "",
    );
    const approvedWorkerName = process.env.CST_TEAM_DEV_APPROVED_WORKER_NAME?.trim();
    if (!approvedId.success || !approvedWorkerName ||
        approvedWorkerName !== worker.workerName ||
        parsedJobId?.data !== approvedId.data) {
      res.status(403).json({ error: "DEV_SCOPED_MODEL_JOB_OR_WORKER_NOT_APPROVED" });
      return;
    }
  }
  try {
    const job = await claimRemoteOllamaInvocation(
      worker,
      parsedJobId?.success ? { devExpectedJobId: parsedJobId.data } : undefined,
    );
    if (!job) {
      res.status(204).end();
      return;
    }
    const payload = { ...((job.payloadJson ?? {}) as Record<string, unknown>) };
    delete payload["_claimedByWorkerId"];
    res.json({ jobId: job.id, jobCode: job.jobCode, jobType: job.jobType, payload });
  } catch (error) {
    logger.error({ err: error, workerId }, "[remote-ollama] claim failed");
    res.status(503).json({ error: "Remote Ollama claim temporarily unavailable" });
  }
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
  try {
    const job = await retryRemoteOllamaInvocation(workerId, jobId, body.data.error);
    res.json({ jobId: job.id, status: job.status, retryCount: job.retryCount });
  } catch (error) {
    if (error instanceof JobOwnershipLostError) {
      res.status(409).json({ error: "Worker no longer owns this job" });
      return;
    }
    throw error;
  }
});

export default router;
