/**
 * creativeDocumentWorkerService.test.ts — Phase 3 Creative Document Engine
 *
 * Tests the generic PDF export worker + all four new document type mappers.
 *
 * Sections:
 *   A. Registry — all supported types resolve; unsupported → WorkerNotImplementedError
 *   B. Generic worker — fresh generate, idempotency, storage recovery, upload failure
 *   C. Brand Strategy mapper — normalise + spec structure, no fabrication
 *   D. Copywriting mapper — copy variants, empty filtered, fallback
 *   E. Creative Consultation mapper — findings, recommendations, no raw JSON
 *   F. Brand Identity mapper — logo embed, missing logo blocked, mockup optional
 *   G. markProjectDocumentFailed — status flip
 *   H. Smoke tests — real PDFKit render for each new type
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AiJob } from "@workspace/db";

// ── Global fetch mock (image download in downloadProjectImages) ───────────────

const FAKE_LOGO_PNG = Buffer.from(
  // Valid 1×1 red pixel PNG (base64 decoded)
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==",
  "base64",
);

vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
  ok: true,
  arrayBuffer: () => Promise.resolve(FAKE_LOGO_PNG.buffer),
}));

// ── DB mock ───────────────────────────────────────────────────────────────────

let pendingSelectQueue: unknown[][] = [];

function chain(result: unknown[]) {
  const c: Record<string, unknown> = {};
  const noop = () => c;
  c["from"]    = noop;
  c["where"]   = noop;
  c["orderBy"] = noop;
  c["limit"]   = noop;
  c["then"]    = (resolve: (v: unknown[]) => void) => Promise.resolve(resolve(result));
  return c;
}

const insertedAssets: Array<Record<string, unknown>> = [];
const updatedAssets:  Array<{ id: number; set: Record<string, unknown> }> = [];
const projectUpdates: Array<{ id: number; set: Record<string, unknown> }> = [];

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => chain(pendingSelectQueue.shift() ?? []),
    })),
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
  creativeProjectsTable:  { id: "id" },
  creativeAiAssetsTable:  { id: "id", projectId: "projectId", assetType: "assetType",
                            category: "category", version: "version", createdAt: "createdAt", status: "status" },
  aiServiceRequestsTable: { id: "id", serviceId: "serviceId" },
  aiServicesTable:        { id: "id", serviceCode: "serviceCode" },
}));

vi.mock("../aiAuditService.js",    () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/logger.js",     () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../creativeDocumentService.js", async () => {
  const actual = await vi.importActual<typeof import("../creativeDocumentService.js")>(
    "../creativeDocumentService.js",
  );
  return {
    ...actual,
    renderDocument: vi.fn().mockResolvedValue({
      buffer: Buffer.from("%PDF-1.4 mock pdf padded for test — ".repeat(10)),
      pageCount: 7,
      renderDurationMs: 15,
    }),
    validateGeneratedPdf: vi.fn().mockReturnValue({
      valid: true, pageCount: 7, fileSizeBytes: 420, mimeType: "application/pdf",
    }),
  };
});

const uploadToSupabase    = vi.fn().mockResolvedValue("https://storage.test/creative-projects/test.pdf");
const storageObjectExists = vi.fn().mockResolvedValue(true);
vi.mock("../../lib/supabaseStorage.js", () => ({
  uploadToSupabase:      (...args: unknown[]) => uploadToSupabase(...args),
  storageObjectExists:   (...args: unknown[]) => storageObjectExists(...args),
  getSupabasePublicUrl:  (path: string) => `https://storage.test/${path}`,
}));

// Company Profile adapter is the only mapper that makes LLM calls; mock it.
vi.mock("../mappers/companyProfileMapperAdapter.js", () => ({
  companyProfileDefinition: {
    documentType: "company_profile", filenamePrefix: "company-profile",
    minimumPageCount: 3, requiresLogo: false, maxInlineImages: 2,
    generateContent: vi.fn().mockResolvedValue({ content: { about: "A company." } }),
    buildSpec: vi.fn().mockReturnValue({
      spec: { documentType: "company_profile", title: "Test Co — Company Profile", sections: [] },
      report: {},
    }),
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  executeGenericPdfExportJob,
  markProjectDocumentFailed,
  getSupportedDocumentTypes,
  getDocumentDefinition,
  DocumentWorkerError,
  REQUIRED_LOGO_ASSET_MISSING,
} from "../creativeDocumentWorkerService.js";
import { initDocumentRegistry } from "../creativeDocumentRegistry.js";
import { WorkerNotImplementedError } from "../jobCompletionGuard.js";

// ── Test project fixture ──────────────────────────────────────────────────────

const FAKE_PROJECT = {
  id: 42,
  projectId: "proj-uuid-brand",
  sourceType: "service_catalog",
  serviceRequestId: 7,
  brandName: "TestCo",
  businessType: "B2B SaaS",
  targetMarket: "Enterprise CTOs at 500+ companies",
  productOrService: "Real-time analytics platform",
  goal: "Increase brand awareness and drive enterprise trials",
  notes: null,
  colorPreference: null,
  stylePreference: "Professional, modern",
  status: "generating_document",
  result: {
    brandStrategy: {
      brand_values: ["Innovation", "Trust", "Clarity"],
      positioning: "The fastest analytics platform for B2B enterprises",
      competitive_advantage: "10× faster time-to-insight vs. legacy tools",
      brand_personality: ["Bold", "Smart", "Trustworthy"],
      tone_of_voice: "Professional, direct, and empowering",
      key_messages: ["Real-time insights", "Zero-setup deployment", "Enterprise-grade security"],
      target_audience: {
        primary: "CTOs and data leaders at 500+ person companies",
        psychographics: ["data-driven", "ROI-focused"],
        pain_points: ["Slow dashboards", "Complex setup", "Unreliable data"],
      },
    },
    creativeDirection: {
      creative_concept: {
        name: "Clarity Engine",
        description: "Visual metaphor of cutting through data noise",
        rationale: "B2B buyers need clarity and speed, not decoration",
      },
      color_direction: {
        primary: "#1a365d",
        secondary: "#2d3748",
        accent: "#c05621",
        rationale: "Navy signals trust; amber accent signals urgency and insight",
      },
      typography: {
        headline_style: "Bold serif — conveys authority",
        body_style: "Clean humanist sans-serif — legibility at small sizes",
        hierarchy: "H1 → H2 → body at 1.5rem / 1.25rem / 1rem",
      },
      imagery_direction: "Abstract data visualisation — light backgrounds, minimal noise",
      campaign_concept: "Data clarity drives business impact. See it. Act on it.",
      visual_style: {
        approach: "typographic",
        mood: "Confident and clean",
        references: ["Linear.app", "Stripe brand"],
      },
    },
    copy: {
      tagline: "Clarity. Speed. Trust.",
      headline: {
        primary: "Analytics that actually work",
        alternatives: ["See your data, own your future", "Insights in seconds, not hours"],
      },
      body_copy: {
        short: "TestCo gives data teams the speed and clarity they need to make decisions fast.",
        long: "TestCo is the enterprise analytics platform that turns raw data into decisions. With zero-setup deployment and real-time dashboards, your team stops waiting and starts acting. Join 500+ enterprises who chose clarity over complexity.",
      },
      cta: { primary: "Start free trial", secondary: "Book a demo" },
      social_captions: [
        { platform: "LinkedIn", caption: "B2B analytics has never been clearer. See TestCo in action. #Analytics #B2BSaaS" },
        { platform: "Twitter",  caption: "Data clarity in seconds. TestCo just works. #DataDriven" },
      ],
      email_subject_lines: [
        "See your data in real time",
        "Stop waiting for reports",
        "Analytics that don't need a PhD",
      ],
      tone_notes: "Professional, direct — no jargon. Empower the reader.",
    },
    qcReview: {
      overall_score: 87,
      brand_consistency: "Strong",
      messaging_clarity: "Clear and compelling",
      target_audience_alignment: "Excellent fit",
      creativity_score: 82,
      strategic_alignment: 91,
      strengths: ["Strong strategic positioning", "Clear, benefit-driven messaging", "Consistent brand voice"],
      recommendations: ["Add more social proof", "Test alternative taglines"],
      critical_issues: [],
      approved: true,
      approval_notes: "All outputs meet brief requirements. Ready for deployment.",
    },
  },
};

function fakeJob(payloadJson: Record<string, unknown>): AiJob {
  return {
    id: 888, jobCode: "J-PDF-3", jobType: "pdf_export", payloadJson, resultJson: null,
    status: "running", priority: 60, priorityScore: "60", retryCount: 0, maxRetry: 3,
    retryStrategy: "exponential", errorMessage: null, estimatedCost: null, actualCost: null,
    estimatedDuration: null, actualDuration: null, scheduledAt: null, startedAt: new Date(),
    completedAt: null, nextRetryAt: null, requiredCapability: null, executionPlanId: null,
    departmentId: null, employeeId: null, managerOverride: null, createdAt: new Date(), updatedAt: new Date(),
  } as unknown as AiJob;
}

beforeEach(() => {
  insertedAssets.length = 0;
  updatedAssets.length  = 0;
  projectUpdates.length = 0;
  uploadToSupabase.mockClear().mockResolvedValue("https://storage.test/creative-projects/test.pdf");
  storageObjectExists.mockClear().mockResolvedValue(true);
  // Default queue: project found, no existing asset, no images
  pendingSelectQueue = [[FAKE_PROJECT], [], []];
  initDocumentRegistry();
});

// ── A. Registry ───────────────────────────────────────────────────────────────

describe("A. Document registry", () => {
  it("registers all supported document types", () => {
    const types = getSupportedDocumentTypes();
    // Core creative document types
    expect(types).toContain("company_profile");
    expect(types).toContain("brand_strategy");
    expect(types).toContain("copywriting");
    expect(types).toContain("creative_consultation");
    expect(types).toContain("brand_identity_guideline");
    expect(types).toContain("fashion_design");
    expect(types).toContain("interior_design");
    // Extended document types (added in presentation-document domain)
    expect(types).toContain("ebook");
    // Total registered types — update this when a new type is added to creativeDocumentRegistry.ts
    expect(types).toHaveLength(8);
  });

  it("returns a definition for every registered type with correct contract shape", () => {
    for (const type of getSupportedDocumentTypes()) {
      const def = getDocumentDefinition(type);
      expect(def, `${type} should be registered`).toBeDefined();
      expect(def!.documentType).toBe(type);
      expect(typeof def!.filenamePrefix).toBe("string");
      expect(def!.minimumPageCount).toBeGreaterThan(0);
      expect(typeof def!.generateContent).toBe("function");
      expect(typeof def!.buildSpec).toBe("function");
    }
  });

  it("brand_identity_guideline requires a logo (requiresLogo: true)", () => {
    const def = getDocumentDefinition("brand_identity_guideline");
    expect(def!.requiresLogo).toBe(true);
  });

  it("company_profile, brand_strategy, copywriting, creative_consultation do not require a logo", () => {
    for (const type of ["company_profile", "brand_strategy", "copywriting", "creative_consultation"] as const) {
      expect(getDocumentDefinition(type)!.requiresLogo).toBe(false);
    }
  });

  it("returns undefined for an unregistered type", () => {
    // @ts-expect-error intentionally invalid
    expect(getDocumentDefinition("pitch_deck")).toBeUndefined();
  });

  it("throws WorkerNotImplementedError for an unsupported document type", async () => {
    pendingSelectQueue = [[FAKE_PROJECT]];
    await expect(
      // @ts-expect-error intentionally invalid
      executeGenericPdfExportJob(fakeJob({ projectId: 42 }), "pitch_deck"),
    ).rejects.toThrow(WorkerNotImplementedError);
  });
});

// ── B. Generic worker ─────────────────────────────────────────────────────────

describe("B. Generic worker", () => {
  it("generates a fresh PDF, uploads, creates an asset, and releases the project", async () => {
    const result = await executeGenericPdfExportJob(fakeJob({ projectId: 42 }), "brand_strategy");

    expect(uploadToSupabase).toHaveBeenCalledTimes(1);
    expect(insertedAssets).toHaveLength(1);
    expect(insertedAssets[0]).toMatchObject({
      assetType: "document",
      category:  "brand_strategy",
      version:   1,
      status:    "completed",
    });
    expect(result).toMatchObject({
      storagePath:      expect.stringContaining("brand-strategy-v1.pdf"),
      permanentUrl:     expect.stringMatching(/^https?:\/\//),
      version:          1,
      documentType:     "brand_strategy",
      finalDeliverable: true,
    });
    expect(projectUpdates.some((u) => u.set.status === "completed")).toBe(true);
  });

  it("reuses an existing completed asset when storage object is still present", async () => {
    const existing = {
      id: 77, version: 2, status: "completed",
      storagePath: "creative-projects/testco/proj-uuid-brand/1/documents/brand-strategy-v2.pdf",
      imageUrl: "https://storage.test/existing-brand-strategy.pdf",
      metadata: { pageCount: 8, fileSizeBytes: 50000, checksum: "abc123" },
    };
    pendingSelectQueue = [[FAKE_PROJECT], [existing]];
    const result = await executeGenericPdfExportJob(fakeJob({ projectId: 42 }), "brand_strategy");

    expect(uploadToSupabase).not.toHaveBeenCalled();
    expect(insertedAssets).toHaveLength(0);
    expect(result).toMatchObject({
      reused:      true,
      assetId:     77,
      version:     2,
      permanentUrl: existing.imageUrl,
    });
  });

  it("regenerates at the same version when storage object is missing (recovery)", async () => {
    storageObjectExists
      .mockResolvedValueOnce(false) // existing asset check → missing
      .mockResolvedValue(true);     // post-upload verify → ok
    const existing = {
      id: 77, version: 3, status: "completed",
      storagePath: "creative-projects/testco/.../brand-strategy-v3.pdf",
      imageUrl: "https://storage.test/old.pdf", metadata: {},
    };
    pendingSelectQueue = [[FAKE_PROJECT], [existing], []];
    const result = await executeGenericPdfExportJob(fakeJob({ projectId: 42 }), "brand_strategy");

    expect(uploadToSupabase).toHaveBeenCalledTimes(1);
    // Updates the existing row, no duplicate insert
    expect(insertedAssets).toHaveLength(0);
    expect(updatedAssets.some((u) => u.set.status === "completed")).toBe(true);
    expect(result).toMatchObject({ version: 3 });
  });

  it("throws DocumentWorkerError(DOCUMENT_UPLOAD_FAILED) when upload verification fails", async () => {
    storageObjectExists.mockResolvedValue(false); // post-upload verify fails
    await expect(
      executeGenericPdfExportJob(fakeJob({ projectId: 42 }), "brand_strategy"),
    ).rejects.toMatchObject({ code: "DOCUMENT_UPLOAD_FAILED" });
  });

  it("continues at same version when prior attempt left an incomplete asset (no duplicate)", async () => {
    const incomplete = { id: 55, version: 1, status: "generating", storagePath: null, imageUrl: null, metadata: {} };
    pendingSelectQueue = [[FAKE_PROJECT], [incomplete], []];
    await executeGenericPdfExportJob(fakeJob({ projectId: 42 }), "brand_strategy");

    expect(insertedAssets).toHaveLength(0); // updates existing row, does not insert a new one
    expect(updatedAssets.some((u) => u.set.status === "completed")).toBe(true);
  });

  it("records correct documentType in the asset category column", async () => {
    await executeGenericPdfExportJob(fakeJob({ projectId: 42 }), "copywriting");
    expect(insertedAssets[0]).toMatchObject({ category: "copywriting" });
  });

  it("throws when payload is missing a numeric projectId", async () => {
    await expect(
      executeGenericPdfExportJob(fakeJob({}), "brand_strategy"),
    ).rejects.toThrow(/projectId/);
  });

  it("throws WorkerNotImplementedError when project is not found in DB", async () => {
    pendingSelectQueue = [[]]; // empty → project not found
    await expect(
      executeGenericPdfExportJob(fakeJob({ projectId: 99999 }), "brand_strategy"),
    ).rejects.toThrow(/not found/);
  });
});

// ── C. Brand Strategy mapper ──────────────────────────────────────────────────

describe("C. Brand Strategy mapper — normalizeBrandStrategyContent", () => {
  it("extracts positioning, brand values, and personality from workflow output", async () => {
    const { normalizeBrandStrategyContent } = await import("../mappers/brandStrategyDocumentMapper.js");
    const { content } = normalizeBrandStrategyContent(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject);
    expect(content.positioning).toBe("The fastest analytics platform for B2B enterprises");
    expect(content.brandValues).toContain("Innovation");
    expect(content.brandPersonality).toContain("Bold");
    expect(content.toneOfVoice).toBeTruthy();
    expect(content.keyMessages.length).toBeGreaterThan(0);
  });

  it("extracts color direction and typography from creative direction output", async () => {
    const { normalizeBrandStrategyContent } = await import("../mappers/brandStrategyDocumentMapper.js");
    const { content } = normalizeBrandStrategyContent(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject);
    expect(content.colorPrimary).toBe("#1a365d");
    expect(content.colorRationale).toBeTruthy();
    expect(content.typographyHeadline).toBeTruthy();
    expect(content.imageryDirection).toBeTruthy();
  });

  it("extracts tagline, headline, and body copy from copy output", async () => {
    const { normalizeBrandStrategyContent } = await import("../mappers/brandStrategyDocumentMapper.js");
    const { content } = normalizeBrandStrategyContent(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject);
    expect(content.tagline).toBe("Clarity. Speed. Trust.");
    expect(content.primaryHeadline).toBe("Analytics that actually work");
    expect(content.bodyLong).toBeTruthy();
  });

  it("skips sections with no content — no fabricated facts, no Lorem ipsum", async () => {
    const { buildBrandStrategySpec, normalizeBrandStrategyContent } = await import("../mappers/brandStrategyDocumentMapper.js");
    const emptyProject = {
      ...FAKE_PROJECT,
      result: {},
    } as unknown as import("@workspace/db").CreativeProject;
    const { content } = normalizeBrandStrategyContent(emptyProject);
    const { spec, report } = buildBrandStrategySpec(emptyProject, content, null, []);

    expect(spec.sections.length).toBeGreaterThan(0); // business context always present
    const allText = spec.sections
      .filter((s) => s.type === "paragraph")
      .map((s) => (s as { text: string }).text)
      .join(" ");
    expect(allText).not.toMatch(/Lorem ipsum/i);
    expect((report as { sectionsSkipped?: unknown[] }).sectionsSkipped).toBeDefined();
  });

  it("includes pain-points section when target_audience has pain_points", async () => {
    const { buildBrandStrategySpec, normalizeBrandStrategyContent } = await import("../mappers/brandStrategyDocumentMapper.js");
    const { content } = normalizeBrandStrategyContent(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject);
    const { spec } = buildBrandStrategySpec(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject, content, null, []);
    const headings = spec.sections.filter((s) => s.type === "heading").map((s) => (s as { title: string }).title);
    expect(headings).toContain("Audience Needs & Pain Points");
  });
});

// ── D. Copywriting mapper ─────────────────────────────────────────────────────

describe("D. Copywriting mapper — normalizeCopywritingContent", () => {
  it("extracts tagline, headlines, CTAs, and social captions", async () => {
    const { normalizeCopywritingContent } = await import("../mappers/copywritingDocumentMapper.js");
    const { content } = normalizeCopywritingContent(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject);
    expect(content.tagline).toBe("Clarity. Speed. Trust.");
    expect(content.primaryHeadline).toBe("Analytics that actually work");
    expect(content.alternativeHeadlines).toContain("See your data, own your future");
    expect(content.primaryCta).toBe("Start free trial");
    expect(content.socialCaptions).toHaveLength(2);
    expect(content.socialCaptions[0]?.platform).toBe("LinkedIn");
  });

  it("filters out empty social caption entries", async () => {
    const { normalizeCopywritingContent } = await import("../mappers/copywritingDocumentMapper.js");
    const project = {
      ...FAKE_PROJECT,
      result: {
        copy: {
          social_captions: [
            { platform: "", caption: "" },
            { platform: "Twitter", caption: "real caption" },
          ],
        },
      },
    } as unknown as import("@workspace/db").CreativeProject;
    const { content } = normalizeCopywritingContent(project);
    expect(content.socialCaptions).toHaveLength(1);
    expect(content.socialCaptions[0]?.platform).toBe("Twitter");
  });

  it("falls back to bodyShort when bodyLong is absent", async () => {
    const { normalizeCopywritingContent } = await import("../mappers/copywritingDocumentMapper.js");
    const project = {
      ...FAKE_PROJECT,
      result: { copy: { body_copy: { short: "Short only." } } },
    } as unknown as import("@workspace/db").CreativeProject;
    const { content } = normalizeCopywritingContent(project);
    expect(content.bodyShort).toBe("Short only.");
    expect(content.bodyLong).toBe("");
  });

  it("buildCopywritingSpec produces no raw JSON blobs in paragraph sections", async () => {
    const { buildCopywritingSpec, normalizeCopywritingContent } = await import("../mappers/copywritingDocumentMapper.js");
    const { content } = normalizeCopywritingContent(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject);
    const { spec } = buildCopywritingSpec(
      FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject,
      content, null, [],
    );
    const allText = spec.sections.filter((s) => s.type === "paragraph")
      .map((s) => (s as { text: string }).text).join(" ");
    expect(allText).not.toMatch(/\{.*\}/s);
    expect(spec.documentType).toBe("copywriting");
  });
});

// ── E. Creative Consultation mapper ──────────────────────────────────────────

describe("E. Creative Consultation mapper — normalizeConsultationContent", () => {
  it("extracts QC score, strengths, recommendations, and approval notes", async () => {
    const { normalizeConsultationContent } = await import("../mappers/creativeConsultationDocumentMapper.js");
    const { content } = normalizeConsultationContent(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject);
    expect(content.overallScore).toBe(87);
    expect(content.approved).toBe(true);
    expect(content.strengths).toContain("Strong strategic positioning");
    expect(content.recommendations).toContain("Add more social proof");
    expect(content.approvalNotes).toBe("All outputs meet brief requirements. Ready for deployment.");
  });

  it("spec has no raw JSON blobs in paragraph sections", async () => {
    const { buildCreativeConsultationSpec, normalizeConsultationContent } = await import("../mappers/creativeConsultationDocumentMapper.js");
    const { content } = normalizeConsultationContent(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject);
    const { spec } = buildCreativeConsultationSpec(
      FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject,
      content, null, [],
    );
    const allText = spec.sections.filter((s) => s.type === "paragraph")
      .map((s) => (s as { text: string }).text).join(" ");
    expect(allText).not.toMatch(/\{.*brand_values.*\}/s);
    expect(spec.documentType).toBe("creative_consultation");
  });

  it("action items render as bullet lists not as raw strings", async () => {
    const { buildCreativeConsultationSpec, normalizeConsultationContent } = await import("../mappers/creativeConsultationDocumentMapper.js");
    const { content } = normalizeConsultationContent(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject);
    const { spec } = buildCreativeConsultationSpec(
      FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject,
      content, null, [],
    );
    const bulletSections = spec.sections.filter((s) => s.type === "bullets");
    expect(bulletSections.length).toBeGreaterThan(0);
  });
});

// ── F. Brand Identity Guideline mapper ───────────────────────────────────────

describe("F. Brand Identity Guideline mapper", () => {
  it("embeds the logo buffer as an image section in the spec", async () => {
    const { buildBrandIdentityGuidelineSpec, normalizeBrandIdentityContent } = await import("../mappers/brandIdentityGuidelineDocumentMapper.js");
    const { content } = normalizeBrandIdentityContent(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject);
    const { spec, report } = buildBrandIdentityGuidelineSpec(
      FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject,
      content, FAKE_LOGO_PNG, [],
    );
    const imageSections = spec.sections.filter((s) => s.type === "image");
    expect(imageSections.length).toBeGreaterThan(0);
    expect((imageSections[0] as { imageBuffer?: Buffer }).imageBuffer).toBe(FAKE_LOGO_PNG);
    expect((report as { logoEmbedded?: boolean }).logoEmbedded).toBe(true);
  });

  it("blocks completion when requiresLogo is true and no image assets exist", async () => {
    // No images in the project → download returns [] → REQUIRED_LOGO_ASSET_MISSING
    pendingSelectQueue = [[FAKE_PROJECT], [], []];
    await expect(
      executeGenericPdfExportJob(fakeJob({ projectId: 42 }), "brand_identity_guideline"),
    ).rejects.toMatchObject({ code: REQUIRED_LOGO_ASSET_MISSING });
  });

  it("optional mockup section is skipped when no inline images are passed", async () => {
    const { buildBrandIdentityGuidelineSpec, normalizeBrandIdentityContent } = await import("../mappers/brandIdentityGuidelineDocumentMapper.js");
    const { content } = normalizeBrandIdentityContent(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject);
    const { report } = buildBrandIdentityGuidelineSpec(
      FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject,
      content, FAKE_LOGO_PNG, [],
    );
    const skipped = (report as { sectionsSkipped?: Array<{ id: string }> }).sectionsSkipped ?? [];
    expect(skipped.find((s) => s.id === "mockups")).toBeDefined();
  });

  it("color palette section is present when creative direction has color data", async () => {
    const { buildBrandIdentityGuidelineSpec, normalizeBrandIdentityContent } = await import("../mappers/brandIdentityGuidelineDocumentMapper.js");
    const { content } = normalizeBrandIdentityContent(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject);
    const { spec } = buildBrandIdentityGuidelineSpec(
      FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject,
      content, FAKE_LOGO_PNG, [],
    );
    const headings = spec.sections.filter((s) => s.type === "heading").map((s) => (s as { title: string }).title);
    expect(headings).toContain("Color Palette");
  });

  it("succeeds when one image asset is available (logo satisfied)", async () => {
    // Provide one image in the download queue → logo requirement met
    pendingSelectQueue = [
      [FAKE_PROJECT],  // project
      [],              // no existing document asset
      [{ id: 1, imageUrl: "https://storage.test/logo.png", storagePath: null,
         status: "completed", category: "logo" }],
    ];
    const result = await executeGenericPdfExportJob(fakeJob({ projectId: 42 }), "brand_identity_guideline");
    expect(result).toMatchObject({ documentType: "brand_identity_guideline" });
  });

  it("retry is idempotent — does not insert a duplicate asset row", async () => {
    const existing = {
      id: 99, version: 1, status: "completed",
      storagePath: "path/brand-identity-guideline-v1.pdf",
      imageUrl: "https://storage.test/existing-guideline.pdf", metadata: {},
    };
    pendingSelectQueue = [[FAKE_PROJECT], [existing]];
    const result = await executeGenericPdfExportJob(fakeJob({ projectId: 42 }), "brand_identity_guideline");
    expect(result).toMatchObject({ reused: true, assetId: 99 });
    expect(insertedAssets).toHaveLength(0);
  });
});

// ── G. markProjectDocumentFailed ─────────────────────────────────────────────

describe("G. markProjectDocumentFailed", () => {
  it("flips a generating_document project to failed status", async () => {
    pendingSelectQueue = [[FAKE_PROJECT]]; // status = "generating_document"
    await markProjectDocumentFailed(42, "render error: out of memory");
    expect(projectUpdates.some((u) => u.set.status === "failed")).toBe(true);
  });

  it("does nothing when the project is already in a terminal state", async () => {
    pendingSelectQueue = [[{ ...FAKE_PROJECT, status: "completed" }]];
    await markProjectDocumentFailed(42, "stale error");
    expect(projectUpdates).toHaveLength(0);
  });
});

// ── H. Smoke tests — real PDFKit render (no LLM, no network) ─────────────────

describe("H. Real-render smoke tests", () => {
  it("Smoke A — Brand Strategy: renders a real PDF from fixture data", async () => {
    const { normalizeBrandStrategyContent } = await vi.importActual<typeof import("../mappers/brandStrategyDocumentMapper.js")>(
      "../mappers/brandStrategyDocumentMapper.js",
    );
    const { buildBrandStrategySpec } = await vi.importActual<typeof import("../mappers/brandStrategyDocumentMapper.js")>(
      "../mappers/brandStrategyDocumentMapper.js",
    );
    const { renderDocument } = await vi.importActual<typeof import("../creativeDocumentService.js")>(
      "../creativeDocumentService.js",
    );
    const { content } = normalizeBrandStrategyContent(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject);
    const { spec } = buildBrandStrategySpec(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject, content, null, []);
    const { buffer, pageCount } = await renderDocument(spec);
    expect(buffer.slice(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pageCount).toBeGreaterThanOrEqual(1);
    expect(buffer.length).toBeGreaterThan(1024);
  }, 30000);

  it("Smoke B — Copywriting: renders a real PDF from fixture data", async () => {
    const { normalizeCopywritingContent, buildCopywritingSpec } = await vi.importActual<
      typeof import("../mappers/copywritingDocumentMapper.js")
    >("../mappers/copywritingDocumentMapper.js");
    const { renderDocument } = await vi.importActual<typeof import("../creativeDocumentService.js")>(
      "../creativeDocumentService.js",
    );
    const { content } = normalizeCopywritingContent(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject);
    const { spec } = buildCopywritingSpec(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject, content, null, []);
    const { buffer, pageCount } = await renderDocument(spec);
    expect(buffer.slice(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pageCount).toBeGreaterThanOrEqual(1);
    expect(buffer.length).toBeGreaterThan(1024);
  }, 30000);

  it("Smoke C — Creative Consultation: renders a real PDF from fixture data", async () => {
    const { normalizeConsultationContent, buildCreativeConsultationSpec } = await vi.importActual<
      typeof import("../mappers/creativeConsultationDocumentMapper.js")
    >("../mappers/creativeConsultationDocumentMapper.js");
    const { renderDocument } = await vi.importActual<typeof import("../creativeDocumentService.js")>(
      "../creativeDocumentService.js",
    );
    const { content } = normalizeConsultationContent(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject);
    const { spec } = buildCreativeConsultationSpec(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject, content, null, []);
    const { buffer, pageCount } = await renderDocument(spec);
    expect(buffer.slice(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pageCount).toBeGreaterThanOrEqual(1);
    expect(buffer.length).toBeGreaterThan(1024);
  }, 30000);

  it("Smoke D — Brand Identity Guideline: renders a real PDF with a real logo image", async () => {
    const { normalizeBrandIdentityContent, buildBrandIdentityGuidelineSpec } = await vi.importActual<
      typeof import("../mappers/brandIdentityGuidelineDocumentMapper.js")
    >("../mappers/brandIdentityGuidelineDocumentMapper.js");
    const { renderDocument } = await vi.importActual<typeof import("../creativeDocumentService.js")>(
      "../creativeDocumentService.js",
    );
    const { content } = normalizeBrandIdentityContent(FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject);
    // Use the valid 1×1 PNG defined at top of file
    const { spec } = buildBrandIdentityGuidelineSpec(
      FAKE_PROJECT as unknown as import("@workspace/db").CreativeProject,
      content, FAKE_LOGO_PNG, [],
    );
    const { buffer, pageCount } = await renderDocument(spec);
    expect(buffer.slice(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pageCount).toBeGreaterThanOrEqual(1);
    expect(buffer.length).toBeGreaterThan(1024);
  }, 60000);
});
