/**
 * creative-commercial/__tests__/routes.test.ts — Team 03
 *
 * Audit remediation P2 test suite:
 *   - Unauthorized request (adminAuth rejects → 401)
 *   - Malformed path param (non-integer / zero / negative customerProfileId → 400)
 *   - Malformed query param (invalid orderAmount → 400, empty approvedBy → 400)
 *   - Pagination limit clamping (limit > max → clamped, never exceeded)
 *   - Service throws → route returns structured error, not crash (500/409)
 *   - Approval not found → 404
 *   - Happy-path smoke tests for key endpoints
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import type { Express, Request, Response, NextFunction } from "express";

// ── vi.hoisted: mock modules before any imports ───────────────────────────────

const mocks = vi.hoisted(() => ({
  // adminAuth — pass-through by default; swap per-test for 401 scenarios
  adminAuth: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),

  // service mocks
  getPackageRecommendations:           vi.fn().mockResolvedValue([]),
  getCrossSellRecommendations:         vi.fn().mockResolvedValue([]),
  getCouponRecommendation:             vi.fn().mockResolvedValue(null),
  getAvailableBundles:                 vi.fn().mockResolvedValue([]),
  getBundleRecommendation:             vi.fn().mockResolvedValue(null),
  requestBundleDiscount:               vi.fn().mockResolvedValue({ approvalId: 1 }),
  getAbandonedCheckoutRecommendations: vi.fn().mockResolvedValue([]),
  detectAbandonedCheckouts:            vi.fn().mockResolvedValue([]),
  getAbandonmentStats:                 vi.fn().mockResolvedValue({ totalAbandoned: 0, recoveredCount: 0, recoveryRate: 0, avgHoursBeforeAbandonment: 0 }),
  getRepeatOrderRecommendations:       vi.fn().mockResolvedValue([]),
  findRepeatOrderCandidates:           vi.fn().mockResolvedValue([]),
  getRepeatOrderStats:                 vi.fn().mockResolvedValue({ totalRepeatCustomers: 0, avgDaysBetweenOrders: 0, repeatRate: 0 }),
  approveApproval:                     vi.fn(),
  rejectApproval:                      vi.fn(),
  listPendingApprovals:                vi.fn().mockResolvedValue([]),
  getApproval:                         vi.fn().mockResolvedValue(null),
  requestCustomCouponIssuance:         vi.fn().mockResolvedValue({ approvalId: 99, message: "ok" }),

  // attribution service
  calculateAttribution:   vi.fn().mockResolvedValue({ totalTouchpoints: 0, multiTouchWeighted: {} }),
  getCustomerTouchpoints: vi.fn().mockResolvedValue([]),
  getAttributionReport:   vi.fn().mockResolvedValue({ model: "linear", topChannels: [], bySource: {} }),
  recordTouchpoint:       vi.fn().mockResolvedValue(undefined),

  // funnel service
  buildFunnelMetrics:  vi.fn().mockResolvedValue({ stages: [], projectedRevenue: 0, projectedOrders: 0, bySource: {} }),
  getFunnelSnapshots:  vi.fn().mockResolvedValue([]),

  // logger
  logError: vi.fn(),
  logWarn:  vi.fn(),
}));

// adminAuthWithExceptions must also be exported: creative-commercial/index.ts does
// router.use(adminAuthWithExceptions) and Vitest throws if the export is missing.
// Delegate to mocks.adminAuth so per-test mockImplementation changes propagate.
vi.mock("../../../middleware/adminAuth.js", () => ({
  adminAuth: mocks.adminAuth,
  adminAuthWithExceptions: vi.fn((req: unknown, res: unknown, next: () => void) => mocks.adminAuth(req, res, next)),
}));

vi.mock("../../../services/creative-commercial/index.js", () => ({
  getPackageRecommendations:           mocks.getPackageRecommendations,
  getCrossSellRecommendations:         mocks.getCrossSellRecommendations,
  getCouponRecommendation:             mocks.getCouponRecommendation,
  getAvailableBundles:                 mocks.getAvailableBundles,
  getBundleRecommendation:             mocks.getBundleRecommendation,
  requestBundleDiscount:               mocks.requestBundleDiscount,
  getAbandonedCheckoutRecommendations: mocks.getAbandonedCheckoutRecommendations,
  detectAbandonedCheckouts:            mocks.detectAbandonedCheckouts,
  getAbandonmentStats:                 mocks.getAbandonmentStats,
  getRepeatOrderRecommendations:       mocks.getRepeatOrderRecommendations,
  findRepeatOrderCandidates:           mocks.findRepeatOrderCandidates,
  getRepeatOrderStats:                 mocks.getRepeatOrderStats,
  approveApproval:                     mocks.approveApproval,
  rejectApproval:                      mocks.rejectApproval,
  listPendingApprovals:                mocks.listPendingApprovals,
  getApproval:                         mocks.getApproval,
  requestCustomCouponIssuance:         mocks.requestCustomCouponIssuance,
}));

vi.mock("../../../services/creative-commercial/attributionService.js", () => ({
  calculateAttribution:   mocks.calculateAttribution,
  getCustomerTouchpoints: mocks.getCustomerTouchpoints,
  getAttributionReport:   mocks.getAttributionReport,
  recordTouchpoint:       mocks.recordTouchpoint,
}));

vi.mock("../../../services/creative-commercial/funnelProjectionService.js", () => ({
  buildFunnelMetrics: mocks.buildFunnelMetrics,
  getFunnelSnapshots: mocks.getFunnelSnapshots,
}));

vi.mock("../../../lib/logger.js", () => ({
  logger: { error: mocks.logError, warn: mocks.logWarn, info: vi.fn() },
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────

import ccRouter from "../index.js";

// ── App factory ───────────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/ai/creative-commercial", ccRouter);
  return app;
}

async function st(app: Express) {
  const { default: supertest } = await import("supertest");
  return supertest(app);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adminAuth.mockImplementation((_req: unknown, _res: unknown, next: () => void) => next());
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth — 401 when adminAuth rejects
// ─────────────────────────────────────────────────────────────────────────────

describe("Auth — explicit adminAuth at router level", () => {
  function blockAuth() {
    mocks.adminAuth.mockImplementation(
      (_req: Request, res: Response, _next: NextFunction) => {
        res.status(401).json({ error: "Unauthorized" });
      },
    );
  }

  it("returns 401 for GET /recommendations/:id when auth blocks", async () => {
    blockAuth();
    const resp = await (await st(buildApp())).get("/ai/creative-commercial/recommendations/1");
    expect(resp.status).toBe(401);
  });

  it("returns 401 for GET /bundles when auth blocks", async () => {
    blockAuth();
    const resp = await (await st(buildApp())).get("/ai/creative-commercial/bundles");
    expect(resp.status).toBe(401);
  });

  it("returns 401 for POST /approvals/1/approve when auth blocks", async () => {
    blockAuth();
    const resp = await (await st(buildApp()))
      .post("/ai/creative-commercial/approvals/1/approve")
      .send({ approvedBy: "admin" });
    expect(resp.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input validation — 400 for malformed params
// ─────────────────────────────────────────────────────────────────────────────

describe("Input validation — 400 for malformed params", () => {
  it("returns 400 for non-integer customerProfileId", async () => {
    const resp = await (await st(buildApp())).get("/ai/creative-commercial/recommendations/abc");
    expect(resp.status).toBe(400);
    expect(resp.body.error).toMatch(/invalid/i);
  });

  it("returns 400 for zero customerProfileId", async () => {
    const resp = await (await st(buildApp())).get("/ai/creative-commercial/recommendations/0");
    expect(resp.status).toBe(400);
  });

  it("returns 400 for negative customerProfileId", async () => {
    const resp = await (await st(buildApp())).get("/ai/creative-commercial/recommendations/-5");
    expect(resp.status).toBe(400);
  });

  it("returns 400 for coupon endpoint with orderAmount=0", async () => {
    const resp = await (await st(buildApp()))
      .get("/ai/creative-commercial/recommendations/1/coupon?orderAmount=0");
    expect(resp.status).toBe(400);
    expect(resp.body.error).toMatch(/orderAmount/i);
  });

  it("returns 400 for coupon endpoint with negative orderAmount", async () => {
    const resp = await (await st(buildApp()))
      .get("/ai/creative-commercial/recommendations/1/coupon?orderAmount=-100");
    expect(resp.status).toBe(400);
  });

  it("returns 400 for approve with empty approvedBy string", async () => {
    const resp = await (await st(buildApp()))
      .post("/ai/creative-commercial/approvals/1/approve")
      .send({ approvedBy: "" });
    expect(resp.status).toBe(400);
    expect(resp.body.error).toMatch(/approvedBy/i);
  });

  it("returns 400 for approve with missing approvedBy field", async () => {
    const resp = await (await st(buildApp()))
      .post("/ai/creative-commercial/approvals/1/approve")
      .send({});
    expect(resp.status).toBe(400);
  });

  it("returns 400 for approve with non-integer approvalId", async () => {
    const resp = await (await st(buildApp()))
      .post("/ai/creative-commercial/approvals/abc/approve")
      .send({ approvedBy: "admin" });
    expect(resp.status).toBe(400);
  });

  it("returns 400 for record-touchpoint with missing source", async () => {
    const resp = await (await st(buildApp()))
      .post("/ai/creative-commercial/attribution/record-touchpoint")
      .send({ customerProfileId: 1 });
    expect(resp.status).toBe(400);
    expect(resp.body.error).toMatch(/source/i);
  });

  it("returns 400 for record-touchpoint with missing customerProfileId", async () => {
    const resp = await (await st(buildApp()))
      .post("/ai/creative-commercial/attribution/record-touchpoint")
      .send({ source: "google" });
    expect(resp.status).toBe(400);
  });

  it("returns 400 for request-coupon with missing orderAmount", async () => {
    const resp = await (await st(buildApp()))
      .post("/ai/creative-commercial/approvals/request-coupon")
      .send({ customerProfileId: 1, discountPercent: 10, requestedBy: "admin" });
    expect(resp.status).toBe(400);
  });

  it("returns 400 for request-bundle-discount with customerProfileId=0", async () => {
    const resp = await (await st(buildApp()))
      .post("/ai/creative-commercial/approvals/request-bundle-discount")
      .send({ customerProfileId: 0, bundleCode: "STARTER", requestedBy: "admin" });
    expect(resp.status).toBe(400);
  });

  it("returns 400 for request-bundle-discount with empty bundleCode", async () => {
    const resp = await (await st(buildApp()))
      .post("/ai/creative-commercial/approvals/request-bundle-discount")
      .send({ customerProfileId: 1, bundleCode: "", requestedBy: "admin" });
    expect(resp.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pagination limit clamping
// ─────────────────────────────────────────────────────────────────────────────

describe("Pagination limit clamping", () => {
  it("clamps abandoned-checkouts limit to ≤200 when 9999 requested", async () => {
    await (await st(buildApp())).get("/ai/creative-commercial/abandoned-checkouts?limit=9999");
    const call = mocks.detectAbandonedCheckouts.mock.calls[0]?.[0];
    expect(call?.limit).toBeLessThanOrEqual(200);
  });

  it("clamps repeat-order limit to ≤200 when 9999 requested", async () => {
    await (await st(buildApp())).get("/ai/creative-commercial/repeat-order-candidates?limit=9999");
    const call = mocks.findRepeatOrderCandidates.mock.calls[0]?.[0];
    expect(call?.limit).toBeLessThanOrEqual(200);
  });

  it("clamps windowHours to ≤168 when 999 requested", async () => {
    await (await st(buildApp())).get("/ai/creative-commercial/abandoned-checkouts?windowHours=999");
    const call = mocks.detectAbandonedCheckouts.mock.calls[0]?.[0];
    expect(call?.windowHours).toBeLessThanOrEqual(168);
  });

  it("clamps inactiveDays to ≤365 when 9999 requested", async () => {
    await (await st(buildApp())).get("/ai/creative-commercial/repeat-order-candidates?inactiveDays=9999");
    const call = mocks.findRepeatOrderCandidates.mock.calls[0]?.[0];
    expect(call?.inactiveDaysThreshold).toBeLessThanOrEqual(365);
  });

  it("clamps funnel snapshot limit to ≤90 when 999 requested", async () => {
    await (await st(buildApp())).get("/ai/creative-commercial/funnel/snapshots?limit=999");
    expect(mocks.getFunnelSnapshots.mock.calls[0]?.[0]).toBeLessThanOrEqual(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Service throws → structured error (no crash, no stack trace leak)
// ─────────────────────────────────────────────────────────────────────────────

describe("Error handling — service throws → structured 500 / 409", () => {
  it("returns 500 (not crash) when package rec service throws", async () => {
    mocks.getPackageRecommendations.mockRejectedValueOnce(new Error("DB timeout"));
    const resp = await (await st(buildApp()))
      .get("/ai/creative-commercial/recommendations/1/packages");
    expect(resp.status).toBe(500);
    expect(resp.body.error).toBeDefined();
  });

  it("returns 500 when cross-sell service throws", async () => {
    mocks.getCrossSellRecommendations.mockRejectedValueOnce(new Error("DB timeout"));
    const resp = await (await st(buildApp()))
      .get("/ai/creative-commercial/recommendations/1/cross-sell");
    expect(resp.status).toBe(500);
    expect(resp.body.error).toBeDefined();
  });

  it("returns 500 when funnel projection throws", async () => {
    mocks.buildFunnelMetrics.mockRejectedValueOnce(new Error("DB timeout"));
    const resp = await (await st(buildApp())).get("/ai/creative-commercial/funnel/projection");
    expect(resp.status).toBe(500);
    expect(resp.body.error).toBeDefined();
  });

  it("returns 500 when attribution report throws", async () => {
    mocks.getAttributionReport.mockRejectedValueOnce(new Error("DB timeout"));
    const resp = await (await st(buildApp())).get("/ai/creative-commercial/attribution/report");
    expect(resp.status).toBe(500);
    expect(resp.body.error).toBeDefined();
  });

  it("returns 500 when abandoned-checkouts service throws", async () => {
    mocks.detectAbandonedCheckouts.mockRejectedValueOnce(new Error("DB error"));
    const resp = await (await st(buildApp())).get("/ai/creative-commercial/abandoned-checkouts");
    expect(resp.status).toBe(500);
    expect(resp.body.error).toBeDefined();
  });

  it("returns 409 when approveApproval throws (already approved)", async () => {
    mocks.approveApproval.mockRejectedValueOnce(new Error("Approval already approved"));
    const resp = await (await st(buildApp()))
      .post("/ai/creative-commercial/approvals/1/approve")
      .send({ approvedBy: "manager@test.com" });
    expect(resp.status).toBe(409);
    expect(resp.body.error).toMatch(/already approved/i);
  });

  it("returns 409 when rejectApproval throws (not pending)", async () => {
    mocks.rejectApproval.mockRejectedValueOnce(new Error("Not found or not pending"));
    const resp = await (await st(buildApp()))
      .post("/ai/creative-commercial/approvals/5/reject")
      .send({ rejectedBy: "manager@test.com", reason: "too expensive" });
    expect(resp.status).toBe(409);
  });

  it("response body never contains a stack trace", async () => {
    mocks.getPackageRecommendations.mockRejectedValueOnce(new Error("secret internal error"));
    const resp = await (await st(buildApp()))
      .get("/ai/creative-commercial/recommendations/1/packages");
    expect(JSON.stringify(resp.body)).not.toContain("at Object.");
    expect(JSON.stringify(resp.body)).not.toContain("at async");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Approval 404 and terminal state
// ─────────────────────────────────────────────────────────────────────────────

describe("Approval — 404 when not found", () => {
  it("returns 404 for unknown approvalId", async () => {
    mocks.getApproval.mockResolvedValueOnce(null);
    const resp = await (await st(buildApp())).get("/ai/creative-commercial/approvals/9999");
    expect(resp.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Happy-path smoke tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Happy path smoke tests", () => {
  it("GET /bundles returns 200 with array", async () => {
    mocks.getAvailableBundles.mockResolvedValueOnce([{ bundleCode: "TEST" }]);
    const resp = await (await st(buildApp())).get("/ai/creative-commercial/bundles");
    expect(resp.status).toBe(200);
    expect(Array.isArray(resp.body)).toBe(true);
  });

  it("GET /approvals returns 200 with array", async () => {
    const resp = await (await st(buildApp())).get("/ai/creative-commercial/approvals");
    expect(resp.status).toBe(200);
    expect(Array.isArray(resp.body)).toBe(true);
  });

  it("GET /funnel/projection returns 200", async () => {
    const resp = await (await st(buildApp())).get("/ai/creative-commercial/funnel/projection");
    expect(resp.status).toBe(200);
    expect(resp.body.stages).toBeDefined();
  });

  it("GET /attribution/report returns 200", async () => {
    const resp = await (await st(buildApp())).get("/ai/creative-commercial/attribution/report");
    expect(resp.status).toBe(200);
    expect(resp.body.model).toBe("linear");
  });

  it("POST /attribution/record-touchpoint returns 201", async () => {
    const resp = await (await st(buildApp()))
      .post("/ai/creative-commercial/attribution/record-touchpoint")
      .send({ customerProfileId: 1, source: "google", touchpointType: "organic" });
    expect(resp.status).toBe(201);
    expect(resp.body.ok).toBe(true);
  });

  it("POST /approvals/request-coupon returns 201 with approvalId", async () => {
    const resp = await (await st(buildApp()))
      .post("/ai/creative-commercial/approvals/request-coupon")
      .send({ customerProfileId: 1, orderAmount: 500000, discountPercent: 10, requestedBy: "admin" });
    expect(resp.status).toBe(201);
    expect(resp.body.approvalId).toBe(99);
  });
});
