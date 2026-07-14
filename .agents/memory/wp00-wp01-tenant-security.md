---
name: WP-00/WP-01 tenant-spoofing fix and canonical RequestContext
description: How tenant identity is resolved server-side vs client input, and where the canonical context types live, in artifacts/api-server.
---

`artifacts/api-server/src/security/requestContext.ts` defines the canonical `RequestContext`
type system (ActorType/AuthMode/RequestSource, ResourceScope, permissions, tenant invariants)
and `artifacts/api-server/src/security/tenantResolution.ts` builds the tenant resolvers on top
of it. Both were added as the WP-01 foundation + WP-00 consumer in one pass.

**Rule going forward:** never read `tenantId` from `req.body`/`req.query`/any header on a route
that needs a trustworthy tenant. Two resolution patterns exist, pick by trust level:
- Authenticated/internal routes (session or ADMIN_API_KEY, e.g. marketplace.ts): call
  `resolveAuthenticatedTenantContext(req)` then `assertClientTenantNotSpoofed(clientValue, ctx.tenantId, req, routeLabel)`
  — mismatch throws `TenantMismatchError`, caller maps it to HTTP 403.
- Genuinely public/unauthenticated routes (e.g. catalog.ts quote/request): call
  `resolvePublicRequestTenantId(clientValue, req, routeLabel, canonicalTenantId)` — never
  throws, just ignores the client value and logs if it disagreed.

**Why:** confirmed single-tenant system (no per-user tenant membership table exists), so both
resolvers currently return a hardcoded constant (`DEFAULT_TENANT_ID = "default"` for
marketplace/ai_installed_packages convention, `null` for catalog/ai_service_requests
"null = default tenant" convention) — this must stay in sync with whichever table's own
NOT-NULL-default-vs-nullable convention the calling route persists to. When real per-tenant
membership ships, only the resolver bodies change, not call sites.

Logging: `assertClientTenantNotSpoofed`/`resolvePublicRequestTenantId` truncate/sanitize the
client value before logging (`safeFragment`, 40-char alphanumeric cap) and wrap the `logger.warn`
call in try/catch so a logging failure can never suppress or replace the security decision.

Request/correlation IDs: `getOrCreateRequestId` reuses pino-http's `req.id` (don't mint a
second ID); `getOrCreateCorrelationId` accepts client `X-Correlation-Id` since it's
tracing-only, never authorization-bearing.

Full writeup with vulnerability root cause, test list, and typecheck/build verification:
`docs/implementation/p0-wp00-wp01-implementation-report.md`.
