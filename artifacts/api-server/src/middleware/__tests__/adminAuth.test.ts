import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { adminAuthWithExceptions } from "../adminAuth.js";

/**
 * Phase 2.2 — Public Customer Route Auth Hotfix regression tests.
 *
 * These exercise adminAuthWithExceptions() directly (no HTTP layer) so they
 * run fast and don't need a DB. They assert the exact method+path matrix
 * from the audit: customer-facing GET/POST routes must pass through without
 * ADMIN_API_KEY, while admin/management routes on the *same* path prefixes
 * must still be rejected, and admin routes must still work if the correct
 * key is supplied.
 */

const ADMIN_KEY = "test-admin-key-123";

function makeReq(method: string, path: string, headers: Record<string, string> = {}): Request {
  return { method, path, headers } as unknown as Request;
}

function makeRes() {
  const res: { statusCode?: number; body?: unknown; status: (n: number) => typeof res; json: (b: unknown) => typeof res } = {
    status(n: number) {
      this.statusCode = n;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return res;
}

describe("adminAuthWithExceptions", () => {
  beforeEach(() => {
    process.env["ADMIN_API_KEY"] = ADMIN_KEY;
    process.env["NODE_ENV"] = "production"; // fail-closed path, matches "test with key active" requirement
  });

  afterEach(() => {
    delete process.env["ADMIN_API_KEY"];
    delete process.env["NODE_ENV"];
  });

  const publicRoutes: { method: string; path: string }[] = [
    { method: "GET", path: "/ai/catalog/services/42" },
    { method: "POST", path: "/ai/catalog/services/42/quote" },
    { method: "POST", path: "/ai/catalog/services/42/request" },
    { method: "GET", path: "/ai/portfolio/services/7/showcase" },
    { method: "POST", path: "/ai/portfolio/portfolios/9/view" },
    { method: "POST", path: "/ai/portfolio/preview" },
    { method: "GET", path: "/ai/portfolio/preview/5" },
    { method: "GET", path: "/ai/portfolio/preview/session/abc-123/count" },
    { method: "POST", path: "/ai/portfolio/preview/5/continue" },
    { method: "GET", path: "/ai/catalog/public" },
    { method: "GET", path: "/public/catalog/requests/some-uuid" },
    { method: "PUT", path: "/public/catalog/requests/some-uuid/brief" },
  ];

  it.each(publicRoutes)("allows $method $path without ADMIN_API_KEY", ({ method, path }) => {
    const req = makeReq(method, path);
    const res = makeRes();
    const next = vi.fn();
    adminAuthWithExceptions(req, res as unknown as Response, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });

  const adminRoutesSamePrefix: { method: string; path: string }[] = [
    { method: "GET", path: "/ai/catalog/services" }, // list — admin only
    { method: "POST", path: "/ai/catalog/services" }, // create — admin only
    { method: "PATCH", path: "/ai/catalog/services/42" }, // update — admin only
    { method: "DELETE", path: "/ai/catalog/services/42" }, // delete — admin only
    { method: "POST", path: "/ai/catalog/services/42/packages" }, // admin only
    { method: "PATCH", path: "/ai/catalog/packages/3" },
    { method: "DELETE", path: "/ai/catalog/packages/3" },
    { method: "GET", path: "/ai/catalog/requests" }, // internal list — admin only
    { method: "PATCH", path: "/ai/catalog/requests/1/status" },
    { method: "GET", path: "/ai/portfolio/services/7/portfolios" }, // management read — admin only
    { method: "POST", path: "/ai/portfolio/services/7/portfolios" },
    { method: "PATCH", path: "/ai/portfolio/portfolios/9" },
    { method: "DELETE", path: "/ai/portfolio/portfolios/9" },
    { method: "GET", path: "/ai/portfolio/analytics" },
    { method: "GET", path: "/commercial-gates" },
    { method: "POST", path: "/commercial-gates/1/verify" },
  ];

  it.each(adminRoutesSamePrefix)(
    "rejects $method $path without ADMIN_API_KEY (401)",
    ({ method, path }) => {
      const req = makeReq(method, path);
      const res = makeRes();
      const next = vi.fn();
      adminAuthWithExceptions(req, res as unknown as Response, next as unknown as NextFunction);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    },
  );

  it("rejects an admin route with the wrong key (401)", () => {
    const req = makeReq("GET", "/ai/catalog/requests", { authorization: "Bearer wrong-key" });
    const res = makeRes();
    const next = vi.fn();
    adminAuthWithExceptions(req, res as unknown as Response, next as unknown as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("allows an admin route with the correct key", () => {
    const req = makeReq("GET", "/ai/catalog/requests", { authorization: `Bearer ${ADMIN_KEY}` });
    const res = makeRes();
    const next = vi.fn();
    adminAuthWithExceptions(req, res as unknown as Response, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });

  it("allows an admin route with the correct key via x-admin-key header", () => {
    const req = makeReq("DELETE", "/ai/catalog/services/42", { "x-admin-key": ADMIN_KEY });
    const res = makeRes();
    const next = vi.fn();
    adminAuthWithExceptions(req, res as unknown as Response, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("never exposes the admin key requirement in the public error message for public routes", () => {
    // Sanity: a public route never even reaches the code path that could
    // produce "Unauthorized: ADMIN_API_KEY is not configured" etc.
    const req = makeReq("GET", "/ai/catalog/services/1");
    const res = makeRes();
    const next = vi.fn();
    adminAuthWithExceptions(req, res as unknown as Response, next as unknown as NextFunction);
    expect(res.body).toBeUndefined();
  });
});
