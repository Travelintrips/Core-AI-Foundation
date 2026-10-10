import { Router } from "express";
import { getZeroLlmReadinessSnapshot } from "../services/zeroLlmLocalService.js";

const router = Router();

const readinessHandler = async (_req: import("express").Request, res: import("express").Response): Promise<void> => {
  const snapshot = await getZeroLlmReadinessSnapshot();
  res.json(snapshot);
};

// Keep the original route; protected alias avoids URL-specific edge filtering.
router.get("/ai/coding/zerollm/readiness", readinessHandler);
router.get("/ai/coding/local-readiness", readinessHandler);

export default router;
