/**
 * creative-commercial/routes/attribution.ts — Team 03
 *
 * Attribution read-model endpoints. Pure reads — no mutations except record-touchpoint.
 * Audit remediation: try/catch on all handlers.
 *
 * Routes (mounted under /ai/creative-commercial):
 *   GET  /attribution/:customerProfileId
 *   GET  /attribution/:customerProfileId/touchpoints
 *   GET  /attribution/report?periodDays=30&model=linear
 *   POST /attribution/record-touchpoint
 */

import { Router } from "express";
import {
  calculateAttribution,
  getCustomerTouchpoints,
  getAttributionReport,
  recordTouchpoint,
} from "../../services/creative-commercial/attributionService.js";
import type { TouchpointType } from "../../services/creative-commercial/types.js";
import { logger } from "../../lib/logger.js";

const router = Router();

const VALID_MODELS = new Set(["first_touch", "last_touch", "linear", "time_decay"]);
const VALID_TOUCHPOINT_TYPES = new Set<string>([
  "organic", "paid_search", "social", "email", "affiliate", "referral", "direct", "other",
]);

function parsePositiveInt(raw: unknown): number | null {
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── GET /attribution/report ───────────────────────────────────────────────────
// Must be defined BEFORE /attribution/:customerProfileId to avoid the path
// segment "report" being captured as a customerProfileId param.

router.get("/attribution/report", async (req, res): Promise<void> => {
  const periodDays = Math.min(
    Math.max(parseInt(String(req.query["periodDays"] ?? "30"), 10) || 30, 1),
    365,
  );

  const model = VALID_MODELS.has(String(req.query["model"]))
    ? (String(req.query["model"]) as "first_touch" | "last_touch" | "linear" | "time_decay")
    : "linear";

  // Tenant scope: restrict aggregate to a specific tenant's customers when provided.
  // Omitting tenantId = platform-wide view (super-admin only — all tenants visible).
  const tenantId = req.query["tenantId"] ? String(req.query["tenantId"]) : undefined;

  try {
    const report = await getAttributionReport({ periodDays, model, tenantId });
    res.json(report);
  } catch (err) {
    logger.error({ err, model, periodDays }, "[creative-commercial] attribution report error");
    res.status(500).json({ error: "Failed to build attribution report" });
  }
});

// ── POST /attribution/record-touchpoint ───────────────────────────────────────
// Also before /:customerProfileId to avoid route collision.

router.post("/attribution/record-touchpoint", async (req, res): Promise<void> => {
  const { customerProfileId, serviceRequestId, touchpointType, source, medium, campaign, occurredAt } =
    req.body ?? {};

  const cpId = parsePositiveInt(customerProfileId);
  if (!cpId) {
    res.status(400).json({ error: "customerProfileId must be a positive integer" });
    return;
  }
  if (!source || typeof source !== "string" || source.trim().length === 0) {
    res.status(400).json({ error: "source is required" });
    return;
  }

  const tp: TouchpointType = VALID_TOUCHPOINT_TYPES.has(String(touchpointType))
    ? (String(touchpointType) as TouchpointType)
    : "other";

  try {
    await recordTouchpoint({
      customerProfileId: cpId,
      serviceRequestId:  serviceRequestId ? parseInt(String(serviceRequestId), 10) : undefined,
      touchpointType:    tp,
      source:            String(source).trim().slice(0, 100),
      medium:            medium  ? String(medium).slice(0, 100)  : undefined,
      campaign:          campaign ? String(campaign).slice(0, 100) : undefined,
      occurredAt:        occurredAt ? new Date(String(occurredAt)) : undefined,
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error({ err, cpId }, "[creative-commercial] record-touchpoint error");
    res.status(500).json({ error: "Failed to record touchpoint" });
  }
});

// ── GET /attribution/:customerProfileId ───────────────────────────────────────

router.get("/attribution/:customerProfileId", async (req, res): Promise<void> => {
  const customerProfileId = parsePositiveInt(req.params["customerProfileId"]);
  if (!customerProfileId) { res.status(400).json({ error: "Invalid customerProfileId" }); return; }

  const model = VALID_MODELS.has(String(req.query["model"]))
    ? (String(req.query["model"]) as "first_touch" | "last_touch" | "linear" | "time_decay")
    : "linear";

  try {
    const summary = await calculateAttribution({
      customerProfileId,
      serviceRequestId: parsePositiveInt(req.query["serviceRequestId"]) ?? undefined,
      model,
      conversionValue:  parsePositiveInt(req.query["conversionValue"]) ?? undefined,
    });
    res.json(summary);
  } catch (err) {
    logger.error({ err, customerProfileId }, "[creative-commercial] attribution error");
    res.status(500).json({ error: "Failed to calculate attribution" });
  }
});

// ── GET /attribution/:customerProfileId/touchpoints ───────────────────────────

router.get("/attribution/:customerProfileId/touchpoints", async (req, res): Promise<void> => {
  const customerProfileId = parsePositiveInt(req.params["customerProfileId"]);
  if (!customerProfileId) { res.status(400).json({ error: "Invalid customerProfileId" }); return; }

  try {
    const touchpoints = await getCustomerTouchpoints(
      customerProfileId,
      parsePositiveInt(req.query["serviceRequestId"]) ?? undefined,
    );
    res.json(touchpoints);
  } catch (err) {
    logger.error({ err, customerProfileId }, "[creative-commercial] touchpoints error");
    res.status(500).json({ error: "Failed to load touchpoints" });
  }
});

export default router;
