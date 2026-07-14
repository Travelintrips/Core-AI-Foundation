---
name: WP-02 repository foundation
description: How the repository layer wraps RequestContext, what's migrated vs deferred, and a known pre-existing build blocker discovered while working on it.
---

## Design
`artifacts/api-server/src/repositories/types.ts` defines `RepositoryContext { requestContext, executor?, includeDeleted?, auditMetadata?, platformOperation? }` — always wraps the canonical `RequestContext` from `security/requestContext.ts`, never a second context type. Domain repositories write their own explicit `where(eq(table.tenantId, tenantId))` after calling `requireTenantId(ctx)` from `repositories/tenantScope.ts` — there is deliberately no shared generic query builder that could hide/drop the tenant filter.

**Why:** a hidden/shared query builder risks silently widening scope in a way that's hard to audit; explicit per-repository where-clauses stay reviewable.

**How to apply:** any new domain repository should follow this same shape — take `RepositoryContext` first, call `requireTenantId`/`requirePlatformScope`, build its own where clause. Legacy call sites with a bare `tenantId` string param build a `RepositoryContext` via `security/requestContext.ts`'s `adaptLegacyTenantContext` rather than changing their own public signature (see `packageManagerService.ts`).

## Migration status (as of 2026-07-14)
Only the Marketplace Installation domain (`ai_installed_packages` / `packageManagerService.ts`) is fully migrated onto a repository (`packageInstallationRepository.ts`). Quotation has a foundation-only read repository (`quotationRepository.ts`) but `aiQuotationService.ts` (the real atomic-CAS lifecycle service) was intentionally NOT migrated. Project, Request/Brief, Customer Workspace Resource, Job, and Deliverable domains have no repository yet — still direct `db` access. Do not assume broader repository coverage exists without checking the specific service file.

## Known pre-existing blocker (unrelated to repositories)
`artifacts/api-server/src/routes/templates.ts` imports `requireAdminApiKey` from `middleware/adminAuth.ts`, which does not export it. This breaks `pnpm run build:api` (esbuild) entirely, and since the api-server workflow's dev script is `build && start`, the workflow cannot boot until this is fixed. Confirmed present before any repository work started — not a regression from repository work. Needs its own fix (check what `adminAuth.ts` actually exports and update the import, or restore the export) before the api-server workflow will come up again.
