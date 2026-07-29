/**
 * B5A — fashionDesignAuthGuard unit tests
 *
 * Verifies:
 *   B5A-FD-1: session admin (req.internalUser set) → passes without ADMIN_API_KEY
 *   B5A-FD-2: no session + no ADMIN_API_KEY → 503 (prevents fail-open)
 *   B5A-FD-3: no session + ADMIN_API_KEY configured → passes (API-key path)
 *   B5A-FD-4: invalid API key → passes guard (adminAuth validates it next)
 *             (guard only checks whether key is CONFIGURED, not whether it's correct)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { fashionDesignAuthGuard } from "../authGuard.js";

// ── Minimal mock helpers ──────────────────────────────────────────────────────

function makeRes() {
  let statusCode = 0;
  let body: unknown = null;
  const res = {
    status(code: number) { statusCode = code; return res; },
    json(data: unknown) { body = data; return res; },
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

function makeReq(internalUser?: unknown): Request {
  const req: Record<string, unknown> = {};
  if (internalUser !== undefined) req["internalUser"] = internalUser;
  return req as unknown as Request;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("fashionDesignAuthGuard (B5A)", () => {
  const originalKey = process.env["ADMIN_API_KEY"];

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env["ADMIN_API_KEY"];
    } else {
      process.env["ADMIN_API_KEY"] = originalKey;
    }
  });

  it("B5A-FD-1: session admin (req.internalUser set) passes — no ADMIN_API_KEY needed", () => {
    delete process.env["ADMIN_API_KEY"];

    const req = makeReq({ id: 1, email: "admin@cstlogistic.co.id", accountType: "internal", status: "active" });
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    fashionDesignAuthGuard(req, res, next);

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(0); // no response sent
  });

  it("B5A-FD-2: no session + no ADMIN_API_KEY → 503 (prevents fail-open)", () => {
    delete process.env["ADMIN_API_KEY"];

    const req = makeReq(); // no internalUser
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    fashionDesignAuthGuard(req, res, next);

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(503);
    const body = res.body as Record<string, unknown>;
    expect(body["code"]).toBe("AUTH_NOT_CONFIGURED");
  });

  it("B5A-FD-3: no session + ADMIN_API_KEY configured → passes (API-key path handled by adminAuth)", () => {
    process.env["ADMIN_API_KEY"] = "test-key-b5a-fd3";

    const req = makeReq(); // no internalUser
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    fashionDesignAuthGuard(req, res, next);

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(0);
  });

  it("B5A-FD-4: server-to-server valid API key → guard passes (key validation is adminAuth responsibility)", () => {
    process.env["ADMIN_API_KEY"] = "configured-key-fd4";

    // Guard only checks whether ADMIN_API_KEY is configured, not whether
    // the presented header matches — that's adminAuth's responsibility.
    const req = makeReq();
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    fashionDesignAuthGuard(req, res, next);

    expect(nextCalled).toBe(true);
  });

  it("B5A-FD-5: invalid session internalUser shape still passes guard (guard trusts upstream middleware)", () => {
    delete process.env["ADMIN_API_KEY"];

    // If req.internalUser is set it means adminAuth upstream already accepted the
    // session. The guard trusts that verification.
    const req = makeReq({ id: 99, role: "viewer" }); // minimal shape
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    fashionDesignAuthGuard(req, res, next);

    expect(nextCalled).toBe(true);
  });
});
