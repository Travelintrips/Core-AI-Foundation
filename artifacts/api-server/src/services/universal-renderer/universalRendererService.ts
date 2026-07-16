/**
 * universalRendererService — Universal Renderer Team 14
 *
 * Main orchestration layer.  Accepts a UniversalRenderRequest, routes to the
 * appropriate adapter(s), applies post-processing (watermark, thumbnail,
 * print-ready, ZIP), uploads to storage, and returns a rich result.
 *
 * Dependency injection via constructor — all ports are swappable in tests.
 */

import { randomUUID } from "crypto";
import { computeChecksum } from "./checksumService.js";
import { stampWatermarkBuffer, stampWatermarkSvg } from "./watermarkService.js";
import { generateThumbnail }  from "./thumbnailService.js";
import { makePrintReady }     from "./printReadyService.js";
import { buildZipPackage }    from "./zipPackageService.js";
import { buildComposition }   from "./compositionService.js";
import { RenderError }        from "./errors.js";
import type { SvgRendererPort }  from "./ports/SvgRendererPort.js";
import type { PdfRendererPort }  from "./ports/PdfRendererPort.js";
import type { PngRendererPort, RasterFormat }  from "./ports/PngRendererPort.js";
import type { StoragePort }      from "./ports/StoragePort.js";
import type { JobSchedulerPort } from "./ports/JobSchedulerPort.js";
import type { ZipEntry }         from "./zipPackageService.js";
import type { CompositionLayer } from "./compositionService.js";

// ── Request & Result types ────────────────────────────────────────────────────

export type OutputFormat =
  | "svg"
  | "png"
  | "jpg"
  | "webp"
  | "pdf"
  | "pdf-print"      // print-ready PDF
  | "thumbnail"      // 1280×720 WebP
  | "watermarked"    // watermarked preview PDF
  | "zip"            // ZIP package of all requested formats
  | "composition";   // editable JSON

export interface RenderSource {
  kind:         "svg";
  svgContent:   string;
  canvasWidth:  number;
  canvasHeight: number;
}

export interface UniversalRenderRequest {
  /** Unique render request ID — generated if not provided. */
  requestId?:    string;
  source:        RenderSource;
  formats:       OutputFormat[]; // at least one
  /** When true, preview outputs are watermarked. */
  previewMode?:  boolean;
  /** Where to upload results in storage (prefix). */
  storagePrefix?: string;
  /** Package name for ZIP outputs. */
  packageName?:  string;
  /** Title / creator for PDF metadata. */
  metadata?: {
    title?:   string;
    creator?: string;
  };
  /** Tenant ID (WP-06). */
  tenantId?: string;
}

export interface RenderArtifact {
  format:        OutputFormat;
  storagePath:   string;
  publicUrl:     string;
  fileSizeBytes: number;
  checksum:      string;
  mimeType:      string;
  /** Only set for raster outputs. */
  width?:        number;
  height?:       number;
  /** Only set for PDF outputs. */
  pageCount?:    number;
}

export interface UniversalRenderResult {
  requestId:  string;
  artifacts:  RenderArtifact[];
  warnings:   string[];
  durationMs: number;
}

// ── Deps interface ────────────────────────────────────────────────────────────

export interface UniversalRendererDeps {
  svgRenderer:   SvgRendererPort;
  pdfRenderer:   PdfRendererPort;
  pngRenderer:   PngRendererPort;
  storage:       StoragePort;
  jobScheduler?: JobSchedulerPort; // optional — only needed for async dispatch
}

// ── Service class ─────────────────────────────────────────────────────────────

export class UniversalRendererService {
  constructor(private readonly deps: UniversalRendererDeps) {}

  async render(req: UniversalRenderRequest): Promise<UniversalRenderResult> {
    const startMs   = Date.now();
    const requestId = req.requestId ?? randomUUID();
    const warnings:  string[] = [];

    if (!req.formats || req.formats.length === 0) {
      throw new RenderError("UNSUPPORTED_FORMAT", "At least one output format must be requested");
    }

    const prefix   = (req.storagePrefix ?? `universal-renders/${requestId}`).replace(/\/$/, "");
    const metadata = req.metadata ?? {};
    const artifacts: RenderArtifact[] = [];

    // ── Step 1: Render SVG from source ──────────────────────────────────────
    const svgOut = await this.deps.svgRenderer.render({
      svgContent:   req.source.svgContent,
      canvasWidth:  req.source.canvasWidth,
      canvasHeight: req.source.canvasHeight,
    });
    warnings.push(...svgOut.warnings);

    let svgString = svgOut.svgString;

    // Apply SVG watermark before rasterising if in preview mode and SVG output requested
    const needsWatermark = req.previewMode === true;

    // ── Step 2: Produce each requested format ────────────────────────────────

    const zipEntries: ZipEntry[] = [];

    for (const format of req.formats) {
      const artifact = await this.renderOneFormat({
        format,
        svgString,
        source: req.source,
        metadata,
        needsWatermark,
        prefix,
        packageName: req.packageName ?? `render-${requestId}`,
        zipEntries,
        warnings,
        requestId,
      });
      if (artifact) {
        artifacts.push(artifact);
      }
    }

    // ── Step 3: Build ZIP if requested ───────────────────────────────────────
    if (req.formats.includes("zip")) {
      if (zipEntries.length === 0) {
        throw new RenderError("ZIP_EMPTY", "ZIP format requested but no render outputs were produced");
      }
      const pkg = await buildZipPackage({
        entries:     zipEntries,
        packageName: req.packageName ?? `render-${requestId}`,
      });

      const zipPath   = `${prefix}/package.zip`;
      const uploaded  = await this.deps.storage.upload({
        buffer:      pkg.buffer,
        storagePath: zipPath,
        contentType: "application/zip",
        checksum:    pkg.checksum,
      });

      artifacts.push({
        format:        "zip",
        storagePath:   uploaded.storagePath,
        publicUrl:     uploaded.publicUrl,
        fileSizeBytes: pkg.fileSizeBytes,
        checksum:      pkg.checksum,
        mimeType:      "application/zip",
      });
    }

    return {
      requestId,
      artifacts,
      warnings,
      durationMs: Date.now() - startMs,
    };
  }

  // ── Private: produce one format ────────────────────────────────────────────

  private async renderOneFormat(ctx: {
    format:      OutputFormat;
    svgString:   string;
    source:      RenderSource;
    metadata:    { title?: string; creator?: string };
    needsWatermark: boolean;
    prefix:      string;
    packageName: string;
    zipEntries:  ZipEntry[];
    warnings:    string[];
    requestId:   string;
  }): Promise<RenderArtifact | null> {
    const { format, svgString, source, metadata, needsWatermark, prefix, zipEntries, warnings } = ctx;

    switch (format) {
      // ── SVG ───────────────────────────────────────────────────────────────
      case "svg": {
        const finalSvg = needsWatermark ? stampWatermarkSvg(svgString) : svgString;
        const buf      = Buffer.from(finalSvg, "utf8");
        const checksum = computeChecksum(buf);
        const path     = `${prefix}/output.svg`;
        const up       = await this.deps.storage.upload({ buffer: buf, storagePath: path, contentType: "image/svg+xml", checksum });
        zipEntries.push({ filename: "output.svg", buffer: buf, mimeType: "image/svg+xml" });
        return { format, storagePath: up.storagePath, publicUrl: up.publicUrl, fileSizeBytes: buf.length, checksum, mimeType: "image/svg+xml" };
      }

      // ── PNG / JPG / WebP ─────────────────────────────────────────────────
      case "png":
      case "jpg":
      case "webp": {
        const rasterFormat: RasterFormat = format;
        const pngOut = await this.deps.pngRenderer.render({
          source: { kind: "svg", svgString, canvasWidth: source.canvasWidth, canvasHeight: source.canvasHeight },
          format: rasterFormat,
        });
        const ext    = format === "jpg" ? "jpg" : format;
        const path   = `${prefix}/output.${ext}`;
        const up     = await this.deps.storage.upload({ buffer: pngOut.buffer, storagePath: path, contentType: pngOut.mimeType, checksum: pngOut.checksum });
        zipEntries.push({ filename: `output.${ext}`, buffer: pngOut.buffer, mimeType: pngOut.mimeType });
        return { format, storagePath: up.storagePath, publicUrl: up.publicUrl, fileSizeBytes: pngOut.fileSizeBytes, checksum: pngOut.checksum, mimeType: pngOut.mimeType, width: pngOut.width, height: pngOut.height };
      }

      // ── PDF ───────────────────────────────────────────────────────────────
      case "pdf": {
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

      // ── Print-ready PDF ───────────────────────────────────────────────────
      case "pdf-print": {
        const pdfOut  = await this.deps.pdfRenderer.render({
          source: { kind: "svg", svgString, width: source.canvasWidth, height: source.canvasHeight },
          metadata,
          printReady: true,
        });
        const prOut   = await makePrintReady({ pdfBuffer: pdfOut.buffer, title: metadata.title, creator: metadata.creator });
        const path    = `${prefix}/output-print-ready.pdf`;
        const up      = await this.deps.storage.upload({ buffer: prOut.buffer, storagePath: path, contentType: "application/pdf", checksum: prOut.checksum });
        zipEntries.push({ filename: "output-print-ready.pdf", buffer: prOut.buffer, mimeType: "application/pdf" });
        return { format, storagePath: up.storagePath, publicUrl: up.publicUrl, fileSizeBytes: prOut.fileSizeBytes, checksum: prOut.checksum, mimeType: "application/pdf", pageCount: pdfOut.pageCount };
      }

      // ── Watermarked preview ───────────────────────────────────────────────
      case "watermarked": {
        const pdfOut  = await this.deps.pdfRenderer.render({
          source: { kind: "svg", svgString, width: source.canvasWidth, height: source.canvasHeight },
          metadata,
        });
        // Fail-closed: watermark MUST succeed or we refuse to upload
        const wBuf    = await stampWatermarkBuffer(pdfOut.buffer);
        const checksum = computeChecksum(wBuf);
        const path    = `${prefix}/preview-watermarked.pdf`;
        const up      = await this.deps.storage.upload({ buffer: wBuf, storagePath: path, contentType: "application/pdf", checksum });
        warnings.push("Watermarked preview generated — not for final delivery");
        return { format, storagePath: up.storagePath, publicUrl: up.publicUrl, fileSizeBytes: wBuf.length, checksum, mimeType: "application/pdf", pageCount: pdfOut.pageCount };
      }

      // ── Thumbnail ─────────────────────────────────────────────────────────
      case "thumbnail": {
        const thumbOut = await generateThumbnail({
          source: { kind: "svg", svgString, canvasWidth: source.canvasWidth, canvasHeight: source.canvasHeight },
        });
        const path     = `${prefix}/thumbnail.webp`;
        const up       = await this.deps.storage.upload({ buffer: thumbOut.buffer, storagePath: path, contentType: "image/webp", checksum: thumbOut.checksum });
        zipEntries.push({ filename: "thumbnail.webp", buffer: thumbOut.buffer, mimeType: "image/webp" });
        return { format, storagePath: up.storagePath, publicUrl: up.publicUrl, fileSizeBytes: thumbOut.fileSizeBytes, checksum: thumbOut.checksum, mimeType: "image/webp", width: thumbOut.width, height: thumbOut.height };
      }

      // ── Composition JSON ──────────────────────────────────────────────────
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

      // ── ZIP — handled after the loop ──────────────────────────────────────
      case "zip":
        return null;

      default:
        warnings.push(`Unknown output format "${format as string}" — skipped`);
        return null;
    }
  }

  /**
   * Enqueue an asynchronous render job via the JobSchedulerPort.
   * The worker picks this up and calls render() internally.
   */
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
