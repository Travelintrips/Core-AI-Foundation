# WP-02 — Shared Repository Foundation: Implementation Report

Date: 2026-07-14

## 1. Scope

Implemented per the WP-02 directive, building on the completed WP-00 (tenant-spoofing fix
in `routes/marketplace.ts` / `routes/catalog.ts`) and WP-01 (canonical `RequestContext`
in `security/requestContext.ts`):

- A small, typed repository contract (`RepositoryContext`) that wraps `RequestContext` —
  not a second competing context model.
- A reusable tenant-scope guard (`requireTenantId` / `requirePlatformScope`).
- A typed repository error model (`RepositoryNotFoundError`, `RepositoryTenantMismatchError`,
  `RepositoryAlreadyDeletedError` (reserved), `RepositoryConflictError`,
  `RepositoryPlatformScopeError`).
- Transaction-executor support (`withExecutor`, `resolveExecutor`) that makes the active
  `tx` explicit on the context instead of allowing a silent fallback to the global `db`
  client mid-transaction.
- **One fully migrated pilot domain — Marketplace Installation** (`ai_installed_packages`):
  `repositories/packageInstallationRepository.ts`, wired into
  `services/packageManagerService.ts`.
- **Quotation domain: foundation only**, per the explicit "no cutover" instruction —
  `repositories/quotationRepository.ts` provides named, reviewed read accessors for both
  the canonical (`ai_quotations`) and legacy (`creative_project_quotations`) lineages, but
  `services/aiQuotationService.ts` (the real, atomic-CAS quotation lifecycle service) was
  **not** touched or migrated onto it.

Explicitly NOT done in this pass (see §8 and §17): Project, Request/Brief, Customer
Workspace Resource, Job, and Deliverable repositories were **not** built. Given the
security-critical nature of this work and the effort budget available, WP-02 delivered one
complete, tested, production-wired pilot migration (Marketplace) plus the reusable
foundation, rather than shallow repositories across all seven priority domains. This is a
deliberate, disclosed scope reduction — see §17 for what remains.

## 2. Baseline (captured before any WP-02 change)

- `pnpm test` (api-server): **488/488 passed**, 21 test files.
- `tsc --noEmit`: **97 pre-existing errors**, none in `marketplace.ts`, `catalog.ts`,
  `security/`, or any file WP-02 touches. All are in unrelated modules from earlier phases
  (asset-library, brand-kit-enterprise, brand-intelligence, creative-brand-intelligence,
  presentation-render, template-matching/service, zip-delivery, `migrate-v43.ts`,
  `seedTemplates.ts`, `routes/templates.ts`).
- `pnpm run build:api` (esbuild): **fails** with one hard error —
  `routes/templates.ts:31` imports `requireAdminApiKey` from `middleware/adminAuth.ts`,
  which does not export it. This is a **pre-existing defect, unrelated to WP-02** (present
  before any WP-02 change; confirmed via a build run before touching any code). It is
  flagged, not fixed, per the explicit WP-02 scope instruction not to fix unrelated
  pre-existing errors — see §14 and §15 for the consequence this has on live smoke testing.
- Full logs: `/tmp/baseline_test.log`, `/tmp/baseline_typecheck.log`, `/tmp/baseline_build.log`.

## 3. Query Inventory Summary (priority domains)

| Domain | Tenant column? | Current access pattern | WP-02 status |
|---|---|---|---|
| Marketplace Installation (`ai_installed_packages`) | Yes (`tenant_id`, NOT NULL) | `packageManagerService.ts` — bare `tenantId` param, direct `db`/`tx` calls | **Migrated** to `packageInstallationRepository.ts` |
| Quotation — canonical (`ai_quotations`) | Yes (`tenant_id`, nullable) | `aiQuotationService.ts` — direct `db` calls, atomic CAS transitions | **Foundation only** — read accessor added, service untouched |
| Quotation — legacy (`creative_project_quotations`) | No column; scoped by `project_id` | `routes/quotations.ts` / project services — direct `db` calls | **Foundation only** — read accessor added, service untouched |
| Project (`creative_projects`) | No column yet | Direct `db` access across several services | Not migrated (see §17) |
| Request/Brief (`ai_service_requests`) | Yes | Direct `db` access, some via `resolvePublicRequestTenantId` | Not migrated (see §17) |
| Customer Workspace Resource | N/A (scoped by hashed `clientEmail`, not tenant) | `customerWorkspaceService.ts` — direct `db`, read-only | Not migrated (see §17) |
| Job (`ai_jobs`) | No column | `jobWorkerService.ts` — `FOR UPDATE SKIP LOCKED` claim loop, no tenant/context param at all | Not migrated (see §17) |
| Deliverable | No dedicated table/column found | `zipDeliveryService.ts`, `jobCompletionGuard.ts` | Not migrated (see §17) |

## 4. Repository Architecture

- `repositories/types.ts` — `RepositoryContext { requestContext, executor?, includeDeleted?, auditMetadata?, platformOperation? }`,
  `makeRepositoryContext`, `resolveExecutor`, `withExecutor`.
- `repositories/errors.ts` — typed error classes (see §1).
- `repositories/tenantScope.ts` — `requireTenantId(ctx)` (delegates to
  `security/requestContext.ts`'s `assertTenantOwned`, so there is exactly one place that
  decides "does this context have a valid tenant"), and `requirePlatformScope(ctx)` which
  requires **both** an authorized actor (`isPlatformAdmin` or `isPlatformWide`) **and** an
  explicit `platformOperation` declared on the call — neither alone is sufficient, mirroring
  the invariant already documented on `RequestContext.isPlatformAdmin`.
- Each domain repository writes its own explicit `where(eq(table.tenantId, tenantId))`
  clause after calling `requireTenantId` — there is intentionally no shared generic query
  builder that could hide or silently drop that filter.

## 5. Context / Tenant Enforcement

No second context type was introduced. `RepositoryContext.requestContext` is always the
canonical `RequestContext` from `security/requestContext.ts`. Legacy call sites that still
pass a bare `tenantId` string (e.g. `packageManagerService.ts`, itself called by
`routes/marketplace.ts`, which already resolves the tenant correctly per WP-00) build a
`RepositoryContext` via the existing `adaptLegacyTenantContext` transitional adapter — the
exact mechanism WP-01 documented for this purpose. No repository trusts a client-supplied
tenantId; the guard only ever reads `ctx.requestContext.tenantId`.

## 6. Repositories Added

- `repositories/packageInstallationRepository.ts` — `findInstallation`, `listInstalled`,
  `insertInstallation`, `updateInstallationById`, `deleteInstallationById`,
  `withTransaction`.
- `repositories/quotationRepository.ts` — `getCanonicalQuotationById`,
  `getLegacyQuotationByProjectId` (read-only, foundation only — see §1 and module doc
  comment for why the two lineages are kept explicitly separate).

## 7. Consumers Migrated

- `services/packageManagerService.ts`: `findInstallation`, `install` (including its
  transactional existence-check + insert), `upgrade`, `setEnabled` (enable/disable), and
  `uninstall` now go through `packageInstallationRepository.ts`. The module's **public
  signatures are unchanged** (still `(tenantId: string, ...)`) — `routes/marketplace.ts`
  and its existing tests were not touched, and none needed to be, because behavior is
  identical.
- `validateDependencies` and `healthCheck` in the same file still query `db` directly
  (dependency-graph reads across the whole catalog and a non-tenant-scoped tool health
  update) — left as-is since they are not tenant-scoped installation-row reads/writes.

## 8. Direct Queries Remaining (priority domains, not migrated)

- `services/aiQuotationService.ts` — full canonical quotation lifecycle (create, issue,
  approve/reject via CAS, item updates) — all direct `db`/`tx` calls, untouched.
- `routes/quotations.ts`, `routes/catalog.ts` — direct `db` access for legacy quotation
  and catalog reads.
- `services/customerWorkspaceService.ts` — all five exported functions, direct `db`.
- `services/jobWorkerService.ts` — `claimJob`, `executeJob`, `completeJob`, `retryJob` —
  direct `db`/`tx`, no `RequestContext`/tenant parameter exists on this service at all.
- `services/zipDeliveryService.ts`, `jobCompletionGuard.ts` — deliverable-adjacent, direct `db`.
- Creative project CRUD services — direct `db` (no tenant column on `creative_projects` yet).

## 9. Transaction Support

`withTransaction(ctx, fn)` in `packageInstallationRepository.ts` wraps `db.transaction`,
binding the live `tx` onto a derived `RepositoryContext` via `withExecutor` and passing that
context to every repository call inside the callback. Every repository function reads its
executor via `resolveExecutor(ctx, db)`, defaulting to the plain `db` client only when no
transaction is active — so a repository call inside a transaction can never accidentally
read/write outside it. Calling `withTransaction` with a context that already has an
executor reuses it instead of nesting a second `db.transaction` (tested).

## 10. Platform-Scope Operations

`requirePlatformScope` exists and is unit-tested (§11) but is **not yet called from any
repository function** — no priority-domain repository built in this pass needed a
cross-tenant read. It is documented and tested so the next repository that needs one (e.g.
a future scheduler-wide job sweep) has a ready, reviewed guard to call instead of inventing
its own bypass.

## 11. Tests Added

- `repositories/__tests__/tenantScope.test.ts` (6 tests): tenant-scoped context returns its
  tenantId; platform-wide context is rejected by `requireTenantId`; a system context with no
  tenantId and not platform-wide throws at construction; `requirePlatformScope` rejects a
  platform-wide call with no declared operation, rejects a declared operation from a
  non-privileged actor, and allows it for both a platform-wide system actor and a
  `platform_admin` session actor.
- `repositories/__tests__/packageInstallationRepository.test.ts` (5 tests): a platform-wide
  context is rejected before any query runs; `findInstallation` never returns another
  tenant's row; `withTransaction` binds `db.transaction`'s `tx` onto the child context's
  executor; `withTransaction` does not nest a nested `db.transaction` when the context
  already carries one.
- Total new tests: **11**. All pre-existing marketplace regression tests
  (`routes/__tests__/marketplace.tenant-security.test.ts`) continue to pass unmodified,
  confirming the repository migration behind `packageManagerService.ts` did not change
  observable HTTP behavior.

## 12. Test Results (after WP-02)

`pnpm test` (api-server): **499/499 passed**, 23 test files (488 baseline + 11 new).
Log: `/tmp/wp02_test.log`.

## 13. Typecheck Results (after WP-02)

`tsc --noEmit`: **97 errors — identical set to baseline** (verified by diff; same file/line/
code list, same count). No new errors introduced by any WP-02 file. Log: `/tmp/wp02_typecheck.log`.

## 14. Build Results

`pnpm run build:api` still fails with the same single pre-existing error documented in §2
(`routes/templates.ts` importing a non-existent `requireAdminApiKey` export). This is
unrelated to any file WP-02 added or changed and was not fixed, per the explicit WP-02
instruction to not fix unrelated pre-existing errors. **This is a pre-existing condition of
the codebase, not introduced by WP-02** — a build run captured before any WP-02 change
failed identically. It does mean the `api-server` dev workflow's `build && start` script
cannot currently produce a running server; see §15.

## 15. Live Smoke Test Results

Because of the pre-existing build failure in §14, the `artifacts/api-server` workflow
cannot currently boot (its `dev` script runs `build` before `start`). This blocks an
in-process HTTP smoke test of the running service. As a substitute, the existing
`routes/__tests__/marketplace.tenant-security.test.ts` suite already exercises the real
`marketplace.ts` router and the newly-migrated `packageManagerService.ts` /
`packageInstallationRepository.ts` over a real `http.Server` + `fetch` (only `@workspace/db`
and the event-bus/audit calls are mocked) — install/upgrade/enable/disable/uninstall/
analytics all return the expected status codes and payloads, and the WP-00 tenant-spoofing
rejection path (403 on a mismatched client tenantId) still passes. This is a real, if
narrower, smoke test of the migrated code path; it is not a substitute for booting the
actual server, which remains blocked by the unrelated pre-existing build defect.

## 16. DB Changes

None. No new tables, columns, or migrations. No `deleted_at` columns. No audit schema
changes. No RLS.

## 17. Compatibility Paths / What Remains

- `packageManagerService.ts` keeps its bare-`tenantId` public signature; only its internals
  moved to the repository. No caller needed to change.
- The dual quotation lineages (canonical `ai_quotations` vs legacy
  `creative_project_quotations`) remain fully separate — no dual-write, no shared table, no
  behavior change to either flow's status machine.
- Remaining priority domains **not** migrated in this pass, in the order the spec
  recommended tackling them next: (B) catalog public routes, (C) project/customer-workspace
  reads, (D) job/deliverable lookups, (E) quotation service cutover onto the foundation
  added here. `jobWorkerService.ts` in particular has no tenant/context parameter anywhere
  today — introducing one is a larger, riskier change (it touches the `FOR UPDATE SKIP
  LOCKED` claim loop) that deserves its own workpackage rather than being rushed into WP-02.

## 18. Risks

- The repository foundation is proven on exactly one domain (Marketplace). Its shape may
  need adjustment once a second, differently-structured domain (e.g. one without a tenant
  column, like Job) is migrated onto it — that is expected and is why WP-02 intentionally
  did not try to force-fit all seven domains onto an unproven contract in one pass.
- The pre-existing `routes/templates.ts` build failure (§14) currently blocks booting the
  real server for a full live smoke test of the whole app, not just the WP-02 changes. This
  predates WP-02 and should be triaged separately.

## 19. Rollback Notes

All WP-02 changes are additive new files (`repositories/*.ts` and its `__tests__/`) plus a
mechanical internal refactor of `packageManagerService.ts` that preserves its public API
and behavior 1:1. Reverting is a straightforward file-level revert of
`services/packageManagerService.ts` and deletion of the `repositories/` directory; no schema
or data changes to roll back.

## 20. Readiness for WP-03

The foundation (context contract, tenant guard, error model, transaction support) is ready
to be reused by a WP-03 that migrates the remaining priority domains. WP-03 should not
change `RepositoryContext`'s shape without re-checking it against a second real domain
first (see §18). Per instructions, no WP-03 work was started.
