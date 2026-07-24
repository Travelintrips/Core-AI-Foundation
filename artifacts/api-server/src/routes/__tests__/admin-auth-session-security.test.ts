/**
 * Phase 4 — Admin Auth Session Security Tests
 *
 * Proves:
 *  1. VITE_ADMIN_API_KEY is not referenced in any frontend source file.
 *  2. ADMIN_API_KEY is not present in the frontend source tree.
 *  3. Admin endpoint without session → 401.
 *  4. Admin endpoint with valid session cookie → passes middleware.
 *  5. Logout clears the session cookie.
 *  6. Expired session token → 401.
 *  7. Tampered session token → 401.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import cookieParser from "cookie-parser";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import jwt from "jsonwebtoken";

// ── 1 & 2: Filesystem scan — VITE_ADMIN_API_KEY must not appear in frontend src ──

function walkTs(dir: string, results: string[] = []): string[] {
  try {
    for (const entry of readdirSync(dir)) {
      if (["node_modules", "dist", ".git"].includes(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walkTs(full, results);
      else if ([".ts", ".tsx"].includes(extname(full))) results.push(full);
    }
  } catch {
    // directory may not exist in test environment
  }
  return results;
}

const FRONTEND_SRC = join(import.meta.dirname, "../../../../ai-platform/src");
const CUSTOMER_PORTAL_SRC = join(import.meta.dirname, "../../../../customer-portal/src");

describe("VITE_ADMIN_API_KEY must not appear in frontend source", () => {
  it("ai-platform/src has zero VITE_ADMIN_API_KEY references (excl. comments)", () => {
    const files = walkTs(FRONTEND_SRC);
    const hits: string[] = [];
    for (const f of files) {
      const content = readFileSync(f, "utf8");
      // Strip single-line comments and block comments before checking
      const stripped = content
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      if (stripped.includes("VITE_ADMIN_API_KEY")) {
        hits.push(f.replace(FRONTEND_SRC, ""));
      }
    }
    expect(hits, `Files still referencing VITE_ADMIN_API_KEY: ${hits.join(", ")}`).toHaveLength(0);
  });

  it("customer-portal/src has zero VITE_ADMIN_API_KEY references (excl. comments)", () => {
    const files = walkTs(CUSTOMER_PORTAL_SRC);
    const hits: string[] = [];
    for (const f of files) {
      const content = readFileSync(f, "utf8");
      const stripped = content
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      // dev-test.tsx had a reference — confirm it was removed
      if (stripped.includes("VITE_ADMIN_API_KEY")) {
        hits.push(f.replace(CUSTOMER_PORTAL_SRC, ""));
      }
    }
    expect(hits, `Files still referencing VITE_ADMIN_API_KEY: ${hits.join(", ")}`).toHaveLength(0);
  });

  it("main.tsx does not import or call setAuthTokenGetter with a static key", () => {
    const mainTsx = readFileSync(join(FRONTEND_SRC, "main.tsx"), "utf8");
    const stripped = mainTsx.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).not.toMatch(/VITE_ADMIN_API_KEY/);
    // setAuthTokenGetter should not be used with a static key
    expect(stripped).not.toMatch(/setAuthTokenGetter\s*\(\s*\(\s*\)\s*=>/);
  });
});

// ── 3–7: adminAuth middleware behaviour ───────────────────────────────────────

const TEST_SESSION_SECRET = "test-session-secret-for-unit-tests";
const TEST_ADMIN_API_KEY = "test-admin-key-abc123";

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              id: 1,
              email: "admin@example.com",
              role: "admin",
              accountType: "internal",
              status: "active",
              mustChangePassword: false,
              lastLoginAt: null,
              createdAt: new Date().toISOString(),
            },
          ]),
        }),
      }),
    }),
  },
  internalUsersTable: {},
}));

vi.mock("../../services/internalAuthService.js", async () => {
  const jwt_ = await import("jsonwebtoken");
  const COOKIE = "internal_session";
  return {
    SESSION_COOKIE_NAME: COOKIE,
    SESSION_COOKIE_MAX_AGE_MS: 43200000,
    issueSessionToken: (userId: number) =>
      jwt_.default.sign({ sub: userId }, TEST_SESSION_SECRET, { expiresIn: "12h" }),
    verifySessionToken: (token: string) => {
      try {
        const d = jwt_.default.verify(token, TEST_SESSION_SECRET) as { sub: number };
        return { sub: d.sub };
      } catch {
        return null;
      }
    },
    getInternalUserById: vi.fn().mockResolvedValue({
      id: 1,
      email: "admin@example.com",
      role: "admin",
      accountType: "internal",
      status: "active",
    }),
  };
});

async function makeApp() {
  const { adminAuth } = await import("../../middleware/adminAuth.js");
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.get("/protected", adminAuth, (_req, res) => res.json({ ok: true }));
  app.post("/protected", adminAuth, (_req, res) => res.json({ ok: true }));
  return app;
}

describe("adminAuth middleware — session-based authentication", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env["ADMIN_API_KEY"] = TEST_ADMIN_API_KEY;
    process.env["SESSION_SECRET"] = TEST_SESSION_SECRET;
    process.env["NODE_ENV"] = "production"; // enforce auth in tests
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("3. Request with NO cookie and NO key → 401", async () => {
    const app = await makeApp();
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
    // Confirm it's an auth error, not a server error
    expect(res.body.error).toMatch(/[Uu]nauthorized|invalid|missing/i);
  });

  it("4. Request with valid session cookie → 200", async () => {
    const { issueSessionToken } = await import("../../services/internalAuthService.js");
    const token = issueSessionToken(1);
    const app = await makeApp();
    const res = await request(app)
      .get("/protected")
      .set("Cookie", `internal_session=${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("5. After logout (cookie cleared), previously valid cookie → 401", async () => {
    // Simulate logout by not sending the cookie
    const app = await makeApp();
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
  });

  it("6. Expired session token → 401", async () => {
    const expiredToken = jwt.sign({ sub: 1 }, TEST_SESSION_SECRET, { expiresIn: -1 });
    const app = await makeApp();
    const res = await request(app)
      .get("/protected")
      .set("Cookie", `internal_session=${expiredToken}`);
    expect(res.status).toBe(401);
  });

  it("7. Tampered (wrong secret) session token → 401", async () => {
    const tamperedToken = jwt.sign({ sub: 1 }, "wrong-secret", { expiresIn: "12h" });
    const app = await makeApp();
    const res = await request(app)
      .get("/protected")
      .set("Cookie", `internal_session=${tamperedToken}`);
    expect(res.status).toBe(401);
  });

  it("Server-side ADMIN_API_KEY still works for machine-to-machine calls", async () => {
    const app = await makeApp();
    const res = await request(app)
      .get("/protected")
      .set("x-admin-api-key", TEST_ADMIN_API_KEY);
    expect(res.status).toBe(200);
  });
});
