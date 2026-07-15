/**
 * Design Renderer — Pipeline Orchestrator
 *
 * Assembles the full render pipeline:
 *   1. Validate template + input data
 *   2. Resolve all assets
 *   3. Build SVG
 *   4. Encode to output format
 *   5. Upload to storage
 *   6. Return RenderResult
 *
 * This is the only entry point for production renders.
 * Preview renders use the same pipeline but skip permanent storage.
 */

import { createHash } from "crypto";
import type { DesignTemplate, RenderFormat, RenderDataRow, RenderResult, RenderWarning } from "../../types/designTemplate.js";
import { DESIGN_LIMITS } from "../../types/designTemplate.js";
import { validateRenderData, computeInputHash } from "../designTemplateVariableService.js";
import { RenderError, toErrorCode, sanitiseErrorMessage } from "./errors.js";
import { WarningAccumulator } from "./renderWarnings.js";
import { AssetCache } from "./assetCache.js";
import { buildSvg } from "./svgBuilder.js";
import { encodeSvg, validateOutputDimensions, extForFormat } from "./outputEncoder.js";
import { uploadToSupabase } from "../../lib/supabaseStorage.js";
import { renderConfig } from "./config.js";
import { logger } from "../../lib/logger.js";

export type RenderPipelineInput = {
  template: DesignTemplate;
  templateVersionId: number;
  data: RenderDataRow;
  format: RenderFormat;
  tenantId: string;
  /** Context IDs for storage path and logging */
  batchId?: string | number;
  renderItemId?: string | number;
  /** Output size override — layout still uses template canvas coordinates */
  outputWidth?: number;
  outputHeight?: number;
  /** Batch-scoped asset cache (share across items to avoid re-fetching) */
  cache?: AssetCache;
};

export type PipelineResult = {
  outputUrl: string;
  outputStoragePath: string;
  width: number;
  height: number;
  format: RenderFormat;
  fileSizeBytes: number;
  renderDurationMs: number;
  warnings: RenderWarning[];
  inputHash: string;
};

export type PreviewResult = {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
  warnings: RenderWarning[];
};

/**
 * Run the full production render pipeline and upload to storage.
 */
export async function renderTemplate(input: RenderPipelineInput): Promise<PipelineResult> {
  const startMs = Date.now();
  const warnings = new WarningAccumulator();
  const cache = input.cache ?? new AssetCache();

  const { template, templateVersionId, data, format, tenantId } = input;

  // ── 1. Validate canvas limits ──────────────────────────────────────────────
  const { canvas } = template;
  if (canvas.width > DESIGN_LIMITS.MAX_CANVAS_WIDTH || canvas.height > DESIGN_LIMITS.MAX_CANVAS_HEIGHT) {
    throw new RenderError("CANVAS_LIMIT_EXCEEDED", `Canvas ${canvas.width}×${canvas.height} exceeds limits`);
  }

  // ── 2. Validate input data ─────────────────────────────────────────────────
  const validationResult = validateRenderData(template.variables, data);
  if (!validationResult.valid) {
    throw new RenderError(
      "VARIABLE_VALIDATION_FAILED",
      `Variable validation failed: missing=[${validationResult.missingRequired.join(",")}] invalid=[${validationResult.invalidFields.map((f) => f.key).join(",")}]`,
    );
  }

  // ── 3. Validate output dimensions ──────────────────────────────────────────
  validateOutputDimensions(canvas.width, canvas.height, input.outputWidth, input.outputHeight);

  // ── 4. Compute idempotency hash ────────────────────────────────────────────
  const inputHash = computeInputHashWithMeta(
    templateVersionId,
    data,
    format,
    input.outputWidth,
    input.outputHeight,
  );

  // ── 5. Build SVG ───────────────────────────────────────────────────────────
  let svgString: string;
  try {
    svgString = await buildSvg(template, data, warnings, { cache });
  } catch (err) {
    if (err instanceof RenderError) throw err;
    throw new RenderError("SVG_BUILD_FAILED", `SVG build failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 6. Encode to output format ─────────────────────────────────────────────
  const encoded = await encodeSvg(svgString, format, canvas.width, canvas.height, {
    outputWidth:  input.outputWidth,
    outputHeight: input.outputHeight,
    pdfMetadata: {
      title:           template.name,
      creator:         "Creative AI Studio",
      rendererVersion: renderConfig.rendererVersion,
    },
  });

  // ── 7. Build storage path ──────────────────────────────────────────────────
  const ext = extForFormat(format);
  const pathParts = [
    "design-renders",
    tenantId,
    input.batchId   ? String(input.batchId)      : "single",
    input.renderItemId ? String(input.renderItemId) : `tmp-${Date.now()}`,
    `${inputHash.slice(0, 16)}.${ext}`,
  ];
  const storagePath = pathParts.join("/");

  // ── 8. Upload to storage ───────────────────────────────────────────────────
  let outputUrl: string;
  try {
    outputUrl = await uploadToSupabase(storagePath, encoded.buffer, encoded.mimeType);
  } catch (err) {
    throw new RenderError(
      "STORAGE_UPLOAD_FAILED",
      `Storage upload failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const renderDurationMs = Date.now() - startMs;

  // Convert internal warnings to RenderWarning[] (matches Phase 1 type)
  const renderWarnings: RenderWarning[] = warnings.toArray().map((w) => ({
    elementId: w.elementId,
    code: mapWarningCode(w.code),
    message: w.message,
  }));

  logger.info(
    {
      tenantId,
      templateVersionId,
      format,
      durationMs: renderDurationMs,
      warnings: warnings.count,
      fileSizeBytes: encoded.fileSizeBytes,
    },
    "[design-renderer] Render complete",
  );

  return {
    outputUrl,
    outputStoragePath: storagePath,
    width:             encoded.width,
    height:            encoded.height,
    format,
    fileSizeBytes:     encoded.fileSizeBytes,
    renderDurationMs,
    warnings:          renderWarnings,
    inputHash,
  };
}

/**
 * Run the render pipeline without uploading to storage.
 * Used by the preview endpoint. Callers must handle the buffer directly.
 */
export async function renderTemplatePreview(
  input: Omit<RenderPipelineInput, "batchId" | "renderItemId">,
): Promise<PreviewResult> {
  const warnings = new WarningAccumulator();
  const cache = input.cache ?? new AssetCache();

  const { template, data, format } = input;

  // Validate canvas and data
  const { canvas } = template;
  if (canvas.width > DESIGN_LIMITS.MAX_CANVAS_WIDTH || canvas.height > DESIGN_LIMITS.MAX_CANVAS_HEIGHT) {
    throw new RenderError("CANVAS_LIMIT_EXCEEDED", `Canvas ${canvas.width}×${canvas.height} exceeds limits`);
  }

  validateOutputDimensions(canvas.width, canvas.height, input.outputWidth, input.outputHeight);

  const svgString = await buildSvg(template, data, warnings, { cache });
  const encoded   = await encodeSvg(svgString, format, canvas.width, canvas.height, {
    outputWidth:  input.outputWidth,
    outputHeight: input.outputHeight,
  });

  const renderWarnings: RenderWarning[] = warnings.toArray().map((w) => ({
    elementId: w.elementId,
    code: mapWarningCode(w.code),
    message: w.message,
  }));

  return {
    buffer:   encoded.buffer,
    mimeType: encoded.mimeType,
    width:    encoded.width,
    height:   encoded.height,
    warnings: renderWarnings,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute a render-cache key that includes format and dimensions.
 * Extends the Phase 1 computeInputHash with renderer metadata.
 */
function computeInputHashWithMeta(
  templateVersionId: number,
  data: RenderDataRow,
  format: RenderFormat,
  outputWidth?: number,
  outputHeight?: number,
): string {
  const base = computeInputHash(templateVersionId, data);
  const meta = `${format}|${outputWidth ?? ""}|${outputHeight ?? ""}|${renderConfig.rendererVersion}`;
  return createHash("sha256").update(`${base}::${meta}`).digest("hex");
}

import type { RenderWarningCode } from "./renderWarnings.js";

function mapWarningCode(code: RenderWarningCode): RenderWarning["code"] {
  switch (code) {
    case "TEXT_AUTO_SHRINK_APPLIED": return "text_auto_shrunk";
    case "TEXT_TRUNCATED":           return "text_truncated";
    case "IMAGE_FALLBACK_USED":      return "image_fallback";
    case "VARIABLE_FALLBACK_USED":
    case "OPTIONAL_VARIABLE_MISSING":return "variable_missing";
    case "FONT_FALLBACK_USED":
    case "UNSUPPORTED_FONT_FALLBACK":return "font_fallback";
    case "ELEMENT_OUTSIDE_CANVAS":   return "element_clipped";
    case "MAX_LINES_EXCEEDED":       return "text_truncated";
    case "QR_TOO_LONG":              return "qr_too_long";
    default:                         return "element_clipped";
  }
}
