/**
 * B5A — material-library?status=inactive auth tests
 *
 * Verifies:
 *   B5A-1: valid admin session → 200 (req.internalUser populated by optionalSessionAuth)
 *   B5A-2: anonymous (no credentials at all) → 401
 *   B5A-3: wrong API key → 403
 *   B5A-4: valid ADMIN_API_KEY header → 200 (server-to-server compat preserved)
 *   B5A-5: PUBLIC_ROUTE_RULES does not expose inactive to non-admin — confirmed by B5A-2/B5A-3
 *
 * Design:
 *   - Uses the REAL adminAuthWithExceptions and optionalSessionAuth middleware
 *     (no mock), to test the full global-middleware chain.
 *   - Mocks DB layer and session verification so no live Supabase connection needed.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import cookieParser from "cookie-parser";

// ── Hoist constants ───────────────────────────────────────────────────────────
const TEST_ADMIN_KEY = "test-admin-key-b5a-material";
const SESSION_COOKIE = "internal_session";

const mockInternalUser = {
  id: 42,
  email: "admin@cstlogistic.co.id",
  role: "superadmin",
  accountType: "internal",
  status: "active",
};

// ── DB-layer mock ─────────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), update: vi.fn(), insert: vi.fn() },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

// ── Internal auth service mock ────────────────────────────────────────────────
vi.mock("../../services/internalAuthService.js", () => ({
  SESSION_COOKIE_NAME: SESSION_COOKIE,
  verifySessionToken: vi.fn((token: string) =>
    token === "valid-session-token" ? { sub: "42" } : null,
  ),
  getInternalUserById: vi.fn(async (id: string) =>
    id === "42" ? mockInternalUser : null,
  ),
}));

// ── Material-library service mock ─────────────────────────────────────────────
vi.mock("../../domains/material-library/materialLibraryService.js", () => ({
  parseSearchParams: vi.fn(() => ({})),
  searchMaterials: vi.fn(async () => ({ materials: [], total: 0, page: 1, pageSize: 20 })),
  getMaterialById: vi.fn(),
  getCategories: vi.fn(async () => []),
  getBrands: vi.fn(async () => []),
  MaterialNotFoundError: class extends Error {},
  MaterialValidationError: class extends Error { field = ""; },
}));

vi.mock("../../domains/material-library/seed.js", () => ({
  seedMaterialLibrary: vi.fn(),
}));

// ── App builder ───────────────────────────────────────────────────────────────

async function buildApp() {
  const { optionalSessionAuth, adminAuthWithExceptions } = await import(
    "../../middleware/adminAuth.js"
  );
  const catalogRouter = (await import("../material-library-catalog.js")).default;

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // Mirror the production mount order from app.ts
  app.use("/api", optionalSessionAuth, adminAuthWithExceptions, catalogRouter);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("B5A — GET /material-library?status=inactive", () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env["ADMIN_API_KEY"] = TEST_ADMIN_KEY;
    process.env["NODE_ENV"] = "test";
    app = await buildApp();
  });

  afterAll(() => {
    delete process.env["ADMIN_API_KEY"];
    process.env["NODE_ENV"] = "development";
    vi.restoreAllMocks();
  });

  it("B5A-1: session admin (req.internalUser via optionalSessionAuth) → 200", async () => {
    const res = await request(app)
      .get("/api/material-library?status=inactive")
      .set("Cookie", `${SESSION_COOKIE}=valid-session-token`);
    expect(res.status).toBe(200);
  });

  it("B5A-2: anonymous (no session, no API key) → 401", async () => {
    const res = await request(app)
      .get("/api/material-library?status=inactive");
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("B5A-3: wrong API key → 403", async () => {
    const res = await request(app)
      .get("/api/material-library?status=inactive")
      .set("x-admin-api-key", "wrong-key");
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
  });

  it("B5A-4: valid ADMIN_API_KEY header → 200 (server-to-server compat preserved)", async () => {
    const res = await request(app)
      .get("/api/material-library?status=inactive")
      .set("x-admin-api-key", TEST_ADMIN_KEY);
    expect(res.status).toBe(200);
  });

  it("B5A-4b: valid API key via Authorization Bearer → 200", async () => {
    const res = await request(app)
      .get("/api/material-library?status=inactive")
      .set("Authorization", `Bearer ${TEST_ADMIN_KEY}`);
    expect(res.status).toBe(200);
  });

  it("B5A-5: invalid session token (no internalUser) → 401", async () => {
    const res = await request(app)
      .get("/api/material-library?status=inactive")
      .set("Cookie", `${SESSION_COOKIE}=garbage-token`);
    expect(res.status).toBe(401);
  });

  it("B5A-6: status=active (non-admin filter) → 200 without credentials", async () => {
    // Public route remains open for non-inactive statuses
    const res = await request(app)
      .get("/api/material-library?status=active");
    expect(res.status).toBe(200);
  });

  it("B5A-7: PUBLIC_ROUTE_RULES does not leak admin-only data to anonymous", async () => {
    // Confirm the public exemption does NOT bypass the handler-level inactive guard
    const res = await request(app)
      .get("/api/material-library?status=inactive");
    // No credentials → must be rejected
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(401);
  });
});
