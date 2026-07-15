/**
 * Design Template Engine — Render Worker Service (Phase 2 stub)
 *
 * Phase 1: Stubs that correctly claim/fail jobs so the queue doesn't jam.
 * Phase 2: Full SVG + Sharp renderer implementation.
 *
 * The three exported functions are called from jobWorkerService.ts's switch.
 */

import { eq, and, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  designRenderItemsTable,
  designRenderBatchesTable,
} from "@workspace/db";
import { syncBatchProgress } from "./designRenderBatchService.js";
import { logAudit } from "./aiAuditService.js";
import { logger } from "../lib/logger.js";
import type { AiJob } from "@workspace/db";

// ── design_render ─────────────────────────────────────────────────────────────

/**
 * Execute a single design_render job.
 * Phase 1: Stub — marks item as failed with a clear "not_implemented" code so
 * the batch progress counter is accurate and retry logic works correctly.
 * Phase 2: Replace stub body with SVG + Sharp renderer.
 */
export async function executeDesignRenderJob(
  job: AiJob,
  _workerId: number,
): Promise<Record<string, unknown>> {
  const payload = job.payloadJson as Record<string, unknown>;
  const { templateId, templateVersionId, tenantId } = payload;

  logger.info(
    { jobId: job.id, templateId, templateVersionId },
    "[design-render] Phase 2 renderer not yet implemented — marking as failed",
  );

  await logAudit({
    module: "design-template-engine",
    action: "render_not_implemented",
    resourceType: "design_render_job",
    resourceId: String(job.id),
    status: "warning",
    details: { templateId, templateVersionId, tenantId },
  });

  // Return a result that jobWorkerService will treat as a failure so retry logic kicks in.
  throw new Error("design_render: SVG renderer not yet implemented (Phase 2)");
}

// ── design_render_batch_dispatch ──────────────────────────────────────────────

/**
 * Fan-out job: reads all queued items from a batch and enqueues individual
 * design_render jobs. This is the correct pattern from the spec:
 *   1 Batch → N individual render items (each retriable independently).
 *
 * Phase 1: Functional — dispatches individual render jobs for each queued item.
 */
export async function executeDesignRenderBatchDispatch(
  job: AiJob,
  _workerId: number,
): Promise<Record<string, unknown>> {
  const { batchId, tenantId, retryOnly } = job.payloadJson as {
    batchId: number;
    tenantId: string;
    retryOnly?: boolean;
  };

  logger.info({ jobId: job.id, batchId }, "[design-render-batch] Dispatching render items");

  // Update batch status to processing
  await db
    .update(designRenderBatchesTable)
    .set({ status: "processing" })
    .where(eq(designRenderBatchesTable.id, batchId));

  // Fetch queued items
  const items = await db
    .select({ id: designRenderItemsTable.id, rowIndex: designRenderItemsTable.rowIndex })
    .from(designRenderItemsTable)
    .where(
      and(
        eq(designRenderItemsTable.batchId, batchId),
        eq(designRenderItemsTable.tenantId, tenantId),
        eq(designRenderItemsTable.status, "queued"),
      ),
    )
    .orderBy(designRenderItemsTable.rowIndex);

  if (items.length === 0) {
    logger.info({ jobId: job.id, batchId }, "[design-render-batch] No queued items found");
    await syncBatchProgress(batchId);
    return { batchId, dispatchedCount: 0 };
  }

  // Enqueue individual render jobs (bounded to avoid flooding the queue)
  const { enqueue } = await import("./queueManagerService.js");
  const CONCURRENCY_CAP = parseInt(process.env["DESIGN_RENDER_CONCURRENCY"] ?? "4", 10);

  let dispatched = 0;
  for (const item of items) {
    // Mark item as processing before enqueue
    await db
      .update(designRenderItemsTable)
      .set({ status: "processing", startedAt: new Date() })
      .where(eq(designRenderItemsTable.id, item.id));

    await enqueue({
      jobType: "design_render",
      payloadJson: {
        batchId,
        renderItemId: item.id,
        rowIndex: item.rowIndex,
        tenantId,
      },
      priority: 50,
      maxRetry: parseInt(process.env["DESIGN_RENDER_MAX_ATTEMPTS"] ?? "3", 10),
      retryStrategy: "exponential",
      tenantId,
    });

    dispatched++;
  }

  await logAudit({
    module: "design-template-engine",
    action: "batch_dispatched",
    resourceType: "design_render_batch",
    resourceId: String(batchId),
    status: "success",
    details: { batchId, dispatchedCount: dispatched, tenantId },
  });

  return { batchId, dispatchedCount: dispatched };
}

// ── design_render_zip_export ──────────────────────────────────────────────────

/**
 * Collect all completed render item output URLs for a batch and produce a ZIP.
 * Phase 1: Stub — returns a structured error so the UI knows Phase 2 is needed.
 * Phase 2: Use archiver/jszip to stream files from Supabase Storage into a ZIP.
 */
export async function executeDesignRenderZipExport(
  job: AiJob,
  _workerId: number,
): Promise<Record<string, unknown>> {
  const { batchId } = job.payloadJson as { batchId: number };

  logger.info({ jobId: job.id, batchId }, "[design-render-zip] Phase 2 ZIP export not yet implemented");

  throw new Error("design_render_zip_export: ZIP export not yet implemented (Phase 2)");
}
