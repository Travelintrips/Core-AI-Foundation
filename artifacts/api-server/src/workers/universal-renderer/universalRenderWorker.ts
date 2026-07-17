/**
 * universalRenderWorker — Universal Renderer Team 14
 *
 * Job handler for all "universal_render_*" job types.
 * This module is loaded by the job dispatcher; it does NOT modify
 * jobWorkerService.ts.  Job types are declared in integration/manifests/team-14.json.
 *
 * Supported job types (via manifest):
 *   universal_render            — full multi-format render
 *   universal_render_svg        — SVG only
 *   universal_render_png        — PNG/JPG/WebP raster only
 *   universal_render_pdf        — PDF only
 *   universal_render_thumbnail  — thumbnail (WebP 1280×720) only
 *   universal_render_watermarked — watermarked preview PDF
 *   universal_render_print_ready — print-ready PDF (300 DPI)
 *   universal_render_zip        — ZIP package from multiple formats
 *   universal_render_composition — editable composition JSON
 *
 * Worker capability required: "universal_render" (declared in manifest).
 *
 * Result shape stored in ai_jobs.result_json:
 *   { requestId, artifacts: [...], warnings: [...], durationMs }
 */

import { logger } from "../../lib/logger.js";
import { getUniversalRenderer } from "../../services/universal-renderer/index.js";
import type { UniversalRenderRequest, OutputFormat } from "../../services/universal-renderer/index.js";
import { RenderError } from "../../services/universal-renderer/errors.js";
import type { AiJob } from "@workspace/db";

// ── Supported job types ───────────────────────────────────────────────────────

const JOB_TYPE_FORMAT_MAP: Record<string, OutputFormat[]> = {
  universal_render_svg:          ["svg"],
  universal_render_png:          ["png"],
  universal_render_pdf:          ["pdf"],
  universal_render_thumbnail:    ["thumbnail"],
  universal_render_watermarked:  ["watermarked"],
  universal_render_print_ready:  ["pdf-print"],
  universal_render_zip:          ["svg", "png", "pdf", "thumbnail", "zip"],
  universal_render_composition:  ["composition"],
  // Full multi-format: formats come from payload.formats
  universal_render:              [], // resolved from payload
};

export const SUPPORTED_JOB_TYPES = new Set(Object.keys(JOB_TYPE_FORMAT_MAP));

// ── Main handler ──────────────────────────────────────────────────────────────

export interface WorkerResult {
  requestId:  string;
  artifacts:  unknown[];
  warnings:   string[];
  durationMs: number;
}

/**
 * Execute a universal render job.
 *
 * Called by the dispatcher when it claims a job with a "universal_render*" type.
 * Returns the result to be stored in ai_jobs.result_json.
 *
 * Throws RenderError on non-retryable failures.
 * Throws any other error on transient failures (dispatcher will retry).
 */
export async function executeUniversalRenderJob(job: AiJob): Promise<WorkerResult> {
  const jobType = job.jobType ?? "";

  if (!SUPPORTED_JOB_TYPES.has(jobType)) {
    throw new RenderError(
      "UNSUPPORTED_FORMAT",
      `universalRenderWorker does not handle job type "${jobType}"`,
    );
  }

  const payload = (job.payloadJson ?? {}) as Record<string, unknown>;
  const rawRequest = payload["request"] as Partial<UniversalRenderRequest> | undefined;

  if (!rawRequest?.source) {
    throw new RenderError(
      "SVG_CONTENT_MISSING",
      `Job ${job.id} (${jobType}) payload is missing required field: request.source`,
    );
  }

  // Resolve formats: from job-type map, or from payload.formats for "universal_render"
  let formats: OutputFormat[];
  if (jobType === "universal_render") {
    const payloadFormats = rawRequest.formats;
    if (!Array.isArray(payloadFormats) || payloadFormats.length === 0) {
      throw new RenderError(
        "UNSUPPORTED_FORMAT",
        `universal_render job ${job.id} must include payload.request.formats[]`,
      );
    }
    formats = payloadFormats as OutputFormat[];
  } else {
    formats = JOB_TYPE_FORMAT_MAP[jobType]!;
  }

  const request: UniversalRenderRequest = {
    requestId:     `job-${job.id}`,
    source:        rawRequest.source,
    formats,
    previewMode:   rawRequest.previewMode ?? false,
    storagePrefix: rawRequest.storagePrefix ?? `universal-renders/job-${job.id}`,
    packageName:   rawRequest.packageName  ?? `render-job-${job.id}`,
    metadata:      rawRequest.metadata,
    tenantId:      rawRequest.tenantId ?? (payload["_tenantId"] as string | undefined),
  };

  logger.info(
    { jobId: job.id, jobType, formats, requestId: request.requestId },
    "[universal-render-worker] Starting render",
  );

  const renderer = getUniversalRenderer();
  const result   = await renderer.render(request);

  logger.info(
    {
      jobId:     job.id,
      requestId: result.requestId,
      artifacts: result.artifacts.length,
      durationMs: result.durationMs,
    },
    "[universal-render-worker] Render complete",
  );

  return {
    requestId:  result.requestId,
    artifacts:  result.artifacts,
    warnings:   result.warnings,
    durationMs: result.durationMs,
  };
}
