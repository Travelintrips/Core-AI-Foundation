/**
 * smtp-diagnostic.test.ts — GET /ai/admin/smtp/diagnostic
 *
 * Tests:
 *  1. configured — returns all fields without password
 *  2. not configured — configured: false
 *  3. no auth — 401
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Hoisted mocks ──────────────────────────────────────────────────────────────
const mockIsEmailConfigured = vi.hoisted(() => vi.fn<[], boolean>());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../../services/emailService.js", () => ({
  isEmailConfigured: mockIsEmailConfigured,
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

// Mock all heavy imports used by admin-customer-workspace
vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from:    vi.fn().mockReturnThis(),
      where:   vi.fn().mockResolvedValue([]),
      orderBy: vi.fn().mockReturnThis(),
      limit:   vi.fn().mockResolvedValue([]),
    }),
    update: vi.fn().mockReturnValue({
      set:   vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    }),
    insert: vi.fn().mockReturnValue({
      values:    vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 1 }]),
    }),
  },
  customerDashboardTokensTable:       { id: "id", clientEmail: "clientEmail", tokenHash: "tokenHash", expiresAt: "expiresAt" },
  aiCustomerImpersonationTokensTable: { id: "id", clientEmail: "clientEmail", tokenHash: "tokenHash", expiresAt: "expiresAt", reason: "reason", createdByKey: "createdByKey" },
}));

vi.mock("../../services/aiAuditService.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/customerWorkspaceService.js", () => ({
  resolveCustomerByEmail:       vi.fn().mockResolvedValue(null),
  getWorkspaceSummary:          vi.fn().mockResolvedValue({}),
  listWorkspaceProjectsFiltered: vi.fn().mockResolvedValue([]),
  listWorkspaceDownloads:       vi.fn().mockResolvedValue([]),
  listWorkspaceInvoices:        vi.fn().mockResolvedValue([]),
  listBrandKits:                vi.fn().mockResolvedValue([]),
  listWorkspaceActivity:        vi.fn().mockResolvedValue([]),
  computeWorkspaceAnalytics:    vi.fn().mockResolvedValue({}),
  hashEmail:                    vi.fn((e: string) => `hash_${e}`),
}));

vi.mock("../../services/clientReviewService.js", () => ({
  hashToken: vi.fn((t: string) => `hash_${t}`),
  generateReviewToken: vi.fn().mockReturnValue({ plaintext: "tok", hash: "hash" }),
}));

vi.mock("../../services/internalAuthService.js", () => ({
  SESSION_COOKIE_NAME: "ai_platform_session",
  verifySessionToken:  vi.fn().mockReturnValue(null),
  getInternalUserById: vi.fn().mockResolvedValue(null),
}));

// ── Test app ───────────────────────────────────────────────────────────────────

async function buildApp() {
  const adminCustomerWorkspaceRouter = (await import("../admin-customer-workspace.js")).default;
  const app = express();
  app.use(express.json());
  app.use(adminCustomerWorkspaceRouter);
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("GET /ai/admin/smtp/diagnostic", () => {
  const origNodeEnv   = process.env["NODE_ENV"];
  const origAdminKey  = process.env["ADMIN_API_KEY"];
  const origSmtpHost  = process.env["SMTP_HOST"];
  const origSmtpPort  = process.env["SMTP_PORT"];
  const origSmtpUser  = process.env["SMTP_USER"];
  const origSmtpPass  = process.env["SMTP_PASS"];
  const origSmtpFrom  = process.env["SMTP_FROM"];

  beforeEach(() => {
    vi.resetModules();
    process.env["NODE_ENV"]     = "production";
    process.env["ADMIN_API_KEY"] = "test-admin-key-123";
  });

  afterEach(() => {
    // Restore env
    process.env["NODE_ENV"]     = origNodeEnv ?? "test";
    if (origAdminKey !== undefined) process.env["ADMIN_API_KEY"] = origAdminKey;
    else delete process.env["ADMIN_API_KEY"];
    if (origSmtpHost !== undefined) process.env["SMTP_HOST"] = origSmtpHost;
    else delete process.env["SMTP_HOST"];
    if (origSmtpPort !== undefined) process.env["SMTP_PORT"] = origSmtpPort;
    else delete process.env["SMTP_PORT"];
    if (origSmtpUser !== undefined) process.env["SMTP_USER"] = origSmtpUser;
    else delete process.env["SMTP_USER"];
    if (origSmtpPass !== undefined) process.env["SMTP_PASS"] = origSmtpPass;
    else delete process.env["SMTP_PASS"];
    if (origSmtpFrom !== undefined) process.env["SMTP_FROM"] = origSmtpFrom;
    else delete process.env["SMTP_FROM"];
  });

  it("returns fields without password when SMTP is configured", async () => {
    process.env["SMTP_HOST"] = "smtp.example.com";
    process.env["SMTP_PORT"] = "587";
    process.env["SMTP_USER"] = "alerts@example.com";
    process.env["SMTP_PASS"] = "super-secret-pass";
    process.env["SMTP_FROM"] = "noreply@example.com";

    mockIsEmailConfigured.mockReturnValue(true);

    const app = await buildApp();
    const res = await request(app)
      .get("/ai/admin/smtp/diagnostic")
      .set("x-admin-api-key", "test-admin-key-123");

    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.host).toBe("smtp.example.com");
    expect(res.body.port).toBe(587);
    expect(res.body.user).toBe("alerts@example.com");
    expect(res.body.from).toBe("noreply@example.com");

    // CRITICAL: password must never appear in the response
    expect(JSON.stringify(res.body)).not.toContain("super-secret-pass");
    expect(res.body).not.toHaveProperty("pass");
    expect(res.body).not.toHaveProperty("password");
    expect(res.body).not.toHaveProperty("SMTP_PASS");
  });

  it("returns configured: false when SMTP is not configured", async () => {
    delete process.env["SMTP_HOST"];
    delete process.env["SMTP_USER"];
    delete process.env["SMTP_PASS"];

    mockIsEmailConfigured.mockReturnValue(false);

    const app = await buildApp();
    const res = await request(app)
      .get("/ai/admin/smtp/diagnostic")
      .set("x-admin-api-key", "test-admin-key-123");

    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.host).toBeNull();
    expect(res.body.user).toBeNull();
  });

  it("returns 401 when no auth is provided", async () => {
    mockIsEmailConfigured.mockReturnValue(true);

    const app = await buildApp();
    const res = await request(app)
      .get("/ai/admin/smtp/diagnostic");
    // No Authorization header or x-admin-api-key

    expect(res.status).toBe(401);
  });

  it("returns 401 when wrong admin key is provided", async () => {
    mockIsEmailConfigured.mockReturnValue(true);

    const app = await buildApp();
    const res = await request(app)
      .get("/ai/admin/smtp/diagnostic")
      .set("x-admin-api-key", "wrong-key");

    expect(res.status).toBe(401);
  });
});
