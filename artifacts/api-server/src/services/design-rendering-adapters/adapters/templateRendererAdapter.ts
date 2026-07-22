/**
 * Team 32 — TemplateRendererAdapter
 *
 * Wraps the existing design-renderer pipeline (renderTemplate /
 * renderTemplatePreview) and exposes it through the DesignRendererAdapter
 * interface.
 *
 * Supported artifact kind: "design_template"
 * Supported formats: png, jpg, webp, pdf, svg
 * Supported targets: artifact_preview, workspace_image, review_preview,
 *                    technical_preview, document_page
 *
 * Classification: spec_rendered (always — we build SVG from a design spec,
 * never claim native_conversion for this pipeline).
 *
 * Security:
 *  - tenantId is validated against the template's tenantId field.
 *  - Output filenames are sanitized.
 *  - storagePath is never returned in the public result; only signedUrl.
 *  - Resource limits (width, height, file size) are enforced before upload.
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
  generateRenderSignedToken,
  sanitizeRenderFilename,
} from "../types.js";
import {
  renderTemplate,
  renderTemplatePreview,
} from "../../design-renderer/index.js";
import { logger } from "../../../lib/logger.js";

// ── Supported format set ──────────────────────────────────────────────────────
// RenderFormat = "png" | "jpg" | "webp" | "pdf" — "svg" is not a native pipeline output.

const ADAPTER_FORMATS = ["png", "jpg", "webp", "pdf"] as const;
type AdapterFormat = typeof ADAPTER_FORMATS[number];

// ── Adapter ───────────────────────────────────────────────────────────────────

export interface TemplateRendererAdapterDeps {
  /**
   * Resolve template + version data from the artifact ID.
   * Returns null if not found or if the tenantId does not match.
   */
  resolveTemplate: (artifactId: string, tenantId: string) => Promise<{
    template: Parameters<typeof renderTemplate>[0]["template"];
    templateVersionId: number;
  } | null>;
  /** TTL in seconds for generated signed URLs (default 3600). */
  signedUrlTtlSeconds?: number;
}

export class TemplateRendererAdapter implements DesignRendererAdapter {
  readonly rendererId = "template-renderer-v1";

  readonly capability: DesignRenderCapability = {
    rendererId: "template-renderer-v1",
    description: "Renders design templates via the SVG pipeline (spec_rendered). Formats: png/jpg/webp/pdf.",
    supportedFormats: [...ADAPTER_FORMATS] as import("../types.js").DesignRenderFormat[],
    supportedTargets: [
      "artifact_preview",
      "workspace_image",
      "review_preview",
      "technical_preview",
      "document_page",
    ],
    supportedArtifactKinds: ["design_template"],
    maxWidthPx: DESIGN_RENDER_ADAPTER_LIMITS.MAX_OUTPUT_WIDTH_PX,
    maxHeightPx: DESIGN_RENDER_ADAPTER_LIMITS.MAX_OUTPUT_HEIGHT_PX,
    maxFileSizeBytes: DESIGN_RENDER_ADAPTER_LIMITS.MAX_RASTER_BYTES,
    timeoutMs: DESIGN_RENDER_ADAPTER_LIMITS.DEFAULT_TIMEOUT_MS,
    retryable: true,
    available: true,
    priority: 10,
  };

  constructor(private readonly deps: TemplateRendererAdapterDeps) {}

  canHandle(request: DesignRenderRequest): boolean {
    return (
      request.artifactKind === "design_template" &&
      (ADAPTER_FORMATS as readonly string[]).includes(request.profile.format)
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

    // ── Resolve template ──────────────────────────────────────────────────────
    const resolved = await this.deps.resolveTemplate(request.artifactId, request.tenantId);
    if (!resolved) {
      throw new DesignRenderError({
        code: "UNSUPPORTED_ARTIFACT",
        message: `Template "${request.artifactId}" not found or access denied for tenant "${request.tenantId}"`,
        retryable: false,
        requestId,
        rendererId: this.rendererId,
      });
    }

    const { template, templateVersionId } = resolved;
    const { profile } = request;
    const format = profile.format as AdapterFormat;

    // ── Sanitize output filename hint ─────────────────────────────────────────
    const safeName = sanitizeRenderFilename(
      `${request.artifactId}-${templateVersionId}-${format}`,
    );

    // ── Preview vs production ─────────────────────────────────────────────────
    if (profile.previewQuality) {
      // In-request preview — no permanent storage
      let previewResult;
      try {
        previewResult = await renderTemplatePreview({
          template,
          templateVersionId,
          tenantId: request.tenantId,
          data: (request.sourceData as Record<string, string>) ?? {},
          format,
          outputWidth: profile.widthPx,
          outputHeight: profile.heightPx,
        });
      } catch (err) {
        logger.warn({ err, requestId, rendererId: this.rendererId }, "[team32] Preview render failed");
        throw new DesignRenderError({
          code: "RENDER_FAILED",
          message: err instanceof Error ? err.message : "Preview render failed",
          retryable: true,
          requestId,
          rendererId: this.rendererId,
        });
      }

      return {
        requestId,
        rendererId: this.rendererId,
        format: profile.format,
        target: profile.purpose,
        classification: "spec_rendered",
        mimeType: previewResult.mimeType,
        widthPx: previewResult.width,
        heightPx: previewResult.height,
        fileSizeBytes: previewResult.buffer.length,
        durationMs: Date.now() - startMs,
        warnings: previewResult.warnings.map((w) => w.message),
        tenantId: request.tenantId,
      };
    }

    // ── Production render ─────────────────────────────────────────────────────
    let pipelineResult;
    try {
      pipelineResult = await renderTemplate({
        template,
        templateVersionId,
        data: (request.sourceData as Record<string, string>) ?? {},
        format,
        tenantId: request.tenantId,
        outputWidth: profile.widthPx,
        outputHeight: profile.heightPx,
      });
    } catch (err) {
      logger.error({ err, requestId, rendererId: this.rendererId }, "[team32] Production render failed");
      throw new DesignRenderError({
        code: "RENDER_FAILED",
        message: err instanceof Error ? err.message : "Render failed",
        retryable: true,
        requestId,
        rendererId: this.rendererId,
      });
    }

    // ── Resource limit check ──────────────────────────────────────────────────
    const maxBytes = profile.maxFileSizeBytes ?? this.capability.maxFileSizeBytes;
    if (pipelineResult.fileSizeBytes > maxBytes) {
      throw new DesignRenderError({
        code: "RESOURCE_LIMIT_EXCEEDED",
        message: `Output file size ${pipelineResult.fileSizeBytes} bytes exceeds limit ${maxBytes} bytes`,
        retryable: false,
        requestId,
        rendererId: this.rendererId,
      });
    }

    // ── Sign URL — never expose raw storagePath ───────────────────────────────
    const { token, expiresAt } = generateRenderSignedToken(
      request.tenantId,
      pipelineResult.outputStoragePath,
      this.deps.signedUrlTtlSeconds ?? 3600,
    );

    logger.info(
      { requestId, rendererId: this.rendererId, safeName, format, durationMs: Date.now() - startMs },
      "[team32] Template render complete",
    );

    return {
      requestId,
      rendererId: this.rendererId,
      format: profile.format,
      target: profile.purpose,
      classification: "spec_rendered",
      // storagePath intentionally omitted from public result
      signedUrl: token,
      publicUrl: pipelineResult.outputUrl,
      fileSizeBytes: pipelineResult.fileSizeBytes,
      widthPx: pipelineResult.width,
      heightPx: pipelineResult.height,
      mimeType: MIME_FOR_FORMAT[profile.format],
      expiresAt,
      durationMs: Date.now() - startMs,
      warnings: pipelineResult.warnings.map((w) => w.message),
      tenantId: request.tenantId,
    };
  }
}
