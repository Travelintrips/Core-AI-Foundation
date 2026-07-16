/**
 * Design Template Engine — Batch Render Service (Phase 3A)
 *
 * Creates and manages design_render_batches + design_render_items.
 * reconcileDesignRenderBatch() is the canonical counter/status function.
 * syncBatchProgress() is kept as an alias for backward compatibility.
 */

import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  designRenderBatchesTable,
  designRenderItemsTable,
  designTemplateVersionsTable,
  type NewDesignRenderBatch,
  type NewDesignRenderItem,
} from "@workspace/db";
import { enqueue } from "./queueManagerService.js";
import { logAudit } from "./aiAuditService.js";
import { assertTenantMatch } from "./designTemplateVariableService.js";
import { computeInputHash } from "./designTemplateVariableService.js";
import type { RenderDataRow, RenderFormat } from "../types/designTemplate.js";
import { DESIGN_LIMITS } from "../types/designTemplate.js";
import {
  assertBatchTransition,
  isBatchTerminal,
  isBatchCancellable,
  isBatchRetryable,
  BatchLifecycleError,
} from "./design-batch/batchLifecycle.js";
import { batchConfig } from "./design-batch/config.js";

// ── Tenant Fairness Helpers ───────────────────────────────────────────────────

/**
 * Count non-terminal batches for a tenant.
 * Terminal statuses: completed, partially_failed, failed, cancelled.
 * Used to enforce maxActiveBatchesPerTenant before allowing a batch to start.
 */
export async function countActiveBatchesForTenant(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(designRenderBatchesTable)
    .where(
      and(
        eq(designRenderBatchesTable.tenantId, tenantId),
        sql`${designRenderBatchesTable.status} NOT IN ('completed','partially_failed','failed','cancelled')`,
      ),
    );
  return row?.cnt ?? 0;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DesignRenderBatchSummary {
  batchId: number;
  tenantId: string;
  status: string;
  counts: {
    total: number;
    queued: number;
    processing: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  progressPercent: number;
}

export type ExportableBatchSnapshot = {
  batch: {
    id: string;
    tenantId: string;
    templateId: string;
    templateVersionId: string;
    name: string;
    status: string;
    outputFormat: string;
  };
  completedItems: Array<{
    id: string;
    rowIndex: number;
    outputAssetId?: string | null;
    outputPath?: string | null;
    outputUrl?: string | null;
    outputFormat: string;
    width?: number | null;
    height?: number | null;
    inputHash: string;
  }>;
  failedItems: Array<{
    id: string;
    rowIndex: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    attemptCount: number;
  }>;
  sourceFingerprint: string;
};

// ── Batch CRUD ────────────────────────────────────────────────────────────────

export interface CreateBatchInput {
  tenantId: string;
  templateId: number;
  templateVersionId: number;
  name: string;
  format: RenderFormat;
  width?: number;
  height?: number;
  items: RenderDataRow[];
  requestedBy: string;
}

export async function createBatch(input: CreateBatchInput) {
  if (input.items.length > batchConfig.maxItems) {
    throw new Error(`Batch exceeds maximum size of ${batchConfig.maxItems} items`);
  }

  // Verify the version belongs to the same tenant
  const [version] = await db
    .select({ tenantId: designTemplateVersionsTable.tenantId })
    .from(designTemplateVersionsTable)
    .where(eq(designTemplateVersionsTable.id, input.templateVersionId))
    .limit(1);

  if (!version) throw new Error(`Template version #${input.templateVersionId} not found`);
  assertTenantMatch(version.tenantId, input.tenantId, `version#${input.templateVersionId}`);

  const [batch] = await db
    .insert(designRenderBatchesTable)
    .values({
      tenantId: input.tenantId,
      templateId: input.templateId,
      templateVersionId: input.templateVersionId,
      name: input.name,
      status: "draft",
      totalItems: input.items.length,
      requestedFormat: input.format,
      requestedWidth: input.width,
      requestedHeight: input.height,
      requestedBy: input.requestedBy,
    } satisfies NewDesignRenderBatch)
    .returning();

  // Insert items in chunks to avoid huge single round-trips
  const chunkSize = batchConfig.insertChunkSize;
  for (let i = 0; i < input.items.length; i += chunkSize) {
    const chunk = input.items.slice(i, i + chunkSize);
    const itemValues: NewDesignRenderItem[] = chunk.map((data, localIdx) => ({
      tenantId: input.tenantId,
      batchId: batch!.id,
      templateId: input.templateId,
      templateVersionId: input.templateVersionId,
      rowIndex: i + localIdx,
      inputData: data as unknown as Record<string, unknown>,
      inputHash: computeInputHash(input.templateVersionId, data),
      status: "queued",
      dispatchStatus: "pending",
      queuedAt: new Date(),
    }));
    await db.insert(designRenderItemsTable).values(itemValues);
  }

  await logAudit({
    module: "design-template-engine",
    action: "batch_created",
    resourceType: "design_render_batch",
    resourceId: String(batch!.id),
    status: "success",
    details: { templateId: input.templateId, itemCount: input.items.length, tenantId: input.tenantId },
  });

  return batch!;
}

export async function getBatch(id: number, tenantId: string) {
  const [batch] = await db
    .select()
    .from(designRenderBatchesTable)
    .where(
      and(
        eq(designRenderBatchesTable.id, id),
        eq(designRenderBatchesTable.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!batch) return null;
  assertTenantMatch(batch.tenantId, tenantId, `batch#${id}`);
  return batch;
}

export async function listBatches(
  tenantId: string,
  opts: { templateId?: number; status?: string; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(opts.pageSize ?? 20, 100);
  const offset = (page - 1) * pageSize;

  const conditions = [eq(designRenderBatchesTable.tenantId, tenantId)];
  if (opts.templateId) conditions.push(eq(designRenderBatchesTable.templateId, opts.templateId));
  if (opts.status) conditions.push(eq(designRenderBatchesTable.status, opts.status));

  const [rows, countRow] = await Promise.all([
    db
      .select()
      .from(designRenderBatchesTable)
      .where(and(...conditions))
      .orderBy(desc(designRenderBatchesTable.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(designRenderBatchesTable)
      .where(and(...conditions)),
  ]);

  return { batches: rows, total: countRow[0]?.count ?? 0, page, pageSize };
}

export interface GetBatchItemsOpts {
  status?: string;
  errorCode?: string;
  rowIndex?: number;
  /** Cursor-based: return items with id > cursor */
  cursor?: number;
  limit?: number;
  /** Legacy offset-based pagination (falls back when cursor is absent) */
  page?: number;
  pageSize?: number;
}

export async function getBatchItems(
  batchId: number,
  tenantId: string,
  opts: GetBatchItemsOpts = {},
) {
  // Verify batch ownership
  const batch = await getBatch(batchId, tenantId);
  if (!batch) return null;

  const limit = Math.min(opts.limit ?? opts.pageSize ?? 50, 200);

  const conditions = [
    eq(designRenderItemsTable.batchId, batchId),
    eq(designRenderItemsTable.tenantId, tenantId),
  ];
  if (opts.status) conditions.push(eq(designRenderItemsTable.status, opts.status));
  if (opts.errorCode) conditions.push(eq(designRenderItemsTable.errorCode, opts.errorCode));
  if (opts.rowIndex !== undefined) conditions.push(eq(designRenderItemsTable.rowIndex, opts.rowIndex));
  if (opts.cursor) conditions.push(sql`${designRenderItemsTable.id} > ${opts.cursor}`);

  const rows = await db
    .select()
    .from(designRenderItemsTable)
    .where(and(...conditions))
    .orderBy(designRenderItemsTable.id)
    .limit(limit + 1); // +1 to detect next page

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]!.id : null;

  return { items, nextCursor, hasMore };
}

// ── Batch Lifecycle ───────────────────────────────────────────────────────────

export async function startBatch(batchId: number, tenantId: string, startedBy: string) {
  const batch = await getBatch(batchId, tenantId);
  if (!batch) throw new Error(`Batch #${batchId} not found`);

  assertBatchTransition(batch.status, "queued");

  // ── Tenant active-batch cap ──────────────────────────────────────────────
  // Count BEFORE transitioning. The batch being started is currently in
  // a non-terminal state (draft), so it is already counted; subtract 1
  // to represent the slots used by *other* active batches.
  const activeBatches = await countActiveBatchesForTenant(tenantId);
  const maxActive = batchConfig.maxActiveBatchesPerTenant; // default 5
  // activeBatches includes the current draft batch itself, so the cap is
  // "fewer than maxActive other active batches already exist."
  // Effective check: if activeBatches (including this one in draft) would
  // exceed the limit once it moves to queued, reject it.
  // Since draft is non-terminal it is already counted — reject if
  // (activeBatches - 1) >= maxActive (i.e., there are already maxActive
  // others in non-terminal state).
  const otherActiveBatches = Math.max(0, activeBatches - 1); // exclude self (draft)
  if (otherActiveBatches >= maxActive) {
    throw Object.assign(
      new Error(
        `Tenant '${tenantId}' already has ${otherActiveBatches} active batch(es) ` +
          `(limit: ${maxActive}). Complete or cancel existing batches before starting new ones.`,
      ),
      { code: "BATCH_LIMIT_EXCEEDED", tenantId, activeBatches: otherActiveBatches, limit: maxActive },
    );
  }

  await db
    .update(designRenderBatchesTable)
    .set({ status: "queued", startedAt: new Date() })
    .where(
      and(
        eq(designRenderBatchesTable.id, batchId),
        eq(designRenderBatchesTable.status, batch.status),
      ),
    );

  // Enqueue a dispatcher job — it will fan out individual render items
  await enqueue({
    jobType: "design_render_batch_dispatch",
    payloadJson: { batchId, tenantId },
    priority: 50,
    tenantId,
  });

  await logAudit({
    module: "design-template-engine",
    action: "batch_queued",
    resourceType: "design_render_batch",
    resourceId: String(batchId),
    status: "success",
    details: { startedBy, itemCount: batch.totalItems },
  });

  return { batchId, status: "queued" };
}

export async function cancelBatch(batchId: number, tenantId: string, cancelledBy: string) {
  const batch = await getBatch(batchId, tenantId);
  if (!batch) throw new Error(`Batch #${batchId} not found`);

  // Idempotent: already cancelled
  if (batch.status === "cancelled") return { batchId, status: "cancelled" };
  // Already cancelling — still ok
  if (batch.status === "cancelling") return { batchId, status: "cancelling" };

  if (!isBatchCancellable(batch.status)) {
    throw new BatchLifecycleError(batch.status, "cancelling");
  }

  // Transition to cancelling
  await db
    .update(designRenderBatchesTable)
    .set({ status: "cancelling" })
    .where(
      and(
        eq(designRenderBatchesTable.id, batchId),
        eq(designRenderBatchesTable.status, batch.status),
      ),
    );

  // Cancel queued items immediately (processing items detected via cooperative check)
  await db
    .update(designRenderItemsTable)
    .set({ status: "cancelled", completedAt: new Date(), dispatchStatus: "pending" })
    .where(
      and(
        eq(designRenderItemsTable.batchId, batchId),
        inArray(designRenderItemsTable.status, ["queued"]),
      ),
    );

  // Reconcile to see if we can go directly to cancelled
  const summary = await reconcileDesignRenderBatch(tenantId, batchId);

  await logAudit({
    module: "design-template-engine",
    action: "batch_cancelled",
    resourceType: "design_render_batch",
    resourceId: String(batchId),
    status: "success",
    details: { cancelledBy, finalStatus: summary.status },
  });

  return { batchId, status: summary.status };
}

export async function retryFailedItems(batchId: number, tenantId: string, retriedBy: string) {
  const batch = await getBatch(batchId, tenantId);
  if (!batch) throw new Error(`Batch #${batchId} not found`);

  if (!isBatchRetryable(batch.status)) {
    throw new Error(`Batch is in state '${batch.status}' — only partially_failed or failed batches can be retried`);
  }

  assertBatchTransition(batch.status, "queued");

  // Reset failed items to queued — never touch completed items
  const result = await db
    .update(designRenderItemsTable)
    .set({
      status: "queued",
      errorCode: null,
      errorMessage: null,
      dispatchStatus: "pending",
      dispatchAttemptCount: 0,
      queueJobId: null,
      nextRetryAt: null,
      workerId: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      queuedAt: new Date(),
    })
    .where(
      and(
        eq(designRenderItemsTable.batchId, batchId),
        eq(designRenderItemsTable.tenantId, tenantId),
        eq(designRenderItemsTable.status, "failed"),
      ),
    )
    .returning({ id: designRenderItemsTable.id });

  if (result.length === 0) return { retriedCount: 0 };

  // Move batch back to queued
  await db
    .update(designRenderBatchesTable)
    .set({ status: "queued", completedAt: null })
    .where(eq(designRenderBatchesTable.id, batchId));

  // Re-enqueue dispatcher
  await enqueue({
    jobType: "design_render_batch_dispatch",
    payloadJson: { batchId, tenantId },
    priority: 50,
    tenantId,
  });

  await logAudit({
    module: "design-template-engine",
    action: "batch_retry_failed",
    resourceType: "design_render_batch",
    resourceId: String(batchId),
    status: "success",
    details: { retriedBy, retriedCount: result.length },
  });

  return { retriedCount: result.length };
}

// ── Reconciliation (canonical) ────────────────────────────────────────────────

/**
 * Canonical counter/status function.
 *
 * Recomputes all counters by querying design_render_items directly.
 * Determines the correct batch status from actual item state.
 * Safe to call concurrently — uses optimistic update (no advisory lock needed
 * since counter drift is corrected on every call).
 *
 * Status rules:
 *   - Any non-terminal items exist → processing (or cancelling if batch is cancelling)
 *   - All completed              → completed
 *   - completed + failed exist   → partially_failed
 *   - all failed (or cancelled)  → failed | cancelled based on batch flag
 *   - all terminal + cancellation active → cancelled
 */
export async function reconcileDesignRenderBatch(
  tenantId: string,
  batchId: number,
  _executor?: unknown, // reserved for Team 2 transaction injection
): Promise<DesignRenderBatchSummary> {
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

  if (!batch) throw new Error(`Batch #${batchId} not found for tenant ${tenantId}`);

  // Count items by status in one query
  const statusCounts = await db
    .select({
      status: designRenderItemsTable.status,
      cnt: sql<number>`count(*)::int`,
    })
    .from(designRenderItemsTable)
    .where(eq(designRenderItemsTable.batchId, batchId))
    .groupBy(designRenderItemsTable.status);

  const byStatus = Object.fromEntries(statusCounts.map((r) => [r.status, r.cnt]));
  const queued     = Math.max(0, byStatus["queued"]     ?? 0);
  const processing = Math.max(0, byStatus["processing"] ?? 0);
  const completed  = Math.max(0, byStatus["completed"]  ?? 0);
  const failed     = Math.max(0, byStatus["failed"]     ?? 0);
  const cancelled  = Math.max(0, byStatus["cancelled"]  ?? 0);
  const total      = queued + processing + completed + failed + cancelled;

  // Determine next batch status
  let newStatus: string = batch.status;
  const isCancelling = batch.status === "cancelling" || batch.status === "cancelled";

  if (isBatchTerminal(batch.status)) {
    // Terminal: allow fixing partially_failed ↔ failed drift if items changed.
    if (queued === 0 && processing === 0) {
      if (isCancelling || cancelled > 0) {
        newStatus = "cancelled";
      } else if (failed === 0) {
        newStatus = "completed";
      } else if (completed === 0) {
        newStatus = "failed";
      } else {
        newStatus = "partially_failed";
      }
    }
  } else if (queued > 0 || processing > 0) {
    // Still work to do
    newStatus = isCancelling ? "cancelling" : (batch.status === "dispatching" ? "dispatching" : "processing");
  } else {
    // All items have reached a terminal state
    if (isCancelling) {
      newStatus = "cancelled";
    } else if (failed === 0) {
      newStatus = "completed";
    } else if (completed === 0) {
      newStatus = "failed";
    } else {
      newStatus = "partially_failed";
    }
  }

  const isNowTerminal =
    newStatus === "completed" ||
    newStatus === "partially_failed" ||
    newStatus === "failed" ||
    newStatus === "cancelled";

  const updates: Record<string, unknown> = {
    totalItems:      total,
    queuedItems:     queued,
    processingItems: processing,
    completedItems:  completed,
    failedItems:     failed,
    cancelledItems:  cancelled,
    status:          newStatus,
  };
  if (isNowTerminal && !batch.completedAt) {
    updates["completedAt"] = new Date();
  }

  await db
    .update(designRenderBatchesTable)
    .set(updates)
    .where(eq(designRenderBatchesTable.id, batchId));

  const progressPercent =
    total > 0 ? Math.min(100, Math.round(((completed + failed + cancelled) / total) * 100)) : 0;

  return {
    batchId,
    tenantId,
    status: newStatus,
    counts: { total, queued, processing, completed, failed, cancelled },
    progressPercent,
  };
}

/**
 * Backward-compat alias used by Phase 2 worker service.
 * @deprecated Use reconcileDesignRenderBatch() instead.
 */
export async function syncBatchProgress(batchId: number): Promise<DesignRenderBatchSummary> {
  // Find the tenantId from the batch row
  const [batch] = await db
    .select({ tenantId: designRenderBatchesTable.tenantId })
    .from(designRenderBatchesTable)
    .where(eq(designRenderBatchesTable.id, batchId))
    .limit(1);
  if (!batch) throw new Error(`Batch #${batchId} not found`);
  return reconcileDesignRenderBatch(batch.tenantId, batchId);
}

// ── Export Snapshot (Team 2 contract) ────────────────────────────────────────

/**
 * Build a stable snapshot of the batch for ZIP export.
 * Reconciles before returning to ensure counters and status are accurate.
 */
export async function getExportableBatchSnapshot(
  tenantId: string,
  batchId: number,
): Promise<ExportableBatchSnapshot> {
  // Reconcile first to ensure data accuracy
  await reconcileDesignRenderBatch(tenantId, batchId);

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

  if (!batch) throw new Error(`Batch #${batchId} not found for tenant ${tenantId}`);
  assertTenantMatch(batch.tenantId, tenantId, `snapshot#${batchId}`);

  const allItems = await db
    .select()
    .from(designRenderItemsTable)
    .where(
      and(
        eq(designRenderItemsTable.batchId, batchId),
        eq(designRenderItemsTable.tenantId, tenantId),
      ),
    )
    .orderBy(designRenderItemsTable.rowIndex);

  const completedItems = allItems
    .filter((i) => i.status === "completed")
    .map((i) => ({
      id: String(i.id),
      rowIndex: i.rowIndex,
      outputAssetId: i.outputAssetId ?? i.outputStoragePath,
      outputPath: i.outputStoragePath,
      outputUrl: i.outputUrl,
      outputFormat: i.outputFormat ?? batch.requestedFormat,
      width: i.outputWidth,
      height: i.outputHeight,
      inputHash: i.inputHash,
    }));

  const failedItems = allItems
    .filter((i) => i.status === "failed")
    .map((i) => ({
      id: String(i.id),
      rowIndex: i.rowIndex,
      errorCode: i.errorCode,
      errorMessage: i.errorMessage,
      attemptCount: i.attemptCount,
    }));

  // Fingerprint: hash of batchId + status + item count
  const { createHash } = await import("crypto");
  const sourceFingerprint = createHash("sha256")
    .update(`${batchId}:${batch.status}:${allItems.length}:${completedItems.length}`)
    .digest("hex")
    .slice(0, 16);

  return {
    batch: {
      id: String(batch.id),
      tenantId: batch.tenantId,
      templateId: String(batch.templateId),
      templateVersionId: String(batch.templateVersionId),
      name: batch.name,
      status: batch.status,
      outputFormat: batch.requestedFormat,
    },
    completedItems,
    failedItems,
    sourceFingerprint,
  };
}
