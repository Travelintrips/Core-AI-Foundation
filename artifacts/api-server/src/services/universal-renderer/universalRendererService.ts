/**
 * universalRendererService — Universal Renderer Team 14
 *
 * Main orchestration layer. Changes in this version (remediation):
 *
 *   P1 IDEMPOTENCY:
 *     Before rendering, compute a canonical content hash and return the
 *     cached result if one exists. After rendering, record in the cache.
 *
 *   P1 RESOURCE LIMIT:
 *     Wrap the full render in Promise.race with MAX_RENDER_DURATION_MS.
 *     Format count is capped at 10.
 *
 * All port interfaces remain unchanged — tests can inject mocks freely.
 */

import { randomUUID } from "crypto";
import { computeChecksum }          from "./checksumService.js";
import { stampWatermarkBuffer, stampWatermarkSvg } from "./watermarkService.js";
import { generateThumbnail }        from "./thumbnailService.js";
import { makePrintReady }           from "./printReadyService.js";
import { buildZipPackage }          from "./zipPackageService.js";
import { buildComposition }         from "./compositionService.js";
import { RenderError }              from "./errors.js";
import {
  computeRenderHash,
  checkIdempotency,
  recordIdempotencyResult,
} from "./idempotencyService.js";
import { UNIVERSAL_RENDER_LIMITS }  from "./resourceLimits.js";
import type { SvgRendererPort }     from "./ports/SvgRendererPort.js";
import type { PdfRendererPort }     from "./ports/PdfRendererPort.js";
import type { PngRendererPort, RasterFormat } from "./ports/PngRendererPort.js";
import type { StoragePort }         from "./ports/StoragePort.js";
import type { JobSchedulerPort }    from "./ports/JobSchedulerPort.js";
import type { ZipEntry }            from "./zipPackageService.js";
import type { CompositionLayer }    from "./compositionService.js";

// ── Request & Result types ────────────────────────────────────────────────────

export type OutputFormat =
  | "svg"
  | "png"
  | "jpg"
  | "webp"
  | "pdf"
  | "pdf-print"
  | "thumbnail"
  | "watermarked"
  | "zip"
  | "composition";

export interface RenderSource {
  kind:         "svg";
  svgContent:   string;
  canvasWidth:  number;
  canvasHeight: number;
}

export interface UniversalRenderRequest {
  requestId?:     string;
  source:         RenderSource;
  formats:        OutputFormat[];
  previewMode?:   boolean;
  storagePrefix?: string;
  packageName?:   string;
  metadata?: {
    title?:   string;
    creator?: string;
  };
  tenantId?: string;
}

export interface RenderArtifact {
  format:        OutputFormat;
  storagePath:   string;
  publicUrl:     string;
  fileSizeBytes: number;
  checksum:      string;
  mimeType:      string;
  width?:        number;
  height?:       number;
  pageCount?:    number;
}

export interface UniversalRenderResult {
  requestId:     string;
  artifacts:     RenderArtifact[];
  warnings:      string[];
  durationMs:    number;
  /** True when served from the idempotency cache (no re-render). */
  cached?:       boolean;
}

// ── Deps interface ────────────────────────────────────────────────────────────

export interface UniversalRendererDeps {
  svgRenderer:   SvgRendererPort;
  pdfRenderer:   PdfRendererPort;
  pngRenderer:   PngRendererPort;
  storage:       StoragePort;
  jobScheduler?: JobSchedulerPort;
}

// ── Timeout helper ────────────────────────────────────────────────────────────

function renderTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(
      () => reject(new RenderError("RENDER_TIMEOUT", `Render exceeded ${ms}ms limit`)),
      ms,
    ),
  );
}

// ── Service class ─────────────────────────────────────────────────────────────

export class UniversalRendererService {
  constructor(private readonly deps: UniversalRendererDeps) {}

  async render(req: UniversalRenderRequest): Promise<UniversalRenderResult> {
    // ── Guard: at least one format ──────────────────────────────────────────
    if (!req.formats || req.formats.length === 0) {
      throw new RenderError("UNSUPPORTED_FORMAT", "At least one output format must be requested");
    }

    // ── Guard: format count cap ─────────────────────────────────────────────
    const MAX_FORMATS = 10;
    if (req.formats.length > MAX_FORMATS) {
      throw new RenderError(
        "UNSUPPORTED_FORMAT",
        `Too many output formats requested (${req.formats.length} > ${MAX_FORMATS})`,
      );
    }

    // ── P1 IDEMPOTENCY: return cached result if available ──────────────────
    const contentHash = computeRenderHash(req);
    const cached = checkIdempotency(contentHash);
    if (cached) {
      return { ...cached, cached: true };
    }

    // ── P1 RESOURCE LIMIT: race against wall-clock timeout ─────────────────
    const result = await Promise.race([
      this._doRender(req),
      renderTimeout(UNIVERSAL_RENDER_LIMITS.MAX_RENDER_DURATION_MS),
    ]);

    // ── Record in idempotency cache after success ───────────────────────────
    recordIdempotencyResult(contentHash, result);

    return result;
  }

  private async _doRender(req: UniversalRenderRequest): Promise<UniversalRenderResult> {
    const startMs   = Date.now();
    const requestId = req.requestId ?? randomUUID();
    const warnings:  string[] = [];

    const prefix     = (req.storagePrefix ?? `universal-renders/${requestId}`).replace(/\/$/, "");
    const metadata   = req.metadata ?? {};
    const artifacts: RenderArtifact[] = [];

    // ── Step 1: Render / sanitise SVG ──────────────────────────────────────
    const svgOut = await this.deps.svgRenderer.render({
      svgContent:   req.source.svgContent,
      canvasWidth:  req.source.canvasWidth,
      canvasHeight: req.source.canvasHeight,
    });
    warnings.push(...svgOut.warnings);

    const svgString      = svgOut.svgString;
    const needsWatermark = req.previewMode === true;
    const zipEntries: ZipEntry[] = [];

    // ── Step 2: Produce each requested format ───────────────────────────────
    for (const format of req.formats) {
      const artifact = await this.renderOneFormat({
        format,
        svgString,
        source:       req.source,
        metadata,
        needsWatermark,
        prefix,
        packageName:  req.packageName ?? `render-${requestId}`,
        zipEntries,
        warnings,
        requestId,
      });
      if (artifact) artifacts.push(artifact);
    }

    // ── Step 3: Build ZIP if requested ─────────────────────────────────────
    if (req.formats.includes("zip")) {
      if (zipEntries.length === 0) {
        throw new RenderError("ZIP_EMPTY", "ZIP requested but no render outputs were produced");
      }
      const pkg  = await buildZipPackage({
        entries:     zipEntries,
        packageName: req.packageName ?? `render-${requestId}`,
      });
      const zipPath = `${prefix}/package.zip`;
      const up      = await this.deps.storage.upload({
        buffer:      pkg.buffer,
        storagePath: zipPath,
        contentType: "application/zip",
        checksum:    pkg.checksum,
      });
      artifacts.push({
        format:        "zip",
        storagePath:   up.storagePath,
        publicUrl:     up.publicUrl,
        fileSizeBytes: pkg.fileSizeBytes,
        checksum:      pkg.checksum,
        mimeType:      "application/zip",
      });
    }

    return { requestId, artifacts, warnings, durationMs: Date.now() - startMs };
  }

  private async renderOneFormat(ctx: {
    format:         OutputFormat;
    svgString:      string;
    source:         RenderSource;
    metadata:       { title?: string; creator?: string };
    needsWatermark: boolean;
    prefix:         string;
    packageName:    string;
    zipEntries:     ZipEntry[];
    warnings:       string[];
    requestId:      string;
  }): Promise<RenderArtifact | null> {
    const { format, svgString, source, metadata, needsWatermark, prefix, zipEntries, warnings } = ctx;

    switch (format) {

      case "svg": {
        const finalSvg = needsWatermark ? stampWatermarkSvg(svgString) : svgString;
        const buf      = Buffer.from(finalSvg, "utf8");
        const checksum = computeChecksum(buf);
        const path     = `${prefix}/output.svg`;
        const up       = await this.deps.storage.upload({ buffer: buf, storagePath: path, contentType: "image/svg+xml", checksum });
        zipEntries.push({ filename: "output.svg", buffer: buf, mimeType: "image/svg+xml" });
        return { format, storagePath: up.storagePath, publicUrl: up.publicUrl, fileSizeBytes: buf.length, checksum, mimeType: "image/svg+xml" };
      }

      case "png":
      case "jpg":
      case "webp": {
        // Delegates to existing design-renderer via PngRendererAdapter → encodeSvg()
        const rasterFormat: RasterFormat = format;
        const pngOut = await this.deps.pngRenderer.render({
          source: { kind: "svg", svgString, canvasWidth: source.canvasWidth, canvasHeight: source.canvasHeight },
          format: rasterFormat,
        });
        const ext  = format;
        const path = `${prefix}/output.${ext}`;
        const up   = await this.deps.storage.upload({ buffer: pngOut.buffer, storagePath: path, contentType: pngOut.mimeType, checksum: pngOut.checksum });
        zipEntries.push({ filename: `output.${ext}`, buffer: pngOut.buffer, mimeType: pngOut.mimeType });
        return { format, storagePath: up.storagePath, publicUrl: up.publicUrl, fileSizeBytes: pngOut.fileSizeBytes, checksum: pngOut.checksum, mimeType: pngOut.mimeType, width: pngOut.width, height: pngOut.height };
      }

      case "pdf": {
        // Delegates to existing design-renderer via PdfRendererAdapter → encodeSvg()
        const pdfOut = await this.deps.pdfRenderer.render({
          source: { kind: "svg", svgString, width: source.canvasWidth, height: source.canvasHeight },
          metadata,
        });
        const finalBuf = needsWatermark ? await stampWatermarkBuffer(pdfOut.buffer) : pdfOut.buffer;
        const checksum = computeChecksum(finalBuf);
        const path     = `${prefix}/output.pdf`;
        const up       = await this.deps.storage.upload({ buffer: finalBuf, storagePath: path, contentType: "application/pdf", checksum });
        zipEntries.push({ filename: "output.pdf", buffer: finalBuf, mimeType: "application/pdf" });
        return { format, storagePath: up.storagePath, publicUrl: up.publicUrl, fileSizeBytes: finalBuf.length, checksum, mimeType: "application/pdf", pageCount: pdfOut.pageCount };
      }

      case "pdf-print": {
        const pdfOut = await this.deps.pdfRenderer.render({
          source: { kind: "svg", svgString, width: source.canvasWidth, height: source.canvasHeight },
          metadata,
          printReady: true,
        });
        const prOut  = await makePrintReady({ pdfBuffer: pdfOut.buffer, title: metadata.title, creator: metadata.creator });
        const path   = `${prefix}/output-print-ready.pdf`;
        const up     = await this.deps.storage.upload({ buffer: prOut.buffer, storagePath: path, contentType: "application/pdf", checksum: prOut.checksum });
        zipEntries.push({ filename: "output-print-ready.pdf", buffer: prOut.buffer, mimeType: "application/pdf" });
        return { format, storagePath: up.storagePath, publicUrl: up.publicUrl, fileSizeBytes: prOut.fileSizeBytes, checksum: prOut.checksum, mimeType: "application/pdf", pageCount: pdfOut.pageCount };
      }

      case "watermarked": {
        const pdfOut  = await this.deps.pdfRenderer.render({
          source: { kind: "svg", svgString, width: source.canvasWidth, height: source.canvasHeight },
          metadata,
        });
        // Fail-closed: must succeed or refuse to upload un-watermarked content
        const wBuf    = await stampWatermarkBuffer(pdfOut.buffer);
        const checksum = computeChecksum(wBuf);
        const path    = `${prefix}/preview-watermarked.pdf`;
        const up      = await this.deps.storage.upload({ buffer: wBuf, storagePath: path, contentType: "application/pdf", checksum });
        warnings.push("Watermarked preview generated — not for final delivery");
        return { format, storagePath: up.storagePath, publicUrl: up.publicUrl, fileSizeBytes: wBuf.length, checksum, mimeType: "application/pdf", pageCount: pdfOut.pageCount };
      }

      case "thumbnail": {
        // thumbnailService now delegates SVG→WebP to encodeSvg() (design-renderer)
        const thumbOut = await generateThumbnail({
          source: { kind: "svg", svgString, canvasWidth: source.canvasWidth, canvasHeight: source.canvasHeight },
        });
        const path = `${prefix}/thumbnail.webp`;
        const up   = await this.deps.storage.upload({ buffer: thumbOut.buffer, storagePath: path, contentType: "image/webp", checksum: thumbOut.checksum });
        zipEntries.push({ filename: "thumbnail.webp", buffer: thumbOut.buffer, mimeType: "image/webp" });
        return { format, storagePath: up.storagePath, publicUrl: up.publicUrl, fileSizeBytes: thumbOut.fileSizeBytes, checksum: thumbOut.checksum, mimeType: "image/webp", width: thumbOut.width, height: thumbOut.height };
      }

      case "composition": {
        const layer: Omit<CompositionLayer, "id"> = {
          kind:    "svg",
          label:   "Source SVG",
          zIndex:  0,
          visible: true,
          bounds:  { x: 0, y: 0, width: source.canvasWidth, height: source.canvasHeight },
          data:    { svgContent: svgString },
        };
        const { json, checksum } = buildComposition({
          id:           ctx.requestId,
          canvas:       { width: source.canvasWidth, height: source.canvasHeight },
          layers:       [layer],
          sourceFormat: "svg",
        });
        const buf  = Buffer.from(json, "utf8");
        const path = `${prefix}/composition.json`;
        const up   = await this.deps.storage.upload({ buffer: buf, storagePath: path, contentType: "application/json", checksum });
        zipEntries.push({ filename: "composition.json", buffer: buf, mimeType: "application/json" });
        return { format, storagePath: up.storagePath, publicUrl: up.publicUrl, fileSizeBytes: buf.length, checksum, mimeType: "application/json" };
      }

      case "zip":
        return null; // handled after loop

      default:
        warnings.push(`Unknown output format "${format as string}" — skipped`);
        return null;
    }
  }

  async enqueueRender(req: UniversalRenderRequest): Promise<{ jobId: number; jobCode: string }> {
    if (!this.deps.jobScheduler) {
      throw new RenderError("UNSUPPORTED_FORMAT", "JobScheduler not configured — cannot enqueue async render");
    }
    return this.deps.jobScheduler.schedule({
      jobType:            "universal_render",
      payload:            { request: req },
      priority:           50,
      requiredCapability: "universal_render",
      tenantId:           req.tenantId,
    });
  }
}
