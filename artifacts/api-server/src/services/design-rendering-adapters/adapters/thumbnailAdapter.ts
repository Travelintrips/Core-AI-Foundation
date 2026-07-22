/**
 * Team 32 — ThumbnailAdapter
 *
 * Generates small-format thumbnail previews for design artifacts.
 * Delegates to an injected thumbnail generator function rather than
 * implementing rasterization directly.
 *
 * Classification: rasterized_preview
 * Purpose: thumbnail target only
 * Formats: png, jpg, webp, thumbnail (all treated as raster thumbnail)
 *
 * Security:
 *  - Maximum dimension capped at DESIGN_RENDER_ADAPTER_LIMITS.MAX_THUMBNAIL_PX.
 *  - tenantId validated.
 *  - Filename sanitized.
 */

import { randomUUID } from "crypto";
import type {
  DesignRendererAdapter,
  DesignRenderCapability,
  DesignRenderRequest,
  DesignRenderResult,
} from "../types.js";
import {
  DesignRenderError,
  DESIGN_RENDER_ADAPTER_LIMITS,
  MIME_FOR_FORMAT,
  sanitizeRenderFilename,
} from "../types.js";

// ── Deps ──────────────────────────────────────────────────────────────────────

export interface ThumbnailGeneratorInput {
  sourceBuffer: Buffer;
  sourceMime: string;
  widthPx: number;
  heightPx: number;
  format: "png" | "jpg" | "webp";
  quality?: number;
}

export interface ThumbnailGeneratorOutput {
  buffer: Buffer;
  widthPx: number;
  heightPx: number;
  mimeType: string;
}

export interface ThumbnailAdapterDeps {
  /**
   * Fetch the source artifact as a raw buffer.
   * Returns null if not found or tenant mismatch.
   */
  fetchSourceBuffer: (
    artifactId: string,
    tenantId: string,
  ) => Promise<{ buffer: Buffer; mimeType: string } | null>;

  /**
   * Generate the thumbnail from a buffer.
   * Wraps sharp/thumbnailService from the universal-renderer.
   */
  generateThumbnail: (input: ThumbnailGeneratorInput) => Promise<ThumbnailGeneratorOutput>;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class ThumbnailAdapter implements DesignRendererAdapter {
  readonly rendererId = "thumbnail-adapter-v1";

  readonly capability: DesignRenderCapability = {
    rendererId: "thumbnail-adapter-v1",
    description: "Generates rasterized thumbnails for any design artifact",
    supportedFormats: ["png", "jpg", "webp", "thumbnail"],
    supportedTargets: ["thumbnail"],
    supportedArtifactKinds: [
      "design_template",
      "document",
      "presentation",
      "image",
      "creative_asset",
    ],
    maxWidthPx: DESIGN_RENDER_ADAPTER_LIMITS.MAX_THUMBNAIL_PX,
    maxHeightPx: DESIGN_RENDER_ADAPTER_LIMITS.MAX_THUMBNAIL_PX,
    maxFileSizeBytes: 2 * 1024 * 1024, // 2 MB — thumbnails are small
    timeoutMs: 15_000,
    retryable: true,
    available: true,
    priority: 20,
  };

  constructor(private readonly deps: ThumbnailAdapterDeps) {}

  canHandle(request: DesignRenderRequest): boolean {
    return (
      request.profile.purpose === "thumbnail" &&
      request.profile.widthPx <= DESIGN_RENDER_ADAPTER_LIMITS.MAX_THUMBNAIL_PX &&
      request.profile.heightPx <= DESIGN_RENDER_ADAPTER_LIMITS.MAX_THUMBNAIL_PX
    );
  }

  async render(request: DesignRenderRequest): Promise<DesignRenderResult> {
    const startMs = Date.now();
    const requestId = request.requestId ?? randomUUID();

    // ── Tenant guard ──────────────────────────────────────────────────────────
    if (!request.tenantId || request.tenantId.trim() === "") {
      throw new DesignRenderError({
        code: "TENANT_MISMATCH",
        message: "tenantId is required",
        retryable: false,
        requestId,
        rendererId: this.rendererId,
      });
    }

    // ── Dimension guard ───────────────────────────────────────────────────────
    const { widthPx, heightPx } = request.profile;
    if (
      widthPx > DESIGN_RENDER_ADAPTER_LIMITS.MAX_THUMBNAIL_PX ||
      heightPx > DESIGN_RENDER_ADAPTER_LIMITS.MAX_THUMBNAIL_PX
    ) {
      throw new DesignRenderError({
        code: "RESOURCE_LIMIT_EXCEEDED",
        message: `Thumbnail dimensions ${widthPx}×${heightPx} exceed max ${DESIGN_RENDER_ADAPTER_LIMITS.MAX_THUMBNAIL_PX}px`,
        retryable: false,
        requestId,
        rendererId: this.rendererId,
      });
    }

    sanitizeRenderFilename(`${request.artifactId}-thumb`);

    // ── Fetch source ──────────────────────────────────────────────────────────
    const source = await this.deps.fetchSourceBuffer(request.artifactId, request.tenantId);
    if (!source) {
      throw new DesignRenderError({
        code: "UNSUPPORTED_ARTIFACT",
        message: `Artifact "${request.artifactId}" not found or access denied for tenant "${request.tenantId}"`,
        retryable: false,
        requestId,
        rendererId: this.rendererId,
      });
    }

    // ── Generate thumbnail ────────────────────────────────────────────────────
    const outputFormat =
      request.profile.format === "thumbnail"
        ? "png"
        : (request.profile.format as "png" | "jpg" | "webp");

    let thumb: ThumbnailGeneratorOutput;
    try {
      thumb = await this.deps.generateThumbnail({
        sourceBuffer: source.buffer,
        sourceMime: source.mimeType,
        widthPx: request.profile.widthPx,
        heightPx: request.profile.heightPx,
        format: outputFormat,
        quality: request.profile.quality,
      });
    } catch (err) {
      throw new DesignRenderError({
        code: "RENDER_FAILED",
        message: err instanceof Error ? err.message : "Thumbnail generation failed",
        retryable: true,
        requestId,
        rendererId: this.rendererId,
      });
    }

    return {
      requestId,
      rendererId: this.rendererId,
      format: outputFormat,
      target: "thumbnail",
      classification: "rasterized_preview",
      fileSizeBytes: thumb.buffer.length,
      widthPx: thumb.widthPx,
      heightPx: thumb.heightPx,
      mimeType: thumb.mimeType,
      durationMs: Date.now() - startMs,
      warnings: [],
      tenantId: request.tenantId,
    };
  }
}
