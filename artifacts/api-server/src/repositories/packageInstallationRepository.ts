/**
 * repositories/packageInstallationRepository.ts — WP-02 pilot domain
 * repository for the Marketplace Installation domain (ai_installed_packages),
 * extended by WP-04/WP-05 with soft-delete, archive, restore, and purge.
 *
 * WP-04 additions:
 *   - findInstallation / listInstalled now exclude soft-deleted rows by default
 *     (deleted_at IS NULL). Pass ctx with includeDeleted=true to include them.
 *   - softDeleteById  — marks a row deleted_at=NOW(); throws
 *     RepositoryAlreadyDeletedError if the row is already soft-deleted.
 *   - restoreById     — clears deleted_at (and archived_at) on a deleted row.
 *
 * WP-05 additions:
 *   - archiveById     — marks archived_at=NOW() (orthogonal to deleted_at).
 *   - unarchiveById   — clears archived_at.
 *   - purgeExpiredInstallations — platform-scoped hard-DELETE of records whose
 *     deleted_at is older than the policy retention window. Delegates to
 *     retentionPolicy.runPurge for audit and platform-scope enforcement.
 */
import { eq, and } from "drizzle-orm";
import { db, aiInstalledPackagesTable, type AiInstalledPackage } from "@workspace/db";
import { requireTenantId } from "./tenantScope.js";
import { resolveExecutor, withExecutor, type RepositoryContext, type DbExecutor } from "./types.js";
import { emitRepositoryAuditRecord } from "./auditHook.js";
import { softDeleteGuard, purgeEligibleGuard } from "./softDelete.js";
import { runPurge, type RetentionPolicy, type PurgeResult } from "./retentionPolicy.js";
import { RepositoryAlreadyDeletedError, RepositoryNotFoundError } from "./errors.js";
import { logAudit } from "../services/aiAuditService.js";

const AUDIT_MODULE = "marketplace";
const AUDIT_RESOURCE_TYPE = "installed_package";

export type PackageType = "skill" | "tool";

// ── Transaction helper ─────────────────────────────────────────────────────────

/** Runs `fn` inside a single db.transaction, giving it a RepositoryContext bound to that transaction's executor. */
export async function withTransaction<T>(
  ctx: RepositoryContext,
  fn: (txCtx: RepositoryContext) => Promise<T>,
): Promise<T> {
  if (ctx.executor) {
    // Already inside a transaction — reuse it rather than nesting a second
    // db.transaction, which drizzle does not support meaningfully here.
    return fn(ctx);
  }
  return db.transaction(async (tx) => fn(withExecutor(ctx, tx)));
}

// ── Read operations ────────────────────────────────────────────────────────────

/**
 * Finds a single installation by (packageType, packageId), tenant-checked.
 * Excludes soft-deleted rows unless ctx.includeDeleted is true.
 */
export async function findInstallation(
  ctx: RepositoryContext,
  packageType: PackageType,
  packageId: number,
  opts: { forUpdate?: boolean } = {},
): Promise<AiInstalledPackage | undefined> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const base = executor
    .select()
    .from(aiInstalledPackagesTable)
    .where(
      and(
        eq(aiInstalledPackagesTable.tenantId, tenantId),
        eq(aiInstalledPackagesTable.packageType, packageType),
        eq(aiInstalledPackagesTable.packageId, packageId),
        softDeleteGuard(aiInstalledPackagesTable.deletedAt, ctx),
      ),
    );
  const rows = opts.forUpdate
    ? await (base as unknown as { for: (mode: string) => Promise<AiInstalledPackage[]> }).for("update")
    : await base;
  return rows[0];
}

/**
 * Lists all installations for a tenant.
 * Excludes soft-deleted rows unless ctx.includeDeleted is true.
 */
export async function listInstalled(
  ctx: RepositoryContext,
  packageType?: PackageType,
): Promise<AiInstalledPackage[]> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const whereClause = packageType
    ? and(
        eq(aiInstalledPackagesTable.tenantId, tenantId),
        eq(aiInstalledPackagesTable.packageType, packageType),
        softDeleteGuard(aiInstalledPackagesTable.deletedAt, ctx),
      )
    : and(
        eq(aiInstalledPackagesTable.tenantId, tenantId),
        softDeleteGuard(aiInstalledPackagesTable.deletedAt, ctx),
      );
  return executor.select().from(aiInstalledPackagesTable).where(whereClause);
}

// ── Write operations ───────────────────────────────────────────────────────────

export async function insertInstallation(
  ctx: RepositoryContext,
  values: { packageType: PackageType; packageId: number; installedVersion: string; configurationJson: Record<string, unknown> },
): Promise<AiInstalledPackage> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const [row] = await executor
    .insert(aiInstalledPackagesTable)
    .values({
      tenantId,
      packageId: values.packageId,
      packageType: values.packageType,
      installedVersion: values.installedVersion,
      enabled: true,
      configurationJson: values.configurationJson,
    })
    .returning();

  // WP-03: every write on this pilot domain produces exactly one audit row —
  // no manual logAudit call needed at the packageManagerService.ts call site.
  await emitRepositoryAuditRecord(ctx, {
    module: AUDIT_MODULE,
    operation: "create",
    action: "package_installed",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: row.id,
    after: row as unknown as Record<string, unknown>,
  });
  return row;
}

export async function updateInstallationById(
  ctx: RepositoryContext,
  id: number,
  patch: Partial<Pick<AiInstalledPackage, "installedVersion" | "enabled">>,
): Promise<AiInstalledPackage | undefined> {
  // Defense-in-depth: re-assert tenant scope even when looking up by primary key.
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const before = await findInstallationById(ctx, id);
  const [row] = await executor
    .update(aiInstalledPackagesTable)
    .set(patch)
    .where(
      and(
        eq(aiInstalledPackagesTable.id, id),
        eq(aiInstalledPackagesTable.tenantId, tenantId),
        softDeleteGuard(aiInstalledPackagesTable.deletedAt, ctx),
      ),
    )
    .returning();

  if (row) {
    await emitRepositoryAuditRecord(ctx, {
      module: AUDIT_MODULE,
      operation: "update",
      action: "package_updated",
      resourceType: AUDIT_RESOURCE_TYPE,
      resourceId: id,
      before: before as unknown as Record<string, unknown> | undefined,
      after: row as unknown as Record<string, unknown>,
    });
  }
  return row;
}

export async function deleteInstallationById(ctx: RepositoryContext, id: number): Promise<void> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const before = await findInstallationById(ctx, id);
  await executor.delete(aiInstalledPackagesTable).where(and(eq(aiInstalledPackagesTable.id, id), eq(aiInstalledPackagesTable.tenantId, tenantId)));

  if (before) {
    await emitRepositoryAuditRecord(ctx, {
      module: AUDIT_MODULE,
      operation: "delete",
      action: "package_removed",
      resourceType: AUDIT_RESOURCE_TYPE,
      resourceId: id,
      before: before as unknown as Record<string, unknown>,
    });
  }
}

/** Internal helper: fetch a single row by (tenant-scoped) id, for before/after audit snapshots. */
async function findInstallationById(ctx: RepositoryContext, id: number): Promise<AiInstalledPackage | undefined> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const rows = await executor
    .select()
    .from(aiInstalledPackagesTable)
    .where(and(eq(aiInstalledPackagesTable.id, id), eq(aiInstalledPackagesTable.tenantId, tenantId)));
  return rows[0];
}

// ── WP-04: Soft delete & restore ──────────────────────────────────────────────

/**
 * Soft-deletes an installation by setting deleted_at = NOW().
 * Throws RepositoryNotFoundError if the row does not exist (or belongs to a
 * different tenant). Throws RepositoryAlreadyDeletedError if the row is
 * already soft-deleted.
 */
export async function softDeleteById(ctx: RepositoryContext, id: number): Promise<AiInstalledPackage> {
  return withTransaction(ctx, async (txCtx) => {
    const tenantId = requireTenantId(txCtx);
    const executor = resolveExecutor(txCtx, db) as DbExecutor;

    // Fetch current state (including deleted rows so we can give a specific error)
    const ctxWithDeleted = { ...txCtx, includeDeleted: true };
    const [existing] = await executor
      .select()
      .from(aiInstalledPackagesTable)
      .where(and(eq(aiInstalledPackagesTable.id, id), eq(aiInstalledPackagesTable.tenantId, tenantId)));

    if (!existing) throw new RepositoryNotFoundError("AiInstalledPackage", id);
    if (existing.deletedAt !== null) throw new RepositoryAlreadyDeletedError("AiInstalledPackage", id);
    void ctxWithDeleted; // used above for clarity; executor already has full visibility in the tx

    const now = new Date();
    const [updated] = await executor
      .update(aiInstalledPackagesTable)
      .set({ deletedAt: now })
      .where(and(eq(aiInstalledPackagesTable.id, id), eq(aiInstalledPackagesTable.tenantId, tenantId)))
      .returning();

    await logAudit("packageInstallationRepository", "soft_delete", String(id), "AiInstalledPackage", "success", {
      tenantId,
    });

    return updated;
  });
}

/**
 * Restores a soft-deleted installation by clearing deleted_at (and archived_at).
 * Throws RepositoryNotFoundError if the row does not exist.
 * No-ops gracefully if the row is already active (not deleted).
 */
export async function restoreById(ctx: RepositoryContext, id: number): Promise<AiInstalledPackage> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;

  const [updated] = await executor
    .update(aiInstalledPackagesTable)
    .set({ deletedAt: null, archivedAt: null })
    .where(and(eq(aiInstalledPackagesTable.id, id), eq(aiInstalledPackagesTable.tenantId, tenantId)))
    .returning();

  if (!updated) throw new RepositoryNotFoundError("AiInstalledPackage", id);

  await logAudit("packageInstallationRepository", "restore", String(id), "AiInstalledPackage", "success", { tenantId });
  return updated;
}

// ── WP-05: Archive & unarchive ────────────────────────────────────────────────

/**
 * Archives an installation by setting archived_at = NOW().
 * Archive is orthogonal to soft-delete: an active (not deleted) row can be
 * archived, hiding it from default list views while keeping it recoverable.
 * Throws RepositoryNotFoundError if the row does not exist or is soft-deleted.
 */
export async function archiveById(ctx: RepositoryContext, id: number): Promise<AiInstalledPackage> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;

  const [updated] = await executor
    .update(aiInstalledPackagesTable)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(aiInstalledPackagesTable.id, id),
        eq(aiInstalledPackagesTable.tenantId, tenantId),
        softDeleteGuard(aiInstalledPackagesTable.deletedAt, ctx),
      ),
    )
    .returning();

  if (!updated) throw new RepositoryNotFoundError("AiInstalledPackage", id);

  await logAudit("packageInstallationRepository", "archive", String(id), "AiInstalledPackage", "success", { tenantId });
  return updated;
}

/**
 * Unarchives an installation by clearing archived_at.
 * Throws RepositoryNotFoundError if the row does not exist.
 */
export async function unarchiveById(ctx: RepositoryContext, id: number): Promise<AiInstalledPackage> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;

  const [updated] = await executor
    .update(aiInstalledPackagesTable)
    .set({ archivedAt: null })
    .where(and(eq(aiInstalledPackagesTable.id, id), eq(aiInstalledPackagesTable.tenantId, tenantId)))
    .returning();

  if (!updated) throw new RepositoryNotFoundError("AiInstalledPackage", id);

  await logAudit("packageInstallationRepository", "unarchive", String(id), "AiInstalledPackage", "success", {
    tenantId,
  });
  return updated;
}

// ── WP-05: Retention purge ────────────────────────────────────────────────────

/**
 * Hard-deletes all soft-deleted installations whose deleted_at is older than
 * the policy's retention window. This is a DESTRUCTIVE, IRREVERSIBLE operation.
 *
 * Requires a platform-scoped RepositoryContext with an explicit
 * PlatformOperation (see repositories/tenantScope.ts :: requirePlatformScope).
 */
export async function purgeExpiredInstallations(
  ctx: RepositoryContext,
  policy: RetentionPolicy,
): Promise<PurgeResult> {
  return runPurge(ctx, policy, async (cutoffDate) => {
    const executor = resolveExecutor(ctx, db) as DbExecutor;
    const deleted = await executor
      .delete(aiInstalledPackagesTable)
      .where(purgeEligibleGuard(aiInstalledPackagesTable.deletedAt, cutoffDate))
      .returning({ id: aiInstalledPackagesTable.id });
    return deleted.length;
  });
}
