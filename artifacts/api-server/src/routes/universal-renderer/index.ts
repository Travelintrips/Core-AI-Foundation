/**
 * universal-renderer routes — Team 14
 *
 * POST /ai/universal-renderer/render        — synchronous render (all formats)
 * POST /ai/universal-renderer/render/async  — enqueue async render job
 * GET  /ai/universal-renderer/formats       — list supported formats
 * GET  /ai/universal-renderer/health        — renderer health probe
 *
 * Auth: all routes are protected by the global adminAuth middleware (app.ts).
 * No zod import — manual validation per project convention for api-server routes.
 *
 * P1 RESOURCE LIMIT:
 *   • Max request body: 10 MB (UNIVERSAL_RENDER_LIMITS.MAX_PAYLOAD_BYTES)
 *   • Max canvas width/height: validated against UNIVERSAL_RENDER_LIMITS
 */

import { Router } from "express";
import { logger }   from "../../lib/logger.js";
import { logAudit } from "../../services/aiAuditService.js";
import {
  getUniversalRenderer,
  RenderError,
} from "../../services/universal-renderer/index.js";
import type {
  UniversalRenderRequest,
  OutputFormat,
} from "../../services/universal-renderer/index.js";
import { StorageAdapter } from "../../services/universal-renderer/adapters/StorageAdapter.js";
import { UNIVERSAL_RENDER_LIMITS } from "../../services/universal-renderer/resourceLimits.js";

const router = Router();

// ── Supported formats ─────────────────────────────────────────────────────────

const SUPPORTED_FORMATS: OutputFormat[] = [
  "svg", "png", "jpg", "webp", "pdf", "pdf-print",
  "thumbnail", "watermarked", "zip", "composition",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const storage = new StorageAdapter();

/** Enforce request body size limit before any processing. */
function assertPayloadSize(req: import("express").Request): void {
  const cl = parseInt(
    (req.headers["content-length"] as string | undefined) ?? "0",
    10,
  );
  if (cl > UNIVERSAL_RENDER_LIMITS.MAX_PAYLOAD_BYTES) {
    throw new RenderError(
      "PAYLOAD_TOO_LARGE",
      `Request body (${cl} bytes) exceeds ${UNIVERSAL_RENDER_LIMITS.MAX_PAYLOAD_BYTES} byte limit`,
    );
  }
  // Belt-and-suspenders: also check body byteLength if express already parsed it
  const body = req.body as Record<string, unknown> | undefined;
  if (body) {
    const serialised = JSON.stringify(body);
    if (Buffer.byteLength(serialised, "utf8") > UNIVERSAL_RENDER_LIMITS.MAX_PAYLOAD_BYTES) {
      throw new RenderError(
        "PAYLOAD_TOO_LARGE",
        `Parsed request body exceeds ${UNIVERSAL_RENDER_LIMITS.MAX_PAYLOAD_BYTES} byte limit`,
      );
    }
  }
}

function parseFormats(raw: unknown): OutputFormat[] {
  if (Array.isArray(raw)) {
    const valid = raw.filter((f): f is OutputFormat =>
      typeof f === "string" && (SUPPORTED_FORMATS as string[]).includes(f),
    );
    if (valid.length === 0) {
      throw new RenderError("UNSUPPORTED_FORMAT", "No valid output formats provided");
    }
    return valid;
  }
  if (typeof raw === "string" && (SUPPORTED_FORMATS as string[]).includes(raw)) {
    return [raw as OutputFormat];
  }
  throw new RenderError("UNSUPPORTED_FORMAT", `formats must be an array of: ${SUPPORTED_FORMATS.join(", ")}`);
}

function parseSource(body: Record<string, unknown>): UniversalRenderRequest["source"] {
  const { source } = body;
  if (!source || typeof source !== "object") {
    throw new RenderError("SVG_CONTENT_MISSING", "request.source is required");
  }
  const s = source as Record<string, unknown>;
  if (s["kind"] !== "svg") {
    throw new RenderError("UNSUPPORTED_FORMAT", `source.kind must be "svg"`);
  }
  if (typeof s["svgContent"] !== "string" || (s["svgContent"] as string).trim().length === 0) {
    throw new RenderError("SVG_CONTENT_MISSING", "source.svgContent must be a non-empty string");
  }
  const w = Number(s["canvasWidth"]);
  const h = Number(s["canvasHeight"]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
    throw new RenderError("CANVAS_LIMIT_EXCEEDED", "source.canvasWidth and canvasHeight must be positive numbers");
  }
  if (w > UNIVERSAL_RENDER_LIMITS.MAX_CANVAS_WIDTH || h > UNIVERSAL_RENDER_LIMITS.MAX_CANVAS_HEIGHT) {
    throw new RenderError(
      "CANVAS_LIMIT_EXCEEDED",
      `Canvas ${w}×${h} exceeds maximum ${UNIVERSAL_RENDER_LIMITS.MAX_CANVAS_WIDTH}×${UNIVERSAL_RENDER_LIMITS.MAX_CANVAS_HEIGHT}`,
    );
  }
  if (w * h > UNIVERSAL_RENDER_LIMITS.MAX_CANVAS_PIXELS) {
    throw new RenderError(
      "CANVAS_LIMIT_EXCEEDED",
      `Canvas total pixels ${w * h} exceeds limit ${UNIVERSAL_RENDER_LIMITS.MAX_CANVAS_PIXELS}`,
    );
  }
  return {
    kind:         "svg",
    svgContent:   s["svgContent"] as string,
    canvasWidth:  w,
    canvasHeight: h,
  };
}

// ── GET /ai/universal-renderer/formats ────────────────────────────────────────

router.get("/ai/universal-renderer/formats", (_req, res): void => {
  res.json({ formats: SUPPORTED_FORMATS });
});

// ── GET /ai/universal-renderer/health ─────────────────────────────────────────

router.get("/ai/universal-renderer/health", (_req, res): void => {
  res.json({
    status:      "ok",
    renderer:    "universal-renderer-v1",
    limits: {
      maxPayloadMB:  UNIVERSAL_RENDER_LIMITS.MAX_PAYLOAD_BYTES / (1024 * 1024),
      maxCanvasW:    UNIVERSAL_RENDER_LIMITS.MAX_CANVAS_WIDTH,
      maxCanvasH:    UNIVERSAL_RENDER_LIMITS.MAX_CANVAS_HEIGHT,
      maxRenderMs:   UNIVERSAL_RENDER_LIMITS.MAX_RENDER_DURATION_MS,
    },
  });
});

// ── POST /ai/universal-renderer/render ───────────────────────────────────────

router.post("/ai/universal-renderer/render", async (req, res): Promise<void> => {
  let renderReq: UniversalRenderRequest;
  try {
    assertPayloadSize(req);
    const body    = req.body as Record<string, unknown>;
    const source  = parseSource(body);
    const formats = parseFormats(body["formats"]);
    renderReq = {
      source,
      formats,
      previewMode:   Boolean(body["previewMode"]),
      storagePrefix: typeof body["storagePrefix"] === "string" ? body["storagePrefix"] : undefined,
      packageName:   typeof body["packageName"]   === "string" ? body["packageName"]  : undefined,
      metadata: {
        title:   typeof body["title"]   === "string" ? body["title"]   : undefined,
        creator: typeof body["creator"] === "string" ? body["creator"] : undefined,
      },
    };
  } catch (err) {
    const msg  = err instanceof Error ? err.message : String(err);
    const code = err instanceof RenderError ? err.code : "VALIDATION_ERROR";
    res.status(400).json({ error: msg, code });
    return;
  }

  try {
    const renderer = getUniversalRenderer();
    const result   = await renderer.render(renderReq);

    await logAudit({
      actorType:  "system",
      actorId:    "api",
      action:     "universal_render",
      entityType: "render",
      entityId:   result.requestId,
      status:     "success",
      details: {
        formats:       renderReq.formats,
        artifactCount: result.artifacts.length,
        durationMs:    result.durationMs,
        cached:        result.cached ?? false,
        artifacts: result.artifacts.map((a) => ({
          format:    a.format,
          mimeType:  a.mimeType,
          sizeBytes: a.fileSizeBytes,
          path:      storage.redact(a.storagePath),
        })),
      },
    });

    res.status(200).json(result);
  } catch (err) {
    const msg  = err instanceof Error ? err.message : String(err);
    const code = err instanceof RenderError ? err.code : "RENDER_FAILED";
    logger.error({ err, code }, "[universal-renderer] Render failed");

    await logAudit({
      actorType:  "system",
      actorId:    "api",
      action:     "universal_render",
      entityType: "render",
      entityId:   "unknown",
      status:     "failure",
      details:    { error: msg, code },
    });

    const clientErrors = new Set([
      "CANVAS_LIMIT_EXCEEDED", "SVG_CONTENT_MISSING", "UNSUPPORTED_FORMAT",
      "SVG_SANITISE_FAILED", "SVG_TOO_LARGE", "PAYLOAD_TOO_LARGE", "SSRF_BLOCKED",
    ]);
    const status = clientErrors.has(code) ? 400 : 500;
    res.status(status).json({ error: msg, code });
  }
});

// ── POST /ai/universal-renderer/render/async ─────────────────────────────────

router.post("/ai/universal-renderer/render/async", async (req, res): Promise<void> => {
  let renderReq: UniversalRenderRequest;
  try {
    assertPayloadSize(req);
    const body    = req.body as Record<string, unknown>;
    const source  = parseSource(body);
    const formats = parseFormats(body["formats"]);
    renderReq = {
      source,
      formats,
      previewMode:   Boolean(body["previewMode"]),
      storagePrefix: typeof body["storagePrefix"] === "string" ? body["storagePrefix"] : undefined,
      packageName:   typeof body["packageName"]   === "string" ? body["packageName"]  : undefined,
      metadata: {
        title:   typeof body["title"]   === "string" ? body["title"]   : undefined,
        creator: typeof body["creator"] === "string" ? body["creator"] : undefined,
      },
    };
  } catch (err) {
    const msg  = err instanceof Error ? err.message : String(err);
    const code = err instanceof RenderError ? err.code : "VALIDATION_ERROR";
    res.status(400).json({ error: msg, code });
    return;
  }

  try {
    const renderer = getUniversalRenderer();
    const job      = await renderer.enqueueRender(renderReq);

    await logAudit({
      actorType:  "system",
      actorId:    "api",
      action:     "universal_render_enqueue",
      entityType: "job",
      entityId:   String(job.jobId),
      status:     "success",
      details:    { formats: renderReq.formats, jobCode: job.jobCode },
    });

    res.status(202).json({ jobId: job.jobId, jobCode: job.jobCode });
  } catch (err) {
    const msg  = err instanceof Error ? err.message : String(err);
    const code = err instanceof RenderError ? err.code : "ENQUEUE_FAILED";
    logger.error({ err, code }, "[universal-renderer] Enqueue failed");
    res.status(500).json({ error: msg, code });
  }
});

export default router;
