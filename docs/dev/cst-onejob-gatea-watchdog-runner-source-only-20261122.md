# CST-DEV Gate A watchdog runner — source-only integration

**Not deployed.** This module does not create a signed Operations permit,
provision a database role, open LOGIN, disable RLS, or change PROD.

Source: `scripts/dev/cst_onejob_stage_watchdog_runner.py` combines
the existing `cst_onejob_gatea_lease_reader.py` (database-authoritative
UTC clock and one durable lease), `cst_onejob_stage_watchdog_candidate.py`
(heartbeat fail-closed policy) and a private, zero-argument relock-only SQL
function. The older relock controller remains independently tested, but the
watchdog no longer needs raw ALTER ROLE or pg_terminate_backend permissions.

## Authentication and authority contract

The systemd candidate uses `DynamicUser=yes` and two **separately supplied**
`LoadCredential` files: `watchdog-db` (JSON) and `watchdog-ca` (public CA).
The DB JSON contains exactly `version=1`, project
`xssrfshdrtdfupgqwfdw` and a `dsn`. The DSN must use the project-scoped
`cst_gatea_watchdog_relock` user, the fixed Singapore-region pooler
`aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres`, and
`sslmode=verify-full`. Passwords never enter Git or logs. CA certificate
must match the pinned Supabase Root 2021 SHA-256 fingerprint.

The dedicated PostgreSQL role **has not been provisioned in live CST-DEV**
and credentials are **not provisioned**. The proposed role is NOLOGIN and has
no CREATEROLE, SUPERUSER or BYPASSRLS. It may read the exact lease and invoke
only a private, fixed, owner-reviewed SECURITY DEFINER function that closes
LOGIN and terminates this specific stage role's backends. No dynamic SQL
parameters, no public function grant, no direct ALTER ROLE permission.
Do not reuse GPT02 auditor, postgres superuser or a PROD credential.

The closing-only watchdog **must NOT require a still-valid signed Gate A
opening manifest**, because it must remain available after opening authority
expires. Opening/dispatch still require separate signed authorization.
The watchdog requires pinned source configuration, a reviewed default-deny
network namespace, narrow credential and pinned CA. This candidate is NOT
installed, and its separate service security must pass review.

## Resilience

- Recheck every 5 seconds, heartbeat stale at >15 seconds.
- Database UTC clock controls expiry, never the VPS wall clock.
- If lease is absent/stale or source/project mismatched, relock role and
  terminate its active sessions, verifying zero residual sessions.
- If DB query fails, report NO-GO and let systemd retry. Temporary DB outage
  never becomes a PASS. Unit restart rate limiting is disabled to ensure
  retries continue when the pooler recovers.
- A deliberate SIGTERM/normal service stop attempts relock in `finally`.
- This is not proof of a full VPS power-off restart or Supavisor frontend
  draining, which still require real authorized E2E tests.

## QA

- Unit tests: credential/TLS/project/source rejection, fixed SQL allowlist,
  missing and stale lease, database clock failure, read error containment,
  graceful stop and error stop relock.
- PostgreSQL 16 disposable with `--network none`: existing lease/heartbeat
  and old controller QA remains PASS without rewriting proven functionality.
- PostgreSQL 17 disposable with `--network none`: the actual runner executes
  the fixed relock-only SECURITY DEFINER function and proves NOLOGIN with
  zero sessions. Watcher cannot directly ALTER ROLE, CREATE ROLE or read
  unrelated tables; rollback is tested and denies removal with active lease.
- systemd source unit syntax and credential custody tested separately.

Final release remains **NO-GO**. The staged 7-day Owner business approval
is independent of the short-lived technical DB LOGIN lease.