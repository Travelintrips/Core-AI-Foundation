/**
 * tenantResolution.ts — WP-00 baseline security fix.
 *
 * Closes the tenant-spoofing vulnerability where routes derived the active
 * tenantId from client-controlled input (req.body.tenantId,
 * req.query.tenantId) instead of from the already-authenticated request
 * context. See docs/blueprints/p0-tenant-isolation-blueprint.md and
 * docs/audit/enterprise-readiness-audit-validation-2026-07-14.md.
 *
 * This app is single-tenant in production today (no per-user tenant
 * membership table exists yet — see p0-database-change-plan.md), so every
 * resolver below always resolves to a single, server-defined tenant. The
 * point of this module is NOT to add multi-tenancy; it is to make sure the
 * tenant identifier is *never* taken from client input, so that when real
 * per-user tenant membership ships (WP-02+), only the body of
 * `resolveAuthenticatedTenantContext` needs to change — no call site does.
 */
import type { Request } from "express";
import { logger } from "../lib/logger.js";
import {
  createSessionTenantContext,
  createSystemContext,
  getOrCreateCorrelationId,
  getOrCreateRequestId,
  type TenantScopedContext,
} from "./requestContext.js";

/** Marketplace convention: tenantId is a NOT NULL text column defaulting to "default". */
export const DEFAULT_TENANT_ID = "default";
/** UUID scope used by the WP-03 placement tables (whose tenant_id is UUID). */
export const DEFAULT_PLACEMENT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

export function resolvePlacementTenantId(req: Request): string {
  const candidate = req.internalUser?.tenantId;
  return typeof candidate === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : DEFAULT_PLACEMENT_TENANT_ID;
}

export class TenantMismatchError extends Error {
  constructor(message = "Tenant mismatch") {
    super(message);
    this.name = "TenantMismatchError";
  }
}

/**
 * A. Authenticated request (session cookie from the Internal AI Portal, or
 * the ADMIN_API_KEY internal/system path — both already verified by
 * adminAuthWithExceptions before this ever runs). Tenant is resolved from
 * the authenticated identity, never from req.body/query/headers.
 */
export function resolveAuthenticatedTenantContext(req: Request, source: "admin_portal" | "api" = "admin_portal"): TenantScopedContext {
  const requestId = getOrCreateRequestId(req);
  const correlationId = getOrCreateCorrelationId(req, requestId);

  if (req.internalUser) {
    const isPlatformAdmin = req.internalUser.role === "owner" || req.internalUser.role === "admin";
    return createSessionTenantContext({
      tenantId: DEFAULT_TENANT_ID,
      actorId: String(req.internalUser.id),
      actorType: isPlatformAdmin ? "platform_admin" : "tenant_admin",
      isPlatformAdmin,
      permissions: [],
      source,
      requestId,
      correlationId,
    });
  }

  // No session — this request only got past adminAuthWithExceptions because
  // it presented a valid ADMIN_API_KEY (or dev fail-open with no key
  // configured). Treat it as a trusted internal/system actor, not a
  // customer, and still scope it to the one real tenant server-side.
  const ctx = createSystemContext({
    tenantId: DEFAULT_TENANT_ID,
    actorType: "system",
    source: "api",
    requestId,
    correlationId,
  });
  return ctx as TenantScopedContext;
}

function safeFragment(value: string): string {
  // Never log the raw client-supplied string verbatim (defense in depth in
  // case it contains injected control characters or PII); keep just enough
  // for triage.
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "?").slice(0, 40);
}

/**
 * D. Mismatch handling. If the client supplied a tenantId that differs from
 * the server-resolved one, never use the client value, log a structured
 * (secret-free) security event, and signal the caller to reject the
 * request. A matching or absent client value is a no-op — this keeps the
 * existing happy path (clients that still send tenantId: "default") working
 * without ever trusting it.
 */
export function assertClientTenantNotSpoofed(
  clientSupplied: unknown,
  resolvedTenantId: string,
  req: Request,
  routeLabel: string,
): void {
  if (typeof clientSupplied !== "string" || clientSupplied.length === 0) return;
  if (clientSupplied === resolvedTenantId) return;

  // A logging failure must never suppress (or replace with an unrelated
  // error) the security decision to reject this request.
  try {
    logger.warn(
      {
        event: "tenant_mismatch_blocked",
        route: routeLabel,
        requestId: getOrCreateRequestId(req),
        resolvedTenantId,
        clientTenantFragment: safeFragment(clientSupplied),
      },
      "Rejected request: client-supplied tenantId does not match the server-resolved tenant",
    );
  } catch {
    // intentionally swallowed — see comment above
  }
  throw new TenantMismatchError();
}

/**
 * B (adjacent, no real route yet). Public/unauthenticated routes (e.g. the
 * customer-facing catalog quote/request-service endpoints) have no session
 * to resolve a tenant from and no resource token either — they are
 * single-tenant "create new resource" calls. There is nothing legitimate a
 * client can tell us about which tenant it belongs to, so we never use the
 * client-supplied value; we just log if one was sent (signal for the
 * catalog schema's own `tenantId: null` convention drifting) and always
 * return the canonical value for that table's convention.
 */
export function resolvePublicRequestTenantId(
  clientSupplied: unknown,
  req: Request,
  routeLabel: string,
  canonicalTenantId: string | null = null,
): string | null {
  if (typeof clientSupplied === "string" && clientSupplied.length > 0 && clientSupplied !== canonicalTenantId) {
    try {
      logger.warn(
        {
          event: "public_tenant_input_ignored",
          route: routeLabel,
          requestId: getOrCreateRequestId(req),
          clientTenantFragment: safeFragment(clientSupplied),
        },
        "Ignored client-supplied tenantId on a public route; using the server-resolved tenant",
      );
    } catch {
      // intentionally swallowed — logging failure must never affect the response
    }
  }
  return canonicalTenantId;
}
