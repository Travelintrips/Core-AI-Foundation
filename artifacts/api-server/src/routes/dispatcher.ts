/**
 * Dispatcher Admin Routes — Phase 5.1
 *
 * GET  /ai/dispatcher/status  — runtime status snapshot
 * POST /ai/dispatcher/start   — start background dispatcher
 * POST /ai/dispatcher/stop    — stop background dispatcher
 * POST /ai/dispatcher/tick    — manually run one poll cycle
 * Dispatcher Routes — Phase 5.1 Worker Dispatcher Runtime
 *
 * GET  /api/ai/dispatcher/status   — current runtime status
 * POST /api/ai/dispatcher/start    — start the dispatcher
 * POST /api/ai/dispatcher/stop     — stop the dispatcher
 * POST /api/ai/dispatcher/tick     — run one dispatch cycle immediately
 * GET  /api/ai/dispatcher/settings — current dispatcher settings
 * PATCH /api/ai/dispatcher/settings — update dispatcher settings
 */

import { Router } from "express";
import * as dispatcher from "../services/jobDispatcherService.js";


const router = Router();

// ── Status ────────────────────────────────────────────────────────────────────

router.get("/ai/dispatcher/status", async (_req, res): Promise<void> => {
  const status = await dispatcher.getStatus();
  res.json(status);
});

// ── Control ───────────────────────────────────────────────────────────────────

router.post("/ai/dispatcher/start", async (_req, res): Promise<void> => {
  await dispatcher.start();
  const status = await dispatcher.getStatus();
  res.json(status);
});

router.post("/ai/dispatcher/stop", async (_req, res): Promise<void> => {
  await dispatcher.stop();
  const status = await dispatcher.getStatus();
  res.json(status);
});

router.post("/ai/dispatcher/tick", async (_req, res): Promise<void> => {
  const tickResult = await dispatcher.tick();
  const status     = await dispatcher.getStatus();
  res.json({ ...status, tick: tickResult });
});

// ── Settings ──────────────────────────────────────────────────────────────────

router.get("/ai/dispatcher/settings", (_req, res): void => {
  res.json(dispatcher.getSettings());
});

router.patch("/ai/dispatcher/settings", (req, res): void => {
  const patch = (req.body ?? {}) as Partial<dispatcher.DispatcherSettings>;

  // Validate numeric fields are positive
  const numericKeys: Array<keyof dispatcher.DispatcherSettings> = [
    "workerPollIntervalMs",
    "workerHeartbeatIntervalMs",
    "workerTimeoutMs",
    "jobTimeoutMs",
    "maxConcurrentJobs",
  ];

  for (const key of numericKeys) {
    const val = patch[key] as number | undefined;
    if (val !== undefined) {
      if (typeof val !== "number" || val <= 0 || !Number.isFinite(val)) {
        res.status(400).json({ error: `${key} must be a positive finite number` });
        return;
      }
    }
  }

  const settings = dispatcher.updateSettings(patch);
  res.json(settings);
});

export default router;
