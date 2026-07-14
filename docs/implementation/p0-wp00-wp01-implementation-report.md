# P0 WP-00 / WP-01 Implementation Report

Status: **WP-00 and WP-01 implemented and verified.** WP-02–WP-14 are untouched;
this document does not change their status.

## 1. Scope

- WP-00 — Baseline Security Fixes and Safety Tests (tenant-spoofing closure).
- WP-01 — Canonical Request and Tenant Context Types (foundation only).
- No RLS, no soft-delete columns, no audit-log schema changes, no quotation
  migration, no repository layer, no route redesign, no DB schema push. No
  database migration was needed or performed.

## 2. Baseline

Captured by re-running `tsc -p tsconfig.json --noEmit` against `main` (before
any change, via `git stash`): the same 40+ pre-existing errors already exist
on `main`, all in `asset-library`, `brand-kit-enterprise`, `zip-delivery`,
`presentationRenderService.ts`, and one pre-existing `v42d-zip-delivery.test.ts`
type-narrowing issue — none touch `marketplace.ts`, `catalog.ts`, or any new
file. Baseline `pnpm test` was 440 passing tests before this work began (same
count includes the pre-existing suite; the WP-00/01 additions bring the total
to 477, see §7).

## 3. Vulnerability Root Cause

`artifacts/api-server/src/routes/marketplace.ts` derived the tenant identity
for every mutating/reading operation from client-controlled input:

- `parseTenantId(req.body?.tenantId)` — PATCH `.../upgrade`, `.../enable`, `.../disable`.
- `parseTenantId(req.query?.tenantId)` — DELETE `.../:packageType/:id`.
- Zod-parsed `req.body.tenantId` / `req.query.tenantId` directly (same class
  of bug, different call shape) — POST `/install`, GET `/installed`, GET
  `/analytics`.

`parseTenantId` had no validation beyond "is it a non-empty string" — any
caller with a valid `ADMIN_API_KEY` (or, in development with no key
configured, any caller at all — a documented fail-open) could install,
upgrade, enable, disable, uninstall, or read another tenant's marketplace
state simply by sending a different `tenantId` string. There was no
authenticated/derived-tenant concept at all; the client string *was* the
tenant.

A second, distinct instance of the same bug class was found in
`artifacts/api-server/src/routes/catalog.ts` on the **public, unauthenticated**
`POST /ai/catalog/services/:id/quote` and `POST /ai/catalog/services/:id/request`
routes: `body.tenantId` / `parsed.data.tenantId` were forwarded unchanged into
`generatePricingSnapshot()` (tax-rule lookup keyed by tenant) and, on the
`/request` route, persisted directly onto the new `ai_service_requests` row.
Any anonymous customer could inject an arbitrary tenant string into stored
data and into tax computation.

## 4. Files Changed

New:
- `artifacts/api-server/src/security/requestContext.ts` — WP-01 canonical context types, invariants, factories, legacy adapter.
- `artifacts/api-server/src/security/tenantResolution.ts` — WP-00 tenant resolvers built on the above.
- `artifacts/api-server/src/security/__tests__/requestContext.test.ts`
- `artifacts/api-server/src/security/__tests__/tenantResolution.test.ts`
- `artifacts/api-server/src/routes/__tests__/marketplace.tenant-security.test.ts`
- `docs/implementation/p0-wp00-wp01-implementation-report.md` (this file)

Modified:
- `artifacts/api-server/src/routes/marketplace.ts` — removed `parseTenantId`; all 7 tenant-consuming call sites (`installed`, `install`, `upgrade`, `enable`, `disable`, `delete`, `analytics`) now resolve tenant server-side and reject a mismatching client value with `403`.
- `artifacts/api-server/src/routes/catalog.ts` — `POST /ai/catalog/services/:id/quote` and `POST /ai/catalog/services/:id/request` now ignore client-supplied `tenantId` entirely and use the server-resolved canonical value (`null`, matching this table's own "null = default tenant" convention); a divergent client value is logged, never used or stored.

No other files were changed. No formatting-only diffs, no unrelated files.

## 5. Canonical Context Design Implemented

`security/requestContext.ts` defines:
- `ActorType`, `AuthMode`, `RequestSource` enums exactly matching the
  minimum sets requested (customer/tenant_admin/platform_admin/vendor/
  public_token/system/worker/scheduler/webhook; session/bearer/public_token/
  internal/webhook/system; api/customer_portal/admin_portal/public_page/
  worker/scheduler/webhook/internal_service).
- `RequestContext` with `tenantId`, `actorId`, `actorType`, `authMode`,
  `requestId`, `correlationId`, `source`, `permissions` (exact-match string
  array), `resourceScope` (structured `{resourceType, resourceId}`, not a
  free-text scope string), `isPlatformAdmin`, `isPlatformWide` (explicit
  platform-wide flag, per the "must be explicit" invariant),
  `originatingActorId`, `metadata` (scalar-only, safe to log).
- Invariants: `assertTenantOwned()` throws `TenantContextError` unless a
  concrete `tenantId` is present and the context isn't platform-wide;
  `hasPermission()` is exact-match only (no substring/prefix checks
  anywhere); `createPublicTokenContext()` refuses to construct without a
  `resourceScope` and refuses wildcard (`*`, `foo:*`) permissions;
  `createSystemContext()` throws if a tenant-owned (`isPlatformWide=false`)
  system/worker/scheduler context is built without a `tenantId` — there is
  no hidden default baked into the factory.
- Factories for all four creation paths from the spec (A session, B public
  token, C internal/system, D webhook), plus `adaptLegacyTenantContext()` as
  the explicit, documented transitional adapter for call sites that still
  take separate `(tenantId, ...)` parameters — it only re-shapes an
  already-trusted value; it does not read client input itself.
- `getOrCreateRequestId()` reuses pino-http's existing `req.id` instead of
  minting a second identifier; `getOrCreateCorrelationId()` propagates a
  client `X-Correlation-Id` (safe — tracing-only, never authorization-bearing)
  or falls back to the request id.

`security/tenantResolution.ts` is the WP-00 consumer of the above:
- `resolveAuthenticatedTenantContext(req)` — for routes that sit behind
  `adminAuthWithExceptions` (marketplace today). Resolves via
  `req.internalUser` (session) → `createSessionTenantContext`, or via the
  `ADMIN_API_KEY` / dev-fail-open path (no session) →
  `createSystemContext`. Never reads `req.body`/`req.query`/`req.headers`.
- `assertClientTenantNotSpoofed(clientSupplied, resolvedTenantId, req, routeLabel)`
  — no-op if the client sent nothing or the same value; throws
  `TenantMismatchError` (mapped to `403 Forbidden`, no tenant/resource
  details in the body) and logs a structured, secret-free
  `tenant_mismatch_blocked` event otherwise. A logging failure is caught and
  swallowed so it can never suppress or replace the security decision.
- `resolvePublicRequestTenantId(clientSupplied, req, routeLabel, canonical)`
  — for the two genuinely public, unauthenticated catalog routes: always
  returns the canonical (server) value, only logs (never rejects, since
  there is no identity to reject against) when the client sent a divergent
  value.

This app is single-tenant today (confirmed against the actual schema:
`ai_installed_packages.tenant_id` is `NOT NULL DEFAULT 'default'`;
`ai_service_requests.tenant_id` is nullable with "null = default tenant" as
its own documented convention). Both resolvers respect their table's
existing convention rather than inventing a third one. When real per-tenant
membership ships (WP-02+), only the bodies of these two resolver functions
need to change — no call site does.

## 6. Tests Added

`security/__tests__/requestContext.test.ts` (15 tests) — session/public-token/
system/webhook factories, tenant-owned invariant enforcement, platform-wide
explicitness, exact-match permission checks, public-token scope narrowness,
legacy adapter behavior, request/correlation ID reuse and fallback, and that
context objects carry no `sessionToken`/`secret`/`password`/`authorization`/
`cookie` keys.

`security/__tests__/tenantResolution.test.ts` (13 tests) — covers items 1–4,
6, 9, 10 from the WP-00 test list directly against the resolver functions:
body/query/header tenantId cannot change the resolved tenant; no-session
requests still resolve a concrete tenant; matching/absent client values are
no-ops (happy path preserved); mismatched values throw and are logged without
leaking the raw header/body or the authorization header; a logging failure
never prevents the `TenantMismatchError` from firing; public-route resolution
never uses the client value.

`routes/__tests__/marketplace.tenant-security.test.ts` (9 tests) — full HTTP
round-trip against the real router (Express + a plain `http.Server`, no new
dependency added) with `req.internalUser` and `@workspace/db` /
`packageManagerService` mocked: items 1, 2, 3 (session/query/header spoofing
rejected), 7 (matching tenant still works), 8 (existing happy path), 9
(no-session request still served); asserts the `403` body is exactly
`{"error":"Forbidden"}` with no tenant/internal detail.

Item 5 ("Token Tenant A cannot be used with resource Tenant B") has no
concrete route to test yet — marketplace has no public-token access path,
and no other public-token-authenticated route was in scope for WP-00. The
factory-level guard (`createPublicTokenContext` requiring a matching, narrow
`resourceScope`) is covered structurally in `requestContext.test.ts`;
end-to-end coverage is deferred to whichever WP-02+ work package migrates a
real public-token route onto this factory.

## 7. Test Results

- Targeted new suites: **37/37 passed** (`requestContext.test.ts`,
  `tenantResolution.test.ts`, `marketplace.tenant-security.test.ts`).
- Full `pnpm test` (all 19 test files in `artifacts/api-server`): **477/477
  passed**, 0 failed. No pre-existing test was broken.

## 8. Typecheck and Build Results

- `tsc -p tsconfig.json --noEmit`: **0 new errors.** All errors present in
  the current output (asset-library / brand-kit-enterprise / zip-delivery
  `@workspace/db` export drift, `pptxgenjs` namespace-as-type issues, one
  `v42d-zip-delivery.test.ts` status-literal narrowing) are byte-for-byte the
  same set present on `main` before this work (verified via `git stash` +
  re-run). None touch `marketplace.ts`, `catalog.ts`, or any file under
  `security/`.
- `pnpm run build` (esbuild bundle): succeeds, `dist/index.mjs` produced, no
  new warnings attributable to this change.
- API Server workflow restarted cleanly; live smoke test confirmed a spoofed
  `tenantId` on `POST /ai/marketplace/install` (with a valid `ADMIN_API_KEY`)
  now returns `403 {"error":"Forbidden"}`, while a matching `tenantId`
  proceeds to normal business-logic responses (e.g. `404` for an unknown
  package id) — i.e. the fix changes only the spoofing path, not the happy
  path.

## 9. Remaining Compatibility Paths

- `security/requestContext.ts::adaptLegacyTenantContext` exists specifically
  so future call sites that still take a bare `(tenantId, ...)` signature
  (e.g. `packageManagerService.ts` functions, `aiPricingService.ts`,
  `aiQuotationService.ts`, `commercialGateService.ts` — all identified during
  the WP-00 audit but intentionally left with their current signatures) can
  be wrapped without inventing a second context model. None of those
  services were changed in this pass — only their callers' tenant *inputs*
  were hardened.
- `routes/aiQuotations.ts:107` (`sr.tenantId` propagation from an existing
  `ai_service_requests` row into a new quotation) was reviewed and left
  unchanged: `sr.tenantId` there is a value already read back out of the
  database (not client input at that call site), so it is not part of the
  WP-00 spoofing surface. It becomes a natural WP-02+ candidate once
  `ai_service_requests.tenantId` itself is populated from a verified
  membership rather than the canonical-default resolver added here.
- Dev fail-open in `adminAuth.ts` (`ADMIN_API_KEY` unset + `NODE_ENV=development`
  → allow all) is unchanged — it is a pre-existing, documented convenience
  and out of WP-00's scope; `resolveAuthenticatedTenantContext` treats that
  path as a trusted system actor scoped to the one real tenant, same as the
  `ADMIN_API_KEY` path.

## 10. Risks

- Both new resolvers hardcode `DEFAULT_TENANT_ID`/`null` because there is no
  per-user tenant membership table yet. This is intentional and scoped
  (explicitly required by the task), not a gap introduced by this change —
  but it means WP-00 closes the *spoofing* vector, not multi-tenant
  isolation itself (there is exactly one tenant to isolate today).
- `assertClientTenantNotSpoofed` rejects with a generic `403`, which is
  slightly stricter than before for any legitimate caller that was sending a
  tenantId other than `"default"` — none were found in the codebase (all
  known callers send `"default"` or omit the field, per the zod schema
  defaults), but an undiscovered external integration doing this would now
  see a `403` instead of silently operating on the wrong tenant. This is the
  intended tradeoff.

## 11. Rollback Notes

Revert is a pure code revert (no migration, no data change):
`git checkout -- artifacts/api-server/src/routes/marketplace.ts artifacts/api-server/src/routes/catalog.ts`
and delete `artifacts/api-server/src/security/` and the three new test files.
No environment variables, secrets, or schema changed.

## 12. Readiness for WP-02

WP-00 quality gates: met (tenant no longer sourced from body/query/header;
all `parseTenantId`-class call sites in `marketplace.ts` and the two public
`catalog.ts` call sites reviewed and fixed; negative test for the Tenant A →
Tenant B exploit exists at both the resolver-unit and router-integration
level; happy path passes; logs contain no raw token/secret/authorization
header; no dangerous tenant fallback remains — the one remaining fallback is
a single, explicit, server-defined constant, never client-influenced).

WP-01 quality gates: met (canonical context type shipped with all four
factories, an explicit legacy adapter, and unit tests for each; tenant-owned
invariant enforced via `assertTenantOwned`/factory-level throws; request ID
reused from the existing pino-http assignment; typecheck and the full
regression suite are clean).

**WP-02 is ready to start** on top of this foundation. This report does not
change the status of WP-02–WP-14.
