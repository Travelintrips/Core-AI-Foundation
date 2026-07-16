/**
 * Design Template Engine — Render Worker Service (Phase 3A)
 *
 * Three job types handled here:
 *   design_render              — single item SVG→PNG/JPG/WebP/PDF pipeline
 *   design_render_batch_dispatch — fan-out via production batchDispatcher
 *   design_render_zip_export   — Phase 3 stub (clearly marked)
 *
 * Phase 3A additions:
 *   - Processing lease set at claim time (lease_expires_at, worker_id, heartbeat_at)
 *   - Cooperative cancellation checks use "cancelling" status as well as "cancelled"
 *   - executeDesignRenderBatchDispatch now delegates to batchDispatcher
 */

import { eq, and, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  designRenderItemsTable,
  designRenderBatchesTable,
  designTemplateVersionsTable,
} from "@workspace/db";
import { reconcileDesignRenderBatch } from "./designRenderBatchService.js";
import { logAudit } from "./aiAuditService.js";
import { logger } from "../lib/logger.js";
import type { AiJob } from "@workspace/db";
import {
  renderTemplate,
  RenderError,
  isRetryable,
  toErrorCode,
  sanitiseErrorMessage,
} from "./design-renderer/index.js";
import { AssetCache } from "./design-renderer/assetCache.js";
import { renderConfig } from "./design-renderer/config.js";
import { batchConfig } from "./design-batch/config.js";
import type { DesignTemplate, RenderFormat } from "../types/designTemplate.js";
import { designTemplateJsonSchema } from "../validators/designTemplateSchema.js";

// ── design_render ─────────────────────────────────────────────────────────────

/**
 * Execute a single design_render job.
 *
 * Job payload (minimal — source of truth is the database):
 *   { tenantId: string; renderItemId: number; batchId?: number }
 *
 * Flow:
 *   atomic claim item + set lease → load template version → render → upload → complete item → reconcile batch
 */
export async function executeDesignRenderJob(
  job: AiJob,
  workerId: number,
): Promise<Record<string, unknown>> {
  const payload = job.payloadJson as {
    tenantId: string;
    renderItemId: number;
    batchId?: number;
  };

  const { tenantId, renderItemId, batchId } = payload;
  const workerIdStr = String(workerId);

  if (!renderItemId) {
    throw new RenderError("RENDER_ITEM_NOT_FOUND", "Job payload missing renderItemId");
  }

  const leaseExpiresAt = new Date(Date.now() + batchConfig.processingLeaseMs);

  // ── 1. Atomic claim: increment attempt_count + set lease WHERE still claimable ──
  const claimed = await db
    .update(designRenderItemsTable)
    .set({
      status:           "processing",
      attemptCount:     sql`attempt_count + 1`,
      startedAt:        new Date(),
      workerId:         workerIdStr,
      leaseExpiresAt,
      heartbeatAt:      new Date(),
      dispatchStatus:   "dispatched",
    })
    .where(
      and(
        eq(designRenderItemsTable.id, renderItemId),
        eq(designRenderItemsTable.tenantId, tenantId),
        // Accept queued OR processing (batch dispatch already set to processing)
        sql`status IN ('queued', 'processing')`,
      ),
    )
    .returning();

  if (claimed.length === 0) {
    // Check if already completed (idempotent re-delivery)
    const existing = await db
      .select({ status: designRenderItemsTable.status, outputUrl: designRenderItemsTable.outputUrl })
      .from(designRenderItemsTable)
      .where(eq(designRenderItemsTable.id, renderItemId))
      .limit(1);

    if (existing[0]?.status === "completed" && existing[0]?.outputUrl) {
      logger.info({ jobId: job.id, renderItemId }, "[design-render] Item already completed — idempotent skip");
      return { renderItemId, status: "already_completed", outputUrl: existing[0].outputUrl };
    }

    throw new RenderError("RENDER_ITEM_ALREADY_CLAIMED", `Render item ${renderItemId} is not in a claimable state`);
  }

  const item = claimed[0]!;

  // ── 2. Load template version (immutable source of truth) ──────────────────
  const versions = await db
    .select()
    .from(designTemplateVersionsTable)
    .where(
      and(
        eq(designTemplateVersionsTable.id, item.templateVersionId),
        eq(designTemplateVersionsTable.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!versions[0]) {
    await failItem(item.id, tenantId, batchId, "TEMPLATE_VERSION_NOT_FOUND", "Template version not found", false, workerIdStr);
    throw new RenderError("TEMPLATE_VERSION_NOT_FOUND", `Template version ${item.templateVersionId} not found`);
  }

  const templateJson = versions[0].templateJson;
  const parseResult = designTemplateJsonSchema.safeParse(templateJson);
  if (!parseResult.success) {
    await failItem(item.id, tenantId, batchId, "TEMPLATE_SCHEMA_INVALID", "Template JSON schema invalid", false, workerIdStr);
    throw new RenderError("TEMPLATE_SCHEMA_INVALID", `Template JSON failed schema validation`);
  }

  const template = templateJson as unknown as DesignTemplate;

  // ── 3. Load render data from item ─────────────────────────────────────────
  const renderData = item.inputData as Record<string, string | number | boolean | null | undefined>;

  // ── 4. Determine format from batch or item metadata ────────────────────────
  let format: RenderFormat = "png";
  let outputWidth: number | undefined;
  let outputHeight: number | undefined;

  if (batchId) {
    const batches = await db
      .select({
        requestedFormat: designRenderBatchesTable.requestedFormat,
        requestedWidth:  designRenderBatchesTable.requestedWidth,
        requestedHeight: designRenderBatchesTable.requestedHeight,
        status:          designRenderBatchesTable.status,
      })
      .from(designRenderBatchesTable)
      .where(eq(designRenderBatchesTable.id, batchId))
      .limit(1);

    if (batches[0]) {
      // ── Cancellation check 1: before heavy work ──────────────────────────
      if (batches[0].status === "cancelled" || batches[0].status === "cancelling") {
        await db
          .update(designRenderItemsTable)
          .set({ status: "cancelled", completedAt: new Date(), leaseExpiresAt: null, workerId: null })
          .where(eq(designRenderItemsTable.id, item.id));
        if (batchId) await reconcileDesignRenderBatch(tenantId, batchId).catch(() => undefined);
        throw new RenderError("RENDER_CANCELLED", `Batch ${batchId} has been cancelled`);
      }
      format       = (batches[0].requestedFormat ?? "png") as RenderFormat;
      outputWidth  = batches[0].requestedWidth  ?? undefined;
      outputHeight = batches[0].requestedHeight ?? undefined;
    }
  }

  // ── 5. Idempotency check: if output already exists, reuse ─────────────────
  if (item.outputUrl && item.outputStoragePath) {
    logger.info({ jobId: job.id, renderItemId }, "[design-render] Reusing existing output");
    await completeItem(item.id, tenantId, batchId, workerIdStr, {
      outputUrl:         item.outputUrl,
      outputStoragePath: item.outputStoragePath,
      outputWidth:       item.outputWidth ?? 0,
      outputHeight:      item.outputHeight ?? 0,
      outputFormat:      item.outputFormat ?? format,
      fileSizeBytes:     item.outputFileSizeBytes ?? 0,
      renderDurationMs:  0,
      warnings:          [],
    });
    return { renderItemId, status: "reused", outputUrl: item.outputUrl };
  }

  // ── 6. Cancellation check 2: before Sharp render ─────────────────────────
  if (batchId) {
    const batchCheck = await db
      .select({ status: designRenderBatchesTable.status })
      .from(designRenderBatchesTable)
      .where(eq(designRenderBatchesTable.id, batchId))
      .limit(1);
    if (batchCheck[0]?.status === "cancelled" || batchCheck[0]?.status === "cancelling") {
      await db
        .update(designRenderItemsTable)
        .set({ status: "cancelled", completedAt: new Date(), leaseExpiresAt: null, workerId: null })
        .where(eq(designRenderItemsTable.id, item.id));
      if (batchId) await reconcileDesignRenderBatch(tenantId, batchId).catch(() => undefined);
      throw new RenderError("RENDER_CANCELLED", "Batch cancelled before render");
    }
  }

  // ── 7. Run the render pipeline ────────────────────────────────────────────
  logger.info({ jobId: job.id, renderItemId, format, tenantId }, "[design-render] Starting render");
  const startMs = Date.now();

  let pipelineResult: Awaited<ReturnType<typeof renderTemplate>>;
  try {
    pipelineResult = await renderTemplate({
      template,
      templateVersionId: item.templateVersionId,
      data:              renderData,
      format,
      tenantId,
      batchId,
      renderItemId,
      outputWidth,
      outputHeight,
    });
  } catch (err) {
    const code    = toErrorCode(err);
    const message = sanitiseErrorMessage(err);
    const retry   = isRetryable(err);

    logger.warn({ jobId: job.id, renderItemId, code, retry }, `[design-render] Render failed: ${message}`);

    await failItem(item.id, tenantId, batchId, code, message, retry, workerIdStr);

    await logAudit({
      module:       "design-template-engine",
      action:       "render_failed",
      resourceType: "design_render_item",
      resourceId:   String(item.id),
      status:       "failure",
      details:      { code, retry, renderItemId, batchId },
    });

    throw err;
  }

  // ── 8. Cancellation check 3: before saving result ────────────────────────
  if (batchId) {
    const batchCheck = await db
      .select({ status: designRenderBatchesTable.status })
      .from(designRenderBatchesTable)
      .where(eq(designRenderBatchesTable.id, batchId))
      .limit(1);
    if (batchCheck[0]?.status === "cancelled" || batchCheck[0]?.status === "cancelling") {
      await db
        .update(designRenderItemsTable)
        .set({ status: "cancelled", completedAt: new Date(), leaseExpiresAt: null, workerId: null })
        .where(eq(designRenderItemsTable.id, item.id));
      if (batchId) await reconcileDesignRenderBatch(tenantId, batchId).catch(() => undefined);
      throw new RenderError("RENDER_CANCELLED", "Batch cancelled after render; result discarded");
    }
  }

  // ── 9. Mark item completed ────────────────────────────────────────────────
  await completeItem(item.id, tenantId, batchId, workerIdStr, {
    outputUrl:         pipelineResult.outputUrl,
    outputStoragePath: pipelineResult.outputStoragePath,
    outputWidth:       pipelineResult.width,
    outputHeight:      pipelineResult.height,
    outputFormat:      pipelineResult.format,
    fileSizeBytes:     pipelineResult.fileSizeBytes,
    renderDurationMs:  pipelineResult.renderDurationMs,
    warnings:          pipelineResult.warnings.map((w) => `[${w.code}] ${w.elementId}: ${w.message}`),
  });

  await logAudit({
    module:       "design-template-engine",
    action:       "render_completed",
    resourceType: "design_render_item",
    resourceId:   String(item.id),
    status:       "success",
    details:      {
      renderItemId,
      batchId,
      format,
      fileSizeBytes: pipelineResult.fileSizeBytes,
      durationMs:    pipelineResult.renderDurationMs,
      warnings:      pipelineResult.warnings.length,
    },
  });

  return {
    renderItemId,
    status:    "completed",
    outputUrl: pipelineResult.outputUrl,
    format,
    width:     pipelineResult.width,
    height:    pipelineResult.height,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function completeItem(
  itemId: number,
  tenantId: string,
  batchId: number | undefined,
  workerId: string,
  result: {
    outputUrl: string;
    outputStoragePath: string;
    outputWidth: number;
    outputHeight: number;
    outputFormat: string;
    fileSizeBytes: number;
    renderDurationMs: number;
    warnings: string[];
  },
): Promise<void> {
  await db
    .update(designRenderItemsTable)
    .set({
      status:               "completed",
      outputUrl:            result.outputUrl,
      outputStoragePath:    result.outputStoragePath,
      outputAssetId:        result.outputStoragePath,
      outputWidth:          result.outputWidth,
      outputHeight:         result.outputHeight,
      outputFormat:         result.outputFormat,
      outputFileSizeBytes:  result.fileSizeBytes,
      renderDurationMs:     result.renderDurationMs,
      renderWarnings:       result.warnings,
      errorCode:            null,
      errorMessage:         null,
      completedAt:          new Date(),
      leaseExpiresAt:       null,
      workerId:             null,
      heartbeatAt:          null,
    })
    .where(eq(designRenderItemsTable.id, itemId));

  if (batchId) {
    await reconcileDesignRenderBatch(tenantId, batchId).catch(() => undefined);
  }
}

async function failItem(
  itemId: number,
  tenantId: string,
  batchId: number | undefined,
  errorCode: string,
  errorMessage: string,
  retryable: boolean,
  workerId: string,
): Promise<void> {
  // If non-retryable, mark as permanently failed; if retryable, keep as processing
  // so jobWorkerService retry logic can re-schedule it.
  const newStatus = retryable ? "processing" : "failed";

  await db
    .update(designRenderItemsTable)
    .set({
      status:        newStatus,
      errorCode,
      errorMessage:  errorMessage.slice(0, 1000),
      completedAt:   retryable ? undefined : new Date(),
      // Release lease on terminal failure
      ...(retryable ? {} : { leaseExpiresAt: null, workerId: null, heartbeatAt: null }),
    })
    .where(eq(designRenderItemsTable.id, itemId));

  if (batchId && !retryable) {
    await reconcileDesignRenderBatch(tenantId, batchId).catch(() => undefined);
  }
}

// ── design_render_batch_dispatch ──────────────────────────────────────────────

/**
 * Fan-out job: delegates to the production batchDispatcher.
 *
 * Phase 3A: full production implementation with chunked dispatch,
 * tenant fairness, idempotency, and resumability.
 */
export async function executeDesignRenderBatchDispatch(
  job: AiJob,
  workerId: number,
): Promise<Record<string, unknown>> {
  const { batchId, tenantId } = job.payloadJson as {
    batchId: number;
    tenantId: string;
  };

  logger.info({ jobId: job.id, batchId }, "[design-render-batch] Starting production dispatch");

  const { dispatchBatch } = await import("./design-batch/batchDispatcher.js");
  const result = await dispatchBatch({
    batchId,
    tenantId,
    requestId: String(job.id),
  });

  return result as unknown as Record<string, unknown>;
}

// ── design_render_zip_export ──────────────────────────────────────────────────

/**
 * Phase 3 stub: ZIP export is deferred to Phase 3B (Team 2).
 * Explicitly surfaces "not_implemented" status — does NOT silently fail.
 */
export async function executeDesignRenderZipExport(
  job: AiJob,
  _workerId: number,
): Promise<Record<string, unknown>> {
  const { batchId } = job.payloadJson as { batchId: number };
  logger.info({ jobId: job.id, batchId }, "[design-render-zip] ZIP export deferred to Team 2");
  throw Object.assign(
    new Error("ZIP export not yet implemented — scheduled for Phase 3B (Team 2)"),
    { retryable: false, code: "ZIP_NOT_IMPLEMENTED" },
  );
}
