import { Router } from "express";
import { getZeroLlmReadinessSnapshot } from "../services/zeroLlmLocalService.js";

const router = Router();

router.get("/ai/coding/zerollm/readiness", async (_req, res): Promise<void> => {
  const snapshot = await getZeroLlmReadinessSnapshot();
  res.json(snapshot);
});

export default router;
