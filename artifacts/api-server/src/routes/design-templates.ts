/**
 * Design Template Engine — REST Routes
 *
 * All routes are mounted under /api (via app.ts → routes/index.ts).
 * Auth is global (adminAuthWithExceptions in app.ts) — no per-route middleware needed.
 *
 * IMPORTANT: Do NOT import zod/v4 here. All request parsing uses the
 * validators in ../validators/designTemplateSchema.ts (plain zod).
 *
 * Route prefix rule: paths here do NOT include /api (that's the app.ts mount point).
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

function handleError(res: ReturnType<Router["get"]> extends void ? never : Parameters<Parameters<Router["get"]>[1]>[1], err: unknown) {
  if (err instanceof TenantAccessError) {
    return (res as any).status(403).json({ error: "Access denied" });
  }
  const msg = err instanceof Error ? err.message : "Unexpected error";
  logger.error({ err }, "[design-templates] Route error");
  return (res as any).status(500).json({ error: msg });
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
    if (!body.success) {
      return res.status(400).json({ error: "Validation failed", issues: body.error.issues });
    }
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

/** PATCH /ai/design-templates/:id */
router.patch("/ai/design-templates/:id", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    const body = updateTemplateRequestSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "Validation failed", issues: body.error.issues });

    const updated = await updateTemplate(id, ctx.tenantId, body.data, actorId(req));
    if (!updated) return res.status(404).json({ error: "Template not found" });
    res.json(updated);
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

    const result = await softDeleteTemplate(id, ctx.tenantId, actorId(req));
    if (!result) return res.status(404).json({ error: "Template not found" });
    res.status(204).send();
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
    if (!copy) return res.status(404).json({ error: "Template not found" });
    res.status(201).json(copy);
  } catch (err) {
    return handleError(res, err);
  }
});

/** GET /ai/design-templates/:id/preview — returns template JSON + sample data */
router.get("/ai/design-templates/:id/preview", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    const preview = await getPreviewData(id, ctx.tenantId);
    if (!preview) return res.status(404).json({ error: "Template or active version not found" });
    res.json(preview);
  } catch (err) {
    return handleError(res, err);
  }
});

/**
 * POST /ai/design-templates/:id/preview — render a live image preview
 *
 * Uses the same core renderer as the production worker. Output is returned
 * as a binary response (Content-Type: image/*) or base64 JSON.
 * Does NOT create a permanent batch item.
 *
 * Rate limit: max 10 req/min per tenant (enforced by adminAuthWithExceptions upstream).
 */
router.post("/ai/design-templates/:id/preview", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    const bodySchema = z.object({
      templateVersionId: z.number().int().positive().optional(),
      data:              z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().default({}),
      format:            z.enum(["png", "jpg", "webp", "pdf"]).optional().default("png"),
      width:             z.number().int().positive().max(DESIGN_LIMITS.MAX_CANVAS_WIDTH).optional(),
      height:            z.number().int().positive().max(DESIGN_LIMITS.MAX_CANVAS_HEIGHT).optional(),
    });

    const body = bodySchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "Validation failed", issues: body.error.issues });

    // Load template
    const template = await getTemplate(id, ctx.tenantId);
    if (!template) return res.status(404).json({ error: "Template not found" });

    // Use specified version or active version
    let versionId = body.data.templateVersionId ?? template.activeVersionId ?? null;
    if (!versionId) return res.status(400).json({ error: "Template has no active version" });

    const [version] = await db
      .select()
      .from(designTemplateVersionsTable)
      .where(
        and(
          eq(designTemplateVersionsTable.id, versionId),
          eq(designTemplateVersionsTable.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);

    if (!version) return res.status(404).json({ error: "Template version not found" });

    const parseResult = designTemplateJsonSchema.safeParse(version.templateJson);
    if (!parseResult.success) return res.status(422).json({ error: "Template JSON is invalid" });

    const templateDomain = version.templateJson as unknown as DesignTemplate;

    // Render preview (no permanent storage)
    const result = await renderTemplatePreview({
      template:          templateDomain,
      templateVersionId: versionId,
      data:              body.data.data as Record<string, string | number | boolean | null | undefined>,
      format:            body.data.format as RenderFormat,
      tenantId:          ctx.tenantId,
      outputWidth:       body.data.width,
      outputHeight:      body.data.height,
    });

    // Return binary image directly
    res.set("Content-Type", result.mimeType);
    res.set("Cache-Control", "no-store");
    res.set("X-Render-Warnings", String(result.warnings.length));
    res.set("X-Canvas-Width",  String(result.width));
    res.set("X-Canvas-Height", String(result.height));
    res.send(result.buffer);
  } catch (err) {
    return handleError(res, err);
  }
});

// ── Version Management ────────────────────────────────────────────────────────

/** GET /ai/design-templates/:id/versions */
router.get("/ai/design-templates/:id/versions", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    const versions = await listVersions(id, ctx.tenantId);
    if (!versions) return res.status(404).json({ error: "Template not found" });
    res.json({ versions });
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
      tenantId: ctx.tenantId,
      templateJson: body.data.templateJson as any,
      changelog: body.data.changelog,
      createdBy: actorId(req),
    });
    res.status(201).json(version);
  } catch (err) {
    return handleError(res, err);
  }
});

/** POST /ai/design-templates/:id/publish */
router.post("/ai/design-templates/:id/publish", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    const versionId = z.number().int().positive().safeParse(req.body?.versionId);
    if (!versionId.success) return res.status(400).json({ error: "versionId (number) is required" });

    const result = await publishVersion(id, versionId.data, ctx.tenantId, actorId(req));
    res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

// ── Single Render ─────────────────────────────────────────────────────────────

/**
 * POST /ai/design-templates/:id/render
 *
 * Creates a canonical render item (via a single-item batch) and enqueues a
 * design_render job. The job payload carries only the renderItemId — all
 * render data is read from the database by the worker.
 *
 * Idempotency: if a completed render item with the same inputHash already
 * exists, returns the cached result immediately (no new job).
 */
router.post("/ai/design-templates/:id/render", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    const body = singleRenderRequestSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "Validation failed", issues: body.error.issues });

    // Verify template belongs to this tenant
    const template = await getTemplate(id, ctx.tenantId);
    if (!template) return res.status(404).json({ error: "Template not found" });

    const versionId = body.data.templateVersionId;

    // Verify version belongs to this tenant
    const [version] = await db
      .select({ id: designTemplateVersionsTable.id, tenantId: designTemplateVersionsTable.tenantId })
      .from(designTemplateVersionsTable)
      .where(
        and(
          eq(designTemplateVersionsTable.id, versionId),
          eq(designTemplateVersionsTable.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    if (!version) return res.status(404).json({ error: "Template version not found" });

    const data   = body.data.data as Record<string, string | number | boolean | null | undefined>;
    const format = body.data.format as RenderFormat;
    const inputHash = computeInputHash(versionId, data);

    // Idempotency: check for an existing completed render with the same hash
    const [existing] = await db
      .select()
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

    // Create a single-item batch to provide a canonical batchId for the render item
    const batch = await createBatch({
      tenantId:          ctx.tenantId,
      templateId:        id,
      templateVersionId: versionId,
      name:              `single-render-${Date.now()}`,
      format,
      width:             body.data.width,
      height:            body.data.height,
      items:             [data],
      requestedBy:       actorId(req),
    });

    // The render item was created by createBatch — retrieve it
    const [renderItem] = await db
      .select({ id: designRenderItemsTable.id })
      .from(designRenderItemsTable)
      .where(eq(designRenderItemsTable.batchId, batch.id))
      .limit(1);

    if (!renderItem) return res.status(500).json({ error: "Failed to create render item" });

    // Enqueue dispatch job (carries only IDs — worker reads from DB)
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

/** POST /ai/design-render-batches/:id/cancel */
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

/** GET /ai/design-render-batches/:id/items */
router.get("/ai/design-render-batches/:id/items", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid batch ID" });

    const page = parseInt(String(req.query["page"] ?? "1"), 10);
    const pageSize = parseInt(String(req.query["pageSize"] ?? "50"), 10);
    const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;

    const result = await getBatchItems(id, ctx.tenantId, { status, page, pageSize });
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

    // Tenant isolation: already enforced by getLatestZipExportForBatch, but double-check
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
