/**
 * coupons.test.ts — UAT regression: duplicate coupon → 409 JSON
 *
 * Covers:
 * - duplicate coupon code → HTTP 409 with JSON body (no raw DB detail)
 * - other DB errors → still throw (not swallowed as 409)
 * - no stack trace / raw SQL in 409 response
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Mock the coupon service ──────────────────────────────────────────────────

vi.mock("../../services/couponService", () => ({
  listCoupons: vi.fn().mockResolvedValue([]),
  createCoupon: vi.fn(),
  updateCoupon: vi.fn(),
  validateCoupon: vi.fn(),
  redeemCoupon: vi.fn(),
  DuplicateCouponError: class DuplicateCouponError extends Error {
    constructor(code: string) {
      super(`Coupon code '${code}' already exists`);
      this.name = "DuplicateCouponError";
    }
  },
}));

import couponsRouter from "../coupons.js";
import * as couponService from "../../services/couponService.js";

// Minimal Express app for route testing
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(couponsRouter);
  // Generic error handler
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "internal_server_error" });
  });
  return app;
}

describe("POST /ai/coupons — duplicate coupon handling", () => {
  const validPayload = { code: "SAVE10", type: "percentage", value: 10 };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("✓ duplicate coupon → 409 JSON with controlled message", async () => {
    // Simulate the service throwing DuplicateCouponError (23505 path)
    const { DuplicateCouponError } = await import("../../services/couponService.js");
    (couponService.createCoupon as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DuplicateCouponError("SAVE10"),
    );

    const app = makeApp();
    const res = await request(app).post("/ai/coupons").send(validPayload);

    expect(res.status).toBe(409);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toHaveProperty("error", "conflict");
    expect(res.body).toHaveProperty("message");
    expect(res.body.message).toContain("SAVE10");
  });

  it("✓ 409 response does not leak raw DB detail or stack trace", async () => {
    const { DuplicateCouponError } = await import("../../services/couponService.js");
    (couponService.createCoupon as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DuplicateCouponError("SAVE10"),
    );

    const app = makeApp();
    const res = await request(app).post("/ai/coupons").send(validPayload);

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/stack/i);
    expect(body).not.toMatch(/23505/);
    expect(body).not.toMatch(/unique/i);
    expect(body).not.toMatch(/<!DOCTYPE/i); // no HTML error page
  });

  it("✓ non-duplicate DB error is NOT swallowed as 409", async () => {
    const otherError = new Error("Connection timeout");
    (couponService.createCoupon as ReturnType<typeof vi.fn>).mockRejectedValue(otherError);

    const app = makeApp();
    const res = await request(app).post("/ai/coupons").send(validPayload);

    // Should propagate to the generic error handler as 500
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("internal_server_error");
  });

  it("✓ successful creation still returns 201", async () => {
    const fakeCoupon = { id: 1, code: "SAVE10", type: "percentage", value: 10, status: "active" };
    (couponService.createCoupon as ReturnType<typeof vi.fn>).mockResolvedValue(fakeCoupon);

    const app = makeApp();
    const res = await request(app).post("/ai/coupons").send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.code).toBe("SAVE10");
  });
});

describe("DuplicateCouponError — service-level unit", () => {
  it("✓ DuplicateCouponError is specifically identified (not generic Error)", async () => {
    const { DuplicateCouponError } = await import("../../services/couponService.js");
    const err = new DuplicateCouponError("TEST50");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DuplicateCouponError");
    expect(err.message).toContain("TEST50");
  });
});
