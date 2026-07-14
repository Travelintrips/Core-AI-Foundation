/**
 * repositories/creativeProjectRepository.ts — WP-04/WP-05 Creative Project
 * domain repository for creative_projects.
 *
 * FOUNDATION ONLY — per WP-02 precedent for domains without a tenantId column.
 * creative_projects has no tenant_id column yet; full tenant-scoped soft-delete
 * requires the column to be added in a future workpackage. Until then:
 *
 *   - Reads and mutations are scoped by projectId (a unique UUID),
 *     which is effectively a capability token for the project.
 *   - There is NO requireTenantId call here — do not fabricate a tenant
 *     filter where the schema has no column to enforce it, per the
 *     quotationRepository.ts precedent.
 *   - Purge is ONLY available via a platform-scoped context (requirePlatformScope)
 *     since there is no tenant boundary to limit the DELETE to.
 *
 * Call sites that already have a verified tenantId should pass it in the
 * RepositoryContext for audit purposes, but this repository does not use it
 * for row filtering until the schema migration adds the column.
 *
 * Scope note: does NOT touch status transitions, payment gates, brief logic,
 * workers, scheduler, SSE, quotation, or AI workflow — explicitly out of
 * scope for WP-04/WP-05.
 */
import { eq, and } from "drizzle-orm";
import { db, creativeProjectsTable, type CreativeProject } from "@workspace/db";
import { requirePlatformScope } from "./tenantScope.js";
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

// ── Read operations ────────────────────────────────────────────────────────────

/**
 * Finds a creative project by its client-facing UUID (projectId).
 * Excludes soft-deleted rows unless ctx.includeDeleted is true.
 * Returns undefined if the project does not exist or is soft-deleted.
 *
 * NOTE: No tenant check — creative_projects has no tenantId column.
 * The projectId UUID is the capability token; callers are responsible for
 * ensuring the UUID was obtained through a tenant-verified lookup.
 */
export async function findProjectByProjectId(
  ctx: RepositoryContext,
  projectId: string,
): Promise<CreativeProject | undefined> {
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const [row] = await executor
    .select()
    .from(creativeProjectsTable)
    .where(
      and(
        eq(creativeProjectsTable.projectId, projectId),
        softDeleteGuard(creativeProjectsTable.deletedAt, ctx),
      ),
    );
  return row;
}

// ── WP-04: Soft delete & restore ──────────────────────────────────────────────

/**
 * Soft-deletes a creative project by setting deleted_at = NOW().
 * Throws RepositoryNotFoundError if projectId does not exist.
 * Throws RepositoryAlreadyDeletedError if the project is already soft-deleted.
 *
 * NOTE: No tenant guard — scoped by projectId UUID only.
 */
export async function softDeleteByProjectId(
  ctx: RepositoryContext,
  projectId: string,
): Promise<CreativeProject> {
  return withTransaction(ctx, async (txCtx) => {
    const executor = resolveExecutor(txCtx, db) as DbExecutor;

    const [existing] = await executor
      .select()
      .from(creativeProjectsTable)
      .where(eq(creativeProjectsTable.projectId, projectId));

    if (!existing) throw new RepositoryNotFoundError("CreativeProject", projectId);
    if (existing.deletedAt !== null) throw new RepositoryAlreadyDeletedError("CreativeProject", projectId);

    const [updated] = await executor
      .update(creativeProjectsTable)
      .set({ deletedAt: new Date() })
      .where(eq(creativeProjectsTable.projectId, projectId))
      .returning();

    await logAudit(
      "creativeProjectRepository",
      "soft_delete",
      projectId,
      "CreativeProject",
      "success",
      { tenantId: ctx.requestContext.tenantId ?? "unknown" },
    );

    return updated;
  });
}

/**
 * Restores a soft-deleted project by clearing deleted_at (and archived_at).
 * Throws RepositoryNotFoundError if projectId does not exist.
 * No-ops gracefully if the project is already active.
 */
export async function restoreByProjectId(
  ctx: RepositoryContext,
  projectId: string,
): Promise<CreativeProject> {
  const executor = resolveExecutor(ctx, db) as DbExecutor;

  const [updated] = await executor
    .update(creativeProjectsTable)
    .set({ deletedAt: null, archivedAt: null })
    .where(eq(creativeProjectsTable.projectId, projectId))
    .returning();

  if (!updated) throw new RepositoryNotFoundError("CreativeProject", projectId);

  await logAudit(
    "creativeProjectRepository",
    "restore",
    projectId,
    "CreativeProject",
    "success",
    { tenantId: ctx.requestContext.tenantId ?? "unknown" },
  );

  return updated;
}

// ── WP-05: Archive & unarchive ────────────────────────────────────────────────

/**
 * Archives a project by setting archived_at = NOW(). Only applies to active
 * (not soft-deleted) rows.
 * Throws RepositoryNotFoundError if project does not exist or is soft-deleted.
 */
export async function archiveByProjectId(
  ctx: RepositoryContext,
  projectId: string,
): Promise<CreativeProject> {
  const executor = resolveExecutor(ctx, db) as DbExecutor;

  const [updated] = await executor
    .update(creativeProjectsTable)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(creativeProjectsTable.projectId, projectId),
        softDeleteGuard(creativeProjectsTable.deletedAt, ctx),
      ),
    )
    .returning();

  if (!updated) throw new RepositoryNotFoundError("CreativeProject", projectId);

  await logAudit(
    "creativeProjectRepository",
    "archive",
    projectId,
    "CreativeProject",
    "success",
    { tenantId: ctx.requestContext.tenantId ?? "unknown" },
  );

  return updated;
}

/**
 * Unarchives a project by clearing archived_at.
 * Throws RepositoryNotFoundError if project does not exist.
 */
export async function unarchiveByProjectId(
  ctx: RepositoryContext,
  projectId: string,
): Promise<CreativeProject> {
  const executor = resolveExecutor(ctx, db) as DbExecutor;

  const [updated] = await executor
    .update(creativeProjectsTable)
    .set({ archivedAt: null })
    .where(eq(creativeProjectsTable.projectId, projectId))
    .returning();

  if (!updated) throw new RepositoryNotFoundError("CreativeProject", projectId);

  await logAudit(
    "creativeProjectRepository",
    "unarchive",
    projectId,
    "CreativeProject",
    "success",
    { tenantId: ctx.requestContext.tenantId ?? "unknown" },
  );

  return updated;
}

// ── WP-05: Retention purge ────────────────────────────────────────────────────

/**
 * Hard-deletes all soft-deleted creative projects whose deleted_at is older
 * than the policy retention window. DESTRUCTIVE and IRREVERSIBLE.
 *
 * REQUIRES platform scope — creative_projects has no tenantId column, so
 * the DELETE is cross-tenant by nature. Always declare an explicit
 * PlatformOperation on the RepositoryContext before calling this.
 */
export async function purgeExpiredProjects(
  ctx: RepositoryContext,
  policy: RetentionPolicy,
): Promise<PurgeResult> {
  // requirePlatformScope is called inside runPurge via requirePlatformScope(ctx)
  // but we explicitly guard here too to make the requirement visible at the
  // call site and give a clear error message in context.
  requirePlatformScope(ctx);

  return runPurge(ctx, policy, async (cutoffDate) => {
    const executor = resolveExecutor(ctx, db) as DbExecutor;
    const deleted = await executor
      .delete(creativeProjectsTable)
      .where(purgeEligibleGuard(creativeProjectsTable.deletedAt, cutoffDate))
      .returning({ id: creativeProjectsTable.id });
    return deleted.length;
  });
}
