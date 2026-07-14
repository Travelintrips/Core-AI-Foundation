/**
 * repositories/types.ts — WP-02 Shared Repository Foundation.
 *
 * See docs/implementation/p0-wp02-repository-foundation-implementation-report.md
 * for the full design rationale. This module defines the ONE contract every
 * domain repository added in WP-02 (and beyond) builds on. It deliberately
 * does NOT introduce a second context model: RepositoryContext always wraps
 * the canonical RequestContext from security/requestContext.ts.
 *
 * Non-goals for WP-02 (do not add here without a new workpackage):
 *   - Row-level security / DB-enforced tenant filtering (Postgres RLS).
 *     Tenant filtering here is application-level, same as WP-00.
 *   - Soft-delete columns or semantics. `includeDeleted` is a reserved flag
 *     for forward-compatibility only; no repository currently sets or
 *     interprets it against a real column.
 *   - Audit-log schema changes. `auditMetadata` is a passthrough bag a
 *     repository MAY forward to an existing audit call (e.g. logAudit); it
 *     does not create new audit tables or fields.
 *   - An abstract generic query builder. Domain repositories still write
 *     their own explicit Drizzle `where(eq(table.tenantId, tenantId))`
 *     conditions so the tenant filter stays visible and reviewable in each
 *     repository file, not hidden behind a shared helper that could silently
 *     drop it.
 */
import type { db } from "@workspace/db";
import type { RequestContext } from "../security/requestContext.js";

/** Either the module-level `db` client or a live `db.transaction` callback's `tx`. */
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * A cross-tenant / platform-wide operation must declare itself explicitly —
 * there is no bypass derived implicitly from `ctx.requestContext.isPlatformAdmin`.
 * `name` should be a short machine-readable identifier (e.g.
 * "scheduler_sweep_all_tenants"); `reason` is a short human string for logs.
 */
export interface PlatformOperation {
  readonly name: string;
  readonly reason: string;
}

/**
 * The contract every WP-02+ repository function accepts as its first
 * argument (after any resource identifiers). Deliberately small: it is a
 * thin wrapper around RequestContext, not a replacement for it.
 */
export interface RepositoryContext {
  /** The canonical, already-resolved request context (see security/requestContext.ts). */
  readonly requestContext: RequestContext;
  /**
   * Optional live transaction executor. When set, repositories MUST use this
   * executor for every query instead of falling back to the module-level
   * `db` client — a silent fallback to `db` mid-transaction would break
   * atomicity without any visible error. See `runInTransaction` below.
   */
  readonly executor?: DbExecutor;
  /** Reserved for WP-03+ soft-delete. No repository currently reads this. */
  readonly includeDeleted?: boolean;
  /** Optional passthrough metadata a repository may forward to an audit call. */
  readonly auditMetadata?: Readonly<Record<string, string | number | boolean | null>>;
  /** Must be set for any repository call that reads/writes across tenants. */
  readonly platformOperation?: PlatformOperation | null;
}

export function makeRepositoryContext(
  requestContext: RequestContext,
  overrides: Partial<Omit<RepositoryContext, "requestContext">> = {},
): RepositoryContext {
  return { requestContext, ...overrides };
}

/** Returns the executor to run a query against: the active transaction if present, otherwise the plain db client. */
export function resolveExecutor(ctx: RepositoryContext, fallback: typeof db): DbExecutor {
  return ctx.executor ?? fallback;
}

/**
 * Derives a child RepositoryContext bound to a live transaction executor.
 * Repositories should call this at the top of any multi-statement mutation
 * that must be atomic, then pass the returned context to every helper call
 * inside the transaction body — never re-read `ctx.executor` from outside.
 */
export function withExecutor(ctx: RepositoryContext, executor: DbExecutor): RepositoryContext {
  return { ...ctx, executor };
}
