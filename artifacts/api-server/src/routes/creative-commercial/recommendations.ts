/**
 * creative-commercial/routes/recommendations.ts — Team 03
 *
 * All recommendation endpoints are GET-only and read-only.
 * No financial mutations here — those go through /approvals.
 *
 * Routes (mounted under /ai/creative-commercial):
 *   GET  /recommendations/:customerProfileId
 *   GET  /recommendations/:customerProfileId/packages
 *   GET  /recommendations/:customerProfileId/cross-sell
 *   GET  /recommendations/:customerProfileId/coupon
 *   GET  /recommendations/:customerProfileId/bundles
 *   GET  /abandoned-checkouts
 *   GET  /repeat-order-candidates
 *   POST /approvals/:approvalId/approve
 *   POST /approvals/:approvalId/reject
 *   GET  /approvals
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

// ── Helper ────────────────────────────────────────────────────────────────────

function parseCustomerId(raw: unknown): number | null {
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── GET /recommendations/:customerProfileId ────────────────────────────────────
// Returns all recommendation types in one call.

router.get("/recommendations/:customerProfileId", async (req, res): Promise<void> => {
  const customerProfileId = parseCustomerId(req.params["customerProfileId"]);
  if (!customerProfileId) {
    res.status(400).json({ error: "Invalid customerProfileId" });
    return;
  }

  const serviceId = req.query["serviceId"] ? parseInt(String(req.query["serviceId"]), 10) : undefined;
  const serviceCode = req.query["serviceCode"] ? String(req.query["serviceCode"]) : undefined;
  const packageId = req.query["packageId"] ? parseInt(String(req.query["packageId"]), 10) : undefined;
  const segment = req.query["segment"] ? String(req.query["segment"]) : undefined;
  const orderAmount = req.query["orderAmount"] ? parseInt(String(req.query["orderAmount"]), 10) : 0;

  const [packages, crossSell, coupon, bundle] = await Promise.allSettled([
    getPackageRecommendations({
      customerProfileId,
      currentServiceId: serviceId,
      currentPackageId: packageId,
      segment,
      orderAmountHint: orderAmount,
    }),
    getCrossSellRecommendations({
      customerProfileId,
      currentServiceCode: serviceCode,
      currentServiceId: serviceId,
      segment,
    }),
    getCouponRecommendation({
      customerProfileId,
      orderAmount: orderAmount || 100_000,
      serviceId,
      segment,
    }),
    getBundleRecommendation({
      customerProfileId,
      viewedServiceCode: serviceCode,
      segment,
    }),
  ]);

  res.json({
    customerProfileId,
    packages: packages.status === "fulfilled" ? packages.value : [],
    crossSell: crossSell.status === "fulfilled" ? crossSell.value : [],
    coupon: coupon.status === "fulfilled" ? coupon.value : null,
    bundle: bundle.status === "fulfilled" ? bundle.value : null,
  });
});

// ── GET /recommendations/:customerProfileId/packages ──────────────────────────

router.get("/recommendations/:customerProfileId/packages", async (req, res): Promise<void> => {
  const customerProfileId = parseCustomerId(req.params["customerProfileId"]);
  if (!customerProfileId) { res.status(400).json({ error: "Invalid customerProfileId" }); return; }

  const recs = await getPackageRecommendations({
    customerProfileId,
    currentServiceId: req.query["serviceId"] ? parseInt(String(req.query["serviceId"]), 10) : undefined,
    currentPackageId: req.query["packageId"] ? parseInt(String(req.query["packageId"]), 10) : undefined,
    segment: req.query["segment"] ? String(req.query["segment"]) : undefined,
    orderAmountHint: req.query["orderAmount"] ? parseInt(String(req.query["orderAmount"]), 10) : undefined,
  });

  res.json(recs);
});

// ── GET /recommendations/:customerProfileId/cross-sell ────────────────────────

router.get("/recommendations/:customerProfileId/cross-sell", async (req, res): Promise<void> => {
  const customerProfileId = parseCustomerId(req.params["customerProfileId"]);
  if (!customerProfileId) { res.status(400).json({ error: "Invalid customerProfileId" }); return; }

  const recs = await getCrossSellRecommendations({
    customerProfileId,
    currentServiceCode: req.query["serviceCode"] ? String(req.query["serviceCode"]) : undefined,
    currentServiceId: req.query["serviceId"] ? parseInt(String(req.query["serviceId"]), 10) : undefined,
    segment: req.query["segment"] ? String(req.query["segment"]) : undefined,
  });

  res.json(recs);
});

// ── GET /recommendations/:customerProfileId/coupon ────────────────────────────

router.get("/recommendations/:customerProfileId/coupon", async (req, res): Promise<void> => {
  const customerProfileId = parseCustomerId(req.params["customerProfileId"]);
  if (!customerProfileId) { res.status(400).json({ error: "Invalid customerProfileId" }); return; }

  const orderAmount = parseInt(String(req.query["orderAmount"] ?? "100000"), 10);
  if (!Number.isFinite(orderAmount) || orderAmount <= 0) {
    res.status(400).json({ error: "orderAmount must be a positive integer" });
    return;
  }

  const rec = await getCouponRecommendation({
    customerProfileId,
    orderAmount,
    serviceId: req.query["serviceId"] ? parseInt(String(req.query["serviceId"]), 10) : undefined,
    segment: req.query["segment"] ? String(req.query["segment"]) : undefined,
    isAbandoned: req.query["isAbandoned"] === "true",
  });

  res.json(rec ?? null);
});

// ── GET /recommendations/:customerProfileId/bundles ───────────────────────────

router.get("/recommendations/:customerProfileId/bundles", async (req, res): Promise<void> => {
  const customerProfileId = parseCustomerId(req.params["customerProfileId"]);
  if (!customerProfileId) { res.status(400).json({ error: "Invalid customerProfileId" }); return; }

  const rec = await getBundleRecommendation({
    customerProfileId,
    viewedServiceCode: req.query["serviceCode"] ? String(req.query["serviceCode"]) : undefined,
    segment: req.query["segment"] ? String(req.query["segment"]) : undefined,
  });

  res.json(rec ?? null);
});

// ── GET /bundles ──────────────────────────────────────────────────────────────
// Full bundle catalog (no customer context)

router.get("/bundles", async (req, res): Promise<void> => {
  const bundles = await getAvailableBundles({
    customerSegment: req.query["segment"] ? String(req.query["segment"]) : undefined,
  });
  res.json(bundles);
});

// ── GET /abandoned-checkouts ──────────────────────────────────────────────────

router.get("/abandoned-checkouts", async (req, res): Promise<void> => {
  const windowHours = Math.min(parseInt(String(req.query["windowHours"] ?? "24"), 10) || 24, 168);
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10) || 50, 200);
  const asRecommendations = req.query["recommendations"] === "true";

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
});

// ── GET /repeat-order-candidates ──────────────────────────────────────────────

router.get("/repeat-order-candidates", async (req, res): Promise<void> => {
  const inactiveDays = Math.min(parseInt(String(req.query["inactiveDays"] ?? "60"), 10) || 60, 365);
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10) || 50, 200);
  const asRecommendations = req.query["recommendations"] === "true";

  const [candidates, stats] = await Promise.all([
    asRecommendations
      ? getRepeatOrderRecommendations({ inactiveDaysThreshold: inactiveDays, maxRecommendations: limit })
      : findRepeatOrderCandidates({ inactiveDaysThreshold: inactiveDays, limit }),
    getRepeatOrderStats(),
  ]);

  res.json({ candidates, stats });
});

// ── GET /approvals ────────────────────────────────────────────────────────────

router.get("/approvals", async (req, res): Promise<void> => {
  const customerProfileId = req.query["customerProfileId"]
    ? parseCustomerId(req.query["customerProfileId"])
    : undefined;

  const approvals = await listPendingApprovals(customerProfileId ?? undefined);
  res.json(approvals);
});

// ── GET /approvals/:approvalId ────────────────────────────────────────────────

router.get("/approvals/:approvalId", async (req, res): Promise<void> => {
  const approvalId = parseInt(req.params["approvalId"], 10);
  if (!Number.isFinite(approvalId)) { res.status(400).json({ error: "Invalid approvalId" }); return; }

  const approval = await getApproval(approvalId);
  if (!approval) { res.status(404).json({ error: "Approval not found" }); return; }
  res.json(approval);
});

// ── POST /approvals/:approvalId/approve ───────────────────────────────────────

router.post("/approvals/:approvalId/approve", async (req, res): Promise<void> => {
  const approvalId = parseInt(req.params["approvalId"], 10);
  if (!Number.isFinite(approvalId)) { res.status(400).json({ error: "Invalid approvalId" }); return; }

  const approvedBy = String(req.body?.approvedBy ?? req.body?.adminId ?? "admin");
  if (!approvedBy || approvedBy === "undefined") {
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
  const approvalId = parseInt(req.params["approvalId"], 10);
  if (!Number.isFinite(approvalId)) { res.status(400).json({ error: "Invalid approvalId" }); return; }

  const rejectedBy = String(req.body?.rejectedBy ?? req.body?.adminId ?? "admin");
  const reason = req.body?.reason ? String(req.body.reason).slice(0, 500) : undefined;

  try {
    const approval = await rejectApproval(approvalId, rejectedBy, reason);
    res.json({ ok: true, approval });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Rejection failed";
    res.status(409).json({ error: message });
  }
});

// ── POST /approvals/request-coupon ────────────────────────────────────────────

router.post("/approvals/request-coupon", async (req, res): Promise<void> => {
  const { customerProfileId, orderAmount, discountPercent, requestedBy, reason } = req.body ?? {};

  if (!customerProfileId || !orderAmount || !discountPercent || !requestedBy) {
    res.status(400).json({ error: "customerProfileId, orderAmount, discountPercent, requestedBy are required" });
    return;
  }

  try {
    const result = await requestCustomCouponIssuance({
      customerProfileId: parseInt(String(customerProfileId), 10),
      orderAmount: parseInt(String(orderAmount), 10),
      discountPercent: parseInt(String(discountPercent), 10),
      requestedBy: String(requestedBy),
      reason: reason ? String(reason).slice(0, 500) : "manual_request",
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

  if (!customerProfileId || !bundleCode || !requestedBy) {
    res.status(400).json({ error: "customerProfileId, bundleCode, requestedBy are required" });
    return;
  }

  try {
    const result = await requestBundleDiscount({
      customerProfileId: parseInt(String(customerProfileId), 10),
      bundleCode: String(bundleCode),
      requestedBy: String(requestedBy),
    });
    res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    res.status(400).json({ error: message });
  }
});

export default router;
