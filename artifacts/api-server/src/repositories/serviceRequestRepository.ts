/**
 * repositories/serviceRequestRepository.ts — WP-04/WP-05 Service Request
 * domain repository for ai_service_requests.
 *
 * This is a new WP-04 repository (ai_service_requests had no repository in
 * WP-02). It ships with soft-delete, archive/restore, and retention purge
 * built-in from day one, following the packageInstallationRepository pattern.
 *
 * Tenant scoping: ai_service_requests has a nullable tenantId column —
 * null means "default" tenant, matching the existing marketplace convention
 * (see tenantResolution.ts). requireTenantId is called on every mutation;
 * reads use the same convention as quotationRepository.ts (row.tenantId null
 * is treated as belonging to every tenant context — revisit before real
 * multi-tenancy ships).
 *
 * Scope note: this repository provides data-access primitives only. It does
 * NOT replace or touch aiQuotationService.ts, the commercial gate logic,
 * the pricing engine, or any scheduler/worker logic — those are explicitly
 * out of scope for WP-04/WP-05.
 */
import { eq, and, desc } from "drizzle-orm";
import { db, aiServiceRequestsTable, type AiServiceRequest } from "@workspace/db";
import { requireTenantId } from "./tenantScope.js";
import { resolveExecutor, withExecutor, type RepositoryContext, type DbExecutor } from "./types.js";
import { softDeleteGuard, purgeEligibleGuard } from "./softDelete.js";
import { runPurge, type RetentionPolicy, type PurgeResult } from "./retentionPolicy.js";
import { RepositoryAlreadyDeletedError, RepositoryNotFoundError } from "./errors.js";
import { logAudit } from "../services/aiAuditService.js";

// ── Transaction helper ─────────────────────────────────────────────────────────

/** Runs `fn` inside a db.transaction, binding the tx as executor. */
export async function withTransaction<T>(
  ctx: RepositoryContext,
  fn: (txCtx: RepositoryContext) => Promise<T>,
): Promise<T> {
  if (ctx.executor) return fn(ctx);
  return db.transaction(async (tx) => fn(withExecutor(ctx, tx)));
}

// ── Internal tenant check ──────────────────────────────────────────────────────

/**
 * Returns true when the row belongs to the requesting tenant.
 * A null tenantId on the row is treated as the "default" tenant (shared),
 * matching the existing single-tenant convention.
 */
function rowBelongsToTenant(row: AiServiceRequest, tenantId: string): boolean {
  return row.tenantId === null || row.tenantId === tenantId;
}

// ── Read operations ────────────────────────────────────────────────────────────

/**
 * Find a single service request by primary key, tenant-checked.
 * Returns undefined for both "not found" and "wrong tenant" (fail-closed).
 * Excludes soft-deleted rows unless ctx.includeDeleted is true.
 */
export async function findServiceRequest(
  ctx: RepositoryContext,
  id: number,
): Promise<AiServiceRequest | undefined> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const [row] = await executor
    .select()
    .from(aiServiceRequestsTable)
    .where(
      and(
        eq(aiServiceRequestsTable.id, id),
        softDeleteGuard(aiServiceRequestsTable.deletedAt, ctx),
      ),
    );
  if (!row || !rowBelongsToTenant(row, tenantId)) return undefined;
  return row;
}

/**
 * Find a single service request by its client-facing UUID requestId.
 * Returns undefined for both "not found" and "wrong tenant" (fail-closed).
 * Excludes soft-deleted rows unless ctx.includeDeleted is true.
 */
export async function findServiceRequestByRequestId(
  ctx: RepositoryContext,
  requestId: string,
): Promise<AiServiceRequest | undefined> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const [row] = await executor
    .select()
    .from(aiServiceRequestsTable)
    .where(
      and(
        eq(aiServiceRequestsTable.requestId, requestId),
        softDeleteGuard(aiServiceRequestsTable.deletedAt, ctx),
      ),
    );
  if (!row || !rowBelongsToTenant(row, tenantId)) return undefined;
  return row;
}

/**
 * List service requests for a tenant, newest first.
 * Excludes soft-deleted rows unless ctx.includeDeleted is true.
 *
 * @param opts.status   Optional status filter (e.g. "draft", "completed")
 * @param opts.limit    Page size (default 50)
 * @param opts.offset   Page offset (default 0)
 */
export async function listServiceRequests(
  ctx: RepositoryContext,
  opts: { status?: string; limit?: number; offset?: number } = {},
): Promise<AiServiceRequest[]> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const { limit = 50, offset = 0, status } = opts;

  // Build tenant clause — null tenantId rows are treated as shared
  const tenantFilter = eq(aiServiceRequestsTable.tenantId, tenantId);
  const deleteFilter = softDeleteGuard(aiServiceRequestsTable.deletedAt, ctx);
  const statusFilter = status ? eq(aiServiceRequestsTable.status, status) : undefined;

  return executor
    .select()
    .from(aiServiceRequestsTable)
    .where(and(tenantFilter, deleteFilter, statusFilter))
    .orderBy(desc(aiServiceRequestsTable.createdAt))
    .limit(limit)
    .offset(offset);
}

// ── WP-04: Soft delete & restore ──────────────────────────────────────────────

/**
 * Soft-deletes a service request by setting deleted_at = NOW().
 * Throws RepositoryNotFoundError  if the row does not exist or belongs to
 * a different tenant.
 * Throws RepositoryAlreadyDeletedError if the row is already soft-deleted.
 */
export async function softDeleteById(ctx: RepositoryContext, id: number): Promise<AiServiceRequest> {
  return withTransaction(ctx, async (txCtx) => {
    const tenantId = requireTenantId(txCtx);
    const executor = resolveExecutor(txCtx, db) as DbExecutor;

    // Read current state (include deleted to give a specific error)
    const [existing] = await executor
      .select()
      .from(aiServiceRequestsTable)
      .where(eq(aiServiceRequestsTable.id, id));

    if (!existing || !rowBelongsToTenant(existing, tenantId)) {
      throw new RepositoryNotFoundError("AiServiceRequest", id);
    }
    if (existing.deletedAt !== null) {
      throw new RepositoryAlreadyDeletedError("AiServiceRequest", id);
    }

    const [updated] = await executor
      .update(aiServiceRequestsTable)
      .set({ deletedAt: new Date() })
      .where(eq(aiServiceRequestsTable.id, id))
      .returning();

    await logAudit("serviceRequestRepository", "soft_delete", String(id), "AiServiceRequest", "success", { tenantId });
    return updated;
  });
}

/**
 * Restores a soft-deleted service request by clearing deleted_at (and
 * archived_at). No-ops if the row is already active.
 * Throws RepositoryNotFoundError if the row does not exist or wrong tenant.
 */
export async function restoreById(ctx: RepositoryContext, id: number): Promise<AiServiceRequest> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;

  const [existing] = await executor
    .select()
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.id, id));

  if (!existing || !rowBelongsToTenant(existing, tenantId)) {
    throw new RepositoryNotFoundError("AiServiceRequest", id);
  }

  const [updated] = await executor
    .update(aiServiceRequestsTable)
    .set({ deletedAt: null, archivedAt: null })
    .where(eq(aiServiceRequestsTable.id, id))
    .returning();

  await logAudit("serviceRequestRepository", "restore", String(id), "AiServiceRequest", "success", { tenantId });
  return updated;
}

// ── WP-05: Archive & unarchive ────────────────────────────────────────────────

/**
 * Archives a service request by setting archived_at = NOW().
 * Archive is orthogonal to soft-delete: only active (not deleted) rows can
 * be archived through this function.
 * Throws RepositoryNotFoundError if the row does not exist, is soft-deleted,
 * or belongs to a different tenant.
 */
export async function archiveById(ctx: RepositoryContext, id: number): Promise<AiServiceRequest> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;

  // Only match active (not deleted) rows via softDeleteGuard
  const [updated] = await executor
    .update(aiServiceRequestsTable)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(aiServiceRequestsTable.id, id),
        softDeleteGuard(aiServiceRequestsTable.deletedAt, ctx),
      ),
    )
    .returning();

  if (!updated || !rowBelongsToTenant(updated, tenantId)) {
    throw new RepositoryNotFoundError("AiServiceRequest", id);
  }

  await logAudit("serviceRequestRepository", "archive", String(id), "AiServiceRequest", "success", { tenantId });
  return updated;
}

/**
 * Unarchives a service request by clearing archived_at.
 * Throws RepositoryNotFoundError if the row does not exist or wrong tenant.
 */
export async function unarchiveById(ctx: RepositoryContext, id: number): Promise<AiServiceRequest> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;

  const [existing] = await executor
    .select()
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.id, id));

  if (!existing || !rowBelongsToTenant(existing, tenantId)) {
    throw new RepositoryNotFoundError("AiServiceRequest", id);
  }

  const [updated] = await executor
    .update(aiServiceRequestsTable)
    .set({ archivedAt: null })
    .where(eq(aiServiceRequestsTable.id, id))
    .returning();

  await logAudit("serviceRequestRepository", "unarchive", String(id), "AiServiceRequest", "success", { tenantId });
  return updated;
}

// ── WP-05: Retention purge ────────────────────────────────────────────────────

/**
 * Hard-deletes all soft-deleted service requests whose deleted_at is older
 * than the policy retention window. DESTRUCTIVE and IRREVERSIBLE.
 *
 * Requires a platform-scoped context with an explicit PlatformOperation.
 */
export async function purgeExpiredServiceRequests(
  ctx: RepositoryContext,
  policy: RetentionPolicy,
): Promise<PurgeResult> {
  return runPurge(ctx, policy, async (cutoffDate) => {
    const executor = resolveExecutor(ctx, db) as DbExecutor;
    const deleted = await executor
      .delete(aiServiceRequestsTable)
      .where(purgeEligibleGuard(aiServiceRequestsTable.deletedAt, cutoffDate))
      .returning({ id: aiServiceRequestsTable.id });
    return deleted.length;
  });
}
