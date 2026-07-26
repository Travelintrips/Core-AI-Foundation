/**
 * Phase 2 Acceptance Gap 2B — Analytics authorization.
 *
 * Verifies that GET /material-library/intelligence/analytics:
 *   - returns 401 for anonymous requests (no key, no session)
 *   - returns 200 for requests bearing a valid ADMIN_API_KEY
 *   - is NOT in the PUBLIC_ROUTE_RULES exception list
 *   - returns only aggregate counters (no PII, no credentials)
 *   - all counters are finite numbers (bounded)
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

// ── Hoist: admin key used in all tests ────────────────────────────────────────
const TEST_ADMIN_KEY = "test-admin-api-key-phase2-gap2b";

// ── Minimal DB mock so the server module can load ─────────────────────────────
vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), update: vi.fn(), insert: vi.fn() },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("../../services/aiAuditService.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/internalAuthService.js", () => ({
  verifySessionToken: vi.fn().mockReturnValue(null),
  getInternalUserById: vi.fn().mockResolvedValue(null),
  SESSION_COOKIE_NAME: "replit_session",
}));

// ── Build a minimal Express app with the real adminAuthWithExceptions ─────────
async function buildApp() {
  const { adminAuthWithExceptions } = await import("../../middleware/adminAuth.js");
  const intelligenceRouter = (await import("../material-intelligence.js")).default;

  const app = express();
  app.use(express.json());
  app.use(adminAuthWithExceptions);
  app.use(intelligenceRouter);
  return app;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Phase 2 Gap 2B — Analytics authorization", () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env["ADMIN_API_KEY"] = TEST_ADMIN_KEY;
    process.env["NODE_ENV"] = "production"; // ensure fail-closed behaviour
    app = await buildApp();
  });

  afterAll(() => {
    delete process.env["ADMIN_API_KEY"];
    process.env["NODE_ENV"] = "development";
    vi.restoreAllMocks();
  });

  it("2B-1: anonymous request (no key) returns 401", async () => {
    const res = await request(app)
      .get("/material-library/intelligence/analytics");
    expect(res.status).toBe(401);
  });

  it("2B-2: request with wrong key returns 401", async () => {
    const res = await request(app)
      .get("/material-library/intelligence/analytics")
      .set("x-admin-key", "wrong-key");
    expect(res.status).toBe(401);
  });

  it("2B-3: authorized request with Bearer token returns 200", async () => {
    const res = await request(app)
      .get("/material-library/intelligence/analytics")
      .set("Authorization", `Bearer ${TEST_ADMIN_KEY}`);
    expect(res.status).toBe(200);
  });

  it("2B-4: authorized request with x-admin-key header returns 200", async () => {
    const res = await request(app)
      .get("/material-library/intelligence/analytics")
      .set("x-admin-key", TEST_ADMIN_KEY);
    expect(res.status).toBe(200);
  });

  it("2B-5: response body contains aggregate counters only (no PII fields)", async () => {
    const res = await request(app)
      .get("/material-library/intelligence/analytics")
      .set("x-admin-key", TEST_ADMIN_KEY);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    // Must have analytics fields
    expect(body).toHaveProperty("searchCount");
    expect(body).toHaveProperty("cacheHitRatio");
    expect(body).toHaveProperty("averageResponseTimeMs");
    // Must NOT expose user identifiers or credentials
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("sessionToken");
    expect(body).not.toHaveProperty("apiKey");
  });

  it("2B-6: searchCount is a finite non-negative number (bounded)", async () => {
    const res = await request(app)
      .get("/material-library/intelligence/analytics")
      .set("x-admin-key", TEST_ADMIN_KEY);
    const { searchCount } = res.body as { searchCount: number };
    expect(Number.isFinite(searchCount)).toBe(true);
    expect(searchCount).toBeGreaterThanOrEqual(0);
  });

  it("2B-7: cacheHitRatio is between 0 and 1 (bounded)", async () => {
    const res = await request(app)
      .get("/material-library/intelligence/analytics")
      .set("x-admin-key", TEST_ADMIN_KEY);
    const { cacheHitRatio } = res.body as { cacheHitRatio: number };
    expect(cacheHitRatio).toBeGreaterThanOrEqual(0);
    expect(cacheHitRatio).toBeLessThanOrEqual(1);
  });

  it("2B-8: the public search route is still reachable without auth", async () => {
    const res = await request(app)
      .get("/material-library/search?q=marble");
    // Should not be 401 — search remains public
    expect(res.status).not.toBe(401);
  });

  it("2B-9: the public suggestions route is still reachable without auth", async () => {
    const res = await request(app)
      .get("/material-library/suggestions?q=mar");
    expect(res.status).not.toBe(401);
  });
});
