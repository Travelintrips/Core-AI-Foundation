/**
 * Design Batch Engine — Startup Resume (Phase 3A)
 *
 * resumeIncompleteDesignRenderBatches()
 *   Called at server startup (and optionally by a periodic scheduler).
 *   Finds batches that were interrupted by a crash and re-triggers dispatch.
 *
 * Handles:
 *   - queued batches that never got a dispatcher job
 *   - dispatching batches that crashed mid-fan-out
 *   - processing batches that still have queued items pending dispatch
 *   - cancelling batches that still have queued items (cancel them immediately)
 *
 * Paginated — never scans all rows in one unbounded query.
 */

import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  designRenderBatchesTable,
  designRenderItemsTable,
} from "@workspace/db";
import { enqueue } from "../queueManagerService.js";
import { logAudit } from "../aiAuditService.js";
import { logger } from "../../lib/logger.js";
import { reconcileDesignRenderBatch } from "../designRenderBatchService.js";
import { recoverStaleDesignRenderItems } from "./staleRecovery.js";

const RESUME_PAGE_SIZE = 20;

export interface StartupResumeResult {
  batchesResumed: number;
  batchesCancelled: number;
  staleRecovery: Awaited<ReturnType<typeof recoverStaleDesignRenderItems>>;
}

export async function resumeIncompleteDesignRenderBatches(): Promise<StartupResumeResult> {
  let batchesResumed = 0;
  let batchesCancelled = 0;

  logger.info("[startup-resume] Scanning for incomplete design render batches");

  // Run stale item recovery first so requeued items show up in subsequent reconciliation
  const staleRecovery = await recoverStaleDesignRenderItems();

  // Paginate through active (non-terminal) batches
  let cursor = 0;
  while (true) {
    const batches = await db
      .select()
      .from(designRenderBatchesTable)
      .where(
        and(
          inArray(designRenderBatchesTable.status, ["queued", "dispatching", "processing", "cancelling"]),
          sql`${designRenderBatchesTable.id} > ${cursor}`,
        ),
      )
      .orderBy(designRenderBatchesTable.id)
      .limit(RESUME_PAGE_SIZE);

    if (batches.length === 0) break;
    cursor = batches[batches.length - 1]!.id;

    for (const batch of batches) {
      try {
        await resumeBatch(batch);
        if (batch.status === "cancelling") {
          batchesCancelled++;
        } else {
          batchesResumed++;
        }
      } catch (err) {
        logger.warn({ batchId: batch.id, err }, "[startup-resume] Failed to resume batch — skipping");
      }
    }
  }

  logger.info(
    { batchesResumed, batchesCancelled, staleRecovery },
    "[startup-resume] Complete",
  );

  return { batchesResumed, batchesCancelled, staleRecovery };
}

async function resumeBatch(batch: typeof designRenderBatchesTable.$inferSelect): Promise<void> {
  const { id: batchId, tenantId, status } = batch;

  // ── cancelling: cancel remaining queued items immediately ─────────────────
  if (status === "cancelling") {
    await db
      .update(designRenderItemsTable)
      .set({ status: "cancelled", completedAt: new Date(), dispatchStatus: "pending" })
      .where(
        and(
          eq(designRenderItemsTable.batchId, batchId),
          eq(designRenderItemsTable.status, "queued"),
        ),
      );
    await reconcileDesignRenderBatch(tenantId, batchId);
    logger.info({ batchId }, "[startup-resume] Finished cancelling batch");
    return;
  }

  // ── queued/dispatching/processing: check if there are pending items ────────
  const [pendingRow] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(designRenderItemsTable)
    .where(
      and(
        eq(designRenderItemsTable.batchId, batchId),
        inArray(designRenderItemsTable.dispatchStatus, ["pending", "dispatching"]),
        eq(designRenderItemsTable.status, "queued"),
      ),
    );

  const pendingCount = pendingRow?.cnt ?? 0;

  if (pendingCount > 0) {
    // Re-enqueue dispatcher — it's idempotent so safe to call multiple times
    await enqueue({
      jobType: "design_render_batch_dispatch",
      payloadJson: { batchId, tenantId },
      priority: 50,
      tenantId,
    });

    // Ensure batch is in queued state so dispatcher can claim it
    await db
      .update(designRenderBatchesTable)
      .set({ status: "queued" })
      .where(
        and(
          eq(designRenderBatchesTable.id, batchId),
          inArray(designRenderBatchesTable.status, ["dispatching", "processing"]),
        ),
      );

    await logAudit({
      module: "design-template-engine",
      action: "batch_resume_dispatched",
      resourceType: "design_render_batch",
      resourceId: String(batchId),
      status: "success",
      details: { pendingCount, previousStatus: status, tenantId },
    });

    logger.info({ batchId, pendingCount, previousStatus: status }, "[startup-resume] Re-enqueued dispatcher for batch");
  } else {
    // No pending items — just reconcile to get accurate status
    await reconcileDesignRenderBatch(tenantId, batchId);
    logger.info({ batchId, status }, "[startup-resume] Batch has no pending items — reconciled");
  }
}
