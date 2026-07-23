/**
 * orderRecovery.ts — Admin routes for scanning and repairing broken creative orders.
 *
 * GET  /ai/orders/:projectId/scan    — dry-run: returns list of detected issues
 * POST /ai/orders/:projectId/repair  — apply safe automatic repairs
 */

import { Router } from "express";
import {
  scanBrokenCreativeOrder,
  repairBrokenCreativeOrder,
} from "../services/orderRecoveryService.js";

const router = Router();

// ── GET /ai/orders/:projectId/scan ────────────────────────────────────────────
// Returns a read-only diagnostic snapshot of an order's consistency.
// Safe to call at any time — no writes performed.

router.get("/ai/orders/:projectId/scan", async (req, res): Promise<void> => {
  const { projectId } = req.params as { projectId: string };
  if (!projectId || projectId.length < 8) {
    res.status(400).json({ error: "Invalid projectId" });
    return;
  }

  try {
    const result = await scanBrokenCreativeOrder(projectId);
    res.json(result);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// ── POST /ai/orders/:projectId/repair ─────────────────────────────────────────
// Applies safe automatic repairs. Body: { repairedBy: string }
// Non-destructive: only unlocks files when all payments are confirmed paid,
// or re-publishes a proof-submitted event if the project is stuck.

router.post("/ai/orders/:projectId/repair", async (req, res): Promise<void> => {
  const { projectId } = req.params as { projectId: string };
  if (!projectId || projectId.length < 8) {
    res.status(400).json({ error: "Invalid projectId" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const repairedBy =
    typeof body.repairedBy === "string" ? body.repairedBy.trim() : "";
  if (!repairedBy) {
    res.status(400).json({ error: "repairedBy is required" });
    return;
  }

  try {
    const result = await repairBrokenCreativeOrder(projectId, repairedBy);
    const hasErrors = result.errors.length > 0;
    res.status(hasErrors ? 207 : 200).json({
      ok: !hasErrors,
      ...result,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

export default router;
