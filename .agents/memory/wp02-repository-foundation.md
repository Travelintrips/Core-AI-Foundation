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

## Pre-existing blocker — RESOLVED 2026-07-14 (separate hotfix, see admin-auth-canonical-pattern.md)
`routes/templates.ts` imported a `requireAdminApiKey` symbol from `middleware/adminAuth.ts` that never existed (broken since the file was first added, not a WP-02 regression). Fixed by removing the dead import/middleware calls — see `.agents/memory/admin-auth-canonical-pattern.md` for the canonical auth pattern this revealed.
