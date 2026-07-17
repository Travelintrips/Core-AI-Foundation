/**
 * graphic-design/tests/service.test.ts — Team 15
 *
 * Tests for the domain service functions.
 *
 * After remediation:
 *  - createBrief() takes no ports (pure state management).
 *  - approveBriefAndDispatch() takes a CanonicalJobAdapter (single path).
 *  - No 4-stub port injection; one mock adapter instead.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createBrief,
  listBriefs,
  getBrief,
  updateBriefStatus,
  approveBriefAndDispatch,
  runBriefQc,
  getBriefManifest,
  getBriefQcResult,
  listBriefJobs,
  _clearStoreForTest,
  type CanonicalJobAdapter,
} from "../service.js";
import type { GraphicDesignBrief } from "../schema.js";
import type { RenderedDeliverable } from "../qc.js";

// ── Canonical adapter mock ────────────────────────────────────────────────────

let mockProjectCounter = 0;

function makeMockAdapter(): CanonicalJobAdapter {
  return {
    createProject: vi.fn().mockImplementation(async () => ({
      projectId: `studio-proj-${++mockProjectCounter}`,
    })),
  };
}

// ── Brief fixtures ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const LOGO_BRIEF = {
  serviceCode:     "GD-LOGO",
  clientName:      "PT Test Klien",
  brandName:       "TestBrand",
  industry:        "Tech",
  targetAudience:  "Startup founders",
  stylePreference: "modern",
  colorPalette:    ["#003DA5"],
  urgencyLevel:    "standard",
  language:        "id",
  packageTier:     "standard",
  outputFormat:    "both",
  printQuantity:   0,
  referenceUrls:   [] as string[],
} as GraphicDesignBrief;

// GD-BCARD basic = 1 concept (used for "single concept" dispatch tests)
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const BCARD_BRIEF = {
  serviceCode:     "GD-BCARD",
  clientName:      "PT Test Klien",
  brandName:       "CardBrand",
  industry:        "Tech",
  targetAudience:  "Startup founders",
  stylePreference: "modern",
  colorPalette:    ["#003DA5"],
  urgencyLevel:    "standard",
  language:        "id",
  packageTier:     "basic",
  outputFormat:    "print",
  printQuantity:   0,
  referenceUrls:   [] as string[],
} as GraphicDesignBrief;

const DELIVERED: RenderedDeliverable = {
  variant:        "primary_1000",
  canvasWidthPx:  1000,
  canvasHeightPx: 1000,
  resolutionDpi:  96,
  colorMode:      "sRGB",
  elements:       [],
  fileFormats:    ["svg", "pdf", "png"],
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _clearStoreForTest();
  mockProjectCounter = 0;
  vi.clearAllMocks();
});

// ── createBrief ───────────────────────────────────────────────────────────────

describe("createBrief", () => {
  it("returns briefId, pending_review status, and manifest info", async () => {
    const result = await createBrief(LOGO_BRIEF);
    expect(result.briefId).toBeTruthy();
    expect(result.status).toBe("pending_review");
    expect(result.requiredFiles).toBeGreaterThan(0);
    expect(result.estimatedDays).toBeGreaterThan(0);
  });

  it("stores brief retrievable by getBrief", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    const record = getBrief(briefId);
    expect(record.brief.brandName).toBe("TestBrand");
    expect(record.serviceCode).toBe("GD-LOGO");
  });

  it("initialises with empty jobs array", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    expect(getBrief(briefId).jobs).toEqual([]);
  });

  it("assigns unique IDs to separate briefs", async () => {
    const a = await createBrief(LOGO_BRIEF);
    const b = await createBrief(BCARD_BRIEF);
    expect(a.briefId).not.toBe(b.briefId);
  });

  it("rush urgency reduces estimatedDays", async () => {
    const std  = await createBrief({ ...LOGO_BRIEF, urgencyLevel: "standard" });
    const rush = await createBrief({ ...LOGO_BRIEF, urgencyLevel: "rush" });
    expect(rush.estimatedDays).toBeLessThanOrEqual(std.estimatedDays);
  });
});

// ── listBriefs ────────────────────────────────────────────────────────────────

describe("listBriefs", () => {
  beforeEach(async () => {
    await createBrief(LOGO_BRIEF);
    await createBrief(BCARD_BRIEF);
  });

  it("returns all briefs without filter", () => {
    const { items, total } = listBriefs();
    expect(total).toBe(2);
    expect(items).toHaveLength(2);
  });

  it("filters by serviceCode", () => {
    const { items, total } = listBriefs({ serviceCode: "GD-LOGO" });
    expect(total).toBe(1);
    expect(items[0]?.serviceCode).toBe("GD-LOGO");
  });

  it("filters by status", () => {
    const { items } = listBriefs({ status: "pending_review" });
    expect(items.length).toBe(2);
  });

  it("respects page + pageSize", async () => {
    await createBrief({ ...LOGO_BRIEF, brandName: "Third" });
    const p1 = listBriefs({ page: 1, pageSize: 2 });
    const p2 = listBriefs({ page: 2, pageSize: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.total).toBe(3);
    expect(p2.items).toHaveLength(1);
  });

  it("exposes jobCount from jobs array", async () => {
    const { items } = listBriefs();
    for (const item of items) expect(item.jobCount).toBe(0);
  });
});

// ── getBrief ──────────────────────────────────────────────────────────────────

describe("getBrief", () => {
  it("throws 404 for unknown id", () => {
    expect(() => getBrief("not-a-real-id")).toThrow();
  });

  it("returns the full record", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    const record = getBrief(briefId);
    expect(record.id).toBe(briefId);
    expect(record.brief.clientName).toBe("PT Test Klien");
  });
});

// ── updateBriefStatus ─────────────────────────────────────────────────────────

describe("updateBriefStatus", () => {
  it("transitions status and returns prev/next", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    const result = await updateBriefStatus(briefId, "approved");
    expect(result.prevStatus).toBe("pending_review");
    expect(result.nextStatus).toBe("approved");
  });

  it("rejects update from terminal status completed", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    await updateBriefStatus(briefId, "completed");
    await expect(updateBriefStatus(briefId, "approved")).rejects.toThrow();
  });

  it("rejects update from terminal status cancelled", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    await updateBriefStatus(briefId, "cancelled");
    await expect(updateBriefStatus(briefId, "approved")).rejects.toThrow();
  });

  it("stores optional note", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    await updateBriefStatus(briefId, "revision_requested", "Needs bolder font");
    expect(getBrief(briefId).note).toBe("Needs bolder font");
  });
});

// ── approveBriefAndDispatch — canonical adapter ───────────────────────────────

describe("approveBriefAndDispatch", () => {
  it("calls the canonical adapter exactly once per concept variant (standard = 3)", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);  // standard = 3 variants
    const adapter = makeMockAdapter();

    const result = await approveBriefAndDispatch(briefId, adapter);

    expect(adapter.createProject).toHaveBeenCalledTimes(3);
    expect(result.conceptCount).toBe(3);
    expect(result.jobIds).toHaveLength(3);
  });

  it("basic tier (GD-BCARD) dispatches exactly 1 concept", async () => {
    // GD-BCARD basic = 1 concept (GD-LOGO basic overrides to 2)
    const { briefId } = await createBrief(BCARD_BRIEF);
    const adapter = makeMockAdapter();

    const result = await approveBriefAndDispatch(briefId, adapter);

    expect(adapter.createProject).toHaveBeenCalledTimes(1);
    expect(result.conceptCount).toBe(1);
  });

  it("premium tier dispatches exactly 5 concepts", async () => {
    const { briefId } = await createBrief({ ...LOGO_BRIEF, packageTier: "premium" });
    const adapter = makeMockAdapter();

    const result = await approveBriefAndDispatch(briefId, adapter);

    expect(adapter.createProject).toHaveBeenCalledTimes(5);
    expect(result.conceptCount).toBe(5);
  });

  it("passes canvas dimensions derived from blueprint to the adapter", async () => {
    const { briefId } = await createBrief({ ...LOGO_BRIEF, packageTier: "basic" });
    const adapter = makeMockAdapter();

    await approveBriefAndDispatch(briefId, adapter);

    const call = (adapter.createProject as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      canvasWidthPx: number;
      canvasHeightPx: number;
    };
    expect(call.canvasWidthPx).toBeGreaterThan(0);
    expect(call.canvasHeightPx).toBeGreaterThan(0);
  });

  it("includes briefId and serviceCode in project tags", async () => {
    const { briefId } = await createBrief({ ...LOGO_BRIEF, packageTier: "basic" });
    const adapter = makeMockAdapter();

    await approveBriefAndDispatch(briefId, adapter);

    const call = (adapter.createProject as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      tags: string[];
    };
    expect(call.tags).toContain("GD-LOGO");
    expect(call.tags.some((t: string) => t.startsWith("brief:"))).toBe(true);
  });

  it("advances status to in_production after dispatch", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    const adapter = makeMockAdapter();

    await approveBriefAndDispatch(briefId, adapter);

    expect(getBrief(briefId).status).toBe("in_production");
  });

  it("stores returned projectIds in brief.jobs", async () => {
    const { briefId } = await createBrief({ ...LOGO_BRIEF, packageTier: "basic" });
    const adapter = makeMockAdapter();

    const { jobIds } = await approveBriefAndDispatch(briefId, adapter);

    expect(getBrief(briefId).jobs).toEqual(jobIds);
  });

  it("rejects dispatch if brief is not pending_review or approved", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    await updateBriefStatus(briefId, "cancelled");

    await expect(approveBriefAndDispatch(briefId, makeMockAdapter())).rejects.toThrow();
  });

  it("does NOT call the adapter twice if called twice on the same brief", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    const adapter = makeMockAdapter();

    await approveBriefAndDispatch(briefId, adapter);
    // Brief is now in_production — second call must reject without calling adapter again
    try { await approveBriefAndDispatch(briefId, adapter); } catch { /* expected */ }

    // Only the first call's invocations (3 for standard)
    expect((adapter.createProject as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });
});

// ── runBriefQc ────────────────────────────────────────────────────────────────

describe("runBriefQc", () => {
  it("returns a qcScore and passed flag", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    const result = await runBriefQc(briefId, DELIVERED);
    expect(typeof result.qcScore).toBe("number");
    expect(result.qcScore).toBeGreaterThanOrEqual(0);
    expect(result.qcScore).toBeLessThanOrEqual(100);
    expect(typeof result.passed).toBe("boolean");
  });

  it("sets status to qc_check on pass, qc_failed on fail", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    const result = await runBriefQc(briefId, DELIVERED);
    const expected = result.passed ? "qc_check" : "qc_failed";
    expect(getBrief(briefId).status).toBe(expected);
  });

  it("sanitizes malicious fileFormats — ../../etc/passwd is dropped", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    const malicious: RenderedDeliverable = {
      ...DELIVERED,
      fileFormats: ["../../etc/passwd", "svg", ".env", "png"],
    };
    // Should not throw; malicious formats are silently dropped
    const result = await runBriefQc(briefId, malicious);
    expect(result).toBeDefined();
    // The stored qcResult should not contain the traversal string
    const stored = getBriefQcResult(briefId);
    expect(JSON.stringify(stored)).not.toContain("etc/passwd");
  });

  it("sanitizes malicious variant key", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    const result = await runBriefQc(briefId, {
      ...DELIVERED,
      variant: "../../dangerous-variant",
    });
    expect(result).toBeDefined();
  });
});

// ── getBriefManifest / getBriefQcResult ───────────────────────────────────────

describe("getBriefManifest", () => {
  it("returns a manifest with at least one file", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    const manifest = getBriefManifest(briefId);
    expect(manifest.files.length).toBeGreaterThan(0);
  });
});

describe("getBriefQcResult", () => {
  it("returns null before any QC run", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    expect(getBriefQcResult(briefId)).toBeNull();
  });

  it("returns result after QC run", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    await runBriefQc(briefId, DELIVERED);
    expect(getBriefQcResult(briefId)).not.toBeNull();
  });
});

// ── listBriefJobs (P2 pagination) ─────────────────────────────────────────────

describe("listBriefJobs", () => {
  it("returns empty jobs for a new brief", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    const result = listBriefJobs(briefId);
    expect(result.jobs).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("returns all jobs after dispatch", async () => {
    const { briefId } = await createBrief({ ...LOGO_BRIEF, packageTier: "premium" }); // 5 concepts
    await approveBriefAndDispatch(briefId, makeMockAdapter());

    const result = listBriefJobs(briefId);
    expect(result.total).toBe(5);
    expect(result.jobs).toHaveLength(5);
  });

  it("paginates jobs correctly", async () => {
    const { briefId } = await createBrief({ ...LOGO_BRIEF, packageTier: "premium" }); // 5 concepts
    await approveBriefAndDispatch(briefId, makeMockAdapter());

    const p1 = listBriefJobs(briefId, { page: 1, pageSize: 2 });
    const p2 = listBriefJobs(briefId, { page: 2, pageSize: 2 });
    const p3 = listBriefJobs(briefId, { page: 3, pageSize: 2 });

    expect(p1.jobs).toHaveLength(2);
    expect(p1.total).toBe(5);
    expect(p2.jobs).toHaveLength(2);
    expect(p3.jobs).toHaveLength(1);
  });

  it("pageSize is capped at 100", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF);
    const result = listBriefJobs(briefId, { pageSize: 9999 });
    expect(result.pageSize).toBe(100);
  });

  it("throws 404 for unknown brief", () => {
    expect(() => listBriefJobs("no-such-brief")).toThrow();
  });
});
