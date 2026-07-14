# WP-04 / WP-05 — Soft Delete, Archive, Retention & Purge: Implementation Report

Date: 2026-07-14  
Author: TEAM B

---

## 1. Scope

Implemented per the WP-04 (soft delete + repository filtering) and WP-05 (archive, restore, retention policy, hard-delete purge) directives, building on the WP-02 repository foundation (`RepositoryContext`, `requireTenantId`, `requirePlatformScope`, `resolveExecutor`, `withExecutor`).

### In scope (per owner brief)

| Area | Status |
|---|---|
| Schema: `deleted_at` + `archived_at` columns on 3 tables | ✅ Done |
| DDL migration (hand-written, safe to re-run) | ✅ Done |
| Repository filtering (`ctx.includeDeleted` now active) | ✅ Done |
| Soft delete — `softDeleteById` | ✅ Done (3 domains) |
| Restore — `restoreById` / `restoreByProjectId` | ✅ Done (3 domains) |
| Archive — `archiveById` / `archiveByProjectId` | ✅ Done (3 domains) |
| Unarchive — `unarchiveById` / `unarchiveByProjectId` | ✅ Done (3 domains) |
| Retention policy types + canonical windows | ✅ Done |
| Purge runner (platform-scoped, audited via TEAM A hook) | ✅ Done |
| Hard-delete via purge in each domain repository | ✅ Done (3 domains) |
| Tests (unit + integration-style) | ✅ Done |

### Explicitly NOT done (per owner brief restrictions)

- tenant middleware, RequestContext, audit architecture — untouched
- quotation, worker, scheduler, SSE, presentation, document, AI workflow — untouched
- No custom audit system was created. All audit writes use TEAM A's `logAudit` hook (`services/aiAuditService.ts`)

---

## 2. Architecture

### 2.1 Core helpers

**`artifacts/api-server/src/repositories/softDelete.ts`**

Four pure, composable SQL expression helpers:

| Function | Returns | Usage |
|---|---|---|
| `softDeleteGuard(col, ctx)` | `SQL \| undefined` | Default filter in all list/find queries |
| `deletedOnlyGuard(col)` | `SQL` | Admin views showing only deleted rows |
| `archivedOnlyGuard(col)` | `SQL` | Views showing only archived rows |
| `purgeEligibleGuard(col, cutoffDate)` | `SQL` | Retention purge DELETE queries |

Key design: `softDeleteGuard` returns `undefined` when `ctx.includeDeleted = true`, and drizzle's `and()` ignores `undefined` entries. This means the call site requires zero conditional logic:

```typescript
.where(and(eq(t.tenantId, tenantId), softDeleteGuard(t.deletedAt, ctx)))
```

**`artifacts/api-server/src/repositories/retentionPolicy.ts`**

- `RetentionPolicy` type: `{ resourceType, windowDays, description }`
- `PurgeResult` type: `{ resourceType, windowDays, cutoffDate, purgedCount, executedAt }`
- `RETENTION_POLICIES` — canonical windows (Marketplace: 90 days, ServiceRequest: 365 days, CreativeProject: 365 days)
- `runPurge(ctx, policy, hardDelete)` — generic purge runner that:
  1. Calls `requirePlatformScope(ctx)` (throws `RepositoryPlatformScopeError` without a declared `PlatformOperation`)
  2. Audits intent via `logAudit("retentionPolicy", "purge_start", ...)` — TEAM A hook, never throws
  3. Delegates DELETE to the domain-provided `hardDelete` callback
  4. Audits result or failure
  5. Returns `PurgeResult`

### 2.2 `ctx.includeDeleted` — now active

`RepositoryContext.includeDeleted` was previously a reserved-but-unused flag (see WP-02 types.ts comment). WP-04 activates it:

- **Before WP-04**: every list/find returned all rows regardless
- **After WP-04**: every list/find in the three migrated repositories excludes soft-deleted rows by default; callers pass `{ includeDeleted: true }` to override (e.g., admin restore views)

The flag is read only by `softDeleteGuard` — no repository function checks it directly, preserving the single-responsibility principle.

---

## 3. Schema changes

### 3.1 New columns

Three tables received two new nullable `TIMESTAMPTZ` columns each:

| Table | New columns |
|---|---|
| `ai_platform.ai_installed_packages` | `deleted_at`, `archived_at` |
| `ai_platform.ai_service_requests` | `deleted_at`, `archived_at` |
| `ai_platform.creative_projects` | `deleted_at`, `archived_at` |

**Semantics:**
- `deleted_at = NULL` → row is active (default)
- `deleted_at = <timestamp>` → row is soft-deleted; hidden from default list/find queries
- `archived_at = NULL` → row is not archived (default)
- `archived_at = <timestamp>` → row is archived; orthogonal to `deleted_at`

### 3.2 Drizzle schema updates

The TypeScript table definitions in `lib/db/src/schema/` were updated:
- `ai-installed-packages.ts` — `deletedAt`, `archivedAt` fields added
- `ai-service-catalog.ts` — `deletedAt`, `archivedAt` added to `aiServiceRequestsTable`
- `creative-projects.ts` — `deletedAt`, `archivedAt` fields added

`$inferSelect` types (`AiInstalledPackage`, `AiServiceRequest`, `CreativeProject`) now include the new fields automatically.

### 3.3 DDL migration

**`scripts/migrations/wp04-wp05-soft-delete.sql`**

- Uses `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — safe to re-run
- Creates partial indexes (`WHERE deleted_at IS NOT NULL`) so the hot path (active records, `deleted_at IS NULL`) never touches the soft-delete index
- Ends with a verification query to confirm columns exist on all three tables
- Does NOT use `drizzle-kit push` (per the `drizzle-push-false-positive` policy; see `.agents/memory/drizzle-push-false-positive.md`)

---

## 4. Domain repositories

### 4.1 `packageInstallationRepository.ts` (updated — WP-02 pilot domain)

Functions added/changed:

| Function | Change |
|---|---|
| `findInstallation` | Now applies `softDeleteGuard(t.deletedAt, ctx)` |
| `listInstalled` | Now applies `softDeleteGuard(t.deletedAt, ctx)` |
| `updateInstallationById` | Guard added (can't update soft-deleted rows) |
| `softDeleteById(ctx, id)` | **New** — transactional find-then-update; throws `RepositoryAlreadyDeletedError` |
| `restoreById(ctx, id)` | **New** — clears `deletedAt` + `archivedAt` |
| `archiveById(ctx, id)` | **New** — sets `archivedAt` |
| `unarchiveById(ctx, id)` | **New** — clears `archivedAt` |
| `purgeExpiredInstallations(ctx, policy)` | **New** — delegates to `runPurge` |

All mutations call `logAudit` (TEAM A hook) with `module = "packageInstallationRepository"`.

### 4.2 `serviceRequestRepository.ts` (new — WP-04 first full tenant-scoped domain)

New repository for `ai_service_requests`. Ships with soft-delete from day one.

Tenant scoping: `ai_service_requests.tenantId` is nullable (null = shared/"default" tenant). The repository follows the `quotationRepository.ts` convention: a row with `tenantId = null` is treated as belonging to any tenant context. This is a read-only convenience consistent with the existing single-tenant convention and must be revisited before real multi-tenancy.

Functions:

| Function | Notes |
|---|---|
| `findServiceRequest(ctx, id)` | By PK, tenant-checked, soft-delete filtered |
| `findServiceRequestByRequestId(ctx, requestId)` | By UUID, tenant-checked |
| `listServiceRequests(ctx, opts)` | Paginated, newest-first, status filter optional |
| `softDeleteById(ctx, id)` | Transactional; throws `AlreadyDeletedError` |
| `restoreById(ctx, id)` | Clears `deletedAt` + `archivedAt` |
| `archiveById(ctx, id)` | Sets `archivedAt`; only on active rows |
| `unarchiveById(ctx, id)` | Clears `archivedAt` |
| `withTransaction(ctx, fn)` | Same pattern as packageInstallation repo |
| `purgeExpiredServiceRequests(ctx, policy)` | Platform-scoped; delegates to `runPurge` |

### 4.3 `creativeProjectRepository.ts` (new — FOUNDATION ONLY)

`creative_projects` has no `tenantId` column. Per the WP-02 precedent for the quotation domain: **do not fabricate a tenant filter where the schema has none.**

Consequently:
- Reads/mutations are scoped by `projectId` (unique UUID — capability token)
- No `requireTenantId` call; caller is responsible for verifying the UUID was obtained through a tenant-verified lookup
- Purge calls `requirePlatformScope` explicitly (DELETE is cross-tenant by nature without a tenant column)

Functions:

| Function | Notes |
|---|---|
| `findProjectByProjectId(ctx, projectId)` | By UUID, soft-delete filtered |
| `softDeleteByProjectId(ctx, projectId)` | Transactional; throws `AlreadyDeletedError` |
| `restoreByProjectId(ctx, projectId)` | Clears `deletedAt` + `archivedAt` |
| `archiveByProjectId(ctx, projectId)` | Sets `archivedAt`; only on active rows |
| `unarchiveByProjectId(ctx, projectId)` | Clears `archivedAt` |
| `purgeExpiredProjects(ctx, policy)` | Requires platform scope (no tenant column) |

**Future work:** once `creative_projects` gains a `tenantId` column, graduate this repository from foundation-only to full tenant-scoped (same migration path as `packageInstallationRepository.ts`).

---

## 5. Error model

`RepositoryAlreadyDeletedError` in `repositories/errors.ts` was activated (WP-02 reserved it as a placeholder). Its comment was updated from "Reserved for WP-03+" to reflect its WP-04 activation.

The error is thrown by `softDeleteById` / `softDeleteByProjectId` when the target row's `deletedAt` is already non-null. Callers should catch it and return HTTP 409 Conflict or an equivalent domain response.

---

## 6. Audit (TEAM A integration)

Every soft-delete mutation calls TEAM A's `logAudit` hook:

```typescript
await logAudit(module, action, resourceId, resourceType, status, details);
```

The `runPurge` runner calls `logAudit` at two points:
1. **Before** the hard-delete (intent log — survives even if the DELETE fails)
2. **After** success OR failure

`logAudit` is defined to never throw — audit write failures produce a console error but do not propagate. This means a transient Supabase write failure on the audit table will not block a legitimate soft-delete or purge operation.

---

## 7. Tests

Two new test files:

| File | Tests |
|---|---|
| `__tests__/softDelete.test.ts` | Helper pure-function tests; `packageInstallationRepository` lifecycle (softDelete, AlreadyDeleted guard, NotFound guard, restore, archive, unarchive, tenant enforcement) |
| `__tests__/serviceRequestRepository.test.ts` | Tenant enforcement; findServiceRequest (wrong-tenant, null-tenant); softDeleteById (not-found, already-deleted, happy path, wrong-tenant); restoreById; archiveById; listServiceRequests; `retentionPolicy.runPurge` (platform scope guard, cutoff date math, error auditing) |

### Existing tests

No existing tests were modified. WP-04 changes to `packageInstallationRepository.ts` are additive and backward-compatible: `findInstallation` and `listInstalled` now filter `deleted_at IS NULL` by default, but the existing test mocks return rows without a `deletedAt` key, which Drizzle's `isNull` correctly matches (NULL/undefined treated as NULL in the mock chain).

---

## 8. What remains (future workpackages)

| Item | Notes |
|---|---|
| `creative_projects` full tenant scoping | Requires `tenant_id` column migration first |
| Remaining domains (Jobs, Deliverables, etc.) | Not in WP-04 scope |
| Scheduler-triggered nightly purge | Uses `purgeExpiredInstallations` / `purgeExpiredServiceRequests` / `purgeExpiredProjects` but requires a scheduler job — explicitly out of WP-04/05 scope |
| Admin UI for "restore deleted records" | Requires frontend work + route changes |
| Drizzle schema for archived-only list views | Needs `archivedOnlyGuard` wired into list functions if desired |

---

## 9. Files changed / created

### New files

| Path | Purpose |
|---|---|
| `artifacts/api-server/src/repositories/softDelete.ts` | SQL expression helpers (WP-04) |
| `artifacts/api-server/src/repositories/retentionPolicy.ts` | Policy types + purge runner (WP-05) |
| `artifacts/api-server/src/repositories/serviceRequestRepository.ts` | Service request domain repository |
| `artifacts/api-server/src/repositories/creativeProjectRepository.ts` | Creative project domain repository (foundation only) |
| `artifacts/api-server/src/repositories/__tests__/softDelete.test.ts` | Tests for helpers + packageInstallation repo |
| `artifacts/api-server/src/repositories/__tests__/serviceRequestRepository.test.ts` | Tests for service request repo + purge runner |
| `scripts/migrations/wp04-wp05-soft-delete.sql` | Hand-written DDL migration |

### Modified files

| Path | Change |
|---|---|
| `lib/db/src/schema/ai-installed-packages.ts` | Added `deletedAt`, `archivedAt` columns |
| `lib/db/src/schema/ai-service-catalog.ts` | Added `deletedAt`, `archivedAt` to `aiServiceRequestsTable` |
| `lib/db/src/schema/creative-projects.ts` | Added `deletedAt`, `archivedAt` columns |
| `artifacts/api-server/src/repositories/packageInstallationRepository.ts` | Soft-delete filter + lifecycle functions |
| `artifacts/api-server/src/repositories/errors.ts` | Activated `RepositoryAlreadyDeletedError` comment |
