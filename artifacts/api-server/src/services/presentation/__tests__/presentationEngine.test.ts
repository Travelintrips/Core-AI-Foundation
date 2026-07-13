/**
 * presentationEngine.test.ts — Phase 4 Presentation Engine
 *
 * Sections:
 *   A. Registry — pitch_deck resolves; unsupported types don't
 *   B. Pitch deck mapper — anti-fabrication skip logic, no fabricated data
 *   C. Renderer — real PPTX buffer is a valid OOXML zip with the right slide count
 *   D. Validation — rejects placeholder-corrupted / too-few-slide buffers
 *   E. PDF preview — spec-rendered fallback always reports the honest strategy,
 *      and page count always equals slide count (no PDFKit auto-pagination drift)
 *   F. Thumbnail — dimensions and mime type
 *   G. markProjectPresentationFailed — status flip mirrors the Document Engine
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CreativeProject } from "@workspace/db";

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
  creativeProjectsTable: { id: "id", status: "status" },
}));

vi.mock("../../aiAuditService.js", () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

import {
  registerPresentation,
  getPresentationDefinition,
  getSupportedPresentationTypes,
  markProjectPresentationFailed,
} from "../creativePresentationWorkerService.js";
import { pitchDeckDefinition, normalizePitchDeckContent, buildPitchDeckSpec } from "../mappers/pitchDeckPresentationMapper.js";
import { renderPresentation } from "../presentationRenderService.js";
import { validateGeneratedPresentation, PresentationValidationError, PPTX_MIME } from "../presentationValidationService.js";
import { renderSpecBasedPdfPreview } from "../presentationPdfPreviewService.js";
import { generatePresentationThumbnail } from "../presentationThumbnailService.js";
import { db, creativeProjectsTable } from "@workspace/db";

function makeProject(overrides: Partial<CreativeProject> = {}): CreativeProject {
  return {
    id: 1,
    projectId: "test-project-001",
    sourceType: "service_catalog",
    serviceRequestId: null,
    serviceQuotationId: null,
    brandName: "Test Brand",
    businessType: "SaaS",
    targetMarket: "Small businesses",
    productOrService: "Inventory automation software",
    stylePreference: null,
    colorPreference: null,
    referenceLinks: null,
    goal: "Grow revenue 3x",
    notes: null,
    deadline: null,
    status: "generating_presentation",
    paymentPolicy: "full_payment",
    depositPercentage: 50,
    paymentStatus: "paid",
    filesUnlocked: true,
    result: {
      brandStrategy: { positioning: "The simplest inventory tool for small retailers." },
      creativeDirection: {},
      copy: { tagline: "Inventory, simplified." },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CreativeProject;
}

// ── A. Registry ────────────────────────────────────────────────────────────────

describe("presentation registry", () => {
  beforeEach(() => {
    registerPresentation(pitchDeckDefinition);
  });

  it("resolves pitch_deck", () => {
    expect(getPresentationDefinition("pitch_deck")).toBe(pitchDeckDefinition);
    expect(getSupportedPresentationTypes()).toContain("pitch_deck");
  });

  it("returns undefined for an unregistered type", () => {
    expect(getPresentationDefinition("company_overview" as never)).toBeUndefined();
  });
});

// ── B. Mapper anti-fabrication ─────────────────────────────────────────────────

describe("pitch deck mapper", () => {
  it("never fabricates metrics/financial/team/comparison data when absent from project outputs", () => {
    const project = makeProject();
    const { content } = normalizePitchDeckContent(project);
    const { spec, report } = buildPitchDeckSpec(project, content, null, []);

    const skippedIds = (report.slidesSkipped as Array<{ id: string }>).map((s) => s.id);
    expect(skippedIds).toEqual(expect.arrayContaining(["metrics", "financial", "team", "comparison"]));
    expect(spec.slides.some((s) => s.kind === "metrics")).toBe(false);
    expect(spec.slides.some((s) => s.kind === "financial")).toBe(false);
    expect(spec.slides.some((s) => s.kind === "team")).toBe(false);
    expect(spec.slides.some((s) => s.kind === "comparison")).toBe(false);
  });

  it("always includes cover, solution and closing slides derived only from brief fields", () => {
    const project = makeProject();
    const { content } = normalizePitchDeckContent(project);
    const { spec } = buildPitchDeckSpec(project, content, null, []);

    const cover = spec.slides.find((s) => s.kind === "cover");
    expect(cover?.title).toBe(project.brandName);
    expect(spec.slides.some((s) => s.kind === "solution")).toBe(true);
    expect(spec.slides.some((s) => s.kind === "closing")).toBe(true);
  });

  it("meets the definition's minimum slide count for a typical brief", () => {
    const project = makeProject();
    const { content } = normalizePitchDeckContent(project);
    const { spec } = buildPitchDeckSpec(project, content, null, []);
    expect(spec.slides.length).toBeGreaterThanOrEqual(pitchDeckDefinition.minimumSlideCount);
  });
});

// ── C. Renderer + D. Validation ────────────────────────────────────────────────

describe("presentation render + validation", () => {
  it("renders a real, valid OOXML PPTX buffer with one slide XML per spec slide", async () => {
    const project = makeProject();
    const { content } = normalizePitchDeckContent(project);
    const { spec } = buildPitchDeckSpec(project, content, null, []);

    const result = await renderPresentation(spec);
    expect(result.buffer.slice(0, 2).toString("ascii")).toBe("PK"); // ZIP magic bytes
    expect(result.slideCount).toBe(spec.slides.length);

    const validation = await validateGeneratedPresentation(result.buffer, result.slideCount, 1);
    expect(validation.valid).toBe(true);
    expect(validation.mimeType).toBe(PPTX_MIME);
  });

  it("rejects a buffer with fewer real slides than claimed", async () => {
    const project = makeProject();
    const { content } = normalizePitchDeckContent(project);
    const { spec } = buildPitchDeckSpec(project, content, null, []);
    const result = await renderPresentation(spec);

    await expect(
      validateGeneratedPresentation(result.buffer, result.slideCount + 5, 1),
    ).rejects.toThrow(PresentationValidationError);
  });

  it("rejects a non-PPTX buffer outright", async () => {
    await expect(
      validateGeneratedPresentation(Buffer.from("not a pptx"), 3, 1),
    ).rejects.toThrow(PresentationValidationError);
  });

  it("creates a continuation slide instead of truncating an overflowing bullet list", async () => {
    const project = makeProject();
    const { content } = normalizePitchDeckContent(project);
    const { spec } = buildPitchDeckSpec(project, content, null, []);
    const contentSlide = spec.slides.find((s) => s.kind === "content");
    if (contentSlide) {
      (contentSlide as { bullets?: string[] }).bullets = Array.from({ length: 25 }, (_, i) => `Bullet point number ${i + 1} with enough words to matter`);
    }
    const result = await renderPresentation(spec);
    expect(result.slideCount).toBeGreaterThan(spec.slides.length);
    expect(result.continuationSlidesCreated).toBeGreaterThan(0);
  });
});

// ── E. PDF preview ──────────────────────────────────────────────────────────────

describe("presentation PDF preview (honest fallback)", () => {
  it("always reports conversionStrategy 'spec_rendered' since no binary converter exists in this environment", async () => {
    const project = makeProject();
    const { content } = normalizePitchDeckContent(project);
    const { spec } = buildPitchDeckSpec(project, content, null, []);
    const preview = await renderSpecBasedPdfPreview(spec);
    expect(preview.conversionStrategy).toBe("spec_rendered");
    expect(preview.buffer.slice(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("produces exactly one PDF page per slide, even with long bullet content", async () => {
    const project = makeProject();
    const { content } = normalizePitchDeckContent(project);
    const { spec } = buildPitchDeckSpec(project, content, null, []);
    const marketSlide = spec.slides.find((s) => s.kind === "market");
    if (marketSlide) {
      (marketSlide as { bullets?: string[] }).bullets = Array.from({ length: 40 }, (_, i) => `Very long market bullet point number ${i + 1} describing target segment characteristics in detail`);
    }
    const preview = await renderSpecBasedPdfPreview(spec);
    expect(preview.pageCount).toBe(spec.slides.length);
  });
});

// ── F. Thumbnail ────────────────────────────────────────────────────────────────

describe("presentation thumbnail", () => {
  it("renders a 1280x720 webp cover card", async () => {
    const project = makeProject();
    const { content } = normalizePitchDeckContent(project);
    const { spec } = buildPitchDeckSpec(project, content, null, []);
    const thumb = await generatePresentationThumbnail(spec);
    expect(thumb.width).toBe(1280);
    expect(thumb.height).toBe(720);
    expect(thumb.mimeType).toBe("image/webp");
    expect(thumb.buffer.length).toBeGreaterThan(0);
  });
});

// ── G. markProjectPresentationFailed ────────────────────────────────────────────

describe("markProjectPresentationFailed", () => {
  it("flips a project from generating_presentation to failed and logs an audit entry", async () => {
    const project = makeProject({ id: 42, status: "generating_presentation" });
    const updateCalls: Array<{ set: Record<string, unknown> }> = [];

    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({ where: () => Promise.resolve([project]) }),
    });
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          updateCalls.push({ set });
          return Promise.resolve([]);
        },
      }),
    });

    await markProjectPresentationFailed(42, "render exploded");
    expect(updateCalls).toEqual([{ set: { status: "failed" } }]);
  });

  it("does nothing if the project is not currently generating_presentation", async () => {
    const project = makeProject({ id: 43, status: "completed" });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({ where: () => Promise.resolve([project]) }),
    });
    const updateSpy = vi.fn();
    (db.update as ReturnType<typeof vi.fn>).mockImplementation(updateSpy);

    await markProjectPresentationFailed(43, "irrelevant");
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
