/**
 * requestContext.ts — WP-01 canonical request/tenant context (P0 Enterprise
 * Foundation). See docs/blueprints/p0-tenant-isolation-blueprint.md.
 *
 * This module defines the ONE canonical shape every request-derived
 * authorization decision should eventually be built from. WP-01 only lays
 * the foundation: a handful of call sites adopt it now (see
 * security/tenantResolution.ts) as a worked example; broad route migration
 * is WP-02+.
 *
 * Design invariants (do not weaken without updating the blueprint + tests):
 *   - tenantId is only null for an operation explicitly marked platform-wide
 *     (isPlatformWide=true). A tenant-owned operation MUST have a tenantId.
 *   - isPlatformAdmin is a fact about the actor, not a bypass switch — it
 *     does not by itself widen resourceScope or skip tenant filtering.
 *   - system/worker/scheduler actors still need a tenantId for any
 *     tenant-owned operation; there is no hidden default tenant baked into
 *     the type itself (see createSystemContext).
 *   - Context objects are safe to log/serialize: no raw tokens, no secrets,
 *     no session cookies. Only ids, enums, and small scalar metadata.
 */
import type { Request } from "express";

// ── Enums ──────────────────────────────────────────────────────────────────

export const ACTOR_TYPES = [
  "customer",
  "tenant_admin",
  "platform_admin",
  "vendor",
  "public_token",
  "system",
  "worker",
  "scheduler",
  "webhook",
] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const AUTH_MODES = ["session", "bearer", "public_token", "internal", "webhook", "system"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export const REQUEST_SOURCES = [
  "api",
  "customer_portal",
  "admin_portal",
  "public_page",
  "worker",
  "scheduler",
  "webhook",
  "internal_service",
] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

/**
 * A verifiable pointer to the single resource a public-token (or otherwise
 * narrowly-scoped) request is allowed to touch. Deliberately structured
 * (not a free-text string) so callers can compare resourceType+resourceId
 * instead of doing substring/prefix checks on an opaque scope string.
 */
export interface ResourceScope {
  readonly resourceType: string;
  readonly resourceId: string | number;
}

/** Safe scalar-only metadata — never put tokens, secrets, or full payloads here. */
export type SafeMetadata = Readonly<Record<string, string | number | boolean | null>>;

export interface RequestContext {
  readonly tenantId: string | null;
  readonly actorId: string | null;
  readonly actorType: ActorType;
  readonly authMode: AuthMode;
  readonly requestId: string;
  readonly correlationId: string;
  readonly source: RequestSource;
  /** Exact-match permission strings. Never checked via substring/prefix. */
  readonly permissions: readonly string[];
  readonly resourceScope: ResourceScope | null;
  readonly isPlatformAdmin: boolean;
  /** True only for operations explicitly declared platform-wide (no single tenant owns them). */
  readonly isPlatformWide: boolean;
  /** Set when this context was created "on behalf of" another actor (e.g. impersonation, adapters). */
  readonly originatingActorId: string | null;
  readonly metadata: SafeMetadata;
}

/** A context guaranteed (by construction or by assertTenantOwned) to carry a tenantId. */
export type TenantScopedContext = RequestContext & { readonly tenantId: string };

export class TenantContextError extends Error {
  constructor(message: string, public readonly code: "MISSING_TENANT" | "INVALID_RESOURCE_SCOPE" | "SCOPE_TOO_BROAD") {
    super(message);
    this.name = "TenantContextError";
  }
}

// ── Invariants ─────────────────────────────────────────────────────────────

/**
 * Asserts a tenant-owned operation has a concrete tenantId. Use this at the
 * boundary of any service function that queries/writes tenant-scoped rows —
 * never assume isPlatformAdmin implies it is safe to skip this check.
 */
export function assertTenantOwned(ctx: RequestContext): TenantScopedContext {
  if (ctx.isPlatformWide) {
    throw new TenantContextError(
      "Context is marked platform-wide but was passed to a tenant-owned operation",
      "MISSING_TENANT",
    );
  }
  if (!ctx.tenantId) {
    throw new TenantContextError("Tenant-owned operation requires a tenantId on the request context", "MISSING_TENANT");
  }
  return ctx as TenantScopedContext;
}

/** Exact-match permission check — never substring/prefix matching. */
export function hasPermission(ctx: RequestContext, permission: string): boolean {
  return ctx.permissions.includes(permission);
}

/**
 * A public-token context's permission set must never exceed what its
 * resourceScope justifies. This is a structural guard, not a full ACL —
 * call sites still enforce their own scope checks, but a context that
 * fails this can never be constructed via createPublicTokenContext.
 */
function assertPublicTokenScopeIsNarrow(resourceScope: ResourceScope | null, permissions: readonly string[]): void {
  if (!resourceScope) {
    throw new TenantContextError("Public token context requires a resourceScope", "INVALID_RESOURCE_SCOPE");
  }
  if (permissions.some((p) => p === "*" || p.endsWith(":*"))) {
    throw new TenantContextError("Public token context cannot hold wildcard permissions", "SCOPE_TOO_BROAD");
  }
}

// ── Request/correlation ID ──────────────────────────────────────────────────

/**
 * Reuses the request ID pino-http already assigns to every request
 * (req.id) instead of minting a second, competing identifier. Falls back to
 * a fresh UUID only if pino-http's middleware did not run (e.g. unit tests
 * that construct a bare req object).
 */
export function getOrCreateRequestId(req: Request): string {
  const existing = (req as unknown as { id?: string | number }).id;
  if (existing !== undefined && existing !== null && String(existing).length > 0) {
    return String(existing);
  }
  return randomId();
}

/**
 * Correlation ID is propagation-only (tracing), never authorization-bearing,
 * so it is safe to accept a client-supplied X-Correlation-Id and otherwise
 * fall back to the request ID. Do not use this value for any tenant/actor
 * decision.
 */
export function getOrCreateCorrelationId(req: Request, requestId: string): string {
  const header = req.headers["x-correlation-id"];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value === "string" && value.length > 0 && value.length <= 200) {
    return value;
  }
  return requestId;
}

function randomId(): string {
  // Local import to avoid pulling `crypto` into every module that only
  // needs the types above.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (globalThis.crypto?.randomUUID?.() as string | undefined) ?? `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// ── Factories ────────────────────────────────────────────────────────────────

interface BaseContextInput {
  readonly requestId: string;
  readonly correlationId?: string;
  readonly source: RequestSource;
  readonly permissions?: readonly string[];
  readonly metadata?: SafeMetadata;
}

/** A. Authenticated session (internal portal, customer session, etc.). */
export function createSessionTenantContext(
  input: BaseContextInput & {
    tenantId: string;
    actorId: string;
    actorType: ActorType;
    isPlatformAdmin?: boolean;
  },
): TenantScopedContext {
  return {
    tenantId: input.tenantId,
    actorId: input.actorId,
    actorType: input.actorType,
    authMode: "session",
    requestId: input.requestId,
    correlationId: input.correlationId ?? input.requestId,
    source: input.source,
    permissions: input.permissions ?? [],
    resourceScope: null,
    isPlatformAdmin: input.isPlatformAdmin ?? false,
    isPlatformWide: false,
    originatingActorId: null,
    metadata: input.metadata ?? {},
  } satisfies RequestContext as TenantScopedContext;
}

/**
 * B. Public resource token. The caller must have ALREADY resolved
 * tenantId/resourceScope from the token → resource lookup (token → resolve
 * resource → derive tenant → verify scope → create context). This factory
 * only assembles the context; it does not itself trust any client input.
 */
export function createPublicTokenContext(
  input: BaseContextInput & {
    tenantId: string;
    resourceScope: ResourceScope;
  },
): TenantScopedContext {
  assertPublicTokenScopeIsNarrow(input.resourceScope, input.permissions ?? []);
  return {
    tenantId: input.tenantId,
    actorId: null,
    actorType: "public_token",
    authMode: "public_token",
    requestId: input.requestId,
    correlationId: input.correlationId ?? input.requestId,
    source: input.source,
    permissions: input.permissions ?? ["read"],
    resourceScope: input.resourceScope,
    isPlatformAdmin: false,
    isPlatformWide: false,
    originatingActorId: null,
    metadata: input.metadata ?? {},
  } satisfies RequestContext as TenantScopedContext;
}

/**
 * C. Internal/system/worker/scheduler. Tenant-owned operations MUST pass a
 * tenantId explicitly — there is no implicit default. Pass
 * `isPlatformWide: true` only for genuinely cross-tenant operations
 * (e.g. a scheduler sweep across all tenants), never as a convenience.
 */
export function createSystemContext(
  input: BaseContextInput & {
    tenantId: string | null;
    actorType: "system" | "worker" | "scheduler";
    isPlatformWide?: boolean;
  },
): RequestContext {
  const isPlatformWide = input.isPlatformWide ?? false;
  if (!isPlatformWide && !input.tenantId) {
    throw new TenantContextError(
      `${input.actorType} context for a tenant-owned operation requires an explicit tenantId`,
      "MISSING_TENANT",
    );
  }
  return {
    tenantId: input.tenantId,
    actorId: null,
    actorType: input.actorType,
    authMode: "system",
    requestId: input.requestId,
    correlationId: input.correlationId ?? input.requestId,
    source: input.source,
    permissions: input.permissions ?? [],
    resourceScope: null,
    isPlatformAdmin: false,
    isPlatformWide,
    originatingActorId: null,
    metadata: input.metadata ?? {},
  };
}

/**
 * D. Webhook. tenantId MUST come from a server-side mapping of the
 * account/integration/resource the webhook targets — never from the
 * provider's payload body.
 */
export function createWebhookContext(
  input: BaseContextInput & { tenantId: string; originatingActorId?: string | null },
): TenantScopedContext {
  return {
    tenantId: input.tenantId,
    actorId: null,
    actorType: "webhook",
    authMode: "webhook",
    requestId: input.requestId,
    correlationId: input.correlationId ?? input.requestId,
    source: input.source,
    permissions: input.permissions ?? [],
    resourceScope: null,
    isPlatformAdmin: false,
    isPlatformWide: false,
    originatingActorId: input.originatingActorId ?? null,
    metadata: input.metadata ?? {},
  } satisfies RequestContext as TenantScopedContext;
}

// ── Legacy adapter ───────────────────────────────────────────────────────────

/**
 * Wraps an already-resolved (trusted) tenantId from a legacy call site that
 * still takes separate (tenantId, userId, requestId) parameters, so it can
 * participate in code paths that expect a RequestContext. This is a
 * transitional adapter, not a second permanent context model — it never
 * reads client input itself, it only re-shapes a value the caller already
 * validated. Do not use this to smuggle an unvalidated client value into a
 * context; that defeats the entire point of WP-00.
 */
export function adaptLegacyTenantContext(
  input: BaseContextInput & { tenantId: string; actorType?: ActorType },
): TenantScopedContext {
  return {
    tenantId: input.tenantId,
    actorId: null,
    actorType: input.actorType ?? "system",
    authMode: "internal",
    requestId: input.requestId,
    correlationId: input.correlationId ?? input.requestId,
    source: input.source,
    permissions: input.permissions ?? [],
    resourceScope: null,
    isPlatformAdmin: false,
    isPlatformWide: false,
    originatingActorId: null,
    metadata: { ...(input.metadata ?? {}), viaLegacyAdapter: true },
  } satisfies RequestContext as TenantScopedContext;
}
