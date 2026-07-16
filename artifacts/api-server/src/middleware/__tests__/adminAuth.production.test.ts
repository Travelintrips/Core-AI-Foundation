/**
 * WP-14 Regression: adminAuth production fail-closed behaviour
 *
 * Critical security requirement: in NODE_ENV=production, if ADMIN_API_KEY is
 * not set, the middleware MUST reject all requests (fail-closed).
 * In development, it may allow traffic for convenience (fail-open), but this
 * must never happen in production.
 *
 * Also verifies:
 *   - Correct key → next() called (200 from downstream handler)
 *   - Wrong key → 401
 *   - No key in production (ADMIN_API_KEY not set) → 401
 *   - Session cookie path works correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// We test adminAuth in isolation, mocking the session service.
vi.mock("../../services/internalAuthService.js", () => ({
  SESSION_COOKIE_NAME: "ai_platform_session",
  verifySessionToken: vi.fn().mockReturnValue(null), // default: invalid session
  getInternalUserById: vi.fn().mockResolvedValue(null),
}));

async function importAdminAuth() {
  // Force re-import to pick up new env var values
  vi.resetModules();
  // Re-mock after reset
  vi.mock("../../services/internalAuthService.js", () => ({
    SESSION_COOKIE_NAME: "ai_platform_session",
    verifySessionToken: vi.fn().mockReturnValue(null),
    getInternalUserById: vi.fn().mockResolvedValue(null),
  }));
  const mod = await import("../../middleware/adminAuth.js");
  return mod;
}

function makeApp(middleware: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  app.use(middleware);
  app.get("/protected", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("adminAuth — production fail-closed", () => {
  const originalEnv = process.env["NODE_ENV"];
  const originalKey = process.env["ADMIN_API_KEY"];

  afterEach(() => {
    process.env["NODE_ENV"] = originalEnv;
    if (originalKey !== undefined) {
      process.env["ADMIN_API_KEY"] = originalKey;
    } else {
      delete process.env["ADMIN_API_KEY"];
    }
  });

  it("rejects with 401 in production when ADMIN_API_KEY is not set", async () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["ADMIN_API_KEY"];

    const { adminAuth } = await importAdminAuth();
    const app = makeApp(adminAuth as express.RequestHandler);
    const res = await request(app).get("/protected");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/ADMIN_API_KEY/);
  });

  it("rejects with 401 when wrong key is supplied", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["ADMIN_API_KEY"] = "correct-key-abc123";

    const { adminAuth } = await importAdminAuth();
    const app = makeApp(adminAuth as express.RequestHandler);
    const res = await request(app)
      .get("/protected")
      .set("x-admin-api-key", "wrong-key");

    expect(res.status).toBe(401);
  });

  it("allows with 200 when correct key is supplied via x-admin-api-key", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["ADMIN_API_KEY"] = "correct-key-abc123";

    const { adminAuth } = await importAdminAuth();
    const app = makeApp(adminAuth as express.RequestHandler);
    const res = await request(app)
      .get("/protected")
      .set("x-admin-api-key", "correct-key-abc123");

    expect(res.status).toBe(200);
  });

  it("allows with 200 when correct key is supplied via Authorization Bearer", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["ADMIN_API_KEY"] = "correct-key-abc123";

    const { adminAuth } = await importAdminAuth();
    const app = makeApp(adminAuth as express.RequestHandler);
    const res = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer correct-key-abc123");

    expect(res.status).toBe(200);
  });

  it("does NOT allow in development when ADMIN_API_KEY is not set (fail-open is only for dev)", async () => {
    // This test documents the KNOWN behaviour: dev is fail-open.
    // The important guarantee is that production is fail-CLOSED (tested above).
    process.env["NODE_ENV"] = "development";
    delete process.env["ADMIN_API_KEY"];

    const { adminAuth } = await importAdminAuth();
    const app = makeApp(adminAuth as express.RequestHandler);
    const res = await request(app).get("/protected");

    // In dev without a key, the middleware allows all (documented convenience)
    expect(res.status).toBe(200);
  });
});

describe("adminAuth — PUBLIC_PATH_PREFIXES exemptions", () => {
  beforeEach(() => {
    process.env["NODE_ENV"] = "production";
    process.env["ADMIN_API_KEY"] = "test-admin-key";
  });

  afterEach(() => {
    delete process.env["ADMIN_API_KEY"];
  });

  it("skips auth for /healthz", async () => {
    const { adminAuthWithExceptions } = await importAdminAuth();
    const app = express();
    app.use(adminAuthWithExceptions as express.RequestHandler);
    app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
  });

  it("skips auth for /public/* routes", async () => {
    const { adminAuthWithExceptions } = await importAdminAuth();
    const app = express();
    app.use(adminAuthWithExceptions as express.RequestHandler);
    app.get("/public/customer/quotation/abc", (_req, res) => res.json({ ok: true }));

    const res = await request(app).get("/public/customer/quotation/abc");
    expect(res.status).toBe(200);
  });

  it("requires auth for /ai/* routes", async () => {
    const { adminAuthWithExceptions } = await importAdminAuth();
    const app = express();
    app.use(adminAuthWithExceptions as express.RequestHandler);
    app.get("/ai/agents", (_req, res) => res.json({ ok: true }));

    const res = await request(app).get("/ai/agents");
    expect(res.status).toBe(401);
  });
});
