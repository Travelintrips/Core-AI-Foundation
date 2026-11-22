# Gate A CST-DEV — reject future-dated lease heartbeat at database boundary

**Scope:** Supabase project `xssrfshdrtdfupgqwfdw` only. No changes to
staging LOGIN, watchdog LOGIN, database passwords, approval, signer,
dispatch, PostgreSQL role membership or PROD.

## Evidence and root cause

The existing `cst_onejob_stage_watchdog_candidate.check_once` already
requires `issued_at <= heartbeat_at <= database_utc_now < expires_at`.
Therefore an out-of-order future timestamp would trigger relock, not
extend an accepted lease.

However, previously installed RLS policies on
`ai_platform.cst_gatea_stage_leases` restricted INSERT to the exact project
and UPDATE to an active unexpired row, while the table CHECK required
only `issued_at <= heartbeat_at <= expires_at`. A scoped writer could
therefore submit a future heartbeat as data. This was **verified before
the patch** on disposable PostgreSQL 17 with the exact original lease,
relock and ACL SQL. The writer has no LOGIN and no attached service
operationally, but data-layer rejection remains useful defense in depth.

## Minimal hardening

`docs/dev/cst-gatea-heartbeat-no-future.CSTDEV-ONLY.sql` changes only
the existing `WITH CHECK` expressions of two RLS policies:

- `gatea_stage_lease_write_insert` now requires the correct project,
  ACTIVE state, issued_at and heartbeat_at not later than the DB clock,
  and expiration later than the DB clock
- `gatea_stage_lease_write_update` preserves its original role, USING
  conditions and table/column grants, but rejects heartbeat_at later
  than the DB clock

No trigger, table rewrite, new grant, role, policy, password or worker.
PostgreSQL clock_timestamp() is the DB time source; client clock values
are not an authorization source.

## Tests and rollback

`scripts/dev/cst-onejob-gatea-no-future-heartbeat-pg17.disposable.py`
runs official SQL inside an isolated PostgreSQL 17 Docker container
(`--network none`). It proves future INSERT and UPDATE were allowed
before the patch, are rejected after it, valid writes still work, forced
RLS and all five policies remain, and stage/watchdog roles stay NOLOGIN.
It also proves rollback cannot proceed with an existing lease and that
clean rollback restores the prior policy expressions. Reapplying the
migration must be refused.

The rollback source is
`docs/dev/cst-gatea-heartbeat-no-future.ROLLBACK-CSTDEV-ONLY.sql`.
It refuses nonempty lease data, active approvals/sessions, missing forced
RLS, or unexpected policy drift. Never roll back during an active lease.

**Evidence log:** `/opt/cst-onejob-dev/qa/gatea-no-future-heartbeat-pg17-20261123.log`.

**Operational release:** NO-GO. This patch does not prove real authenticated
Supavisor relock/session draining, a reviewed persistent watchdog secret
or a Super Admin business E2E; none is implied by isolated QA.