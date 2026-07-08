/**
 * Dispatcher Admin Routes — Phase 5.1
 *
 * GET  /ai/dispatcher/status  — runtime status snapshot
 * POST /ai/dispatcher/start   — start background dispatcher
 * POST /ai/dispatcher/stop    — stop background dispatcher
 * POST /ai/dispatcher/tick    — manually run one poll cycle
 */

import { Router } from "express";
import {
  startDispatcher,
  stopDispatcher,
  tick,
  getDispatcherStatus,
} from "../services/jobDispatcherService.js";

const router = Router();

router.get("/ai/dispatcher/status", (_req, res): void => {
  res.json(getDispatcherStatus());
});

router.post("/ai/dispatcher/start", async (_req, res): Promise<void> => {
  try {
    await startDispatcher();
    res.json(getDispatcherStatus());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Start failed" });
  }
});

router.post("/ai/dispatcher/stop", async (_req, res): Promise<void> => {
  await stopDispatcher();
  res.json(getDispatcherStatus());
});

router.post("/ai/dispatcher/tick", async (_req, res): Promise<void> => {
  try {
    await tick();
    res.json(getDispatcherStatus());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Tick failed" });
  }
});

export default router;
