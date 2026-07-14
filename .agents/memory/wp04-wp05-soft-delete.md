---
name: WP-04/WP-05 Soft Delete & Retention
description: Design decisions, mock pattern, and activation status for the soft-delete/archive/purge layer
---

## Key decisions

**Column design**: `deleted_at TIMESTAMPTZ NULL` (active = NULL), `archived_at TIMESTAMPTZ NULL` (not archived = NULL). Archive is orthogonal to soft-delete — both columns can be set independently.

**`ctx.includeDeleted` is now active**: The WP-02 reserved flag now drives `softDeleteGuard`. Pass `makeRepositoryContext(ctx.requestContext, { includeDeleted: true })` to bypass the default IS NULL filter.

**Purge requires TWO guards**: `requirePlatformScope(ctx)` must pass AND `ctx.platformOperation` must be declared. A platform-wide context without an explicit `platformOperation` still throws `RepositoryPlatformScopeError`.

**Why:** purge is a cross-tenant, irreversible operation; a plain `isPlatformWide` context is not enough — an explicit named operation must be declared so audit trails name the initiating process.

**creativeProjectRepository is foundation-only**: No `tenantId` column on `creative_projects` → no `requireTenantId`. Scoped by projectId UUID only. Purge is platform-scoped (cross-tenant DELETE by nature). Graduates to full tenant-scoped when the column is added.

**Why:** mirrors quotationRepository WP-02 precedent — never fabricate a tenant filter where the schema has no column.

## Test mock pattern for withTransaction

The `db.transaction` mock MUST pass the mocked `db` object as the executor, not a plain string. Use a self-referential object:

```typescript
vi.mock("@workspace/db", () => {
  const db: Record<string, unknown> = {
    select: vi.fn(...), update: vi.fn(...), delete: vi.fn(...),
  };
  db["transaction"] = vi.fn(async (fn) => fn(db)); // passes db, not "fake-tx"
  return { db, someTable: {...} };
});
```

Also: after `vi.clearAllMocks()` in an async `beforeEach`, re-set the transaction mock:

```typescript
(db["transaction"] as ReturnType<typeof vi.fn>).mockImplementation(async (fn) => fn(db));
```

**Why:** `resolveExecutor(txCtx, db)` returns `txCtx.executor` when set. The transaction callback sets `txCtx.executor = tx`. If `tx = "fake-tx"` (a string), `"fake-tx".select()` throws `TypeError: executor.select is not a function`. Self-referential db avoids this.

**How to apply:** any time you write a repository test where the function under test calls `withTransaction`, use this pattern.

## Files delivered (WP-04/WP-05)

- `repositories/softDelete.ts` — 4 pure composable SQL expression helpers
- `repositories/retentionPolicy.ts` — RetentionPolicy type, RETENTION_POLICIES, runPurge
- `repositories/packageInstallationRepository.ts` — extended with soft-delete/archive/purge ops
- `repositories/serviceRequestRepository.ts` — new full tenant-scoped repo with WP-04/05 built-in
- `repositories/creativeProjectRepository.ts` — foundation-only (no tenant col, UUID-scoped)
- `scripts/migrations/wp04-wp05-soft-delete.sql` — hand-written DDL, safe to re-run
- Schema edits: `ai-installed-packages.ts`, `ai-service-catalog.ts`, `creative-projects.ts`
- Tests: `softDelete.test.ts`, `serviceRequestRepository.test.ts`
- `RepositoryAlreadyDeletedError` in errors.ts — activated (was "Reserved for WP-03+")
