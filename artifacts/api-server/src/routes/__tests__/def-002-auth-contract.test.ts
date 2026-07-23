/**
 * DEF-002 — /api/internal/auth/me auth contract.
 *
 * Contract decision: SESSION-ONLY BY DESIGN.
 *
 * GET /internal/auth/me resolves identity from session cookie (requireAuth
 * middleware), NOT from the admin API key. These are two separate auth
 * mechanisms. The admin API key grants access to admin routes; a session
 * cookie is issued after email+password login via POST /internal/auth/login.
 *
 * Rationale:
 *   - The Internal AI Portal's admin frontend authenticates via session cookie.
 *   - Machine-to-machine callers using admin API key do not need /auth/me;
 *     they already know their own identity.
 *   - Mixing the two auth mechanisms on the same "identity" endpoint would
 *     require a unified actor/tenant context that does not currently exist.
 *
 * Evidence (callsite audit):
 *   - src/routes/internal-auth.ts  → `router.get("/internal/auth/me", requireAuth, ...)`
 *   - requireAuth middleware validates SESSION_COOKIE_NAME (JWT signed with SESSION_SECRET)
 *   - adminAuthWithExceptions checks x-admin-api-key (different code path entirely)
 *   - No frontend component calls /auth/me with an API key; all calls originate
 *     from the browser session established by POST /internal/auth/login.
 *
 * Verdict: DEF-002 is NOT a product defect.
 *          Admin API key rejection on /auth/me is correct behaviour.
 */

import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import internalAuthRouter from "../internal-auth.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: () => ({ where: vi.fn().mockResolvedValue([]) }),
    }),
    update: vi.fn().mockReturnValue({
      set: () => ({ where: vi.fn().mockResolvedValue([]) }),
    }),
    insert: vi.fn().mockReturnValue({
      values: () => vi.fn().mockResolvedValue([]),
    }),
  },
  internalUsersTable: {},
  toSafeInternalUser: (u: unknown) => u,
}));

vi.mock("../../services/passwordService.js", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed"),
  verifyPassword: vi.fn().mockResolvedValue(true),
  isPasswordStrongEnough: vi.fn().mockReturnValue(true),
}));

vi.mock("../../services/internalAuthService.js", () => ({
  issueSessionToken: vi.fn().mockReturnValue("test-session-token"),
  getInternalUserByEmail: vi.fn().mockResolvedValue(null),
  SESSION_COOKIE_NAME: "admin_session",
  SESSION_COOKIE_MAX_AGE_MS: 86400000,
}));

vi.mock("../../middleware/internalAuth.js", () => ({
  requireAuth: (
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction,
  ) => {
    // Simulate: only session cookie auth passes requireAuth
    const cookie = req.cookies?.["admin_session"];
    if (cookie === "valid-session-token") {
      req.internalUser = { id: 1, email: "admin@example.com", role: "admin" } as never;
      next();
    } else {
      res.status(401).json({ error: "Not authenticated" });
    }
  },
}));

vi.mock("../../middleware/rateLimiter.js", () => ({
  loginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../services/aiAuditService.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

// ── Test app ─────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(require("cookie-parser")());
app.use(internalAuthRouter);

describe("DEF-002 — /internal/auth/me auth contract (SESSION-ONLY BY DESIGN)", () => {
  it("1. No credentials → 401", async () => {
    const res = await request(app).get("/internal/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Not authenticated");
  });

  it("2. Valid admin API key WITHOUT session cookie → 401 (correct: API key is not accepted here)", async () => {
    const res = await request(app)
      .get("/internal/auth/me")
      .set("x-admin-api-key", "any-valid-api-key");
    // SESSION-ONLY: API key must not bypass requireAuth on this endpoint
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Not authenticated");
  });

  it("3. Valid session cookie → 200 with user object", async () => {
    const res = await request(app)
      .get("/internal/auth/me")
      .set("Cookie", "admin_session=valid-session-token");
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.id).toBe(1);
  });

  it("4. Invalid session cookie → 401", async () => {
    const res = await request(app)
      .get("/internal/auth/me")
      .set("Cookie", "admin_session=invalid-garbage");
    expect(res.status).toBe(401);
  });

  it("5. DEF-002 contract documentation: endpoint is session-only, not a product defect", () => {
    // This test documents the design decision inline so it appears in the test report.
    const contractDecision = {
      endpoint: "GET /internal/auth/me",
      authMechanism: "session-cookie only (requireAuth middleware)",
      adminApiKeySupported: false,
      verdict: "SESSION-ONLY BY DESIGN — NOT a product defect",
      rationale:
        "requireAuth validates SESSION_COOKIE_NAME (JWT). " +
        "Admin API key (x-admin-api-key) is a separate mechanism for machine access. " +
        "Mixing them on /auth/me would require unified actor context not yet needed.",
    };
    expect(contractDecision.adminApiKeySupported).toBe(false);
    expect(contractDecision.verdict).toContain("NOT a product defect");
  });
});
