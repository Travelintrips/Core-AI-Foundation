# CST-DEV Gate A — actual watchdog runner under transient systemd against PG17

**PASS on VPS synthetic PostgreSQL 17, NOT operational Supavisor E2E.**

## Why this test exists

The existing isolated SQL/function tests demonstrated relock, and transient
systemd tests demonstrated restart, but the actual watchdog `run_loop` had
not been exercised together with PostgreSQL, systemd DynamicUser, a live
staging session and a temporarily unavailable database. This test joins
those proven components without constructing another production worker.

## Test assets

- `scripts/dev/cst-onejob-gatea-runner-systemd-pg17.disposable.sh`
- `scripts/dev/cst-onejob-gatea-synthetic-runner-entry.py`
- Existing production candidate `scripts/dev/cst_onejob_stage_watchdog_runner.py`
- Existing official lease schema and private relock-only function migrations

Only a temporary PostgreSQL17 Docker container on an `--internal` network
is used. The synthetic database has zero user/customer data. It uses
trust authentication **only inside this disposable QA database**; it has
no password, API key or remote Supabase URL. The Python entrypoint accepts
only a private IPv4 and an explicit synthetic-QA environment flag.

Systemd starts the actual runner source under `DynamicUser=yes`,
`NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`,
`PrivateTmp=yes`, `IPAddressDeny=any` and
`IPAddressAllow=<disposable database IP>/32`. The connection injection
points to this synthetic PostgreSQL only; the pinned production connector
and its credential-validation path remain untouched.

## Verified scenarios

1. A valid bound durable lease with one active synthetic stage session
   remains running; no false-positive relock
2. SIGTERM/normal systemd stop runs the runner's `finally` relock,
   changes stage to NOLOGIN and kills its active PostgreSQL session
3. Missing lease automatically triggers relock and zero-session readback
4. SIGKILL of the actual Python process causes systemd restart
5. After restart, an active stage session under a valid lease survives
   until heartbeat is made stale; the restarted runner relocks it
6. PostgreSQL is deliberately `docker pause`d; runner exits fail-closed
   after connection failures, and systemd retries
7. On `docker unpause`, a new healthy test lease and session can be
   established; once heartbeat becomes stale, watchdog reconnects
   and relocks again with zero stage sessions

The test initially exposed a race where the watchdog relocked faster than
the synthetic session could be created. The test fixture was corrected
to stage a *valid* lease before creating the new session, then explicitly
age the heartbeat. No security check or relock threshold was weakened.

## Evidence

VPS log:
`/opt/cst-onejob-dev/qa/gatea-real-runner-systemd-synthetic-pg17-20261123.log`

Success markers:
- `CST_GATEA_VALID_LEASE_OBSERVATION_PASS`
- `CST_GATEA_SYSTEMD_SIGTERM_REAL_RUNNER_RELOCK_PASS`
- `CST_GATEA_SYSTEMD_REAL_RUNNER_ORPHAN_RELOCK_PASS`
- `CST_GATEA_SYSTEMD_REAL_RUNNER_SIGKILL_RESTART_PASS`
- `CST_GATEA_SYSTEMD_RESTARTED_RUNNER_EXPIRED_HEARTBEAT_RELOCK_PASS`
- `CST_GATEA_REAL_RUNNER_DB_OUTAGE_FAILCLOSED_PASS`
- `CST_GATEA_REAL_RUNNER_RECONNECT_AND_RELOCK_PASS`
- `CST_GATEA_REAL_WATCHDOG_DYNAMICUSER_PG17_DISPOSABLE_PASS`

Cleanup unpauses Docker first if necessary, stops the transient unit,
removes the container and its internal network, leaving no active service.
No actual CST-DEV LOGIN role, Supabase pooler login, signer, dispatcher,
PROD or host-wide firewall was touched.

## What remains NO-GO

Persistent authorized watchdog credentials/custody and true authenticated
Supavisor connection draining are not verified. Neither a full VPS
power-cycle nor Super Admin WAITING-to-Final-ACK business E2E was tested.
The actual runtime stays off. `releaseDecision=NO_GO`.