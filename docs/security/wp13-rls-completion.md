# WP-13 — Security Hardening: RLS Completion
## Core AI Foundation — Material Library

**Repository:** Travelintrips/Core-AI-Foundation
**Branch:** `security/wp13-rls-completion`
**Base release:** `material-v5.0.0` (`b5335e3`)
**Report date:** 2026-07-27
**Author:** Engineering Team
**Scope:** Close the RLS gap on `material_import_staging` and `material_import_audit` identified in the Phase 6 Entry Approval Report

---

## 1. Tables Affected

| Table | Schema | Reason for gap |
|---|---|---|
| `ai_platform.material_import_staging` | `ai_platform` | Created 2026-07-26 — 12 days after `rls-v12.sql` was finalized |
| `ai_platform.material_import_audit` | `ai_platform` | Same migration file; same timing gap |

**No other tables were modified.** All 11 tables covered by `rls-v12.sql` remain unchanged.

---

## 2. Policies Added

**Migration file:** `scripts/migrations/rls-v13.sql`

### Policy design

Uses the same `allow_authenticated` policy name and permissive `USING (true)` posture as the 11 non-tenant-scoped tables in `rls-v12.sql`, with an explicit `TO authenticated` role restriction. These tables have no `tenant_id` column and are admin-only workflows — they require the same broad authenticated access posture as `ai_audit_logs`, `ai_jobs`, `creative_projects`, etc.

### `ai_platform.material_import_staging`

```sql
ALTER TABLE ai_platform.material_import_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.material_import_staging FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_authenticated ON ai_platform.material_import_staging;
CREATE POLICY allow_authenticated ON ai_platform.material_import_staging
  TO authenticated
  USING (true);
```

| Property | Value |
|---|---|
| Policy name | `allow_authenticated` |
| Type | PERMISSIVE |
| Applies to | ALL operations (SELECT, INSERT, UPDATE, DELETE) |
| Role | `authenticated` only |
| USING expression | `true` (allow all authenticated connections) |
| WITH CHECK expression | None (INSERT/UPDATE not restricted beyond auth) |
| FORCE ROW LEVEL SECURITY | Yes — table owner cannot bypass |

### `ai_platform.material_import_audit`

```sql
ALTER TABLE ai_platform.material_import_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.material_import_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_authenticated ON ai_platform.material_import_audit;
CREATE POLICY allow_authenticated ON ai_platform.material_import_audit
  TO authenticated
  USING (true);
```

| Property | Value |
|---|---|
| Policy name | `allow_authenticated` |
| Type | PERMISSIVE |
| Applies to | ALL operations |
| Role | `authenticated` only |
| USING expression | `true` |
| FORCE ROW LEVEL SECURITY | Yes |

### Effective access matrix after migration

| Role | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|---|---|---|---|---|
| service_role (API server) | ✅ | ✅ | ✅ | ✅ | BYPASSRLS — unaffected by policies |
| authenticated (Supabase JWT) | ✅ | ✅ | ✅ | ✅ | `USING (true)` — all permitted |
| anon (Supabase anon key) | ❌ | ❌ | ❌ | ❌ | Supabase PostgREST blocks anon on tables without an explicit anon policy |
| postgres / table owner | ✅ | ✅ | ✅ | ✅ | Superuser bypasses RLS regardless |

> **Key point:** The API server uses the Supabase service role, which has `BYPASSRLS` privilege. RLS policies have **zero effect on normal application behaviour**. They are a defence-in-depth backstop against direct Supabase client access using lower-privilege keys.

---

## 3. Risk Assessment

### Before this migration

| Risk | Severity | Status |
|---|---|---|
| Anon-key direct Supabase access to `material_import_staging` | Medium | ❌ Unmitigated |
| Anon-key direct Supabase access to `material_import_audit` | Medium | ❌ Unmitigated |
| Authenticated-key direct Supabase access (cross-admin leak) | Low | ❌ Unmitigated |
| Service-role API server access | — | ✅ Always BYPASSRLS — unaffected |
| Application route access (ADMIN_API_KEY gate) | — | ✅ In place — primary gate |

### After this migration

| Risk | Severity | Status |
|---|---|---|
| Anon-key direct Supabase access | ~~Medium~~ | ✅ Blocked by explicit `TO authenticated` policy |
| Authenticated-key direct Supabase access | ~~Low~~ | ⚠️ Permitted by `USING (true)` — same as all other non-tenant tables |
| Service-role API server access | — | ✅ Unchanged — BYPASSRLS |
| Application route access | — | ✅ Unchanged — ADMIN_API_KEY primary gate |

### Residual risk

The `allow_authenticated TO authenticated USING (true)` policy permits any authenticated Supabase JWT holder to read/write these tables. This broad authenticated access is intentional for the admin-only tables; application-layer auth (ADMIN_API_KEY) is the primary gate. No Supabase authenticated-user flow exists in the application; all access is via service role. Residual risk is **Low**.

---

## 4. Verification Evidence

### Migration file

**File:** `scripts/migrations/rls-v13.sql`

- Idempotent: `DROP POLICY IF EXISTS` + `ENABLE ROW LEVEL SECURITY` are safe to re-run
- Rollback DDL included in file header comments
- Post-apply verification query included in file
- Same DDL structure as `rls-v12.sql` — no new security model invented

### Application behaviour analysis

Because the API server uses a Supabase service-role connection with `BYPASSRLS` privilege:

- **Every existing query path is unaffected.** RLS policies are transparent to service-role connections.
- No code changes were required.
- No migration file changes to application source files.

**The only file created in this WP-13 task:**
- `scripts/migrations/rls-v13.sql` — SQL DDL, no TypeScript

---

## 5. Regression Summary

### Task 3 suites (targeted)

| Suite | Test file | Result | Tests |
|---|---|---|---|
| Material Import | `material-import-phase5.test.ts` | ✅ **37 / 37 PASS** | Lifecycle, staging, approve, reject, import |
| Duplicate Resolution | `material-import-phase5.test.ts` | ✅ **Included above** | Scenarios 7–9 |
| Audit Trail | `material-import-phase5.test.ts` | ✅ **Included above** | Scenario 14 |
| Human Review | `material-import-phase5.test.ts` | ✅ **Included above** | Scenarios 10–12 |
| Material Intelligence | `material-intelligence.test.ts` | ✅ **24 / 24 PASS** | Search, suggest, normalise |
| Material Intelligence Auth | `material-intelligence-analytics-auth.test.ts` | ✅ **9 / 9 PASS** | Auth contract |

**All Task 3 targeted suites: 70 / 70 tests passing.**

### Full regression baseline

| Metric | Value |
|---|---|
| Total tests | 5,741 |
| Passing | 5,726 |
| Failing | 15 |
| Failed test files | 2 |

**Pre-existing failures (unchanged by this task):**

| File | Failures | Root cause | Pre-existing? |
|---|---|---|---|
| `provider-health.test.ts` | 12 | Drizzle mock mismatch on `aiProviderHealthLogsTable.values()` — Drizzle ORM insert API not covered by pool mock | ✅ Yes — commit `3b002438` |
| `material-library-catalog.test.ts` | 3 | Test isolation side-effect when run in full suite alongside provider-health; passes 100% in isolation | ✅ Yes — pre-existing |

**No new failures introduced by WP-13.** The baseline is identical to the pre-WP-13 state.

---

## 6. Smoke Test Results

Smoke tests run against the development API server (all workflows running):

| Test | Endpoint | Result | Detail |
|---|---|---|---|
| Health check | `GET /api/healthz` | ✅ PASS | `status: ok` |
| Material search | `POST /api/material-library/search` | ✅ PASS | Results returned for query "marble" |
| Import staging list | `GET /api/ai/material-import/staged` | ✅ PASS | Endpoint accessible with admin key |
| Import dashboard | `GET /api/ai/material-import/dashboard` | ✅ PASS | Dashboard shape returned |
| Material categories | `GET /api/material-library/categories` | ✅ PASS | 13 categories returned |
| Material suggestions | `GET /api/material-library/suggestions` | ✅ PASS | Suggestions endpoint reachable |

> **Note:** The RLS migration (`rls-v13.sql`) is applied at the Supabase database level, not via the application server. Application-layer smoke tests confirm that routes, auth, and data access continue to function correctly regardless of RLS state (service-role BYPASSRLS). A database-level verification query must be run after applying the migration to Supabase (see post-apply verification in `scripts/migrations/rls-v13.sql`).

---

## 7. Rollback Procedure

If the migration must be reversed:

```sql
-- Connect to target database via psql
SET search_path TO ai_platform, public;

ALTER TABLE ai_platform.material_import_staging  DISABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.material_import_audit    DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_authenticated ON ai_platform.material_import_staging;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.material_import_audit;
```

Rollback is fully reversible — RLS enable/disable preserves all table data and existing policies can be re-created from the migration file.

---

## 8. Production Application Procedure

Follow `docs/production-migration-runbook.md` — Section 10 (RLS Migration):

1. Complete pre-flight checklist (Section 4)
2. Apply to development first:  
   `psql "$SUPABASE_DATABASE_URL_DEV" -f scripts/migrations/rls-v13.sql`
3. Run post-apply verification query from file header
4. Confirm smoke tests still pass in dev
5. Apply to production:  
   `psql "$SUPABASE_DATABASE_URL" -f scripts/migrations/rls-v13.sql`
6. Run post-apply verification query against production
7. Document result in `docs/audits/migration-YYYYMMDD-result.md`

---

## Summary

| Item | Status |
|---|---|
| Migration created | ✅ `scripts/migrations/rls-v13.sql` |
| Policies added | ✅ 2 tables, `allow_authenticated TO authenticated USING (true)` each |
| Policy style consistent with WP-12 | ✅ Same broad authenticated posture, with explicit role restriction |
| No new security model invented | ✅ |
| Application behaviour unchanged | ✅ Service-role BYPASSRLS |
| Task 3 regression suites | ✅ 70 / 70 |
| Full baseline unchanged | ✅ 15 pre-existing failures, 0 new failures |
| Rollback DDL documented | ✅ In migration file |
| Runbook updated | ✅ `docs/production-migration-runbook.md` §10 |

---

## Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Migration author | | | |
| Reviewer (second engineer) | | | |
| Engineering lead | | | |
