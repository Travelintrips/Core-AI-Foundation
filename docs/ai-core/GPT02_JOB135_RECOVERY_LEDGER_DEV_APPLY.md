# Job 135 — DEV recovery lineage/lease ledger installation gate

**Status as of Nov 9, 2026 WIB:** read-only runtime audit in CST-DEV shows
- `ai_platform.gpt02_dev_recovery_reservations`: EXISTS; RLS enabled; no direct runtime SELECT; narrow timeline reader present
- `ai_platform.gpt02_dev_recovery_command_links`: MISSING
- `ai_platform.gpt02_dev_recovery_leases`: MISSING
- `ai_platform.gpt02_dev_recovery_lease_releases`: MISSING
- recovered DELL prototype SHA-256 matches the reviewed artifact, but native ACK and final attestation remain NOT VERIFIED

This is a **DEV-only additive schema installation**, not an authorized new attempt or proof of no untracked history. It is explicitly blocked from PROD and from worker dispatch.

## Gate checklist
1. Verify Supabase SQL Editor is project `CST-DEV` (project ref `xssrfshdrtdfupgqwfdw`) and you are connected as reservation-table owner `postgres`. Do **not** use an unrelated Supabase project or a production AI Core database.
2. Verify latest reviewed PR CI and isolated PostgreSQL 16 suite `scripts/tests/gpt02_recovery_ledgers_bundle_isolated.sh` passed, using **the exact reviewed commit**.
3. Apply both files *in order* using authorized SQL Editor session (never the app runtime DB role):
   - `scripts/migrations/20261108_gpt02_dev_recovery_lineage_lease.sql`
   - `scripts/migrations/20261108_gpt02_dev_recovery_release_receipts.sql`
   - Before each file, set `SET ai_core.dev_migration_authorized='true';` in the **same SQL Editor execution/session** as the file's SQL, then `RESET ai_core.dev_migration_authorized;` afterward. Each migration contains its own `BEGIN/COMMIT`, so **do not** wrap both in a second outer transaction.
   - Stop on any SQL error. Never remove the role-owner/RLS guards to make the migration run.
4. Verify with read-only SQL below. Both flags `AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED` and `AI_CORE_DEV_GPT02_LEASE_MUTATIONS_ENABLED` must remain OFF.
5. Require an authorized atomic issuer implementation, a safe native worker fencing protocol, and independent ACK evidence **before** enabling any runtime write or dispatch. No runtime grants or RLS policies are part of this proposal.

## Read-only postmigration verification
```sql
SELECT
  x.name,
  to_regclass('ai_platform.'||x.name) IS NOT NULL AS present,
  has_table_privilege('aicore_dev_runtime',
    to_regclass('ai_platform.'||x.name),'SELECT') AS runtime_select,
  has_table_privilege('aicore_dev_runtime',
    to_regclass('ai_platform.'||x.name),'INSERT') AS runtime_insert,
  (SELECT relrowsecurity FROM pg_class
    WHERE oid=to_regclass('ai_platform.'||x.name)) AS rls_enabled
FROM (VALUES ('gpt02_dev_recovery_command_links'),
 ('gpt02_dev_recovery_leases'),
 ('gpt02_dev_recovery_lease_releases')) x(name);
```
Expected for all rows: present=true, runtime_select=false, runtime_insert=false, rls_enabled=true. Also confirm all three tables are empty before any authorized issuer runs.

**Do not mistake schema PASS for Job 135 end-to-end PASS.** The original command remains FAILED, the reviewer accepted recovery recommendations but did not authorize dispatch, and legacy external/native attempts cannot yet be excluded.
