/**
 * creative-commercial/routes/recommendations.ts — Team 03
 *
 * All recommendation endpoints are GET-only and read-only.
 * No financial mutations here — those go through /approvals.
 *
 * Audit remediation:
 *   - try/catch on all handlers (P1: unhandled rejections leaked stack traces)
 *   - Input validation tightened (P2: malformed IDs return 400, not NaN)
 *   - Pagination limits clamped server-side (P2: limit enforced)
 *
 * Routes (mounted under /ai/creative-commercial):
 *   GET  /recommendations/:customerProfileId
 *   GET  /recommendations/:customerProfileId/packages
 *   GET  /recommendations/:customerProfileId/cross-sell
 *   GET  /recommendations/:customerProfileId/coupon
 *   GET  /recommendations/:customerProfileId/bundles
 *   GET  /bundles
 *   GET  /abandoned-checkouts
 *   GET  /repeat-order-candidates
 *   GET  /approvals
 *   GET  /approvals/:approvalId
 *   POST /approvals/:approvalId/approve
 *   POST /approvals/:approvalId/reject
 *   POST /approvals/request-coupon
 *   POST /approvals/request-bundle-discount
 */

import { Router } from "express";
import {
  getPackageRecommendations,
  getCrossSellRecommendations,
  getCouponRecommendation,
  getAvailableBundles,
  getBundleRecommendation,
  requestBundleDiscount,
  getAbandonedCheckoutRecommendations,
  detectAbandonedCheckouts,
  getAbandonmentStats,
  getRepeatOrderRecommendations,
  findRepeatOrderCandidates,
  getRepeatOrderStats,
  approveApproval,
  rejectApproval,
  listPendingApprovals,
  getApproval,
  requestCustomCouponIssuance,
} from "../../services/creative-commercial/index.js";
import { logger } from "../../lib/logger.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a path param or query value as a positive integer.
 * Returns null if not a finite positive integer.
 */
function parsePositiveInt(raw: unknown): number | null {
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Clamp a limit query param between [min, max]. Returns defaultVal if invalid.
 */
function clampLimit(raw: unknown, defaultVal: number, max: number): number {
  const n = parseInt(String(raw ?? defaultVal), 10);
  if (!Number.isFinite(n) || n <= 0) return defaultVal;
  return Math.min(n, max);
}

// ── GET /recommendations/:customerProfileId ────────────────────────────────────

router.get("/recommendations/:customerProfileId", async (req, res): Promise<void> => {
  const customerProfileId = parsePositiveInt(req.params["customerProfileId"]);
  if (!customerProfileId) {
    res.status(400).json({ error: "Invalid customerProfileId" });
    return;
  }

  try {
    const serviceId = parsePositiveInt(req.query["serviceId"]) ?? undefined;
    const serviceCode = req.query["serviceCode"] ? String(req.query["serviceCode"]) : undefined;
    const packageId = parsePositiveInt(req.query["packageId"]) ?? undefined;
    const segment = req.query["segment"] ? String(req.query["segment"]) : undefined;
    const orderAmount = Math.max(0, parseInt(String(req.query["orderAmount"] ?? "0"), 10) || 0);

    const [packages, crossSell, coupon, bundle] = await Promise.allSettled([
      getPackageRecommendations({ customerProfileId, currentServiceId: serviceId, currentPackageId: packageId, segment, orderAmountHint: orderAmount }),
      getCrossSellRecommendations({ customerProfileId, currentServiceCode: serviceCode, currentServiceId: serviceId, segment }),
      getCouponRecommendation({ customerProfileId, orderAmount: orderAmount || 100_000, serviceId, segment }),
      getBundleRecommendation({ customerProfileId, viewedServiceCode: serviceCode, segment }),
    ]);

    res.json({
      customerProfileId,
      packages:  packages.status  === "fulfilled" ? packages.value  : [],
      crossSell: crossSell.status === "fulfilled" ? crossSell.value : [],
      coupon:    coupon.status    === "fulfilled" ? coupon.value    : null,
      bundle:    bundle.status    === "fulfilled" ? bundle.value    : null,
    });
  } catch (err) {
    logger.error({ err, customerProfileId }, "[creative-commercial] recommendations error");
    res.status(500).json({ error: "Failed to load recommendations" });
  }
});

// ── GET /recommendations/:customerProfileId/packages ──────────────────────────

router.get("/recommendations/:customerProfileId/packages", async (req, res): Promise<void> => {
  const customerProfileId = parsePositiveInt(req.params["customerProfileId"]);
  if (!customerProfileId) { res.status(400).json({ error: "Invalid customerProfileId" }); return; }

  try {
    const recs = await getPackageRecommendations({
      customerProfileId,
      currentServiceId: parsePositiveInt(req.query["serviceId"]) ?? undefined,
      currentPackageId: parsePositiveInt(req.query["packageId"]) ?? undefined,
      segment:          req.query["segment"] ? String(req.query["segment"]) : undefined,
      orderAmountHint:  parsePositiveInt(req.query["orderAmount"]) ?? undefined,
    });
    res.json(recs);
  } catch (err) {
    logger.error({ err, customerProfileId }, "[creative-commercial] package recs error");
    res.status(500).json({ error: "Failed to load package recommendations" });
  }
});

// ── GET /recommendations/:customerProfileId/cross-sell ────────────────────────

router.get("/recommendations/:customerProfileId/cross-sell", async (req, res): Promise<void> => {
  const customerProfileId = parsePositiveInt(req.params["customerProfileId"]);
  if (!customerProfileId) { res.status(400).json({ error: "Invalid customerProfileId" }); return; }

  try {
    const recs = await getCrossSellRecommendations({
      customerProfileId,
      currentServiceCode: req.query["serviceCode"] ? String(req.query["serviceCode"]) : undefined,
      currentServiceId:   parsePositiveInt(req.query["serviceId"]) ?? undefined,
      segment:            req.query["segment"] ? String(req.query["segment"]) : undefined,
    });
    res.json(recs);
  } catch (err) {
    logger.error({ err, customerProfileId }, "[creative-commercial] cross-sell error");
    res.status(500).json({ error: "Failed to load cross-sell recommendations" });
  }
});

// ── GET /recommendations/:customerProfileId/coupon ────────────────────────────

router.get("/recommendations/:customerProfileId/coupon", async (req, res): Promise<void> => {
  const customerProfileId = parsePositiveInt(req.params["customerProfileId"]);
  if (!customerProfileId) { res.status(400).json({ error: "Invalid customerProfileId" }); return; }

  const orderAmount = parseInt(String(req.query["orderAmount"] ?? "100000"), 10);
  if (!Number.isFinite(orderAmount) || orderAmount <= 0) {
    res.status(400).json({ error: "orderAmount must be a positive integer" });
    return;
  }

  try {
    const rec = await getCouponRecommendation({
      customerProfileId,
      orderAmount,
      serviceId:   parsePositiveInt(req.query["serviceId"]) ?? undefined,
      segment:     req.query["segment"] ? String(req.query["segment"]) : undefined,
      isAbandoned: req.query["isAbandoned"] === "true",
    });
    res.json(rec ?? null);
  } catch (err) {
    logger.error({ err, customerProfileId }, "[creative-commercial] coupon rec error");
    res.status(500).json({ error: "Failed to load coupon recommendation" });
  }
});

// ── GET /recommendations/:customerProfileId/bundles ───────────────────────────

router.get("/recommendations/:customerProfileId/bundles", async (req, res): Promise<void> => {
  const customerProfileId = parsePositiveInt(req.params["customerProfileId"]);
  if (!customerProfileId) { res.status(400).json({ error: "Invalid customerProfileId" }); return; }

  try {
    const rec = await getBundleRecommendation({
      customerProfileId,
      viewedServiceCode: req.query["serviceCode"] ? String(req.query["serviceCode"]) : undefined,
      segment:           req.query["segment"] ? String(req.query["segment"]) : undefined,
    });
    res.json(rec ?? null);
  } catch (err) {
    logger.error({ err, customerProfileId }, "[creative-commercial] bundle rec error");
    res.status(500).json({ error: "Failed to load bundle recommendation" });
  }
});

// ── GET /bundles ──────────────────────────────────────────────────────────────

router.get("/bundles", async (req, res): Promise<void> => {
  try {
    const bundles = await getAvailableBundles({
      customerSegment: req.query["segment"] ? String(req.query["segment"]) : undefined,
    });
    res.json(bundles);
  } catch (err) {
    logger.error({ err }, "[creative-commercial] bundles error");
    res.status(500).json({ error: "Failed to load bundle catalog" });
  }
});

// ── GET /abandoned-checkouts ──────────────────────────────────────────────────

router.get("/abandoned-checkouts", async (req, res): Promise<void> => {
  const windowHours    = clampLimit(req.query["windowHours"], 24, 168);
  const limit          = clampLimit(req.query["limit"], 50, 200);
  const asRecommendations = req.query["recommendations"] === "true";

  try {
    if (asRecommendations) {
      const recs = await getAbandonedCheckoutRecommendations({ windowHours, maxRecommendations: limit });
      res.json(recs);
    } else {
      const [abandonments, stats] = await Promise.all([
        detectAbandonedCheckouts({ windowHours, limit }),
        getAbandonmentStats(windowHours),
      ]);
      res.json({ abandonments, stats });
    }
  } catch (err) {
    logger.error({ err, windowHours }, "[creative-commercial] abandoned-checkouts error");
    res.status(500).json({ error: "Failed to load abandoned checkouts" });
  }
});

// ── GET /repeat-order-candidates ──────────────────────────────────────────────

router.get("/repeat-order-candidates", async (req, res): Promise<void> => {
  const inactiveDays     = clampLimit(req.query["inactiveDays"], 60, 365);
  const limit            = clampLimit(req.query["limit"], 50, 200);
  const asRecommendations = req.query["recommendations"] === "true";

  try {
    const [candidates, stats] = await Promise.all([
      asRecommendations
        ? getRepeatOrderRecommendations({ inactiveDaysThreshold: inactiveDays, maxRecommendations: limit })
        : findRepeatOrderCandidates({ inactiveDaysThreshold: inactiveDays, limit }),
      getRepeatOrderStats(),
    ]);
    res.json({ candidates, stats });
  } catch (err) {
    logger.error({ err, inactiveDays }, "[creative-commercial] repeat-order-candidates error");
    res.status(500).json({ error: "Failed to load repeat order candidates" });
  }
});

// ── GET /approvals ────────────────────────────────────────────────────────────

router.get("/approvals", async (req, res): Promise<void> => {
  const customerProfileId = parsePositiveInt(req.query["customerProfileId"]) ?? undefined;

  try {
    const approvals = await listPendingApprovals(customerProfileId);
    res.json(approvals);
  } catch (err) {
    logger.error({ err }, "[creative-commercial] list approvals error");
    res.status(500).json({ error: "Failed to load approvals" });
  }
});

// ── GET /approvals/:approvalId ────────────────────────────────────────────────

router.get("/approvals/:approvalId", async (req, res): Promise<void> => {
  const approvalId = parsePositiveInt(req.params["approvalId"]);
  if (!approvalId) { res.status(400).json({ error: "Invalid approvalId" }); return; }

  try {
    const approval = await getApproval(approvalId);
    if (!approval) { res.status(404).json({ error: "Approval not found" }); return; }
    res.json(approval);
  } catch (err) {
    logger.error({ err, approvalId }, "[creative-commercial] get approval error");
    res.status(500).json({ error: "Failed to load approval" });
  }
});

// ── POST /approvals/:approvalId/approve ───────────────────────────────────────

router.post("/approvals/:approvalId/approve", async (req, res): Promise<void> => {
  const approvalId = parsePositiveInt(req.params["approvalId"]);
  if (!approvalId) { res.status(400).json({ error: "Invalid approvalId" }); return; }

  const approvedBy = typeof req.body?.approvedBy === "string" ? req.body.approvedBy.trim() : "";
  if (!approvedBy) {
    res.status(400).json({ error: "approvedBy is required" });
    return;
  }

  try {
    const approval = await approveApproval(approvalId, approvedBy);
    res.json({ ok: true, approval });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Approval failed";
    logger.warn({ approvalId, err: message }, "[creative-commercial] approve failed");
    res.status(409).json({ error: message });
  }
});

// ── POST /approvals/:approvalId/reject ────────────────────────────────────────

router.post("/approvals/:approvalId/reject", async (req, res): Promise<void> => {
  const approvalId = parsePositiveInt(req.params["approvalId"]);
  if (!approvalId) { res.status(400).json({ error: "Invalid approvalId" }); return; }

  const rejectedBy = typeof req.body?.rejectedBy === "string" ? req.body.rejectedBy.trim() : "admin";
  const reason     = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : undefined;

  try {
    const approval = await rejectApproval(approvalId, rejectedBy, reason);
    res.json({ ok: true, approval });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Rejection failed";
    res.status(409).json({ error: message });
  }
});

// ── POST /approvals/request-coupon ────────────────────────────────────────────
// NOTE: must be defined BEFORE /approvals/:approvalId routes to avoid routing conflict.

router.post("/approvals/request-coupon", async (req, res): Promise<void> => {
  const { customerProfileId, orderAmount, discountPercent, requestedBy, reason } = req.body ?? {};

  const cpId = parsePositiveInt(customerProfileId);
  const oa   = parsePositiveInt(orderAmount);
  const dp   = typeof discountPercent !== "undefined" ? parseInt(String(discountPercent), 10) : NaN;
  const rb   = typeof requestedBy === "string" ? requestedBy.trim() : "";

  if (!cpId || !oa || !Number.isFinite(dp) || !rb) {
    res.status(400).json({ error: "customerProfileId (>0), orderAmount (>0), discountPercent, requestedBy are required" });
    return;
  }

  try {
    const result = await requestCustomCouponIssuance({
      customerProfileId: cpId,
      orderAmount: oa,
      discountPercent: dp,
      requestedBy: rb,
      reason: typeof reason === "string" ? reason.slice(0, 500) : "manual_request",
    });
    res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    res.status(400).json({ error: message });
  }
});

// ── POST /approvals/request-bundle-discount ───────────────────────────────────

router.post("/approvals/request-bundle-discount", async (req, res): Promise<void> => {
  const { customerProfileId, bundleCode, requestedBy } = req.body ?? {};

  const cpId = parsePositiveInt(customerProfileId);
  const bc   = typeof bundleCode === "string" ? bundleCode.trim() : "";
  const rb   = typeof requestedBy === "string" ? requestedBy.trim() : "";

  if (!cpId || !bc || !rb) {
    res.status(400).json({ error: "customerProfileId (>0), bundleCode, requestedBy are required" });
    return;
  }

  try {
    const result = await requestBundleDiscount({ customerProfileId: cpId, bundleCode: bc, requestedBy: rb });
    res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    res.status(400).json({ error: message });
  }
});

export default router;
