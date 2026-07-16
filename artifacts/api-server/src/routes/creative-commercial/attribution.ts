/**
 * creative-commercial/routes/attribution.ts — Team 03
 *
 * Attribution read-model endpoints. Pure reads — no mutations.
 *
 * Routes (mounted under /ai/creative-commercial):
 *   GET /attribution/:customerProfileId
 *   GET /attribution/:customerProfileId/touchpoints
 *   GET /attribution/report?periodDays=30&model=linear
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

const router = Router();

const VALID_MODELS = new Set(["first_touch", "last_touch", "linear", "time_decay"]);
const VALID_TOUCHPOINT_TYPES = new Set<string>([
  "organic", "paid_search", "social", "email", "affiliate", "referral", "direct", "other",
]);

function parseCustomerId(raw: unknown): number | null {
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── GET /attribution/:customerProfileId ───────────────────────────────────────

router.get("/attribution/:customerProfileId", async (req, res): Promise<void> => {
  const customerProfileId = parseCustomerId(req.params["customerProfileId"]);
  if (!customerProfileId) { res.status(400).json({ error: "Invalid customerProfileId" }); return; }

  const model = VALID_MODELS.has(String(req.query["model"]))
    ? (String(req.query["model"]) as "first_touch" | "last_touch" | "linear" | "time_decay")
    : "linear";

  const serviceRequestId = req.query["serviceRequestId"]
    ? parseInt(String(req.query["serviceRequestId"]), 10)
    : undefined;

  const conversionValue = req.query["conversionValue"]
    ? parseInt(String(req.query["conversionValue"]), 10)
    : undefined;

  const summary = await calculateAttribution({
    customerProfileId,
    serviceRequestId,
    model,
    conversionValue,
  });

  res.json(summary);
});

// ── GET /attribution/:customerProfileId/touchpoints ───────────────────────────

router.get("/attribution/:customerProfileId/touchpoints", async (req, res): Promise<void> => {
  const customerProfileId = parseCustomerId(req.params["customerProfileId"]);
  if (!customerProfileId) { res.status(400).json({ error: "Invalid customerProfileId" }); return; }

  const serviceRequestId = req.query["serviceRequestId"]
    ? parseInt(String(req.query["serviceRequestId"]), 10)
    : undefined;

  const touchpoints = await getCustomerTouchpoints(customerProfileId, serviceRequestId);
  res.json(touchpoints);
});

// ── GET /attribution/report ───────────────────────────────────────────────────

router.get("/attribution/report", async (req, res): Promise<void> => {
  const periodDays = Math.min(
    Math.max(parseInt(String(req.query["periodDays"] ?? "30"), 10) || 30, 1),
    365,
  );

  const model = VALID_MODELS.has(String(req.query["model"]))
    ? (String(req.query["model"]) as "first_touch" | "last_touch" | "linear" | "time_decay")
    : "linear";

  const report = await getAttributionReport({ periodDays, model });
  res.json(report);
});

// ── POST /attribution/record-touchpoint ───────────────────────────────────────

router.post("/attribution/record-touchpoint", async (req, res): Promise<void> => {
  const { customerProfileId, serviceRequestId, touchpointType, source, medium, campaign, occurredAt } =
    req.body ?? {};

  if (!customerProfileId || !source) {
    res.status(400).json({ error: "customerProfileId and source are required" });
    return;
  }

  const cpId = parseInt(String(customerProfileId), 10);
  if (!Number.isFinite(cpId) || cpId <= 0) {
    res.status(400).json({ error: "Invalid customerProfileId" });
    return;
  }

  const tp: TouchpointType = VALID_TOUCHPOINT_TYPES.has(String(touchpointType))
    ? (String(touchpointType) as TouchpointType)
    : "other";

  await recordTouchpoint({
    customerProfileId: cpId,
    serviceRequestId: serviceRequestId ? parseInt(String(serviceRequestId), 10) : undefined,
    touchpointType: tp,
    source: String(source).slice(0, 100),
    medium: medium ? String(medium).slice(0, 100) : undefined,
    campaign: campaign ? String(campaign).slice(0, 100) : undefined,
    occurredAt: occurredAt ? new Date(String(occurredAt)) : undefined,
  });

  res.status(201).json({ ok: true });
});

export default router;
