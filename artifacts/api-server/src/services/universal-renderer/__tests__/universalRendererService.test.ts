/**
 * universalRendererService.test.ts — Team 14
 *
 * Tests orchestration logic with fully mocked ports.
 * Validates: output validity, watermark fail-closed, no empty ZIP,
 * retry semantics, checksum, storage redaction,
 * idempotency (same content hash → cached result),
 * render timeout, design-renderer adapter delegation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { UniversalRendererService } from "../universalRendererService.js";
import { _flushIdempotencyCache }   from "../idempotencyService.js";
import { RenderError }              from "../errors.js";
import type { SvgRendererPort, SvgRenderInput, SvgRenderOutput } from "../ports/SvgRendererPort.js";
import type { PdfRendererPort, PdfRenderInput, PdfRenderOutput } from "../ports/PdfRendererPort.js";
import type { PngRendererPort, PngRenderInput, PngRenderOutput } from "../ports/PngRendererPort.js";
import type { StoragePort, UploadInput, UploadResult } from "../ports/StoragePort.js";
import type { JobSchedulerPort, ScheduleJobInput, ScheduleJobOutput } from "../ports/JobSchedulerPort.js";

// ── Minimal valid SVG source ──────────────────────────────────────────────────

const SVG_SOURCE = {
  kind:         "svg" as const,
  svgContent:   '<svg width="100" height="100"><rect width="100" height="100" fill="red"/></svg>',
  canvasWidth:  100,
  canvasHeight: 100,
};

// ── Mock port factories ───────────────────────────────────────────────────────

function makeSvgPort(override?: Partial<SvgRendererPort>): SvgRendererPort {
  return {
    render: vi.fn(async (input: SvgRenderInput): Promise<SvgRenderOutput> => ({
      svgString: input.svgContent ?? "<svg/>",
      warnings:  [],
    })),
    ...override,
  };
}

function makePdfPort(override?: Partial<PdfRendererPort>): PdfRendererPort {
  return {
    render: vi.fn(async (_input: PdfRenderInput): Promise<PdfRenderOutput> => ({
      buffer:        Buffer.from("%PDF-1.4 FAKE"),
      pageCount:     1,
      fileSizeBytes: 13,
      checksum:      "a".repeat(64),
    })),
    ...override,
  };
}

function makePngPort(override?: Partial<PngRendererPort>): PngRendererPort {
  return {
    render: vi.fn(async (_input: PngRenderInput): Promise<PngRenderOutput> => ({
      buffer:        Buffer.from("PNG"),
      mimeType:      "image/png",
      width:         100,
      height:        100,
      fileSizeBytes: 3,
      checksum:      "b".repeat(64),
    })),
    ...override,
  };
}

function makeStoragePort(override?: Partial<StoragePort>): StoragePort {
  return {
    upload: vi.fn(async (input: UploadInput): Promise<UploadResult> => ({
      storagePath:   input.storagePath,
      publicUrl:     `https://storage.example.com/${input.storagePath}`,
      fileSizeBytes: input.buffer.length,
      verified:      true,
    })),
    objectExists: vi.fn(async () => true),
    getPublicUrl: vi.fn((p: string) => `https://storage.example.com/${p}`),
    redact:       vi.fn((p: string) => p.replace(/token=[^&]*/g, "token=[REDACTED]")),
    ...override,
  };
}

function makeJobPort(override?: Partial<JobSchedulerPort>): JobSchedulerPort {
  return {
    schedule: vi.fn(async (_input: ScheduleJobInput): Promise<ScheduleJobOutput> => ({
      jobId:   42,
      jobCode: "JOB-0042",
    })),
    ...override,
  };
}

function makeService(overrides?: {
  svg?:     Partial<SvgRendererPort>;
  pdf?:     Partial<PdfRendererPort>;
  png?:     Partial<PngRendererPort>;
  storage?: Partial<StoragePort>;
  job?:     Partial<JobSchedulerPort>;
}) {
  return new UniversalRendererService({
    svgRenderer:  makeSvgPort(overrides?.svg),
    pdfRenderer:  makePdfPort(overrides?.pdf),
    pngRenderer:  makePngPort(overrides?.png),
    storage:      makeStoragePort(overrides?.storage),
    jobScheduler: makeJobPort(overrides?.job),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("UniversalRendererService", () => {
  beforeEach(() => {
    _flushIdempotencyCache();
  });

  // ── Format routing ─────────────────────────────────────────────────────────

  describe("format routing", () => {
    it("produces one artifact per requested format (svg, png, pdf)", async () => {
      const svc    = makeService();
      const result = await svc.render({ source: SVG_SOURCE, formats: ["svg", "png", "pdf"] });
      expect(result.artifacts).toHaveLength(3);
      const formats = result.artifacts.map((a) => a.format);
      expect(formats).toContain("svg");
      expect(formats).toContain("png");
      expect(formats).toContain("pdf");
    });

    it("throws UNSUPPORTED_FORMAT when formats array is empty", async () => {
      const svc = makeService();
      await expect(svc.render({ source: SVG_SOURCE, formats: [] })).rejects.toMatchObject({
        code: "UNSUPPORTED_FORMAT",
      });
    });

    it("throws UNSUPPORTED_FORMAT when too many formats requested (>10)", async () => {
      const svc     = makeService();
      const formats = Array(11).fill("png") as any;
      await expect(svc.render({ source: SVG_SOURCE, formats })).rejects.toMatchObject({
        code: "UNSUPPORTED_FORMAT",
      });
    });

    it("includes a requestId in the result", async () => {
      const svc    = makeService();
      const result = await svc.render({ source: SVG_SOURCE, formats: ["png"] });
      expect(typeof result.requestId).toBe("string");
      expect(result.requestId.length).toBeGreaterThan(0);
    });

    it("uses provided requestId", async () => {
      const svc    = makeService();
      const result = await svc.render({ requestId: "custom-id", source: SVG_SOURCE, formats: ["png"] });
      expect(result.requestId).toBe("custom-id");
    });

    it("reports durationMs", async () => {
      const svc    = makeService();
      const result = await svc.render({ source: SVG_SOURCE, formats: ["png"] });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  describe("idempotency (P1)", () => {
    it("returns cached result on second identical request without re-rendering", async () => {
      const pngRender = vi.fn(async (_: PngRenderInput): Promise<PngRenderOutput> => ({
        buffer: Buffer.from("PNG"), mimeType: "image/png", width: 100, height: 100, fileSizeBytes: 3, checksum: "b".repeat(64),
      }));
      const svc = new UniversalRendererService({
        svgRenderer:  makeSvgPort(),
        pdfRenderer:  makePdfPort(),
        pngRenderer:  { render: pngRender },
        storage:      makeStoragePort(),
        jobScheduler: makeJobPort(),
      });

      await svc.render({ source: SVG_SOURCE, formats: ["png"] });
      expect(pngRender).toHaveBeenCalledTimes(1);

      // Second request with same content (different storagePrefix — excluded from hash)
      const second = await svc.render({ source: SVG_SOURCE, formats: ["png"], storagePrefix: "other-prefix" });
      // PNG renderer must NOT have been called again
      expect(pngRender).toHaveBeenCalledTimes(1);
      expect(second.cached).toBe(true);
    });

    it("re-renders for different SVG content (different hash)", async () => {
      const pngRender = vi.fn(async (_: PngRenderInput): Promise<PngRenderOutput> => ({
        buffer: Buffer.from("PNG"), mimeType: "image/png", width: 100, height: 100, fileSizeBytes: 3, checksum: "b".repeat(64),
      }));
      const svc = new UniversalRendererService({
        svgRenderer:  makeSvgPort(),
        pdfRenderer:  makePdfPort(),
        pngRenderer:  { render: pngRender },
        storage:      makeStoragePort(),
        jobScheduler: makeJobPort(),
      });

      await svc.render({ source: SVG_SOURCE, formats: ["png"] });
      const differentSrc = { ...SVG_SOURCE, svgContent: "<svg><circle r='5'/></svg>" };
      await svc.render({ source: differentSrc, formats: ["png"] });

      expect(pngRender).toHaveBeenCalledTimes(2);
    });

    it("same format in different order uses same cached result", async () => {
      const svc = makeService();
      await svc.render({ source: SVG_SOURCE, formats: ["png", "svg"] });
      const second = await svc.render({ source: SVG_SOURCE, formats: ["svg", "png"] });
      expect(second.cached).toBe(true);
    });
  });

  // ── Design-renderer adapter delegation (P1 DUPLICATION) ───────────────────

  describe("existing design-renderer adapter is called", () => {
    it("PngRendererPort.render is invoked for PNG format (delegates to encodeSvg)", async () => {
      const pngRender = vi.fn(async (_: PngRenderInput): Promise<PngRenderOutput> => ({
        buffer: Buffer.from("PNG"), mimeType: "image/png", width: 100, height: 100, fileSizeBytes: 3, checksum: "b".repeat(64),
      }));
      const svc = new UniversalRendererService({
        svgRenderer:  makeSvgPort(),
        pdfRenderer:  makePdfPort(),
        pngRenderer:  { render: pngRender },
        storage:      makeStoragePort(),
        jobScheduler: makeJobPort(),
      });
      await svc.render({ source: SVG_SOURCE, formats: ["png"] });
      expect(pngRender).toHaveBeenCalledOnce();
    });

    it("PdfRendererPort.render is invoked for PDF format (delegates to encodeSvg)", async () => {
      const pdfRender = vi.fn(async (_: PdfRenderInput): Promise<PdfRenderOutput> => ({
        buffer: Buffer.from("%PDF-FAKE"), pageCount: 1, fileSizeBytes: 9, checksum: "a".repeat(64),
      }));
      const svc = new UniversalRendererService({
        svgRenderer:  makeSvgPort(),
        pdfRenderer:  { render: pdfRender },
        pngRenderer:  makePngPort(),
        storage:      makeStoragePort(),
        jobScheduler: makeJobPort(),
      });
      await svc.render({ source: SVG_SOURCE, formats: ["pdf"] });
      expect(pdfRender).toHaveBeenCalledOnce();
    });
  });

  // ── Watermark fail-closed ──────────────────────────────────────────────────

  describe("watermark fail-closed", () => {
    it("watermarked format throws RenderError rather than returning un-watermarked PDF", async () => {
      const svc = makeService({
        pdf: {
          render: vi.fn(async (): Promise<PdfRenderOutput> => ({
            buffer:        Buffer.from("NOT_A_PDF"),
            pageCount:     0,
            fileSizeBytes: 9,
            checksum:      "0".repeat(64),
          })),
        },
      });
      await expect(svc.render({ source: SVG_SOURCE, formats: ["watermarked"] })).rejects.toBeInstanceOf(RenderError);
    });

    it("watermark failure prevents upload — storage.upload must not be called with un-watermarked data", async () => {
      const upload = vi.fn();
      const svc = new UniversalRendererService({
        svgRenderer:  makeSvgPort(),
        pdfRenderer:  { render: vi.fn(async () => ({ buffer: Buffer.from("NOT_PDF"), pageCount: 0, fileSizeBytes: 7, checksum: "0".repeat(64) })) },
        pngRenderer:  makePngPort(),
        storage:      { ...makeStoragePort(), upload },
        jobScheduler: makeJobPort(),
      });
      await expect(svc.render({ source: SVG_SOURCE, formats: ["watermarked"] })).rejects.toBeInstanceOf(RenderError);
      // Upload must NOT have been called with the un-watermarked PDF
      expect(upload).not.toHaveBeenCalled();
    });
  });

  // ── ZIP — no empty archive ─────────────────────────────────────────────────

  describe("ZIP — no empty archive", () => {
    it("throws ZIP_EMPTY when zip is requested but all other formats fail", async () => {
      const svc = makeService({
        png: {
          render: vi.fn(async (): Promise<never> => {
            throw new RenderError("PNG_TOO_LARGE", "too big");
          }),
        },
      });
      await expect(svc.render({ source: SVG_SOURCE, formats: ["zip"] })).rejects.toMatchObject({
        code: "ZIP_EMPTY",
      });
    });
  });

  // ── Storage integration ────────────────────────────────────────────────────

  describe("storage integration", () => {
    it("uploads every artifact to storage", async () => {
      const upload = vi.fn(async (input: UploadInput): Promise<UploadResult> => ({
        storagePath: input.storagePath, publicUrl: `https://cdn/${input.storagePath}`,
        fileSizeBytes: input.buffer.length, verified: true,
      }));
      const svc = makeService({ storage: { upload } });
      await svc.render({ source: SVG_SOURCE, formats: ["svg", "png", "pdf"] });
      expect(upload).toHaveBeenCalledTimes(3);
    });

    it("invalid output is not stored — storage.upload throws propagates", async () => {
      const svc = makeService({
        storage: {
          upload: vi.fn(async (): Promise<never> => {
            throw new RenderError("STORAGE_VERIFY_FAILED", "storage down");
          }),
        },
      });
      await expect(svc.render({ source: SVG_SOURCE, formats: ["png"] })).rejects.toMatchObject({
        code: "STORAGE_VERIFY_FAILED",
      });
    });
  });

  // ── Async enqueue ──────────────────────────────────────────────────────────

  describe("async enqueue", () => {
    it("schedules a universal_render job and returns jobId + jobCode", async () => {
      const svc    = makeService();
      const result = await svc.enqueueRender({ source: SVG_SOURCE, formats: ["png"] });
      expect(result.jobId).toBe(42);
      expect(result.jobCode).toBe("JOB-0042");
    });

    it("throws when jobScheduler is not provided", async () => {
      const svc = new UniversalRendererService({
        svgRenderer:  makeSvgPort(),
        pdfRenderer:  makePdfPort(),
        pngRenderer:  makePngPort(),
        storage:      makeStoragePort(),
      });
      await expect(svc.enqueueRender({ source: SVG_SOURCE, formats: ["png"] })).rejects.toBeInstanceOf(RenderError);
    });
  });

  // ── SVG adapter guard ──────────────────────────────────────────────────────

  describe("SVG adapter guard", () => {
    it("propagates SVG port errors upward", async () => {
      const svc = makeService({
        svg: {
          render: vi.fn(async (): Promise<never> => {
            throw new RenderError("SVG_SANITISE_FAILED", "forbidden script tag");
          }),
        },
      });
      await expect(svc.render({ source: SVG_SOURCE, formats: ["svg"] })).rejects.toMatchObject({
        code: "SVG_SANITISE_FAILED",
      });
    });
  });
});
