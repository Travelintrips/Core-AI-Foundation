/**
 * Domain Plugin Framework — Tenant / Service Availability Policy (Team 07)
 *
 * Checks whether a plugin is available for a given authenticated context.
 * tenantId must come from the server-side auth context — never from the
 * raw client request body or query string.
 */

import type { TenantPolicy } from "./types.js";

export interface TenantContext {
  tenantId: string;
  serviceCode?: string;
  /** True when the caller holds platform-level scope (staff / internal) */
  isPlatformScope?: boolean;
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Evaluate tenant availability for a plugin.
 * Returns { allowed: true } when:
 *   1. The plugin has no tenantPolicy (available to everyone), OR
 *   2. All policy constraints are satisfied.
 */
export function evaluateTenantPolicy(
  policy: TenantPolicy | undefined,
  ctx: TenantContext,
): PolicyResult {
  if (!policy) {
    return { allowed: true };
  }

  if (policy.requiresPlatformScope && !ctx.isPlatformScope) {
    return {
      allowed: false,
      reason: "Plugin requires platform-level scope",
    };
  }

  if (
    policy.allowedTenantIds &&
    policy.allowedTenantIds.length > 0 &&
    !policy.allowedTenantIds.includes(ctx.tenantId)
  ) {
    return {
      allowed: false,
      reason: `Tenant '${ctx.tenantId}' is not authorised for this plugin`,
    };
  }

  if (
    policy.allowedServiceCodes &&
    policy.allowedServiceCodes.length > 0 &&
    ctx.serviceCode &&
    !policy.allowedServiceCodes.includes(ctx.serviceCode)
  ) {
    return {
      allowed: false,
      reason: `Service code '${ctx.serviceCode}' is not authorised for this plugin`,
    };
  }

  return { allowed: true };
}
