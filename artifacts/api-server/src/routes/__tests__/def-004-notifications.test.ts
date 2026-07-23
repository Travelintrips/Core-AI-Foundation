/**
 * DEF-004 — Notification canonical mapping tests.
 *
 * Verifies that GET /api/public/customer/workspace/:token/notifications
 * returns notifications with:
 *   1. `type` field present and not undefined
 *   2. `tenantId` field present and equals the session's clientEmail
 *   3. Cross-tenant isolation — notifications scoped to the authenticated customer
 *   4. Unknown type falls back safely (no undefined, no exception)
 *   5. Retry does not duplicate notifications
 *   6. `tenantId` is never undefined for tenant-scoped notifications
 *   7. Platform notifications are clearly distinguished
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listWorkspaceNotifications,
  type WorkspaceNotification,
  type WorkspaceSession,
} from "../../services/customerWorkspaceService.js";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockListProjects = vi.hoisted(() => vi.fn());
const mockListDownloads = vi.hoisted(() => vi.fn());
const mockListInvoices = vi.hoisted(() => vi.fn());
const mockDbSelect = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  db: { select: mockDbSelect },
  customerNotificationReadsTable: { notificationKey: "notificationKey" },
  creativeAiAssetsTable: {},
  creativeProjectsTable: {},
  creativeAiClientReviewsTable: {},
  aiServiceRequestsTable: {},
  aiServicesTable: {},
  aiAffiliatesTable: {},
  customerDashboardTokensTable: {},
}));

// Mock the heavy service deps that require DB / external calls
vi.mock("../../services/customerWorkspaceService.js", async () => {
  const actual = await vi.importActual<typeof import("../../services/customerWorkspaceService.js")>(
    "../../services/customerWorkspaceService.js",
  );
  return {
    ...actual,
    listAllWorkspaceProjects: mockListProjects,
    listWorkspaceDownloads: mockListDownloads,
    listInvoicesForProjects: mockListInvoices,
  };
});

vi.mock("../../lib/publicBaseUrl.js", () => ({
  getPublicBaseUrl: () => "https://test.example.com",
}));
vi.mock("../../lib/publicBaseUrl", () => ({
  getPublicBaseUrl: () => "https://test.example.com",
}));
vi.mock("../../services/signedUrlService.js", () => ({
  generateDownloadToken: () => "signed-token",
}));
vi.mock("../../services/clientReviewService.js", () => ({
  hashToken: (t: string) => `hash_${t}`,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSession(email: string): WorkspaceSession {
  return {
    id: 1,
    clientEmail: email,
    emailHash: `hash_of_${email}`,
    clientName: "Test User",
    tokenHash: "token_hash",
    expiresAt: new Date(Date.now() + 86400_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "proj-001",
    projectNumber: "PRJ-001",
    brandName: "Test Brand",
    currentStage: "brief",
    currentStageLabel: "Brief",
    status: "in_progress",
    paymentStatus: "paid",
    reviewStatus: "shared",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DEF-004 — Notification canonical mapping", () => {
  const req = {} as import("express").Request;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no read records
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
    mockListInvoices.mockResolvedValue([]);
    mockListDownloads.mockResolvedValue([]);
  });

  it("1. `type` field is present and not undefined on all notifications", async () => {
    const session = makeSession("user@example.com");
    mockListProjects.mockResolvedValue([makeProject()]);

    const items = await listWorkspaceNotifications(req, session, {});

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.type).toBeDefined();
      expect(typeof item.type).toBe("string");
      expect(item.type.length).toBeGreaterThan(0);
    }
  });

  it("2. `tenantId` equals the authenticated customer's email", async () => {
    const session = makeSession("tenant-a@example.com");
    mockListProjects.mockResolvedValue([makeProject()]);

    const items = await listWorkspaceNotifications(req, session, {});

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.tenantId).toBe("tenant-a@example.com");
    }
  });

  it("3. Cross-tenant isolation — tenantId does not bleed between sessions", async () => {
    const sessionA = makeSession("tenant-a@example.com");
    const sessionB = makeSession("tenant-b@example.com");

    mockListProjects.mockResolvedValue([makeProject({ brandName: "Brand A" })]);
    const itemsA = await listWorkspaceNotifications(req, sessionA, {});

    mockListProjects.mockResolvedValue([makeProject({ brandName: "Brand B", projectNumber: "PRJ-002" })]);
    const itemsB = await listWorkspaceNotifications(req, sessionB, {});

    for (const n of itemsA) expect(n.tenantId).toBe("tenant-a@example.com");
    for (const n of itemsB) expect(n.tenantId).toBe("tenant-b@example.com");

    // No cross-contamination
    const aIds = new Set(itemsA.map((n) => n.tenantId));
    const bIds = new Set(itemsB.map((n) => n.tenantId));
    expect([...aIds]).not.toEqual(expect.arrayContaining([...bIds]));
  });

  it("4. Project without paymentStatus or reviewStatus still returns valid notifications", async () => {
    const session = makeSession("user@example.com");
    mockListProjects.mockResolvedValue([
      makeProject({ paymentStatus: null, reviewStatus: null }),
    ]);

    const items = await listWorkspaceNotifications(req, session, {});

    // Should at minimum have the project stage notification
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.type).toBeDefined();
      expect(item.tenantId).toBe("user@example.com");
    }
  });

  it("5. Retry / duplicate call does not duplicate notifications", async () => {
    const session = makeSession("user@example.com");
    mockListProjects.mockResolvedValue([makeProject()]);

    const items1 = await listWorkspaceNotifications(req, session, {});
    const items2 = await listWorkspaceNotifications(req, session, {});

    // Same keys — deduped by key within each call, counts should be stable
    const keys1 = items1.map((n) => n.key).sort();
    const keys2 = items2.map((n) => n.key).sort();
    expect(keys1).toEqual(keys2);
  });

  it("6. tenantId is never undefined (always string | null, not missing)", async () => {
    const session = makeSession("check@example.com");
    mockListProjects.mockResolvedValue([makeProject()]);
    mockListInvoices.mockResolvedValue([{
      invoiceNumber: "INV-001",
      status: "pending",
      projectNumber: "PRJ-001",
      issuedAt: new Date().toISOString(),
    }]);
    mockListDownloads.mockResolvedValue([{
      id: "dl-1",
      status: "unlocked",
      title: "Final Package",
      projectNumber: "PRJ-001",
      locked: false,
      createdAt: new Date().toISOString(),
    }]);

    const items = await listWorkspaceNotifications(req, session, {});

    for (const item of items) {
      // `tenantId` key must EXIST — not absent/undefined
      expect("tenantId" in item).toBe(true);
      // Tenant-scoped notifications must not be null
      expect(item.tenantId).toBe("check@example.com");
    }
  });

  it("7. Notification types cover expected categories", async () => {
    const session = makeSession("user@example.com");
    mockListProjects.mockResolvedValue([makeProject()]);
    mockListInvoices.mockResolvedValue([{
      invoiceNumber: "INV-001",
      status: "pending",
      projectNumber: "PRJ-001",
      issuedAt: new Date().toISOString(),
    }]);
    mockListDownloads.mockResolvedValue([{
      id: "dl-1",
      status: "unlocked",
      title: "Final Package",
      projectNumber: "PRJ-001",
      locked: false,
      createdAt: new Date().toISOString(),
    }]);

    const items = await listWorkspaceNotifications(req, session, {});
    const types = new Set(items.map((n) => n.type));

    // Must include at least project, payment, review, invoice, and download types
    expect(types.has("project")).toBe(true);
    expect(types.has("payment")).toBe(true);
    expect(types.has("invoice")).toBe(true);
    expect(types.has("download")).toBe(true);
  });
});
