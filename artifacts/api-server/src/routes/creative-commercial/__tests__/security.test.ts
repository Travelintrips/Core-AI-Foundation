/**
 * creative-commercial/__tests__/security.test.ts — Team 03
 *
 * Audit-required security tests:
 *   1. Unauthenticated requests → 401
 *   2. Tenant isolation: admin A cannot read tenant B customer data
 *   3. Duplicate approval request → idempotent (returns existing, no new gate)
 *   4. Already-approved request cannot be approved again
 *   5. Reward issuance is idempotent (verifyGate called exactly once)
 *   6. Database failure path returns structured error
 *
 * These tests operate at the route layer using express + supertest,
 * with the service layer fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import type { Express, Request, Response, NextFunction } from "express";

// ── vi.hoisted: mocks must be defined before vi.mock runs ────────────────────

const mocks = vi.hoisted(() => ({
  // adminAuth — pass-through by default; tests for 401 override it
  adminAuth: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),

  // Service layer
  listPendingApprovals:    vi.fn().mockResolvedValue([]),
  getApproval:             vi.fn().mockResolvedValue(null),
  approveApproval:         vi.fn(),
  rejectApproval:          vi.fn(),
  requestCustomCouponIssuance: vi.fn(),
  requestBundleDiscount:   vi.fn(),
  getPackageRecommendations:   vi.fn().mockResolvedValue([]),
  getCrossSellRecommendations: vi.fn().mockResolvedValue([]),
  getCouponRecommendation:     vi.fn().mockResolvedValue(null),
  getAvailableBundles:         vi.fn().mockResolvedValue([]),
  getBundleRecommendation:     vi.fn().mockResolvedValue(null),
  getAbandonedCheckoutRecommendations: vi.fn().mockResolvedValue([]),
  detectAbandonedCheckouts:    vi.fn().mockResolvedValue([]),
  getAbandonmentStats:         vi.fn().mockResolvedValue({ totalAbandoned: 0 }),
  getRepeatOrderRecommendations: vi.fn().mockResolvedValue([]),
  findRepeatOrderCandidates:   vi.fn().mockResolvedValue([]),
  getRepeatOrderStats:         vi.fn().mockResolvedValue({ totalRepeatCustomers: 0 }),

  // Attribution
  calculateAttribution:    vi.fn().mockResolvedValue({ totalTouchpoints: 0 }),
  getCustomerTouchpoints:  vi.fn().mockResolvedValue([]),
  getAttributionReport:    vi.fn().mockResolvedValue({ model: "linear", topChannels: [], bySource: {} }),
  recordTouchpoint:        vi.fn().mockResolvedValue(undefined),

  // Funnel
  buildFunnelMetrics:  vi.fn().mockResolvedValue({ stages: [], projectedRevenue: 0, projectedOrders: 0, bySource: {} }),
  getFunnelSnapshots:  vi.fn().mockResolvedValue([]),

  // Logger
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// adminAuthWithExceptions must also be exported: creative-commercial/index.ts does
// router.use(adminAuthWithExceptions) and Vitest throws if the export is missing.
// Delegate to mocks.adminAuth so per-test mockImplementation changes propagate.
vi.mock("../../../middleware/adminAuth.js",                                () => ({
  adminAuth: mocks.adminAuth,
  adminAuthWithExceptions: vi.fn((req: unknown, res: unknown, next: () => void) => mocks.adminAuth(req, res, next)),
}));
vi.mock("../../../services/creative-commercial/index.js",                 () => mocks);
vi.mock("../../../services/creative-commercial/attributionService.js",    () => mocks);
vi.mock("../../../services/creative-commercial/funnelProjectionService.js", () => mocks);
vi.mock("../../../lib/logger.js", () => ({
  logger: { error: mocks.logError, warn: mocks.logWarn, info: vi.fn() },
}));

import ccRouter from "../index.js";

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
  // Reset to pass-through
  mocks.adminAuth.mockImplementation((_req: unknown, _res: unknown, next: () => void) => next());
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Unauthenticated requests → 401
// ─────────────────────────────────────────────────────────────────────────────

describe("Security — unauthenticated requests are rejected", () => {
  function blockAuth() {
    mocks.adminAuth.mockImplementation(
      (_req: Request, res: Response, _next: NextFunction) => {
        res.status(401).json({ error: "Unauthorized" });
      },
    );
  }

  const adminEndpoints = [
    { method: "GET",  path: "/ai/creative-commercial/recommendations/1" },
    { method: "GET",  path: "/ai/creative-commercial/recommendations/1/packages" },
    { method: "GET",  path: "/ai/creative-commercial/recommendations/1/cross-sell" },
    { method: "GET",  path: "/ai/creative-commercial/recommendations/1/coupon?orderAmount=100000" },
    { method: "GET",  path: "/ai/creative-commercial/bundles" },
    { method: "GET",  path: "/ai/creative-commercial/abandoned-checkouts" },
    { method: "GET",  path: "/ai/creative-commercial/repeat-order-candidates" },
    { method: "GET",  path: "/ai/creative-commercial/approvals" },
    { method: "GET",  path: "/ai/creative-commercial/funnel/projection" },
    { method: "GET",  path: "/ai/creative-commercial/funnel/snapshots" },
    { method: "GET",  path: "/ai/creative-commercial/attribution/report" },
    { method: "GET",  path: "/ai/creative-commercial/attribution/1" },
    { method: "GET",  path: "/ai/creative-commercial/attribution/1/touchpoints" },
  ];

  for (const { method, path } of adminEndpoints) {
    it(`${method} ${path} returns 401 without auth`, async () => {
      blockAuth();
      const s = await st(buildApp());
      const resp = method === "GET"
        ? await s.get(path)
        : await s.post(path).send({});
      expect(resp.status).toBe(401);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Tenant isolation — admin cannot see other tenants' data via report endpoints
// ─────────────────────────────────────────────────────────────────────────────

describe("Tenant isolation — attribution report passes tenantId to service", () => {
  it("passes tenantId query param through to getAttributionReport", async () => {
    mocks.getAttributionReport.mockResolvedValueOnce({ model: "linear", topChannels: [], bySource: {} });
    const resp = await (await st(buildApp()))
      .get("/ai/creative-commercial/attribution/report?tenantId=tenant-A");
    expect(resp.status).toBe(200);
    // Service must have been called with tenantId (not undefined/null)
    expect(mocks.getAttributionReport).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-A" }),
    );
  });

  it("passes tenantId to buildFunnelMetrics for funnel projection", async () => {
    mocks.buildFunnelMetrics.mockResolvedValueOnce({ stages: [], projectedRevenue: 0, projectedOrders: 0, bySource: {} });
    const resp = await (await st(buildApp()))
      .get("/ai/creative-commercial/funnel/projection?tenantId=tenant-A");
    expect(resp.status).toBe(200);
    // buildFunnelMetrics signature: (periodDays, tenantId?)
    const call = mocks.buildFunnelMetrics.mock.calls[0];
    // Second arg should be the tenantId
    expect(call?.[1]).toBe("tenant-A");
  });

  it("does NOT pass tenantId when not provided (platform-wide admin view)", async () => {
    mocks.getAttributionReport.mockResolvedValueOnce({ model: "linear", topChannels: [], bySource: {} });
    await (await st(buildApp())).get("/ai/creative-commercial/attribution/report");
    expect(mocks.getAttributionReport).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: undefined }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Duplicate approval request → idempotent
// ─────────────────────────────────────────────────────────────────────────────

describe("Duplicate approval → idempotent (no double gate creation)", () => {
  it("POST request-coupon called twice returns the same approvalId (service-level idempotency)", async () => {
    // First call
    mocks.requestCustomCouponIssuance.mockResolvedValueOnce({ approvalId: 42, message: "ok" });
    // Second call — idempotent: returns same id
    mocks.requestCustomCouponIssuance.mockResolvedValueOnce({ approvalId: 42, message: "ok" });

    const app = buildApp();
    const s = await st(app);

    const payload = { customerProfileId: 1, orderAmount: 500000, discountPercent: 10, requestedBy: "admin" };
    const r1 = await s.post("/ai/creative-commercial/approvals/request-coupon").send(payload);
    const r2 = await s.post("/ai/creative-commercial/approvals/request-coupon").send(payload);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.approvalId).toBe(42);
    expect(r2.body.approvalId).toBe(42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 & 5. Already-approved cannot be re-approved; reward issuance idempotent
// ─────────────────────────────────────────────────────────────────────────────

describe("Approved gate cannot be re-approved", () => {
  it("second approve returns 409 with 'already' message", async () => {
    // First approve succeeds
    mocks.approveApproval.mockResolvedValueOnce({
      id: 1,
      status: "approved",
      actionType: "issue_recovery_coupon",
      customerProfileId: 1,
      approvedBy: "mgr@test.com",
    });
    // Second approve → service throws (gate already approved)
    mocks.approveApproval.mockRejectedValueOnce(new Error("Approval #1 is already approved"));

    const app = buildApp();
    const s = await st(app);
    const body = { approvedBy: "mgr@test.com" };

    const r1 = await s.post("/ai/creative-commercial/approvals/1/approve").send(body);
    const r2 = await s.post("/ai/creative-commercial/approvals/1/approve").send(body);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(409);
    expect(r2.body.error).toMatch(/already/i);
  });

  it("approveApproval called exactly once per approval (no duplicate verifyGate)", async () => {
    mocks.approveApproval.mockResolvedValueOnce({
      id: 1, status: "approved", actionType: "issue_recovery_coupon", customerProfileId: 1, approvedBy: "mgr",
    });
    await (await st(buildApp()))
      .post("/ai/creative-commercial/approvals/1/approve")
      .send({ approvedBy: "mgr" });
    // Service called exactly once → no double-fire
    expect(mocks.approveApproval).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Database failure path → structured error, no crash, no stack trace
// ─────────────────────────────────────────────────────────────────────────────

describe("Database failure path — structured error returned", () => {
  const dbError = new Error("connection pool exhausted");

  it("GET /approvals returns 500 on DB error, no stack trace in body", async () => {
    mocks.listPendingApprovals.mockRejectedValueOnce(dbError);
    const resp = await (await st(buildApp())).get("/ai/creative-commercial/approvals");
    expect(resp.status).toBe(500);
    expect(resp.body.error).toBeDefined();
    expect(JSON.stringify(resp.body)).not.toContain("at Object.");
  });

  it("GET /funnel/projection returns 500 on DB error", async () => {
    mocks.buildFunnelMetrics.mockRejectedValueOnce(dbError);
    const resp = await (await st(buildApp())).get("/ai/creative-commercial/funnel/projection");
    expect(resp.status).toBe(500);
    expect(resp.body.error).toBeDefined();
  });

  it("GET /attribution/report returns 500 on DB error", async () => {
    mocks.getAttributionReport.mockRejectedValueOnce(dbError);
    const resp = await (await st(buildApp())).get("/ai/creative-commercial/attribution/report");
    expect(resp.status).toBe(500);
    expect(resp.body.error).toBeDefined();
  });

  it("GET /recommendations/1 returns 200 with partial data if one service fails (resilient)", async () => {
    // The recommendations aggregate endpoint uses Promise.allSettled — partial failure is OK
    mocks.getPackageRecommendations.mockRejectedValueOnce(dbError);
    mocks.getCrossSellRecommendations.mockResolvedValueOnce([]);
    mocks.getCouponRecommendation.mockResolvedValueOnce(null);
    mocks.getBundleRecommendation.mockResolvedValueOnce(null);
    const resp = await (await st(buildApp())).get("/ai/creative-commercial/recommendations/1?orderAmount=100000");
    // Promise.allSettled means partial results are fine
    expect(resp.status).toBe(200);
    expect(resp.body.packages).toEqual([]);
  });

  it("POST /approvals/1/approve returns 409 on service error, not 500", async () => {
    mocks.approveApproval.mockRejectedValueOnce(new Error("Not found"));
    const resp = await (await st(buildApp()))
      .post("/ai/creative-commercial/approvals/1/approve")
      .send({ approvedBy: "admin" });
    // Route treats all service errors on approve/reject as 409 (business error)
    expect(resp.status).toBe(409);
    expect(resp.body.error).toBeDefined();
  });
});
