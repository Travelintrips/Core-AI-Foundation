/**
 * Design Template Engine — REST Routes (Phase 3A)
 *
 * All routes are mounted under /api (via app.ts → routes/index.ts).
 * Auth is global (adminAuthWithExceptions in app.ts) — no per-route middleware needed.
 *
 * IMPORTANT: Do NOT import zod/v4 here. All request parsing uses the
 * validators in ../validators/designTemplateSchema.ts (plain zod).
 *
 * Route prefix rule: paths here do NOT include /api (that's the app.ts mount point).
 *
 * Phase 3A additions:
 *   - GET /ai/design-render-batches/:id/progress — real progress with counts + progressPercent
 *   - GET /ai/design-render-batches/:id/items    — cursor-based pagination, status/errorCode/rowIndex filters
 *   - POST /ai/design-render-batches/:id/cancel  — idempotent, uses lifecycle state machine
 */

import { Router } from "express";
import { z } from "zod";
import {
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  softDeleteTemplate,
  duplicateTemplate,
  createVersion,
  listVersions,
  getVersion,
  publishVersion,
  getPreviewData,
} from "../services/designTemplateService.js";
import {
  createBatch,
  getBatch,
  listBatches,
  getBatchItems,
  startBatch,
  cancelBatch,
  retryFailedItems,
  reconcileDesignRenderBatch,
} from "../services/designRenderBatchService.js";
import { enqueue } from "../services/queueManagerService.js";
import { resolveAuthenticatedTenantContext } from "../security/tenantResolution.js";
import {
  createTemplateRequestSchema,
  updateTemplateRequestSchema,
  createVersionRequestSchema,
  singleRenderRequestSchema,
  createBatchRequestSchema,
  designTemplateJsonSchema,
} from "../validators/designTemplateSchema.js";
import { TenantAccessError } from "../services/designTemplateVariableService.js";
import { BatchLifecycleError } from "../services/design-batch/batchLifecycle.js";
import { logger } from "../lib/logger.js";
import { renderTemplatePreview } from "../services/design-renderer/index.js";
import { validateOutputDimensions } from "../services/design-renderer/outputEncoder.js";
import type { DesignTemplate, RenderFormat } from "../types/designTemplate.js";
import { DESIGN_LIMITS } from "../types/designTemplate.js";
import { db } from "@workspace/db";
import {
  designRenderItemsTable,
  designTemplateVersionsTable,
} from "@workspace/db";
import { computeInputHash } from "../services/designTemplateVariableService.js";
import { eq, and } from "drizzle-orm";
import type { NewDesignRenderItem } from "@workspace/db";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function actorId(req: Parameters<typeof resolveAuthenticatedTenantContext>[0]): string {
  return req.internalUser ? String(req.internalUser.id) : "system";
}

function handleError(res: any, err: unknown) {
  if (err instanceof TenantAccessError) {
    return res.status(403).json({ error: "Access denied" });
  }
  if (err instanceof BatchLifecycleError) {
    return res.status(409).json({
      error: "Invalid batch state transition",
      currentStatus: err.currentStatus,
      attemptedStatus: err.attemptedStatus,
    });
  }
  const msg = err instanceof Error ? err.message : "Unexpected error";
  logger.error({ err }, "[design-templates] Route error");
  return res.status(500).json({ error: msg });
}

// ── Template Library ──────────────────────────────────────────────────────────

/** GET /ai/design-templates */
router.get("/ai/design-templates", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const page = parseInt(String(req.query["page"] ?? "1"), 10);
    const pageSize = parseInt(String(req.query["pageSize"] ?? "20"), 10);
    const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
    const category = typeof req.query["category"] === "string" ? req.query["category"] : undefined;

    const result = await listTemplates(ctx.tenantId, { status, category, page, pageSize });
    res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

/** POST /ai/design-templates */
router.post("/ai/design-templates", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const body = createTemplateRequestSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "Validation failed", issues: body.error.issues });

    const template = await createTemplate({ ...body.data, tenantId: ctx.tenantId, createdBy: actorId(req) });
    res.status(201).json(template);
  } catch (err) {
    return handleError(res, err);
  }
});

/** GET /ai/design-templates/:id */
router.get("/ai/design-templates/:id", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    const template = await getTemplate(id, ctx.tenantId);
    if (!template) return res.status(404).json({ error: "Template not found" });
    res.json(template);
  } catch (err) {
    return handleError(res, err);
  }
});

/** PUT /ai/design-templates/:id */
router.put("/ai/design-templates/:id", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    const body = updateTemplateRequestSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "Validation failed", issues: body.error.issues });

    const template = await updateTemplate(id, ctx.tenantId, body.data, actorId(req));
    if (!template) return res.status(404).json({ error: "Template not found" });
    res.json(template);
  } catch (err) {
    return handleError(res, err);
  }
});

/** DELETE /ai/design-templates/:id */
router.delete("/ai/design-templates/:id", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    await softDeleteTemplate(id, ctx.tenantId, actorId(req));
    res.status(204).end();
  } catch (err) {
    return handleError(res, err);
  }
});

/** POST /ai/design-templates/:id/duplicate */
router.post("/ai/design-templates/:id/duplicate", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    const copy = await duplicateTemplate(id, ctx.tenantId, actorId(req));
    res.status(201).json(copy);
  } catch (err) {
    return handleError(res, err);
  }
});

// ── Template Versions ─────────────────────────────────────────────────────────

/** GET /ai/design-templates/:id/versions */
router.get("/ai/design-templates/:id/versions", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    const versions = await listVersions(id, ctx.tenantId);
    res.json(versions);
  } catch (err) {
    return handleError(res, err);
  }
});

/** POST /ai/design-templates/:id/versions */
router.post("/ai/design-templates/:id/versions", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    const body = createVersionRequestSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "Validation failed", issues: body.error.issues });

    const version = await createVersion({
      templateId: id,
      tenantId:   ctx.tenantId,
      templateJson: body.data.templateJson as unknown as DesignTemplate,
      changelog:  body.data.changelog,
      createdBy:  actorId(req),
    });
    res.status(201).json(version);
  } catch (err) {
    return handleError(res, err);
  }
});

/** GET /ai/design-templates/:id/versions/:versionId */
router.get("/ai/design-templates/:id/versions/:versionId", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    const versionId = parseInt(String(req.params["versionId"]), 10);
    if (isNaN(id) || isNaN(versionId)) return res.status(400).json({ error: "Invalid ID" });

    const version = await getVersion(versionId, ctx.tenantId);
    if (!version || version.templateId !== id) return res.status(404).json({ error: "Version not found" });
    res.json(version);
  } catch (err) {
    return handleError(res, err);
  }
});

/** POST /ai/design-templates/:id/versions/:versionId/publish */
router.post("/ai/design-templates/:id/versions/:versionId/publish", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    const versionId = parseInt(String(req.params["versionId"]), 10);
    if (isNaN(id) || isNaN(versionId)) return res.status(400).json({ error: "Invalid ID" });

    const version = await publishVersion(id, versionId, ctx.tenantId, actorId(req));
    res.json(version);
  } catch (err) {
    return handleError(res, err);
  }
});

// ── Single Render ─────────────────────────────────────────────────────────────

/** POST /ai/design-templates/:id/preview */
router.post("/ai/design-templates/:id/preview", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    const body = singleRenderRequestSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "Validation failed", issues: body.error.issues });

    const previewData = await getPreviewData(id, ctx.tenantId);
    if (!previewData) return res.status(404).json({ error: "Template or version not found" });

    const format = (body.data.format ?? "png") as RenderFormat;
    const outputWidth  = typeof body.data.data?.["width"]  === "number" ? (body.data.data["width"]  as number) : undefined;
    const outputHeight = typeof body.data.data?.["height"] === "number" ? (body.data.data["height"] as number) : undefined;

    const t0Preview = Date.now();
    const result = await renderTemplatePreview({
      template:          previewData.template as unknown as DesignTemplate,
      templateVersionId: previewData.version.id,
      data:              body.data.data ?? {},
      format,
      tenantId:          ctx.tenantId,
      outputWidth,
      outputHeight,
    });
    const previewDurationMs = Date.now() - t0Preview;

    res.set("Content-Type", result.mimeType);
    res.set("Content-Length", String(result.buffer.length));
    res.set("X-Render-Duration-Ms", String(previewDurationMs));
    if (result.warnings.length > 0) {
      res.set("X-Render-Warnings", JSON.stringify(result.warnings.map((w) => w.code)));
    }
    res.send(result.buffer);
  } catch (err) {
    return handleError(res, err);
  }
});

/** POST /ai/design-templates/:id/render */
router.post("/ai/design-templates/:id/render", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    const body = singleRenderRequestSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "Validation failed", issues: body.error.issues });

    const previewData = await getPreviewData(id, ctx.tenantId);
    if (!previewData) return res.status(404).json({ error: "Template or version not found" });

    const format = (body.data.format ?? "png") as RenderFormat;
    const data = body.data.data ?? {};
    const versionId = previewData.version.id;

    // Idempotency check
    const inputHash = computeInputHash(versionId, data);
    const [existing] = await db
      .select({ id: designRenderItemsTable.id, status: designRenderItemsTable.status, outputUrl: designRenderItemsTable.outputUrl })
      .from(designRenderItemsTable)
      .where(
        and(
          eq(designRenderItemsTable.templateVersionId, versionId),
          eq(designRenderItemsTable.tenantId, ctx.tenantId),
          eq(designRenderItemsTable.inputHash, inputHash),
          eq(designRenderItemsTable.status, "completed"),
        ),
      )
      .limit(1);

    if (existing?.outputUrl) {
      return res.status(200).json({
        renderItemId: existing.id,
        status: "completed",
        outputUrl: existing.outputUrl,
        cached: true,
      });
    }

    const batch = await createBatch({
      tenantId:          ctx.tenantId,
      templateId:        id,
      templateVersionId: versionId,
      name:              `single-render-${Date.now()}`,
      format,
      width:             typeof body.data.data?.["width"]  === "number" ? (body.data.data["width"]  as number) : undefined,
      height:            typeof body.data.data?.["height"] === "number" ? (body.data.data["height"] as number) : undefined,
      items:             [data],
      requestedBy:       actorId(req),
    });

    const [renderItem] = await db
      .select({ id: designRenderItemsTable.id })
      .from(designRenderItemsTable)
      .where(eq(designRenderItemsTable.batchId, batch.id))
      .limit(1);

    if (!renderItem) return res.status(500).json({ error: "Failed to create render item" });

    const job = await enqueue({
      jobType:     "design_render_batch_dispatch",
      payloadJson: { batchId: batch.id, tenantId: ctx.tenantId },
      priority:    60,
      tenantId:    ctx.tenantId,
    });

    res.status(202).json({
      jobId:        job.id,
      batchId:      batch.id,
      renderItemId: renderItem.id,
      status:       "queued",
    });
  } catch (err) {
    return handleError(res, err);
  }
});

// ── Batch Rendering ───────────────────────────────────────────────────────────

/** GET /ai/design-render-batches */
router.get("/ai/design-render-batches", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const page = parseInt(String(req.query["page"] ?? "1"), 10);
    const pageSize = parseInt(String(req.query["pageSize"] ?? "20"), 10);
    const templateId = req.query["templateId"] ? parseInt(String(req.query["templateId"]), 10) : undefined;
    const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;

    const result = await listBatches(ctx.tenantId, { templateId, status, page, pageSize });
    res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

/** POST /ai/design-render-batches */
router.post("/ai/design-render-batches", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const body = createBatchRequestSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "Validation failed", issues: body.error.issues });

    const batch = await createBatch({
      ...body.data,
      tenantId: ctx.tenantId,
      requestedBy: actorId(req),
    });
    res.status(201).json(batch);
  } catch (err) {
    return handleError(res, err);
  }
});

/** GET /ai/design-render-batches/:id */
router.get("/ai/design-render-batches/:id", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid batch ID" });

    const batch = await getBatch(id, ctx.tenantId);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    res.json(batch);
  } catch (err) {
    return handleError(res, err);
  }
});

/**
 * GET /ai/design-render-batches/:id/progress
 * Phase 3A: accurate progress endpoint with counts and progressPercent.
 * Runs a live reconciliation before responding.
 */
router.get("/ai/design-render-batches/:id/progress", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid batch ID" });

    // Verify batch exists and belongs to tenant
    const batch = await getBatch(id, ctx.tenantId);
    if (!batch) return res.status(404).json({ error: "Batch not found" });

    const summary = await reconcileDesignRenderBatch(ctx.tenantId, id);
    res.json({
      batchId: summary.batchId,
      status:  summary.status,
      counts:  summary.counts,
      progressPercent: summary.progressPercent,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

/** POST /ai/design-render-batches/:id/start */
router.post("/ai/design-render-batches/:id/start", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid batch ID" });

    const result = await startBatch(id, ctx.tenantId, actorId(req));
    res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

/** POST /ai/design-render-batches/:id/cancel (idempotent) */
router.post("/ai/design-render-batches/:id/cancel", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid batch ID" });

    const result = await cancelBatch(id, ctx.tenantId, actorId(req));
    res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

/** POST /ai/design-render-batches/:id/retry-failed */
router.post("/ai/design-render-batches/:id/retry-failed", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid batch ID" });

    const result = await retryFailedItems(id, ctx.tenantId, actorId(req));
    res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

/**
 * GET /ai/design-render-batches/:id/items
 *
 * Phase 3A: cursor-based pagination, status filter, errorCode filter, rowIndex filter.
 *
 * Query params:
 *   status     — filter by item status
 *   errorCode  — filter by errorCode
 *   rowIndex   — filter by exact row index
 *   cursor     — item ID cursor (for cursor-based pagination)
 *   limit      — max items per page (default 50, max 200)
 */
router.get("/ai/design-render-batches/:id/items", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid batch ID" });

    const cursor = req.query["cursor"] ? parseInt(String(req.query["cursor"]), 10) : undefined;
    const limit  = req.query["limit"]  ? parseInt(String(req.query["limit"]),  10) : 50;
    const status    = typeof req.query["status"]    === "string" ? req.query["status"]    : undefined;
    const errorCode = typeof req.query["errorCode"] === "string" ? req.query["errorCode"] : undefined;
    const rowIndex  = req.query["rowIndex"] !== undefined ? parseInt(String(req.query["rowIndex"]), 10) : undefined;

    const result = await getBatchItems(id, ctx.tenantId, {
      status,
      errorCode,
      rowIndex:  rowIndex !== undefined && !isNaN(rowIndex) ? rowIndex : undefined,
      cursor:    cursor !== undefined && !isNaN(cursor) ? cursor : undefined,
      limit:     Math.min(Math.max(1, isNaN(limit) ? 50 : limit), 200),
    });
    if (!result) return res.status(404).json({ error: "Batch not found" });
    res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

/**
 * POST /ai/design-render-batches/:id/export-zip
 *
 * Enqueue a ZIP export for the batch. Idempotent — returns existing export
 * if the fingerprint matches an already-completed export.
 */
router.post("/ai/design-render-batches/:id/export-zip", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid batch ID" });

    const batch = await getBatch(id, ctx.tenantId);
    if (!batch) return res.status(404).json({ error: "Batch not found" });

    const { enqueueZipExport } = await import("../services/designZipExportService.js");
    const zipExport = await enqueueZipExport(id, ctx.tenantId);

    // If already completed (fingerprint match), no job needed — just return it
    if (zipExport.status === "completed") {
      return res.status(200).json({
        exportId: zipExport.id,
        batchId: zipExport.batchId,
        status: zipExport.status,
        sourceFingerprint: zipExport.sourceFingerprint,
        fileSizeBytes: zipExport.fileSizeBytes,
        createdAt: zipExport.createdAt,
        updatedAt: zipExport.updatedAt,
      });
    }

    // If newly queued, enqueue the worker job
    if (zipExport.status === "queued") {
      await enqueue({
        jobType: "design_render_zip_export",
        payloadJson: { exportId: zipExport.id, tenantId: ctx.tenantId, batchId: id },
        priority: 50,
        maxRetry: 2,
        retryStrategy: "exponential",
        tenantId: ctx.tenantId,
      });
    }

    return res.status(202).json({
      exportId: zipExport.id,
      batchId: zipExport.batchId,
      status: zipExport.status,
      sourceFingerprint: zipExport.sourceFingerprint,
      createdAt: zipExport.createdAt,
      updatedAt: zipExport.updatedAt,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

/**
 * GET /ai/design-render-batches/:id/export-zip
 *
 * Poll status of the latest ZIP export for this batch.
 * Includes a signed download URL only when the export is completed AND the
 * request is authenticated — the URL is generated on demand, never stored.
 */
router.get("/ai/design-render-batches/:id/export-zip", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid batch ID" });

    const batch = await getBatch(id, ctx.tenantId);
    if (!batch) return res.status(404).json({ error: "Batch not found" });

    const { getLatestZipExportForBatch, generateZipDownloadToken } = await import(
      "../services/designZipExportService.js"
    );
    const zipExport = await getLatestZipExportForBatch(id, ctx.tenantId);
    if (!zipExport) {
      return res.status(404).json({ error: "No ZIP export found for this batch" });
    }

    if (zipExport.tenantId !== ctx.tenantId) {
      return res.status(403).json({ error: "Access denied" });
    }

    let signedUrl: string | undefined;
    let signedUrlExpiresAt: string | undefined;
    if (zipExport.status === "completed" && zipExport.zipStoragePath) {
      const token = generateZipDownloadToken(zipExport.id, ctx.tenantId);
      signedUrl = `/api/ai/design-zip-exports/${zipExport.id}/download?token=${token}`;
      signedUrlExpiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    }

    return res.json({
      exportId: zipExport.id,
      batchId: zipExport.batchId,
      status: zipExport.status,
      sourceFingerprint: zipExport.sourceFingerprint,
      fileSizeBytes: zipExport.fileSizeBytes,
      manifestJson: zipExport.manifestJson,
      errorMessage: zipExport.errorMessage,
      retryCount: zipExport.retryCount,
      signedUrl: signedUrl ?? null,
      signedUrlExpiresAt: signedUrlExpiresAt ?? null,
      createdAt: zipExport.createdAt,
      updatedAt: zipExport.updatedAt,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

export default router;
