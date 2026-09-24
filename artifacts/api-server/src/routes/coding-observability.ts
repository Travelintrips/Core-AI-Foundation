import { Router } from "express";
import { GetCodingTaskParams } from "@workspace/api-zod";
import { getCodingAiTaskObservability } from "../services/localCodingAiObservabilityService.js";

const router = Router();

router.get("/ai/coding/tasks/:id/observability", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const telemetry = await getCodingAiTaskObservability(params.data.id);
  res.json(telemetry);
});

export default router;
