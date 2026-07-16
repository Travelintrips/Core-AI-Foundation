/**
 * graphic-design/tests/service.test.ts — Team 15
 *
 * Tests for the domain service functions.
 * Uses mock ports so no real Team 7-14 services are called.
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
} from "../service.js";
import type { GraphicDesignPorts } from "../ports.js";
import type { GraphicDesignBrief } from "../schema.js";
import type { RenderedDeliverable } from "../qc.js";

// ── Mock ports ────────────────────────────────────────────────────────────────

function makeMockPorts(): GraphicDesignPorts {
  return {
    renderer: {
      render: vi.fn().mockResolvedValue({
        success: true,
        deliverable: {
          variant:        "primary_1000",
          canvasWidthPx:  1000,
          canvasHeightPx: 1000,
          resolutionDpi:  96,
          colorMode:      "sRGB",
          elements:       [],
          fileFormats:    ["svg", "pdf", "png"],
        },
        fileUrls:  {},
        durationMs: 10,
      }),
    },
    matcher: {
      matchTemplate: vi.fn().mockResolvedValue({
        matches: [
          {
            templateId:  "t1",
            templateCode: "GD-LOGO-DEFAULT",
            score:        0.8,
            canvasState:  { width: 1000, height: 1000, background: "#003DA5", elements: [] },
          },
        ],
        usedFallback: false,
      }),
    },
    assets: {
      searchAssets: vi.fn().mockResolvedValue([]),
      getAsset:     vi.fn().mockResolvedValue(null),
    },
    workflow: {
      dispatch: vi.fn().mockResolvedValue({ jobId: "gd-test-job-1", status: "queued" }),
      getStatus: vi.fn().mockResolvedValue({ jobId: "gd-test-job-1", status: "queued", progressPct: 0 }),
      cancel:    vi.fn().mockResolvedValue(undefined),
    },
  };
}

// ── Shared brief fixtures ─────────────────────────────────────────────────────

const LOGO_BRIEF: GraphicDesignBrief = {
  serviceCode:      "GD-LOGO",
  clientName:       "PT Test Klien",
  brandName:        "TestBrand",
  industry:         "Tech",
  targetAudience:   "Startup founders",
  stylePreference:  "modern",
  colorPalette:     ["#003DA5"],
  urgencyLevel:     "standard",
  language:         "id",
  packageTier:      "standard",
  outputFormat:     "both",
  printQuantity:    0,
  referenceUrls:    [],
  logoType:         "combination",
  conceptVariants:  3,
  deliveryFormats:  ["svg", "pdf", "png"],
  includesDarkVariant: true,
  includesMonochrome:  true,
  includesFavicon:     false,
};

const SOCIAL_BRIEF: GraphicDesignBrief = {
  serviceCode:     "GD-SOCIAL",
  clientName:      "Social Co",
  brandName:       "SocialBrand",
  industry:        "E-Commerce",
  targetAudience:  "Instagram users 18-35",
  stylePreference: "bold",
  colorPalette:    ["#FF5733"],
  urgencyLevel:    "standard",
  language:        "id",
  packageTier:     "basic",
  outputFormat:    "digital",
  printQuantity:   0,
  referenceUrls:   [],
  platforms:       ["instagram", "facebook"],
  contentTypes:    ["post_square", "story"],
  variantsPerType: 2,
  includesTemplate: true,
  includesAnimated: false,
  contentTheme:    "promotion",
  hashtagsIncluded:    false,
  copywritingIncluded: false,
};

// ── createBrief ───────────────────────────────────────────────────────────────

describe("createBrief", () => {
  let ports: GraphicDesignPorts;
  beforeEach(() => { ports = makeMockPorts(); });

  it("creates a brief and returns a briefId", async () => {
    const result = await createBrief(LOGO_BRIEF, ports);
    expect(result.briefId).toBeTruthy();
    expect(result.status).toBe("pending_review");
    expect(result.requiredFiles).toBeGreaterThan(0);
    expect(result.estimatedDays).toBeGreaterThan(0);
  });

  it("creates briefs for different services", async () => {
    const r1 = await createBrief(LOGO_BRIEF, ports);
    const r2 = await createBrief(SOCIAL_BRIEF, ports);
    expect(r1.briefId).not.toBe(r2.briefId);
  });

  it("sets status to pending_review", async () => {
    const result = await createBrief(LOGO_BRIEF, ports);
    const record = getBrief(result.briefId);
    expect(record.status).toBe("pending_review");
  });

  it("rush brief has shorter estimated delivery", async () => {
    const rushBrief = { ...LOGO_BRIEF, urgencyLevel: "rush" as const };
    const stdBrief  = { ...LOGO_BRIEF, urgencyLevel: "standard" as const };
    const rushResult = await createBrief(rushBrief, ports);
    const stdResult  = await createBrief(stdBrief, ports);
    expect(rushResult.estimatedDays).toBeLessThanOrEqual(stdResult.estimatedDays);
  });

  it("stores the manifest with correct service code", async () => {
    const result   = await createBrief(LOGO_BRIEF, ports);
    const manifest = getBriefManifest(result.briefId);
    expect(manifest.serviceCode).toBe("GD-LOGO");
    expect(manifest.packageTier).toBe("standard");
  });
});

// ── listBriefs ────────────────────────────────────────────────────────────────

describe("listBriefs", () => {
  let ports: GraphicDesignPorts;
  beforeEach(() => { ports = makeMockPorts(); });

  it("returns paginated results", async () => {
    await createBrief(LOGO_BRIEF, ports);
    await createBrief(SOCIAL_BRIEF, ports);
    const result = listBriefs({ pageSize: 10 });
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.items.length).toBeGreaterThanOrEqual(2);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
  });

  it("filters by serviceCode", async () => {
    await createBrief(LOGO_BRIEF, ports);
    await createBrief(SOCIAL_BRIEF, ports);
    const logos = listBriefs({ serviceCode: "GD-LOGO" });
    expect(logos.items.every((i) => i.serviceCode === "GD-LOGO")).toBe(true);
  });

  it("filters by status", async () => {
    await createBrief(LOGO_BRIEF, ports);
    const pending = listBriefs({ status: "pending_review" });
    expect(pending.items.every((i) => i.status === "pending_review")).toBe(true);
  });
});

// ── getBrief ──────────────────────────────────────────────────────────────────

describe("getBrief", () => {
  let ports: GraphicDesignPorts;
  beforeEach(() => { ports = makeMockPorts(); });

  it("returns the full brief record", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF, ports);
    const record = getBrief(briefId);
    expect(record.id).toBe(briefId);
    expect(record.brief.serviceCode).toBe("GD-LOGO");
    expect(record.brief.brandName).toBe("TestBrand");
  });

  it("throws 404 for unknown id", () => {
    expect(() => getBrief("no-such-id")).toThrow();
    try {
      getBrief("no-such-id");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(404);
    }
  });
});

// ── updateBriefStatus ─────────────────────────────────────────────────────────

describe("updateBriefStatus", () => {
  let ports: GraphicDesignPorts;
  beforeEach(() => { ports = makeMockPorts(); });

  it("advances status and returns prev/next", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF, ports);
    const result = await updateBriefStatus(briefId, "approved", "Looks good");
    expect(result.prevStatus).toBe("pending_review");
    expect(result.nextStatus).toBe("approved");
    expect(getBrief(briefId).status).toBe("approved");
  });

  it("rejects update from terminal status 'completed'", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF, ports);
    await updateBriefStatus(briefId, "completed");
    await expect(updateBriefStatus(briefId, "approved")).rejects.toMatchObject({ status: 409 });
  });

  it("rejects update from terminal status 'cancelled'", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF, ports);
    await updateBriefStatus(briefId, "cancelled");
    await expect(updateBriefStatus(briefId, "approved")).rejects.toMatchObject({ status: 409 });
  });
});

// ── approveBriefAndDispatch ───────────────────────────────────────────────────

describe("approveBriefAndDispatch", () => {
  let ports: GraphicDesignPorts;
  beforeEach(() => { ports = makeMockPorts(); });

  it("dispatches conceptVariants jobs and changes status to in_production", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF, ports);  // standard = 3 concepts
    const result = await approveBriefAndDispatch(briefId, ports);
    expect(result.jobIds).toHaveLength(3);
    expect(result.conceptCount).toBe(3);
    expect(getBrief(briefId).status).toBe("in_production");
  });

  it("calls ports.matcher.matchTemplate once", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF, ports);
    await approveBriefAndDispatch(briefId, ports);
    expect(ports.matcher.matchTemplate).toHaveBeenCalledOnce();
  });

  it("calls ports.workflow.dispatch for each concept", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF, ports);
    await approveBriefAndDispatch(briefId, ports);
    expect(ports.workflow.dispatch).toHaveBeenCalledTimes(3);
  });

  it("throws 409 if brief is already in terminal status", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF, ports);
    await updateBriefStatus(briefId, "cancelled");
    await expect(approveBriefAndDispatch(briefId, ports)).rejects.toMatchObject({ status: 409 });
  });
});

// ── runBriefQc ────────────────────────────────────────────────────────────────

describe("runBriefQc", () => {
  let ports: GraphicDesignPorts;
  beforeEach(() => { ports = makeMockPorts(); });

  it("stores QC result and updates status to qc_check or qc_failed", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF, ports);
    const deliverable: RenderedDeliverable = {
      variant:        "primary_1000",
      canvasWidthPx:  1000,
      canvasHeightPx: 1000,
      resolutionDpi:  96,
      colorMode:      "sRGB",
      elements:       [],
      fileFormats:    ["svg", "pdf", "png"],
    };
    const result = await runBriefQc(briefId, deliverable);
    expect(result.briefId).toBe(briefId);
    expect(result.qcScore).toBeGreaterThanOrEqual(0);
    expect(result.qcScore).toBeLessThanOrEqual(100);
    expect(["qc_check", "qc_failed"]).toContain(result.newStatus);
  });

  it("getBriefQcResult returns the stored result", async () => {
    const { briefId } = await createBrief(LOGO_BRIEF, ports);
    expect(getBriefQcResult(briefId)).toBeNull();

    await runBriefQc(briefId, {
      variant: "primary_1000", canvasWidthPx: 1000, canvasHeightPx: 1000,
      resolutionDpi: 96, colorMode: "sRGB", elements: [], fileFormats: ["png"],
    });
    expect(getBriefQcResult(briefId)).not.toBeNull();
  });
});
