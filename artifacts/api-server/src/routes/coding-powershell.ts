import { Router, type Response } from "express";
import { z } from "zod";
import {
  approveOllamaPowerShellExecution,
  executeApprovedOllamaPowerShellExecution,
  getOllamaPowerShellExecution,
  getPowerShellExecutorStatus,
  LocalCodingPowerShellError,
  prepareOllamaPowerShellExecution,
} from "../services/localCodingPowerShellExecutorService.js";

const router = Router();

const prepareSchema = z.object({
  taskId: z.string().uuid().nullable().optional(),
  requestedBy: z.string().min(1).max(200),
  modelId: z.string().min(1).max(300),
  commands: z.array(z.string().min(1).max(300)).min(1).max(6),
  approvalTtlMs: z.number().int().min(60_000).max(900_000).optional(),
}).strict();

const digestSchema = z.object({
  expectedDigest: z.string().regex(/^[0-9a-f]{64}$/i),
}).strict();

const executeSchema = digestSchema.extend({
  timeoutMs: z.number().int().min(1_000).max(180_000).optional(),
}).strict();

function sendKnownError(res: Response, error: unknown): boolean {
  if (!(error instanceof LocalCodingPowerShellError)) return false;
  const status =
    error.code === "NOT_FOUND"
      ? 404
      : error.code === "DISABLED"
        ? 403
        : ["NOT_READY", "EXPIRED", "DIGEST_MISMATCH"].includes(error.code)
          ? 409
          : 422;
  res.status(status).json({ error: error.message, code: error.code });
  return true;
}

router.get("/ai/coding/powershell/status", (_req, res) => {
  res.json(getPowerShellExecutorStatus());
});

router.post("/ai/coding/powershell/prepare", async (req, res): Promise<void> => {
  const body = prepareSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const prepared = await prepareOllamaPowerShellExecution(body.data);
    res.status(201).json(prepared);
  } catch (error) {
    if (sendKnownError(res, error)) return;
    throw error;
  }
});

router.get("/ai/coding/powershell/:approvalId", (req, res): void => {
  try {
    res.json(getOllamaPowerShellExecution(req.params.approvalId));
  } catch (error) {
    if (sendKnownError(res, error)) return;
    throw error;
  }
});

router.post("/ai/coding/powershell/:approvalId/approve", async (req, res): Promise<void> => {
  const body = digestSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const approved = await approveOllamaPowerShellExecution(
      req.params.approvalId,
      body.data.expectedDigest,
    );
    res.json(approved);
  } catch (error) {
    if (sendKnownError(res, error)) return;
    throw error;
  }
});

router.post("/ai/coding/powershell/:approvalId/execute", async (req, res): Promise<void> => {
  const body = executeSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const result = await executeApprovedOllamaPowerShellExecution({
      approvalId: req.params.approvalId,
      expectedDigest: body.data.expectedDigest,
      timeoutMs: body.data.timeoutMs,
    });
    res.json(result);
  } catch (error) {
    if (sendKnownError(res, error)) return;
    throw error;
  }
});

export default router;
