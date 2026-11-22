# CST-DEV Gate A watchdog runner — source-only integration

**Not deployed.** This module does not create a signed Operations permit,
provision a database role, open LOGIN, disable RLS, or change PROD.

Source: `scripts/dev/cst_onejob_stage_watchdog_runner.py` combines
the existing `cst_onejob_gatea_lease_reader.py` (database-authoritative
UTC clock and one durable lease), `cst_onejob_stage_watchdog_candidate.py`
(heartbeat fail-closed policy) and `cst_onejob_stage_relock_controller.py`
(NOLOGIN plus terminate/readback). It does not implement another relock policy.

## Authentication and authority contract

The systemd candidate uses `DynamicUser=yes` and two **separately supplied**
`LoadCredential` files: `watchdog-db` (JSON) and `watchdog-ca` (public CA).
The DB JSON contains exactly `version=1`, project
`xssrfshdrtdfupgqwfdw` and a `dsn`. The DSN must use the project-scoped
`cst_gatea_watchdog_relock` user, the fixed Singapore-region pooler
`aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres`, and
`sslmode=verify-full`. Passwords never enter Git or logs. CA certificate
must match the pinned Supabase Root 2021 SHA-256 fingerprint.

The dedicated PostgreSQL role **does not yet exist** and credentials are
**not provisioned**. Its future privilege boundary must be independently
reviewed: it needs only the ability to read the exact lease + role/session
catalog, execute fixed NOLOGIN for the stage role and terminate only its
backends. Do not reuse GPT02 auditor, postgres superuser, or any PROD secret
as a workaround. The runner rejects unexpected SQL statements.

The operational service also requires independently reviewed Ed25519
manifest/authority source pin, default-deny network namespace and CA
credential. All are still release blockers. This candidate is NOT installed.

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
- PostgreSQL 16 disposable with `--network none`: reuses the official
  durable lease SQL fixture and actually runs the composed runner against
  an orphaned SQL session; NOLOGIN and 0 residual sessions confirmed.
- systemd source unit syntax and credential custody tested separately.

Final release remains **NO-GO**. The staged 7-day Owner business approval
is independent of the short-lived technical DB LOGIN lease.