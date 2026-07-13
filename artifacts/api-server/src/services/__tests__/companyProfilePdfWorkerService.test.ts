/**
 * companyProfilePdfWorkerService.test.ts — Phase 2 Creative Document Engine
 *
 * Covers the pdf_export orchestration logic for Company Profile documents:
 *  1. Non-company-profile / unresolved document type → WorkerNotImplementedError
 *  2. Fresh generation → renders, uploads, creates a new asset, releases the project
 *  3. Idempotent retry → existing completed asset + storage object still present → reused, no re-render
 *  4. Recovery → existing completed asset but storage object missing → regenerates at the SAME version
 *  5. Upload verification failure → throws instead of completing
 *  6. markProjectDocumentFailed → flips a "generating_document" project to "failed", no-ops otherwise
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AiJob } from "@workspace/db";

// ── DB mock ───────────────────────────────────────────────────────────────────
// Each test seeds a per-table row queue. Every db.select().from(table)... call
// pops the next queued rows for the table it targets, in call order.

let projectRows: unknown[] = [];
let serviceRequestRows: unknown[] = [];
let serviceRows: unknown[] = [];
let existingAssetRows: unknown[] = [];
let imageAssetRows: unknown[] = [];

const insertedAssets: Array<Record<string, unknown>> = [];
const updatedAssets: Array<{ id: number; set: Record<string, unknown> }> = [];
const projectUpdates: Array<{ id: number; set: Record<string, unknown> }> = [];

function chain(result: unknown[]) {
  const c: Record<string, unknown> = {};
  const noop = () => c;
  c["from"] = noop;
  c["where"] = noop;
  c["orderBy"] = noop;
  c["limit"] = noop;
  c["then"] = (resolve: (v: unknown[]) => void) => Promise.resolve(resolve(result));
  return c;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn((cols?: Record<string, unknown>) => {
      // Distinguish targets by the projection columns used in each call site.
      if (cols && "serviceId" in cols) return chain(serviceRequestRows);
      if (cols && "serviceCode" in cols) return chain(serviceRows);
      return {
        from: (table: unknown) => {
          if (table === "__creativeAiAssetsTable__") {
            const rows = existingAssetRows.length || imageAssetRows.length ? undefined : [];
            void rows;
          }
          return chain(pendingSelectQueue.shift() ?? []);
        },
      };
    }),
    insert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => ({
        returning: vi.fn().mockImplementation(() => {
          insertedAssets.push(v);
          return Promise.resolve([{ id: 999 }]);
        }),
      }),
    })),
    update: vi.fn(() => ({
      set: (set: Record<string, unknown>) => ({
        where: vi.fn().mockImplementation(() => {
          updatedAssets.push({ id: 1, set });
          projectUpdates.push({ id: 1, set });
          return Promise.resolve([]);
        }),
      }),
    })),
  },
  creativeProjectsTable: { id: "id" },
  creativeAiAssetsTable: { id: "id", projectId: "projectId", assetType: "assetType", category: "category", version: "version", createdAt: "createdAt" },
  aiServiceRequestsTable: { id: "id", serviceId: "serviceId" },
  aiServicesTable: { id: "id", serviceCode: "serviceCode" },
}));

// Untyped select() above can't easily disambiguate plain `.from(table)` calls by
// table identity (tables are plain objects, not distinguishable strings), so we
// drive those calls off an explicit ordered queue instead.
let pendingSelectQueue: unknown[][] = [];

vi.mock("../aiAuditService.js", () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

vi.mock("../companyProfileDocumentMapper.js", async () => {
  const actual = await vi.importActual<typeof import("../companyProfileDocumentMapper.js")>(
    "../companyProfileDocumentMapper.js",
  );
  return {
    ...actual,
    generateCompanyProfileContent: vi.fn().mockResolvedValue({
      content: {
        about: "A test company.", vision: "Vision", mission: "Mission",
        coreValues: ["Quality", "Integrity"], servicesOrProducts: [{ name: "Widgets", description: "We make widgets." }],
        competitiveAdvantages: ["Fast", "Reliable"], industriesServed: ["Manufacturing"],
        operationalCapabilities: "We operate 24/7.", milestones: [], teamDescription: "",
        certifications: [], tagline: "Widgets done right", closing: "Thank you.",
        contactInfo: { email: "hi@test.co", phone: "", address: "", website: "" },
      },
      llmUsage: { provider: "test", model: "test", tokensUsed: 100, estimatedCostUsd: 0, latencyMs: 10 },
    }),
  };
});

vi.mock("../creativeDocumentService.js", async () => {
  const actual = await vi.importActual<typeof import("../creativeDocumentService.js")>(
    "../creativeDocumentService.js",
  );
  return {
    ...actual,
    renderDocument: vi.fn().mockResolvedValue({
      buffer: Buffer.from("%PDF-1.4 fake pdf content for testing purposes only, padded to be long enough."),
      pageCount: 4,
      renderDurationMs: 42,
    }),
    validateGeneratedPdf: vi.fn().mockReturnValue({ valid: true, pageCount: 4, fileSizeBytes: 100, mimeType: "application/pdf" }),
  };
});

const uploadToSupabase = vi.fn().mockResolvedValue("https://storage.test/creative-projects/test.pdf");
const storageObjectExists = vi.fn().mockResolvedValue(true);
vi.mock("../../lib/supabaseStorage.js", () => ({
  uploadToSupabase: (...args: unknown[]) => uploadToSupabase(...args),
  storageObjectExists: (...args: unknown[]) => storageObjectExists(...args),
  getSupabasePublicUrl: (path: string) => `https://storage.test/${path}`,
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const FAKE_PROJECT = {
  id: 42,
  projectId: "proj-uuid-1",
  sourceType: "service_catalog",
  serviceRequestId: 7,
  brandName: "Acme Logistics",
  businessType: "Logistics",
  targetMarket: "Enterprise shippers",
  productOrService: "Freight forwarding",
  goal: "Win institutional tenders",
  notes: null,
  colorPreference: null,
  stylePreference: null,
  status: "generating_document",
  result: { copy: { tagline: "We move the world" }, brandStrategy: { positioning: "Reliable logistics partner" } },
};

import { executeCompanyProfilePdfExportJob, markProjectDocumentFailed } from "../companyProfilePdfWorkerService.js";
import { WorkerNotImplementedError } from "../jobCompletionGuard.js";

function fakeJob(payloadJson: Record<string, unknown>): AiJob {
  return {
    id: 501, jobCode: "J-PDF-1", jobType: "pdf_export", payloadJson, resultJson: null,
    status: "running", priority: 60, priorityScore: "60", retryCount: 0, maxRetry: 3,
    retryStrategy: "exponential", errorMessage: null, estimatedCost: null, actualCost: null,
    estimatedDuration: null, actualDuration: null, scheduledAt: null, startedAt: new Date(),
    completedAt: null, nextRetryAt: null, requiredCapability: null, executionPlanId: null,
    departmentId: null, employeeId: null, managerOverride: null, createdAt: new Date(), updatedAt: new Date(),
  } as unknown as AiJob;
}

beforeEach(() => {
  serviceRequestRows = [{ serviceId: 3 }];
  serviceRows = [{ serviceCode: "company-profile" }];
  existingAssetRows = [];
  imageAssetRows = [];
  insertedAssets.length = 0;
  updatedAssets.length = 0;
  projectUpdates.length = 0;
  uploadToSupabase.mockClear();
  storageObjectExists.mockClear().mockResolvedValue(true);
  pendingSelectQueue = [[FAKE_PROJECT], [], []]; // project, existingAsset, images — overridden per test
});

describe("companyProfilePdfWorkerService", () => {
  it("throws WorkerNotImplementedError when the project has no resolvable document type", async () => {
    serviceRows = []; // serviceCode lookup fails → resolveProjectDocumentType returns null
    pendingSelectQueue = [[FAKE_PROJECT]];
    await expect(executeCompanyProfilePdfExportJob(fakeJob({ projectId: 42 }))).rejects.toThrow(
      WorkerNotImplementedError,
    );
  });

  it("throws when payload is missing a numeric projectId", async () => {
    await expect(executeCompanyProfilePdfExportJob(fakeJob({}))).rejects.toThrow(/projectId/);
  });

  it("generates a fresh PDF, uploads it, creates a new asset, and releases the project", async () => {
    pendingSelectQueue = [[FAKE_PROJECT], [], []]; // project, no existing asset, no images
    const result = await executeCompanyProfilePdfExportJob(fakeJob({ projectId: 42 }));

    expect(uploadToSupabase).toHaveBeenCalledTimes(1);
    expect(insertedAssets).toHaveLength(1);
    expect(insertedAssets[0]).toMatchObject({ assetType: "document", category: "company_profile", version: 1 });
    expect(result).toMatchObject({ storagePath: expect.stringContaining("company-profile-v1.pdf"), permanentUrl: expect.stringMatching(/^https?:\/\//), version: 1 });
    // Project was "generating_document" → must be released to "completed".
    expect(projectUpdates.some((u) => u.set.status === "completed")).toBe(true);
  });

  it("reuses an existing asset when the storage object is still present (idempotent retry)", async () => {
    const existing = { id: 55, version: 2, status: "completed", storagePath: "creative-projects/acme/proj-uuid-1/1/documents/company-profile-v2.pdf", imageUrl: "https://storage.test/existing.pdf" };
    pendingSelectQueue = [[FAKE_PROJECT], [existing]];
    const result = await executeCompanyProfilePdfExportJob(fakeJob({ projectId: 42 }));

    expect(uploadToSupabase).not.toHaveBeenCalled();
    expect(insertedAssets).toHaveLength(0);
    expect(result).toMatchObject({ reused: true, assetId: 55, version: 2, permanentUrl: existing.imageUrl });
  });

  it("regenerates at the same version when the existing asset's storage object is missing", async () => {
    storageObjectExists.mockResolvedValueOnce(false).mockResolvedValue(true); // first check (existing) = missing, post-upload check = true
    const existing = { id: 55, version: 2, status: "completed", storagePath: "creative-projects/acme/proj-uuid-1/1/documents/company-profile-v2.pdf", imageUrl: "https://storage.test/existing.pdf" };
    pendingSelectQueue = [[FAKE_PROJECT], [existing], []];
    const result = await executeCompanyProfilePdfExportJob(fakeJob({ projectId: 42 }));

    expect(uploadToSupabase).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ version: 2, storagePath: expect.stringContaining("company-profile-v2.pdf") });
    // Same version → update the existing row, not a new insert.
    expect(insertedAssets).toHaveLength(0);
    expect(updatedAssets.some((u) => u.set.status === "completed")).toBe(true);
  });

  it("throws if the uploaded object cannot be verified afterwards", async () => {
    storageObjectExists.mockResolvedValue(false);
    pendingSelectQueue = [[FAKE_PROJECT], [], []];
    await expect(executeCompanyProfilePdfExportJob(fakeJob({ projectId: 42 }))).rejects.toThrow(/upload verification failed/);
  });
});

describe("markProjectDocumentFailed", () => {
  it("flips a generating_document project to failed", async () => {
    pendingSelectQueue = [[FAKE_PROJECT]];
    await markProjectDocumentFailed(42, "exhausted retries");
    expect(projectUpdates.some((u) => u.set.status === "failed")).toBe(true);
  });

  it("does nothing for a project not waiting on a document", async () => {
    pendingSelectQueue = [[{ ...FAKE_PROJECT, status: "completed" }]];
    await markProjectDocumentFailed(42, "exhausted retries");
    expect(projectUpdates).toHaveLength(0);
  });
});
