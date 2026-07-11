import { Router } from "express";
import { listHealthScores, getHealthScore, calculateHealthScore } from "../services/customerHealthService";

const router = Router();

// GET /ai/customer-health
router.get("/ai/customer-health", async (_req, res): Promise<void> => {
  const scores = await listHealthScores();
  res.json({ items: scores, total: scores.length });
});

// GET /ai/customer-health/:profileId
router.get("/ai/customer-health/:profileId", async (req, res): Promise<void> => {
  const profileId = parseInt(req.params.profileId, 10);
  if (isNaN(profileId)) { res.status(400).json({ error: "Invalid profileId" }); return; }

  const score = await getHealthScore(profileId);
  if (!score) { res.status(404).json({ error: "Health score not found. Use /recalculate to generate." }); return; }
  res.json(score);
});

// POST /ai/customer-health/:profileId/recalculate
router.post("/ai/customer-health/:profileId/recalculate", async (req, res): Promise<void> => {
  const profileId = parseInt(req.params.profileId, 10);
  if (isNaN(profileId)) { res.status(400).json({ error: "Invalid profileId" }); return; }

  const score = await calculateHealthScore(profileId);
  res.json(score);
});

export default router;
