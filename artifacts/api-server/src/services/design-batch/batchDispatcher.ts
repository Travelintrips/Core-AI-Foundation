/**
 * Design Batch Engine — Production Batch Dispatcher (Phase 3A)
 *
 * Implements the design_render_batch_dispatch job handler.
 *
 * Responsibilities:
 *   - Atomic batch claim (queued → dispatching)
 *   - Cooperative cancellation check
 *   - Chunked enqueue with bounded concurrency (pLimit pattern)
 *   - Dispatch markers (dispatch_status: pending → dispatching → dispatched)
 *   - Tenant fairness: active job cap per tenant
 *   - Idempotent/resumable: safe to call again after crash
 *   - No image rendering — payload carries identifiers only
 *
 * Failure window documentation:
 *   If the process crashes between a successful enqueue() and the subsequent
 *   marker update (pending → dispatched), the item stays "dispatching".
 *   On the next dispatcher run, those items are re-enqueued. The render worker
 *   (executeDesignRenderJob) is idempotent: it will skip items already completed
 *   and use atomic claim to avoid double-processing.
 */

import { eq, and, sql, inArray, count } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  designRenderBatchesTable,
  designRenderItemsTable,
} from "@workspace/db";
import { enqueue } from "../queueManagerService.js";
import { logAudit } from "../aiAuditService.js";
import { logger } from "../../lib/logger.js";
import { reconcileDesignRenderBatch } from "../designRenderBatchService.js";
import {
  assertBatchTransition,
  BatchLifecycleError,
} from "./batchLifecycle.js";
import { batchConfig } from "./config.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DispatchBatchInput {
  batchId: number;
  tenantId: string;
  requestId?: string;
}

export interface DispatchBatchResult {
  batchId: number;
  dispatchedCount: number;
  skippedCount: number;
  cappedByTenantLimit: boolean;
  status: string;
}

// ── Tenant Fairness ───────────────────────────────────────────────────────────

/**
 * Count how many render items for this tenant are currently in processing state
 * across ALL active batches (not just this one).
 */
async function countActiveItemsForTenant(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(designRenderItemsTable)
    .where(
      and(
        eq(designRenderItemsTable.tenantId, tenantId),
        inArray(designRenderItemsTable.status, ["queued", "processing"]),
      ),
    );
  return row?.cnt ?? 0;
}

/**
 * Count active (non-terminal) batches for a tenant.
 */
async function countActiveBatchesForTenant(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(designRenderBatchesTable)
    .where(
      and(
        eq(designRenderBatchesTable.tenantId, tenantId),
        sql`status NOT IN ('completed','partially_failed','failed','cancelled')`,
      ),
    );
  return row?.cnt ?? 0;
}

// ── Atomic Batch Claim ────────────────────────────────────────────────────────

/**
 * Atomically transition the batch from queued → dispatching.
 * Returns true if the claim was successful (we own the dispatch).
 * Returns false if the batch was already claimed by another dispatcher.
 */
async function claimBatchForDispatch(
  batchId: number,
  tenantId: string,
  currentStatus: string,
): Promise<boolean> {
  try {
    assertBatchTransition(currentStatus, "dispatching");
  } catch (e) {
    if (e instanceof BatchLifecycleError) return false;
    throw e;
  }

  const updated = await db
    .update(designRenderBatchesTable)
    .set({ status: "dispatching" })
    .where(
      and(
        eq(designRenderBatchesTable.id, batchId),
        eq(designRenderBatchesTable.tenantId, tenantId),
        // CAS: only claim if still in the expected status
        eq(designRenderBatchesTable.status, currentStatus),
      ),
    )
    .returning({ id: designRenderBatchesTable.id });

  return updated.length > 0;
}

// ── Main Dispatcher ───────────────────────────────────────────────────────────

export async function dispatchBatch(input: DispatchBatchInput): Promise<DispatchBatchResult> {
  const { batchId, tenantId, requestId } = input;
  const logCtx = { batchId, tenantId, requestId };

  // ── 1. Load batch and verify tenant ───────────────────────────────────────
  const [batch] = await db
    .select()
    .from(designRenderBatchesTable)
    .where(
      and(
        eq(designRenderBatchesTable.id, batchId),
        eq(designRenderBatchesTable.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!batch) {
    throw new Error(`[dispatch] Batch #${batchId} not found for tenant ${tenantId}`);
  }

  // ── 2. Cancellation fast-path ──────────────────────────────────────────────
  if (batch.status === "cancelling" || batch.status === "cancelled") {
    logger.info({ ...logCtx, batchStatus: batch.status }, "[dispatch] Batch is cancelling/cancelled — aborting dispatch");
    // Cancel any remaining queued items
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
    return { batchId, dispatchedCount: 0, skippedCount: 0, cappedByTenantLimit: false, status: "cancelled" };
  }

  // ── 3. Atomic claim (queued → dispatching) ─────────────────────────────────
  // If batch is already "dispatching" (previous run), we resume from where we left off.
  // If "processing", we also continue (some items may still be pending dispatch).
  const needsClaim = batch.status === "queued";
  if (needsClaim) {
    const claimed = await claimBatchForDispatch(batchId, tenantId, "queued");
    if (!claimed) {
      // Another dispatcher won the race — idempotent exit
      logger.info({ ...logCtx }, "[dispatch] Batch already claimed by another dispatcher — skip");
      return { batchId, dispatchedCount: 0, skippedCount: 0, cappedByTenantLimit: false, status: "already_claimed" };
    }
  }

  logger.info({ ...logCtx, batchStatus: batch.status }, "[dispatch] Starting dispatch");

  // ── 4. Tenant fairness check ───────────────────────────────────────────────
  const activeItems = await countActiveItemsForTenant(tenantId);
  const maxActive = batchConfig.maxActiveItemsPerTenant;
  if (activeItems >= maxActive) {
    logger.warn({ ...logCtx, activeItems, maxActive }, "[dispatch] Tenant active item cap reached — deferring");
    // Put back to processing (not queued) so the batch doesn't lose its place
    await db
      .update(designRenderBatchesTable)
      .set({ status: "processing" })
      .where(eq(designRenderBatchesTable.id, batchId));
    return { batchId, dispatchedCount: 0, skippedCount: 0, cappedByTenantLimit: true, status: "deferred" };
  }

  // ── 5. Select undispatched (pending) items ─────────────────────────────────
  // Includes items where dispatch_status is 'pending' or 'dispatching'
  // (dispatching = crashed between enqueue and marker update — safe to re-enqueue).
  const availableSlots = Math.min(
    maxActive - activeItems,
    batchConfig.dispatchWindowSize,
  );

  const pendingItems = await db
    .select({ id: designRenderItemsTable.id, rowIndex: designRenderItemsTable.rowIndex })
    .from(designRenderItemsTable)
    .where(
      and(
        eq(designRenderItemsTable.batchId, batchId),
        eq(designRenderItemsTable.tenantId, tenantId),
        inArray(designRenderItemsTable.dispatchStatus, ["pending", "dispatching"]),
        inArray(designRenderItemsTable.status, ["queued"]),
      ),
    )
    .orderBy(designRenderItemsTable.rowIndex)
    .limit(availableSlots);

  if (pendingItems.length === 0) {
    logger.info({ ...logCtx }, "[dispatch] No pending items — transitioning to processing");
    // Transition to processing (or reconcile to terminal if all done)
    await db
      .update(designRenderBatchesTable)
      .set({ status: "processing" })
      .where(
        and(
          eq(designRenderBatchesTable.id, batchId),
          // Only move forward if still dispatching (not cancelled/cancelling)
          inArray(designRenderBatchesTable.status, ["dispatching", "queued"]),
        ),
      );
    const summary = await reconcileDesignRenderBatch(tenantId, batchId);
    return { batchId, dispatchedCount: 0, skippedCount: 0, cappedByTenantLimit: false, status: summary.status };
  }

  // ── 6. Chunked dispatch with bounded concurrency ───────────────────────────
  const chunkSize = batchConfig.dispatchChunkSize;
  const concurrency = batchConfig.dispatchConcurrency;
  let totalDispatched = 0;
  let skippedCount = 0;

  for (let i = 0; i < pendingItems.length; i += chunkSize) {
    const chunk = pendingItems.slice(i, i + chunkSize);

    // Re-check cancellation before each chunk
    const [batchCheck] = await db
      .select({ status: designRenderBatchesTable.status })
      .from(designRenderBatchesTable)
      .where(eq(designRenderBatchesTable.id, batchId))
      .limit(1);

    if (batchCheck?.status === "cancelling" || batchCheck?.status === "cancelled") {
      logger.info({ ...logCtx, chunk: i }, "[dispatch] Cancellation detected mid-dispatch — stopping");
      break;
    }

    // Enqueue items with bounded concurrency (simulate p-limit with a semaphore)
    const results = await enqueueChunk(chunk, batchId, tenantId, concurrency);
    totalDispatched += results.dispatched;
    skippedCount += results.skipped;
  }

  // ── 7. Transition to processing ────────────────────────────────────────────
  await db
    .update(designRenderBatchesTable)
    .set({ status: "processing" })
    .where(
      and(
        eq(designRenderBatchesTable.id, batchId),
        inArray(designRenderBatchesTable.status, ["dispatching", "queued"]),
      ),
    );

  await logAudit({
    module: "design-template-engine",
    action: "batch_dispatched",
    resourceType: "design_render_batch",
    resourceId: String(batchId),
    status: "success",
    details: { batchId, dispatchedCount: totalDispatched, skippedCount, tenantId },
  });

  logger.info({ ...logCtx, totalDispatched, skippedCount }, "[dispatch] Dispatch complete");

  const summary = await reconcileDesignRenderBatch(tenantId, batchId);
  return {
    batchId,
    dispatchedCount: totalDispatched,
    skippedCount,
    cappedByTenantLimit: false,
    status: summary.status,
  };
}

// ── Chunk Enqueue ─────────────────────────────────────────────────────────────

interface ChunkResult { dispatched: number; skipped: number }

async function enqueueChunk(
  items: Array<{ id: number; rowIndex: number }>,
  batchId: number,
  tenantId: string,
  concurrency: number,
): Promise<ChunkResult> {
  let dispatched = 0;
  let skipped = 0;

  // Process items in parallel batches of `concurrency`
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const itemIds = batch.map((item) => item.id);

    // Mark items as "dispatching" so crash recovery knows they were in-flight
    await db
      .update(designRenderItemsTable)
      .set({
        dispatchStatus: "dispatching",
        dispatchAttemptCount: sql`dispatch_attempt_count + 1`,
        lastDispatchedAt: new Date(),
      })
      .where(
        and(
          inArray(designRenderItemsTable.id, itemIds),
          inArray(designRenderItemsTable.dispatchStatus, ["pending", "dispatching"]),
        ),
      );

    // Enqueue all items in this micro-batch in parallel
    await Promise.all(
      batch.map(async (item) => {
        try {
          const job = await enqueue({
            jobType: "design_render",
            payloadJson: {
              tenantId,
              batchId,
              renderItemId: item.id,
            },
            priority: 50,
            maxRetry: batchConfig.maxAttempts,
            retryStrategy: "exponential",
            tenantId,
          });

          // Update dispatch marker to reflect successful enqueue
          await db
            .update(designRenderItemsTable)
            .set({
              dispatchStatus: "dispatched",
              queueJobId: String(job?.id ?? ""),
            })
            .where(eq(designRenderItemsTable.id, item.id));

          dispatched++;
        } catch (err) {
          // Enqueue failure: reset to pending so next run retries
          logger.warn({ batchId, renderItemId: item.id, err }, "[dispatch] Enqueue failed — item will retry on next pass");
          await db
            .update(designRenderItemsTable)
            .set({ dispatchStatus: "pending" })
            .where(eq(designRenderItemsTable.id, item.id))
            .catch(() => undefined);
          skipped++;
        }
      }),
    );
  }

  return { dispatched, skipped };
}
