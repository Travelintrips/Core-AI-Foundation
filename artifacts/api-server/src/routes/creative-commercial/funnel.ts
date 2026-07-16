/**
 * creative-commercial/routes/funnel.ts — Team 03
 *
 * Funnel projection endpoints.
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

const router = Router();

// ── GET /funnel/projection ────────────────────────────────────────────────────

router.get("/funnel/projection", async (req, res): Promise<void> => {
  const periodDays = Math.min(
    Math.max(parseInt(String(req.query["periodDays"] ?? "30"), 10) || 30, 7),
    365,
  );

  const projection = await buildFunnelMetrics(periodDays);
  res.json(projection);
});

// ── GET /funnel/snapshots ─────────────────────────────────────────────────────

router.get("/funnel/snapshots", async (req, res): Promise<void> => {
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "30"), 10) || 30, 90);
  const snapshots = await getFunnelSnapshots(limit);
  res.json(snapshots);
});

export default router;
