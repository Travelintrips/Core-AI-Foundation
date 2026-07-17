/**
 * creative-commercial/routes/funnel.ts — Team 03
 *
 * Funnel projection endpoints.
 * Audit remediation: try/catch on all handlers.
 *
 * Routes (mounted under /ai/creative-commercial):
 *   GET /funnel/projection?periodDays=30
 *   GET /funnel/snapshots?limit=30
 */

import { Router } from "express";
import {
  buildFunnelMetrics,
  getFunnelSnapshots,
} from "../../services/creative-commercial/funnelProjectionService.js";
import { logger } from "../../lib/logger.js";

const router = Router();

// ── GET /funnel/projection ────────────────────────────────────────────────────

router.get("/funnel/projection", async (req, res): Promise<void> => {
  const periodDays = Math.min(
    Math.max(parseInt(String(req.query["periodDays"] ?? "30"), 10) || 30, 7),
    365,
  );

  try {
    const projection = await buildFunnelMetrics(periodDays);
    res.json(projection);
  } catch (err) {
    logger.error({ err, periodDays }, "[creative-commercial] funnel projection error");
    res.status(500).json({ error: "Failed to build funnel projection" });
  }
});

// ── GET /funnel/snapshots ─────────────────────────────────────────────────────

router.get("/funnel/snapshots", async (req, res): Promise<void> => {
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "30"), 10) || 30, 90);

  try {
    const snapshots = await getFunnelSnapshots(limit);
    res.json(snapshots);
  } catch (err) {
    logger.error({ err }, "[creative-commercial] funnel snapshots error");
    res.status(500).json({ error: "Failed to load funnel snapshots" });
  }
});

export default router;
