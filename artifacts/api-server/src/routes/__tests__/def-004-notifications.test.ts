/**
 * DEF-004 — Notification canonical mapping tests.
 *
 * Tests the pure function buildWorkspaceNotificationsFromProjects directly,
 * bypassing the DB fetch layer entirely. This avoids the internal-closure mock
 * problem where vi.mock("customerWorkspaceService") cannot replace references
 * captured inside listWorkspaceNotifications's closure.
 *
 * DEF-004 fix: extracted buildWorkspaceNotificationsFromProjects so tests
 * pass projects/invoices/downloads as arguments rather than relying on
 * fragile module-closure mocking of listAllWorkspaceProjects.
 *
 * Verifies that the pure builder:
 *   1. `type` field is present and not undefined on all notifications
 *   2. `tenantId` equals the authenticated customer's email
 *   3. Cross-tenant isolation — no tenantId bleed between sessions
 *   4. Project without paymentStatus/reviewStatus still returns notifications
 *   5. Retry / duplicate call does not duplicate notifications (stable keys)
 *   6. `tenantId` is never undefined for any notification
 *   7. Notification types cover expected categories
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildWorkspaceNotificationsFromProjects,
  type WorkspaceNotification,
  type WorkspaceSession,
  type WorkspaceProject,
  type WorkspaceInvoice,
  type WorkspaceDownloadItem,
} from "../../services/customerWorkspaceService.js";

// ── Module mocks (needed so customerWorkspaceService.ts can be loaded) ────────
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

function makeProject(overrides: Partial<WorkspaceProject> = {}): WorkspaceProject {
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
    internalProjectId: null,
    serviceType: null,
    ...overrides,
  } as WorkspaceProject;
}

function makeInvoice(overrides: Partial<WorkspaceInvoice> = {}): WorkspaceInvoice {
  return {
    invoiceNumber: "INV-001",
    status: "pending",
    projectNumber: "PRJ-001",
    issuedAt: new Date().toISOString(),
    ...overrides,
  } as WorkspaceInvoice;
}

function makeDownload(overrides: Partial<WorkspaceDownloadItem> = {}): WorkspaceDownloadItem {
  return {
    id: 1,
    title: "Final Package",
    category: "source_files",
    projectNumber: "PRJ-001",
    projectName: "Test Brand",
    version: 1,
    status: "unlocked",
    approvedBy: null,
    revisionNotes: null,
    locked: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as WorkspaceDownloadItem;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DEF-004 — Notification canonical mapping (pure function)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. `type` field is present and not undefined on all notifications", () => {
    const session = makeSession("user@example.com");
    const projects = [makeProject()];

    const items = buildWorkspaceNotificationsFromProjects(
      projects, [], [], new Set(), session, {},
    );

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.type).toBeDefined();
      expect(typeof item.type).toBe("string");
      expect(item.type.length).toBeGreaterThan(0);
    }
  });

  it("2. `tenantId` equals the authenticated customer's email", () => {
    const session = makeSession("tenant-a@example.com");
    const projects = [makeProject()];

    const items = buildWorkspaceNotificationsFromProjects(
      projects, [], [], new Set(), session, {},
    );

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.tenantId).toBe("tenant-a@example.com");
    }
  });

  it("3. Cross-tenant isolation — tenantId does not bleed between sessions", () => {
    const sessionA = makeSession("tenant-a@example.com");
    const sessionB = makeSession("tenant-b@example.com");

    const projectsA = [makeProject({ brandName: "Brand A" })];
    const projectsB = [makeProject({ brandName: "Brand B", projectNumber: "PRJ-002" })];

    const itemsA = buildWorkspaceNotificationsFromProjects(
      projectsA, [], [], new Set(), sessionA, {},
    );
    const itemsB = buildWorkspaceNotificationsFromProjects(
      projectsB, [], [], new Set(), sessionB, {},
    );

    for (const n of itemsA) expect(n.tenantId).toBe("tenant-a@example.com");
    for (const n of itemsB) expect(n.tenantId).toBe("tenant-b@example.com");

    // No cross-contamination — tenant sets are disjoint
    const aIds = new Set(itemsA.map((n) => n.tenantId));
    const bIds = new Set(itemsB.map((n) => n.tenantId));
    expect([...aIds]).not.toEqual(expect.arrayContaining([...bIds]));
  });

  it("4. Project without paymentStatus or reviewStatus still returns notifications", () => {
    const session = makeSession("user@example.com");
    const projects = [makeProject({ paymentStatus: null, reviewStatus: null })];

    const items = buildWorkspaceNotificationsFromProjects(
      projects, [], [], new Set(), session, {},
    );

    // Must at minimum have the project stage notification
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.type).toBeDefined();
      expect(item.tenantId).toBe("user@example.com");
    }
  });

  it("5. Retry / duplicate call does not duplicate notifications (stable keys)", () => {
    const session = makeSession("user@example.com");
    const projects = [makeProject()];

    const items1 = buildWorkspaceNotificationsFromProjects(
      projects, [], [], new Set(), session, {},
    );
    const items2 = buildWorkspaceNotificationsFromProjects(
      projects, [], [], new Set(), session, {},
    );

    // Same input → same output, same keys (pure function)
    const keys1 = items1.map((n) => n.key).sort();
    const keys2 = items2.map((n) => n.key).sort();
    expect(keys1).toEqual(keys2);
  });

  it("6. tenantId is never undefined (always string | null, never missing)", () => {
    const session = makeSession("check@example.com");
    const projects = [makeProject()];
    const invoices = [makeInvoice()];
    const downloads = [makeDownload()];

    const items = buildWorkspaceNotificationsFromProjects(
      projects, invoices, downloads, new Set(), session, {},
    );

    for (const item of items) {
      // `tenantId` key must EXIST — not absent/undefined
      expect("tenantId" in item).toBe(true);
      // Tenant-scoped notifications must equal the session email
      expect(item.tenantId).toBe("check@example.com");
    }
  });

  it("7. Notification types cover expected categories", () => {
    const session = makeSession("user@example.com");
    const projects = [makeProject()];                      // → project + payment + review
    const invoices = [makeInvoice()];                      // → invoice
    const downloads = [makeDownload({ locked: false })];   // → download

    const items = buildWorkspaceNotificationsFromProjects(
      projects, invoices, downloads, new Set(), session, {},
    );
    const types = new Set(items.map((n) => n.type));

    // Must include at least project, payment, review, invoice, and download types
    expect(types.has("project")).toBe(true);
    expect(types.has("payment")).toBe(true);
    expect(types.has("review")).toBe(true);
    expect(types.has("invoice")).toBe(true);
    expect(types.has("download")).toBe(true);
  });
});
