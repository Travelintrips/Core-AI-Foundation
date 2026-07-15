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
} from "../validators/designTemplateSchema.js";
import { TenantAccessError } from "../services/designTemplateVariableService.js";
import { logger } from "../lib/logger.js";

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

/** GET /ai/design-templates/:id/preview */
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

/** POST /ai/design-templates/:id/render */
router.post("/ai/design-templates/:id/render", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    const body = singleRenderRequestSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "Validation failed", issues: body.error.issues });

    // Verify the template belongs to this tenant
    const template = await getTemplate(id, ctx.tenantId);
    if (!template) return res.status(404).json({ error: "Template not found" });

    const job = await enqueue({
      jobType: "design_render",
      payloadJson: {
        templateId: id,
        templateVersionId: body.data.templateVersionId,
        format: body.data.format,
        data: body.data.data,
        idempotencyKey: body.data.idempotencyKey,
        width: body.data.width,
        height: body.data.height,
        tenantId: ctx.tenantId,
      },
      priority: 60,
      tenantId: ctx.tenantId,
    });

    res.status(202).json({ jobId: job.id, status: "queued" });
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

/** POST /ai/design-render-batches/:id/export-zip */
router.post("/ai/design-render-batches/:id/export-zip", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid batch ID" });

    const batch = await getBatch(id, ctx.tenantId);
    if (!batch) return res.status(404).json({ error: "Batch not found" });

    const job = await enqueue({
      jobType: "design_render_zip_export",
      payloadJson: { batchId: id, tenantId: ctx.tenantId },
      priority: 40,
      tenantId: ctx.tenantId,
    });

    res.status(202).json({ jobId: job.id, status: "queued" });
  } catch (err) {
    return handleError(res, err);
  }
});

export default router;
