/**
 * repositories/softDelete.ts — WP-04 soft-delete SQL expression helpers.
 *
 * These helpers return Drizzle SQL expressions encoding the standard
 * soft-delete filter semantics. They are purely composable predicates —
 * they do not build complete queries, touch the database, or have side
 * effects. Each domain repository composes them into its own explicit
 * where() clauses, consistent with the WP-02 "no hidden query builder"
 * principle (see repositories/types.ts §non-goals).
 *
 * Standard columns added by WP-04 DDL migration
 * (scripts/migrations/wp04-wp05-soft-delete.sql):
 *   deleted_at   TIMESTAMPTZ nullable — set on soft-delete, NULL = active
 *   archived_at  TIMESTAMPTZ nullable — set on archive, NULL = not archived
 *
 * Visibility semantics:
 *   active    deleted_at IS NULL           (default for all list/find ops)
 *   deleted   deleted_at IS NOT NULL
 *   archived  archived_at IS NOT NULL      (orthogonal to deleted_at)
 *   all       no filter                   (platform-scoped purge/admin only)
 */
import { isNull, isNotNull, and, lt, type SQL } from "drizzle-orm";
import type { RepositoryContext } from "./types.js";

/**
 * Matches what drizzle-orm's `isNull` / `isNotNull` accept as their first
 * argument: any Drizzle column reference or SQL expression.
 */
export type DrizzleExpr = Parameters<typeof isNull>[0];

/**
 * Returns `deleted_at IS NULL`, or `undefined` (no additional clause) when
 * `ctx.includeDeleted` is true.
 *
 * Pass the return value straight to drizzle's `and()` — it handles
 * `undefined` by ignoring the entry, so no conditional needed at call sites:
 *
 *   .where(and(eq(t.tenantId, tenantId), softDeleteGuard(t.deletedAt, ctx)))
 */
export function softDeleteGuard(deletedAtCol: DrizzleExpr, ctx: RepositoryContext): SQL | undefined {
  return ctx.includeDeleted ? undefined : (isNull(deletedAtCol) as SQL);
}

/**
 * Returns `deleted_at IS NOT NULL` — for admin/purge views that explicitly
 * want only soft-deleted rows.
 */
export function deletedOnlyGuard(deletedAtCol: DrizzleExpr): SQL {
  return isNotNull(deletedAtCol) as SQL;
}

/**
 * Returns `archived_at IS NOT NULL` — for views that show archived-only rows.
 */
export function archivedOnlyGuard(archivedAtCol: DrizzleExpr): SQL {
  return isNotNull(archivedAtCol) as SQL;
}

/**
 * Returns `deleted_at IS NOT NULL AND deleted_at < cutoffDate`.
 * Used by domain purge functions to identify records whose retention
 * window has elapsed.
 */
export function purgeEligibleGuard(deletedAtCol: DrizzleExpr, cutoffDate: Date): SQL {
  return and(isNotNull(deletedAtCol), lt(deletedAtCol as Parameters<typeof lt>[0], cutoffDate))! as SQL;
}
