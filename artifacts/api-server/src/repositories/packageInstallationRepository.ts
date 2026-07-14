/**
 * repositories/packageInstallationRepository.ts — WP-02 pilot domain
 * repository for the Marketplace Installation domain
 * (ai_installed_packages), used by services/packageManagerService.ts.
 *
 * Design notes:
 *   - Every function takes a RepositoryContext first, resolves the tenantId
 *     via requireTenantId (never trusts a bare string param), and builds its
 *     own explicit `where(eq(..., tenantId))` clause.
 *   - `withTransaction` is the ONLY way to get a RepositoryContext whose
 *     `executor` points at a live transaction; nested transactions are
 *     rejected so a caller can never accidentally fall back to the
 *     module-level `db` client mid-transaction.
 *   - This repository does not change any behavior of the pre-existing
 *     packageManagerService.ts functions — it is the new home for the raw
 *     `db`/`tx` calls that module used to make directly. See
 *     services/packageManagerService.ts for how it is wired in via
 *     adaptLegacyTenantContext (WP-01's transitional adapter for legacy
 *     call sites that still take a bare tenantId parameter).
 */
import { eq, and } from "drizzle-orm";
import { db, aiInstalledPackagesTable, type AiInstalledPackage } from "@workspace/db";
import { requireTenantId } from "./tenantScope.js";
import { resolveExecutor, withExecutor, type RepositoryContext, type DbExecutor } from "./types.js";

export type PackageType = "skill" | "tool";

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
      ),
    );
  const rows = opts.forUpdate ? await (base as unknown as { for: (mode: string) => Promise<AiInstalledPackage[]> }).for("update") : await base;
  return rows[0];
}

export async function listInstalled(
  ctx: RepositoryContext,
  packageType?: PackageType,
): Promise<AiInstalledPackage[]> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const whereClause = packageType
    ? and(eq(aiInstalledPackagesTable.tenantId, tenantId), eq(aiInstalledPackagesTable.packageType, packageType))
    : eq(aiInstalledPackagesTable.tenantId, tenantId);
  return executor.select().from(aiInstalledPackagesTable).where(whereClause);
}

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
  return row;
}

export async function updateInstallationById(
  ctx: RepositoryContext,
  id: number,
  patch: Partial<Pick<AiInstalledPackage, "installedVersion" | "enabled">>,
): Promise<AiInstalledPackage | undefined> {
  // Defense-in-depth: re-assert tenant scope even though the row is looked
  // up by primary key — a repository call must never trust that its caller
  // already validated the id belongs to this tenant.
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const [row] = await executor
    .update(aiInstalledPackagesTable)
    .set(patch)
    .where(and(eq(aiInstalledPackagesTable.id, id), eq(aiInstalledPackagesTable.tenantId, tenantId)))
    .returning();
  return row;
}

export async function deleteInstallationById(ctx: RepositoryContext, id: number): Promise<void> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  await executor.delete(aiInstalledPackagesTable).where(and(eq(aiInstalledPackagesTable.id, id), eq(aiInstalledPackagesTable.tenantId, tenantId)));
}
