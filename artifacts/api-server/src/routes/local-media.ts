import { Router } from "express";
import {
  getComfyWorkflowHistory,
  getLocalMediaRuntimeStatus,
  submitComfyWorkflow,
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
