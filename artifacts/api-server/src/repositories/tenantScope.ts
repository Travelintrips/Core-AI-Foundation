/**
 * repositories/tenantScope.ts — WP-02 tenant-scope guard helper.
 *
 * Every domain repository calls `requireTenantId` (or `requirePlatformScope`
 * for the rare cross-tenant operation) before building its own explicit
 * Drizzle `where` clause. This module never builds queries itself — see the
 * "non-goals" note in repositories/types.ts for why.
 */
import { assertTenantOwned, type TenantScopedContext } from "../security/requestContext.js";
import { RepositoryPlatformScopeError } from "./errors.js";
import type { RepositoryContext } from "./types.js";

/**
 * Returns the validated tenantId for a tenant-owned repository call.
 * Throws TenantContextError (from security/requestContext.ts) if the
 * context has no tenantId, or is explicitly marked platform-wide without an
 * approved PlatformOperation — see `requirePlatformScope` for that path.
 */
export function requireTenantId(ctx: RepositoryContext): string {
  const scoped: TenantScopedContext = assertTenantOwned(ctx.requestContext);
  return scoped.tenantId;
}

/**
 * Guards a cross-tenant / platform-wide repository call (e.g. a scheduler
 * sweep, or an admin analytics view spanning all tenants). Requires BOTH:
 *   1. `ctx.requestContext.isPlatformAdmin` (or a system/worker/scheduler
 *      actor with `isPlatformWide: true`) — a fact about the actor, and
 *   2. an explicit `ctx.platformOperation` — a fact about THIS call.
 * Neither alone is sufficient; this mirrors the invariant documented on
 * RequestContext.isPlatformAdmin in security/requestContext.ts (it is not a
 * bypass switch by itself).
 */
export function requirePlatformScope(ctx: RepositoryContext): PlatformScopeGrant {
  const rc = ctx.requestContext;
  if (!ctx.platformOperation) {
    throw new RepositoryPlatformScopeError(
      "Cross-tenant repository call requires an explicit platformOperation on the RepositoryContext",
    );
  }
  const actorIsAuthorized = rc.isPlatformAdmin || rc.isPlatformWide;
  if (!actorIsAuthorized) {
    throw new RepositoryPlatformScopeError(
      `Actor is not authorized for platform-wide operation "${ctx.platformOperation.name}"`,
    );
  }
  return { name: ctx.platformOperation.name, reason: ctx.platformOperation.reason };
}

export interface PlatformScopeGrant {
  readonly name: string;
  readonly reason: string;
}
