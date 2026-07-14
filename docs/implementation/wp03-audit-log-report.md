# WP-03 — Canonical Audit Log: Implementation Report

Date: 2026-07-14

## 1. Scope

Implemented per this team's WP-03 directive ("Canonical Audit Log", P0-3 in
`p0-enterprise-foundation-implementation-spec.md`; this label maps onto
`p0-work-package-plan.md`'s **WP-07 + WP-08 combined**). Source-of-truth docs:
`p0-enterprise-foundation-implementation-spec.md`, `p0-work-package-plan.md`,
`p0-test-and-rollout-plan.md`, `docs/blueprints/p0-audit-log-blueprint.md`.

Delivered:

- **Schema (Phase 1 of the blueprint):** additive, nullable `tenant_id` and
  `actor_type` columns on the existing `ai_audit_logs` table (no new table —
  the blueprint's own migration strategy explicitly calls for strengthening
  the existing table first, deferring full consolidation onto the separate
  Canonical Runtime Event Model, v4.0C, to a later phase). Applied via
  `artifacts/api-server/src/scripts/ddl-audit-log-tenant-actor.sql` against
  the dev Supabase database (see §4).
- **Actor-type normalization** (`services/audit/auditTypes.ts`): a coarse
  `AuditActorType` (`internal_user | customer | public_token | system |
  worker`) derived from the richer `RequestContext.actorType` (9 values) via
  an exhaustive mapping function, so the audit trail stays reviewable
  without every caller re-deriving the mapping. This vocabulary is a
  deliberate adaptation, not a literal copy, of the blueprint's proposed
  `internal_staff / customer / system / superadmin_cross_tenant` set — the
  real `RequestContext` already treats `public_token` and `worker` as
  first-class actor types (WP-00/WP-01), so the audit vocabulary reflects
  what the system actually distinguishes today rather than re-deriving a
  parallel taxonomy.
- **Redaction & diffing** (`services/audit/auditRedaction.ts`):
  `sanitizeForAudit` denylist-redacts sensitive-looking keys (password,
  secret, token, apiKey, prompt, credential, hash, etc.) at any depth;
  `computeAuditDiff` diffs raw before/after row snapshots first (so a change
  to a secret value is still detected as *a change happened*), then redacts
  only the changed keys before they leave the function — the value itself
  never reaches `ai_audit_logs.details`.
- **Backward-compatible `logAudit` extension**
  (`services/aiAuditService.ts`): the original 6-arg positional signature is
  unchanged for the ~40 existing call sites; added (a) an optional 7th
  positional `context` argument (`{ tenantId?, actorId?, actorType? }`) and
  (b) a second object-style overload. The object overload additionally fixes
  **3 pre-existing, genuinely broken call sites** that already called
  `logAudit({ action, entityType, entityId, details })` with an object where
  only the positional signature existed — `brand-intelligence.ts:56`,
  `assetIntelligenceService.ts:278`, `creativeBrandIntelligenceService.ts:362`.
  These were not introduced by this work; they are fixed as a natural
  consequence of extending the audit service, without editing any of those
  three files.
- **Immutability at the application layer**: `updateAuditLog()` /
  `deleteAuditLog()` are exported, always throw `AuditLogImmutableError`, and
  serve as an explicit, documented refusal for any future call site that
  reaches for "update an audit row" — there was and is no other update/delete
  path (writes are `db.insert`-only; reads are `routes/audit.ts` only).
- **Repository-driven auto-emission** (`repositories/auditHook.ts`, new
  file): `emitRepositoryAuditRecord(ctx, params)` derives the audit identity
  from `ctx.requestContext`, merges `ctx.auditMetadata`, computes a redacted
  before/after diff, and calls the extended `logAudit`. Never throws.
- **Pilot domain wiring**: `repositories/packageInstallationRepository.ts`
  (Marketplace Installation — the WP-08 pilot domain) now calls
  `emitRepositoryAuditRecord` from `insertInstallation`,
  `updateInstallationById`, and `deleteInstallationById`. No manual
  `logAudit` call was added at the `packageManagerService.ts` call site —
  every write on this domain produces exactly one audit row automatically.
- **Read API, additive only**: `routes/audit.ts` now also filters by
  `tenantId`/`actorType`; `lib/api-spec/openapi.yaml` /
  generated `@workspace/api-zod` schemas expose the two new nullable fields
  and query params. `artifacts/ai-platform/src/pages/audit.tsx` (forbidden
  file, not touched) only reads a strict subset of the response fields, so
  this is confirmed additive and safe.

## 2. Out-of-scope hotfix (disclosed, not part of WP-03)

`artifacts/api-server/src/routes/templates.ts` had a pre-existing merge
artifact: every admin route was registered **twice** with stacked
`router.X(...) => {` openers — one correctly-scoped, authenticated
`/ai/templates/...` route with `requireAdminApiKey`, and one bogus,
unauthenticated `/api/ai/templates/...` route layered directly underneath it.
This was a real syntax/brace-balance error that broke `tsc` and `esbuild` for
the *entire* `api-server` package — not something isolable via a `tsconfig`
exclusion, since TypeScript still pulls the file in through the import graph.
Confirmed via `git log`/`git status` that this was already committed, not a
live in-progress edit by another team. Fixed minimally: removed the 10
duplicate/incorrect second route lines, keeping the authenticated,
correctly-scoped version of each route. This follows the same
out-of-scope-build-unblocking precedent as WP-02's `requireAdminApiKey`
fix — flagged here prominently and kept out of the WP-03 diff's substance.

## 3. Baseline & after-state (`tsc --noEmit`, api-server)

- Baseline (immediately after the templates.ts hotfix, before any WP-03
  schema/service work): **57 errors across 11 files** — all unrelated
  domains (asset intelligence, brand DNA, templates/marketplace matching,
  presentation engine/pptxgenjs, zip delivery, one test file). Saved to
  `/tmp/tsc-baseline-after-templates-fix.log`.
- After WP-03: **43 errors across 6 files** — a strict subset of the
  baseline's files and errors (`assetLibraryService.ts`,
  `brandKitEnterpriseService.ts`, `creativeBrandIntelligenceService.ts`,
  `presentation/presentationRenderService.ts`, `zipDeliveryService.ts`,
  `__tests__/v42d-zip-delivery.test.ts`). The 14-error/5-file reduction comes
  from the `logAudit` object-overload fixing the 3 broken call sites
  described in §1, plus TypeScript's overload resolution clearing a few
  downstream errors that depended on them. No new error appears in any file
  outside these pre-existing, unrelated domains. Saved to
  `/tmp/tsc-after-wp03.log`.
- `node ./build.mjs` (esbuild, the actual runtime build): succeeds, both
  before and after this work.

## 4. Database change applied

`artifacts/api-server/src/scripts/ddl-audit-log-tenant-actor.sql` (idempotent,
`ADD COLUMN IF NOT EXISTS`, following the existing `ddl-*.sql` convention)
was applied directly to the dev Supabase database via `psql`:

```
ALTER TABLE ai_platform.ai_audit_logs
  ADD COLUMN IF NOT EXISTS tenant_id  text,
  ADD COLUMN IF NOT EXISTS actor_type text;
CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_tenant_id ON ai_platform.ai_audit_logs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_created_at ON ai_platform.ai_audit_logs (created_at DESC);
```

`drizzle-kit push` was deliberately **not** run — it has a known history in
this project of proposing to drop the entire `ai_platform` schema even for
purely additive changes (see `.agents/memory/drizzle-push-false-positive.md`).
The Drizzle schema file (`lib/db/src/schema/ai-audit-logs.ts`) was hand-edited
to match the applied DDL instead.

**Production**: this DDL has not been applied to production. Per the
`database` skill, production schema changes for Replit-managed Postgres are
applied through the Publish flow's automatic dev→prod diff, not by agent
script — this project uses an external Supabase database instead, so there
is no equivalent automated apply path found in this codebase (see
`ddl-*.sql` files, all of which are applied manually per existing
convention). Applying this DDL to the production Supabase database is a
manual follow-up outside this environment's tooling.

## 5. Testing

New test files (all passing):

- `services/audit/__tests__/auditTypes.test.ts` — actor-type mapping is
  exhaustive and stable; `deriveAuditContext` correctly derives
  tenant/actor/actor-type from session, system/scheduler, and public-token
  `RequestContext`s.
- `services/audit/__tests__/auditRedaction.test.ts` — sensitive-key
  redaction at depth, inside arrays, bounded recursion; diff-then-redact
  correctness (including the case where only a secret's value changed).
- `services/__tests__/aiAuditService.test.ts` — legacy positional call sites
  (4-arg, 6-arg) unchanged; new optional 7th `context` arg; object-style
  overload with `entityType`/`entityId` aliases (the 3 previously-broken
  call sites' exact shape); `logAudit` never throws on a DB failure;
  `updateAuditLog`/`deleteAuditLog` always throw `AuditLogImmutableError`.
- `repositories/__tests__/auditHook.test.ts` — `emitRepositoryAuditRecord`
  derives identity correctly (including the platform-wide/system,
  `tenantId: null` case), attaches a redacted diff, forwards
  `auditMetadata`, and never throws.
- `repositories/__tests__/packageInstallationRepository.audit.test.ts` —
  every write method (`insertInstallation`, `updateInstallationById`,
  `deleteInstallationById`) emits exactly one audit record with the right
  operation/before/after; a delete on a non-existent row emits nothing
  (nothing to attribute); read methods (`findInstallation`, `listInstalled`)
  never emit.

Full suite: `pnpm exec vitest run` in `artifacts/api-server` — **28 test
files, 527 tests, all passing** (32 of which are new for WP-03).

## 6. Acceptance criteria vs. blueprint §15

| Criterion | Status |
|---|---|
| Every mutation on the pilot domain produces exactly one complete audit row (`tenantId`, `actorId`, `actorType`, `resourceType`/`resourceId`, `action`, `status`) | Done for Marketplace Installation (the assigned pilot domain). Other domains still write manually via the ~40 pre-existing `logAudit` call sites, which now *can* pass `tenantId`/`actorId`/`actorType` via the new optional context but are not required to — extending auto-emission to every domain is future work (blueprint §14 step 4), out of this team's assigned scope. |
| No update/delete path on the audit table from the application | Done — `updateAuditLog`/`deleteAuditLog` always throw; no other code path exists. |
| Admin investigation dashboard can filter by tenant/actor/resource/time | Read API (`routes/audit.ts`) now filters by `tenantId`/`actorType` in addition to the existing `module`/`action`/time-ordering; a dedicated filter-by-actor-id UI control was not added (frontend is out of this team's scope; the field is already exposed in the API response for a future frontend task). |
| Historical backfill verified, no silent loss of meaning | Not attempted — this is genuinely irreversible/inferential work (reconstructing tenant/actor from old `details` JSON) that risks introducing incorrect data if done hastily; explicitly flagged as follow-up rather than guessed at. Existing rows read back with `tenantId: null`, `actorType: null`, which is honest (unknown), not silently wrong. |

## 7. What was NOT done (explicitly out of scope or deferred)

- Extending automatic audit emission beyond the Marketplace Installation
  pilot domain to the other repository-migrated domains — no other domain
  repository exists yet (WP-02 migrated only this one pilot domain).
- Consolidating onto the Canonical Runtime Event Model (v4.0C) as the single
  source of truth (blueprint Phase 3) — intentionally deferred; this pass is
  Phase 1 (schema) + a slice of Phase 2 (one pilot domain's auto-trigger).
- Historical backfill of `tenantId`/`actorType` for existing rows.
- Any change to `security/requestContext.ts`, `repositories/types.ts`,
  `repositories/tenantScope.ts`, `repositories/errors.ts`, tenant middleware,
  soft delete, quotation, worker/scheduler, SSE, presentation, document
  engine, frontend, or authentication — all correctly out of this team's
  ownership and left untouched (aside from the disclosed `templates.ts`
  hotfix in §2, which touches none of those systems either).
- Applying the DDL to the production Supabase database (see §4).
