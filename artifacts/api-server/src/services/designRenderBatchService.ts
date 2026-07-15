/**
 * Design Template Engine — Batch Render Service
 *
 * Creates and manages design_render_batches + design_render_items.
 * Each item is enqueued as an independent job so it can be retried
 * separately without affecting the rest of the batch.
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
  if (input.items.length > DESIGN_LIMITS.MAX_BATCH_SIZE) {
    throw new Error(`Batch exceeds maximum size of ${DESIGN_LIMITS.MAX_BATCH_SIZE} items`);
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

  // Insert all items in one round-trip
  const itemValues: NewDesignRenderItem[] = input.items.map((data, rowIndex) => ({
    tenantId: input.tenantId,
    batchId: batch!.id,
    templateId: input.templateId,
    templateVersionId: input.templateVersionId,
    rowIndex,
    inputData: data as unknown as Record<string, unknown>,
    inputHash: computeInputHash(input.templateVersionId, data),
    status: "queued",
    queuedAt: new Date(),
  }));

  await db.insert(designRenderItemsTable).values(itemValues);

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

export async function getBatchItems(
  batchId: number,
  tenantId: string,
  opts: { status?: string; page?: number; pageSize?: number } = {},
) {
  // Verify batch ownership
  const batch = await getBatch(batchId, tenantId);
  if (!batch) return null;

  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(opts.pageSize ?? 50, 200);
  const offset = (page - 1) * pageSize;

  const conditions = [
    eq(designRenderItemsTable.batchId, batchId),
    eq(designRenderItemsTable.tenantId, tenantId),
  ];
  if (opts.status) conditions.push(eq(designRenderItemsTable.status, opts.status));

  const [rows, countRow] = await Promise.all([
    db
      .select()
      .from(designRenderItemsTable)
      .where(and(...conditions))
      .orderBy(designRenderItemsTable.rowIndex)
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(designRenderItemsTable)
      .where(and(...conditions)),
  ]);

  return { items: rows, total: countRow[0]?.count ?? 0, page, pageSize };
}

// ── Batch Lifecycle ───────────────────────────────────────────────────────────

export async function startBatch(batchId: number, tenantId: string, startedBy: string) {
  const batch = await getBatch(batchId, tenantId);
  if (!batch) throw new Error(`Batch #${batchId} not found`);
  if (batch.status !== "draft") throw new Error(`Batch is already in state: ${batch.status}`);

  await db
    .update(designRenderBatchesTable)
    .set({ status: "queued", startedAt: new Date() })
    .where(eq(designRenderBatchesTable.id, batchId));

  // Enqueue a dispatcher job — it will fan out individual render items
  await enqueue({
    jobType: "design_render_batch_dispatch",
    payloadJson: { batchId, tenantId },
    priority: 50,
    tenantId,
  });

  await logAudit({
    module: "design-template-engine",
    action: "batch_started",
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

  const terminalStates = ["completed", "failed", "cancelled"];
  if (terminalStates.includes(batch.status)) {
    throw new Error(`Batch is already in terminal state: ${batch.status}`);
  }

  await db
    .update(designRenderBatchesTable)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(designRenderBatchesTable.id, batchId));

  // Cancel queued items
  await db
    .update(designRenderItemsTable)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(designRenderItemsTable.batchId, batchId),
        inArray(designRenderItemsTable.status, ["queued"]),
      ),
    );

  await logAudit({
    module: "design-template-engine",
    action: "batch_cancelled",
    resourceType: "design_render_batch",
    resourceId: String(batchId),
    status: "success",
    details: { cancelledBy },
  });

  return { batchId, status: "cancelled" };
}

export async function retryFailedItems(batchId: number, tenantId: string, retriedBy: string) {
  const batch = await getBatch(batchId, tenantId);
  if (!batch) throw new Error(`Batch #${batchId} not found`);

  // Reset failed items to queued
  const result = await db
    .update(designRenderItemsTable)
    .set({
      status: "queued",
      errorCode: null,
      errorMessage: null,
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

  // Re-enqueue dispatcher
  await enqueue({
    jobType: "design_render_batch_dispatch",
    payloadJson: { batchId, tenantId, retryOnly: true },
    priority: 50,
    tenantId,
  });

  // Reset batch status if it was in a terminal failed state
  if (batch.status === "failed" || batch.status === "partially_failed") {
    await db
      .update(designRenderBatchesTable)
      .set({ status: "processing" })
      .where(eq(designRenderBatchesTable.id, batchId));
  }

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

// ── Progress Aggregation ──────────────────────────────────────────────────────

/** Recomputes counters from actual item states and updates the batch row. */
export async function syncBatchProgress(batchId: number) {
  const counts = await db
    .select({
      status: designRenderItemsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(designRenderItemsTable)
    .where(eq(designRenderItemsTable.batchId, batchId))
    .groupBy(designRenderItemsTable.status);

  const byStatus = Object.fromEntries(counts.map((r) => [r.status, r.count]));
  const queued = byStatus["queued"] ?? 0;
  const processing = byStatus["processing"] ?? 0;
  const completed = byStatus["completed"] ?? 0;
  const failed = byStatus["failed"] ?? 0;
  const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);

  let newStatus = "processing";
  if (queued === 0 && processing === 0) {
    newStatus = failed === 0 ? "completed" : completed === 0 ? "failed" : "partially_failed";
  }

  const updates: Record<string, unknown> = {
    queuedItems: queued,
    processingItems: processing,
    completedItems: completed,
    failedItems: failed,
    totalItems: total,
    status: newStatus,
  };
  if (newStatus === "completed" || newStatus === "failed" || newStatus === "partially_failed") {
    updates["completedAt"] = new Date();
  }

  await db
    .update(designRenderBatchesTable)
    .set(updates)
    .where(eq(designRenderBatchesTable.id, batchId));

  return { batchId, status: newStatus, queued, processing, completed, failed, total };
}
