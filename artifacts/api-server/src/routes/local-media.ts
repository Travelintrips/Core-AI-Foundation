import { Router } from "express";
import {
  getComfyWorkflowHistory,
  getLocalMediaRuntimeStatus,
  queueLocalImageGeneration,
  submitComfyWorkflow,
  waitForLocalImageGeneration,
} from "../services/localMediaRuntimeService.js";

const router = Router();

router.get("/ai/local-media/status", async (_req, res): Promise<void> => {
  try {
    res.json(await getLocalMediaRuntimeStatus());
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});



router.post("/ai/local-media/images/generate", async (req, res): Promise<void> => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
  if (!prompt.trim()) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const waitForResult = req.body?.waitForResult !== false;

  try {
    const queued = await queueLocalImageGeneration({
      prompt,
      negativePrompt:
        typeof req.body?.negativePrompt === "string" ? req.body.negativePrompt : undefined,
      checkpoint:
        typeof req.body?.checkpoint === "string" ? req.body.checkpoint : undefined,
      width: typeof req.body?.width === "number" ? req.body.width : undefined,
      height: typeof req.body?.height === "number" ? req.body.height : undefined,
      steps: typeof req.body?.steps === "number" ? req.body.steps : undefined,
      cfg: typeof req.body?.cfg === "number" ? req.body.cfg : undefined,
      seed: typeof req.body?.seed === "number" ? req.body.seed : undefined,
      filenamePrefix:
        typeof req.body?.filenamePrefix === "string" ? req.body.filenamePrefix : undefined,
    });

    if (!waitForResult) {
      res.status(202).json({
        status: "queued",
        ...queued,
      });
      return;
    }

    const timeoutMs =
      typeof req.body?.timeoutMs === "number" ? req.body.timeoutMs : 180_000;

    const result = await waitForLocalImageGeneration(queued.promptId, { timeoutMs });
    res.status(result.status === "completed" ? 200 : 202).json({
      ...queued,
      ...result,
    });
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.post("/ai/local-media/comfyui/workflows", async (req, res): Promise<void> => {
  const workflow = req.body?.workflow;
  const clientId =
    typeof req.body?.clientId === "string" ? req.body.clientId.trim() : undefined;

  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    res.status(400).json({ error: "workflow must be a JSON object" });
    return;
  }

  if (clientId && !/^[a-zA-Z0-9_-]{1,160}$/.test(clientId)) {
    res.status(400).json({ error: "clientId is invalid" });
    return;
  }

  try {
    const result = await submitComfyWorkflow(
      workflow as Record<string, unknown>,
      clientId,
    );
    res.status(202).json(result);
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.get(
  "/ai/local-media/comfyui/history/:promptId",
  async (req, res): Promise<void> => {
    try {
      res.json(await getComfyWorkflowHistory(req.params.promptId ?? ""));
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

export default router;
