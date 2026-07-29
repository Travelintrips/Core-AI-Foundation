/**
 * fashion-design — Route-level auth tests (B3)
 *
 * Covers the revisions endpoint which has an inline admin check that was
 * updated to accept req.internalUser (session-based auth) in addition to
 * ADMIN_API_KEY headers (server-to-server compat).
 *
 * Tests:
 *   - session admin (req.internalUser) can list revisions without API key
 *   - API key admin can list revisions (backward compat)
 *   - non-admin without session requires customerEmail
 *   - non-admin with wrong email → 403
 *   - no credentials at all → 401
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Request, Response, NextFunction } from "express";

// ── Mocks (must be before static imports) ─────────────────────────────────────

vi.mock("../../domains/fashion-design/authGuard.js", () => ({
  fashionDesignAuthGuard: (_req: Request, _res: Response, next: NextFunction) => next(),
  isAuthConfigured: () => true,
}));

vi.mock("../../middleware/rateLimiter.js", () => ({
  aiGenerationLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../../middleware/adminAuth.js", () => ({
  adminAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  adminAuthWithExceptions: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAdminApiKey: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  },
}));

const mockOrder = {
  id: 1,
  customerName: "Test Customer",
  customerEmail: "customer@example.com",
  orderName: "Test Order",
  status: "in_progress",
  serviceType: "jersey",
  outputs: null,
  compositionJson: null,
  trademarkSafe: true,
  trademarkNotes: null,
};

vi.mock("../../services/fashionDesignService.js", () => ({
  createOrder: vi.fn(),
  listOrders: vi.fn(async () => ({ orders: [], total: 0, page: 1, pageSize: 20 })),
  getOrder: vi.fn(async (id: number) => (id === 1 ? mockOrder : null)),
  updateOrderStatus: vi.fn(),
  updateOrderColorways: vi.fn(),
  deleteOrder: vi.fn(),
  saveBlueprint: vi.fn(),
  getBlueprint: vi.fn(async () => null),
  runTrademarkCheck: vi.fn(),
  generateOutputs: vi.fn(),
  getAvailableServices: vi.fn(() => []),
  validateServiceType: vi.fn(),
  validateStatus: vi.fn(),
}));

vi.mock("../../services/fashionRevisionService.js", () => ({
  requestRevision: vi.fn(),
  assignDesigner: vi.fn(),
  uploadRevision: vi.fn(),
  listRevisions: vi.fn(async () => [
    { id: 1, orderId: 1, type: "human", status: "pending", feedback: "Please adjust", createdAt: new Date().toISOString() },
  ]),
}));

// ── Static imports after mocks ─────────────────────────────────────────────────

import fashionDesignRouter from "../fashion-design.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN_KEY = "test-admin-key-fashion";

/** App where req.internalUser is set (simulates browser admin with valid session cookie) */
function buildAppWithSession() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as Record<string, unknown>).internalUser = {
      id: 1,
      email: "admin@cstlogistic.co.id",
      role: "superadmin",
      accountType: "internal",
      status: "active",
    };
    next();
  });
  app.use(fashionDesignRouter);
  return app;
}

/** Plain app — no session, no API key by default */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fashionDesignRouter);
  return app;
}

beforeEach(() => {
  process.env["ADMIN_API_KEY"] = ADMIN_KEY;
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// B3 — GET /ai/fashion-design/orders/:id/revisions auth
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /ai/fashion-design/orders/:id/revisions — session admin (B3)", () => {
  it("session admin (req.internalUser) can list revisions without API key", async () => {
    const res = await request(buildAppWithSession())
      .get("/ai/fashion-design/orders/1/revisions");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("revisions");
    expect(Array.isArray(res.body.revisions)).toBe(true);
  });

  it("API key admin can list revisions (server-to-server compat preserved)", async () => {
    const res = await request(buildApp())
      .get("/ai/fashion-design/orders/1/revisions")
      .set("x-admin-api-key", ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("revisions");
  });

  it("non-admin without session requires ?customerEmail= matching the order", async () => {
    const res = await request(buildApp())
      .get("/ai/fashion-design/orders/1/revisions");
    // No API key, no internalUser, no customerEmail → 401
    expect(res.status).toBe(401);
  });

  it("non-admin with correct customerEmail can list their own revisions", async () => {
    const res = await request(buildApp())
      .get("/ai/fashion-design/orders/1/revisions?customerEmail=customer@example.com");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("revisions");
  });

  it("non-admin with wrong customerEmail → 403", async () => {
    const res = await request(buildApp())
      .get("/ai/fashion-design/orders/1/revisions?customerEmail=wrong@example.com");
    expect(res.status).toBe(403);
  });

  it("non-admin request with role injected via query (not internalUser) is still rejected → 401", async () => {
    // Ensure that injecting "role=admin" as a query param does not grant admin
    // access. Only req.internalUser (set by the centralized adminAuth after
    // DB-verified session) is trusted — body/query/header role claims are ignored.
    const res = await request(buildApp())
      .get("/ai/fashion-design/orders/1/revisions")
      .query({ role: "admin" }); // role injection via query — must be ignored
    // No API key, no internalUser, no customerEmail → 401
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Admin routes: session cookie reaches routes gated by fashionDesignAuthGuard+adminAuth
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /ai/fashion-design/orders — admin session (B3 coverage)", () => {
  it("session admin can list all orders", async () => {
    const res = await request(buildAppWithSession())
      .get("/ai/fashion-design/orders");
    // adminAuth mock passes all, internalUser is set
    expect(res.status).toBe(200);
  });

  it("no auth → adminAuth mock passes, but verifies wiring is correct", async () => {
    // In real app the global adminAuth protects this. Here adminAuth is mocked to pass.
    // This test just ensures the route itself doesn't crash.
    const res = await request(buildApp())
      .get("/ai/fashion-design/orders");
    expect(res.status).toBe(200);
  });
});
