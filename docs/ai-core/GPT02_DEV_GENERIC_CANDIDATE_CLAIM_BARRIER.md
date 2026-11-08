# GPT02 DEV — canonical candidate claim barrier

## Finding

The generic external-agent claim route already rejects recovery-marked metadata,
but a reserved or linked recovery child lacking those markers might bypass it.
The DELL native worker still does not validate a recovery fencing token.

## DEV-only approach

The owner-controlled migration 20261109_gpt02_dev_generic_claim_candidate_barrier.sql
installs a narrow, read-only SECURITY DEFINER boolean function:

- Input: command UUID.
- If UUID is a reservation candidate or linked recovery child, return false.
- Otherwise return true.
- No broad SELECT grants to aicore_dev_runtime.
- Only aicore_dev_runtime may EXECUTE. Browser roles are denied.
- Requires explicit migration authorization, reservation and link table
  ownership, active RLS, and absent broad runtime SELECT. Reapplying is safe.

In APP_ENV=development, the generic claim SELECT invokes this database
function alongside the existing metadata quarantine; outside DEV it emits
a literal TRUE and does not require a new PROD database function.

## Deployment order

1. Verify Supabase project CST-DEV (ref xssrfshdrtdfupgqwfdw), database role
   postgres, owner of both recovery ledger tables; never use PROD.
2. Run isolated test scripts/tests/gpt02_generic_claim_candidate_barrier_isolated.sh.
   The test uses Docker PostgreSQL 16 with no network and compiles the actual
   Drizzle query fragment. It checks denied unauthorized/rogue installation,
   idempotent double install, browser denial, runtime no SELECT, unmarked
   candidate blocked and ordinary command allowed.
3. BEFORE code deployment, apply the SQL file on CST-DEV as owner with the
   ai_core.dev_migration_authorized session flag; no commands or leases created.
4. Independently read back the function owner and the EXECUTE/SELECT privilege
   matrix. Both GPT02 recovery flags must stay OFF.
5. Merge to develop through successful CI, then verify exact public DEV SHA,
   normal bridge behavior, and unchanged PROD.

This barrier is not an authorized recovery issuer, does not prove the absence
of external legacy attempts, and does not provide a DELL native fencing ACK.
Do not mark Job 135 E2E PASS.
