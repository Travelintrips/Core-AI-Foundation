/**
 * Design Batch Engine — Stale Item Recovery (Phase 3A)
 *
 * recoverStaleDesignRenderItems()
 *   Finds render items that are in "processing" state but whose lease has expired.
 *   Uses atomic update to avoid stealing active leases.
 *   Requeues retryable items; terminally fails items that have exceeded max attempts.
 *   Runs reconciliation after recovery.
 *   Safe to call concurrently — atomic claim prevents double-recovery.
 */

import { eq, and, sql, lt } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  designRenderItemsTable,
  designRenderBatchesTable,
} from "@workspace/db";
import { logAudit } from "../aiAuditService.js";
import { logger } from "../../lib/logger.js";
import { reconcileDesignRenderBatch } from "../designRenderBatchService.js";
import { batchConfig, computeNextRetryAt } from "../design-batch/config.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StaleRecoveryResult {
  scannedCount: number;
  requeuCount: number;
  terminalCount: number;
  affectedBatchIds: number[];
}

// ── Main Recovery Function ────────────────────────────────────────────────────

const RECOVERY_PAGE_SIZE = 50;

export async function recoverStaleDesignRenderItems(): Promise<StaleRecoveryResult> {
  const now = new Date();
  let scannedCount = 0;
  let requeuCount = 0;
  let terminalCount = 0;
  const affectedBatchIds = new Set<number>();

  // Paginate through stale items to avoid unbounded query
  let cursor = 0;
  while (true) {
    const staleItems = await db
      .select({
        id: designRenderItemsTable.id,
        batchId: designRenderItemsTable.batchId,
        tenantId: designRenderItemsTable.tenantId,
        attemptCount: designRenderItemsTable.attemptCount,
        leaseExpiresAt: designRenderItemsTable.leaseExpiresAt,
      })
      .from(designRenderItemsTable)
      .where(
        and(
          eq(designRenderItemsTable.status, "processing"),
          // Lease must exist and be expired — never steal an active lease
          sql`${designRenderItemsTable.leaseExpiresAt} IS NOT NULL`,
          lt(designRenderItemsTable.leaseExpiresAt, now),
          sql`${designRenderItemsTable.id} > ${cursor}`,
        ),
      )
      .orderBy(designRenderItemsTable.id)
      .limit(RECOVERY_PAGE_SIZE);

    if (staleItems.length === 0) break;
    scannedCount += staleItems.length;
    cursor = staleItems[staleItems.length - 1]!.id;

    for (const item of staleItems) {
      // Check whether the batch is being cancelled — if so, cancel the item
      const [batchRow] = await db
        .select({ status: designRenderBatchesTable.status })
        .from(designRenderBatchesTable)
        .where(eq(designRenderBatchesTable.id, item.batchId))
        .limit(1);

      if (batchRow?.status === "cancelling" || batchRow?.status === "cancelled") {
        // Atomic cancel
        const updated = await db
          .update(designRenderItemsTable)
          .set({
            status: "cancelled",
            completedAt: now,
            leaseExpiresAt: null,
            workerId: null,
            heartbeatAt: null,
          })
          .where(
            and(
              eq(designRenderItemsTable.id, item.id),
              eq(designRenderItemsTable.status, "processing"),
              sql`${designRenderItemsTable.leaseExpiresAt} IS NOT NULL`,
              lt(designRenderItemsTable.leaseExpiresAt, now),
            ),
          )
          .returning({ id: designRenderItemsTable.id });

        if (updated.length > 0) {
          affectedBatchIds.add(item.batchId);
          terminalCount++;
        }
        continue;
      }

      const maxAttempts = batchConfig.maxAttempts;
      const isRetryable = item.attemptCount < maxAttempts;

      if (isRetryable) {
        // Atomic requeue: only update if lease is still expired (prevent stealing active lease)
        const nextRetryAt = computeNextRetryAt(item.attemptCount);
        const updated = await db
          .update(designRenderItemsTable)
          .set({
            status: "queued",
            dispatchStatus: "pending",
            leaseExpiresAt: null,
            workerId: null,
            heartbeatAt: null,
            nextRetryAt,
            queuedAt: now,
          })
          .where(
            and(
              eq(designRenderItemsTable.id, item.id),
              eq(designRenderItemsTable.status, "processing"),
              // Re-confirm lease is still expired — atomic guard against concurrent heartbeat
              sql`${designRenderItemsTable.leaseExpiresAt} IS NOT NULL`,
              lt(designRenderItemsTable.leaseExpiresAt, now),
            ),
          )
          .returning({ id: designRenderItemsTable.id });

        if (updated.length > 0) {
          affectedBatchIds.add(item.batchId);
          requeuCount++;

          await logAudit({
            module: "design-template-engine",
            action: "stale_item_requeued",
            resourceType: "design_render_item",
            resourceId: String(item.id),
            status: "success",
            details: { batchId: item.batchId, attemptCount: item.attemptCount, maxAttempts },
          });
        }
      } else {
        // Max attempts reached — terminal failure
        const updated = await db
          .update(designRenderItemsTable)
          .set({
            status: "failed",
            completedAt: now,
            errorCode: "MAX_ATTEMPTS_EXCEEDED",
            errorMessage: `Render item exceeded max ${maxAttempts} attempts (stale lease recovery)`,
            leaseExpiresAt: null,
            workerId: null,
            heartbeatAt: null,
          })
          .where(
            and(
              eq(designRenderItemsTable.id, item.id),
              eq(designRenderItemsTable.status, "processing"),
              sql`${designRenderItemsTable.leaseExpiresAt} IS NOT NULL`,
              lt(designRenderItemsTable.leaseExpiresAt, now),
            ),
          )
          .returning({ id: designRenderItemsTable.id });

        if (updated.length > 0) {
          affectedBatchIds.add(item.batchId);
          terminalCount++;

          await logAudit({
            module: "design-template-engine",
            action: "stale_item_failed",
            resourceType: "design_render_item",
            resourceId: String(item.id),
            status: "failure",
            details: { batchId: item.batchId, attemptCount: item.attemptCount, maxAttempts },
          });
        }
      }
    }
  }

  // Reconcile all affected batches
  for (const batchId of affectedBatchIds) {
    const [batchRow] = await db
      .select({ tenantId: designRenderBatchesTable.tenantId })
      .from(designRenderBatchesTable)
      .where(eq(designRenderBatchesTable.id, batchId))
      .limit(1);
    if (batchRow) {
      await reconcileDesignRenderBatch(batchRow.tenantId, batchId).catch((err) => {
        logger.warn({ batchId, err }, "[stale-recovery] Reconcile failed after stale recovery");
      });
    }
  }

  if (scannedCount > 0) {
    logger.info(
      { scannedCount, requeuCount, terminalCount, affectedBatches: affectedBatchIds.size },
      "[stale-recovery] Scan complete",
    );
  }

  return { scannedCount, requeuCount, terminalCount, affectedBatchIds: Array.from(affectedBatchIds) };
}

/**
 * Extend the processing lease for an active render item.
 * Called by the render worker at cooperative checkpoints.
 * No-op if the item is no longer processing (idempotent).
 */
export async function extendRenderItemLease(
  renderItemId: number,
  workerId: string,
): Promise<boolean> {
  const leaseExpiresAt = new Date(Date.now() + batchConfig.processingLeaseMs);
  const updated = await db
    .update(designRenderItemsTable)
    .set({
      leaseExpiresAt,
      heartbeatAt: new Date(),
    })
    .where(
      and(
        eq(designRenderItemsTable.id, renderItemId),
        eq(designRenderItemsTable.workerId, workerId),
        eq(designRenderItemsTable.status, "processing"),
      ),
    )
    .returning({ id: designRenderItemsTable.id });

  return updated.length > 0;
}
