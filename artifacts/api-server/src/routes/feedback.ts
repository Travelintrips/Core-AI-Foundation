import { Router } from "express";

const router = Router();

router.get("/ai/feedback", async (_req, res): Promise<void> => {
  res.json([]);
});

export default router;
