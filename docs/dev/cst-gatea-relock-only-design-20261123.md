# CST-DEV Gate A — relock-only database interface

**Source candidate, not installed or enabled on any live runtime.**

## Why this is needed

Giving the watchdog PostgreSQL CREATEROLE + ADMIN OPTION would enable both
`ALTER ROLE stage NOLOGIN` and `ALTER ROLE stage LOGIN`, which violates the
one-way containment requirement. `pg_signal_backend` is also too broad.

PostgreSQL 17 does not provide an ALTER ROLE NOLOGIN-only grant. The safe
candidate is a narrowly scoped, zero-argument SECURITY DEFINER function
with fixed SQL statements; it lives in a private schema and delegates
only the operation of *closing* this one exact CST-DEV role.

## Candidate contract

- Project: xssrfshdrtdfupgqwfdw, never any other Supabase project.
- Lease table: ai_platform.cst_gatea_stage_leases, existing forced RLS.
- Watchdog account: cst_gatea_watchdog_relock, initially NOLOGIN, no
  CREATEROLE, SUPERUSER, BYPASSRLS, CREATEDB, or role membership.
- Grants: fixed-column SELECT of project-scoped lease via one SELECT
  RLS policy and EXECUTE of cst_gatea_relock_private.relock_stage_now().
- Function takes **no arguments**, requires exact authenticated SESSION_USER,
  search_path pg_catalog, pg_temp, and is created in a single transaction
  with REVOKE EXECUTE FROM PUBLIC before any session can reach it.
- The function owner is postgres (already possesses required CREATEROLE
  and an explicit ADMIN membership on the exact stage role in CST-DEV).
  This elevated ownership makes audit of the function body essential.
- Fixed operation only: ALTER ROLE cst_team_model_pilot_stage_login NOLOGIN
  CONNECTION LIMIT 1, terminate only that role's backends, refresh the
  PostgreSQL statistics snapshot, return role-login flag/session count and
  secure-scope readback. Failed termination does not falsely claim PASS.
- The Python runner's allowlist excludes raw ALTER ROLE/pg_terminate_backend
  and calls only that private function, checking (login, sessions, scope)
  equals (0, 0, 1); otherwise it fails and systemd retries.

## Rollout boundaries

1. Test SQL against disposable PostgreSQL 17 with Docker `--network none`.
2. Require CI PASS, verified project/role/table preconditions, 0 live
   staging sessions, 0 active approvals, and a separately reviewed change.
3. If approved, apply only to CST-DEV and read back function permissions,
   RLS, role NOLOGIN and absence of any public grants. No PROD.
4. Watchdog credentials, PINNED CA, Operations signed manifest, reviewer
   namespace ACL, Supavisor real connection teardown and host restart E2E
   remain separate prerequisites. Do **not** grant LOGIN or run service.

## Rollback

Source: docs/dev/cst-gatea-relock-only.ROLLBACK-CSTDEV-ONLY.sql. It refuses
rollback if the stage or watchdog is connected, if a lease row exists, or
if another active approval would be affected. It removes only the private
function/schema and watchdog role/lease policy, keeping the lease table.

## Evidence

The disposable PG17 test demonstrates the watcher cannot directly open
LOGIN, alter other roles, create roles, write lease, read unrelated tables
or invoke the definer as an untrusted session. It can call the function to
lock a synthetic stage role and end its active session. The PostgreSQL
statistics-snapshot refresh is necessary for correct zero-session readback.

**Operational releaseDecision=NO_GO** until all real backend and Supavisor
tests prove containment. Short technical LOGIN lease is independent of the
7-day one-use business approval.