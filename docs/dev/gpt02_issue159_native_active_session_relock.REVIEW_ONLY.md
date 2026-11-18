# GPT02 DEV — native active-session relock proof (REVIEW ONLY)

Status: **NOT EXECUTED / NO-GO**. This is a controlled test specification, **not** a service, migration, credential, role-opening command, approval, or authorization to dispatch. It must not be treated as E2E evidence.

## Existing verified baseline (18 Nov 2026)

- Project: CST-DEV Supabase `xssrfshdrtdfupgqwfdw` (PostgreSQL 17.6); VPS `srv1792369`. Never point this test at PROD `nzdweipzckfszczzqtuw`.
- The existing private `gpt02_relock_audit` schema has exact Phase A / Phase B functions; `dev_gpt02_relock_catalog_auditor` holds only schema USAGE and exact function EXECUTE, with no direct watchdog SELECT.
- Timer on VPS is **inactive/disabled** at baseline. The auditor is `NOLOGIN`, connection limit 0; its host-encrypted systemd credential is root-only. Attestor, issuer and issuer reader are `NOLOGIN`, limit 0, password NULL, zero sessions.
- Synthetic Task `99811` proved independent timer cleanup and restoration of historical `VALID UNTIL` with an **already dormant role** on native CST-DEV. It did **not** have any connected operational session.
- Disposable isolated PostgreSQL 17 fixtures proved the Phase A committed relock, Phase B live session termination, killed coordinator, rollback, and repeated windows. These do not substitute for a native CST-DEV connected-session proof.
- The old writer-slot and issuer-reader proof entrypoints are guarded to refuse an unregistered role-opening window. Do not disable or bypass those guards.

## Independent auditor credential invariant — 18 Nov 2026 incident

**The independent auditor is not one of the three operational writer/reader roles.** Keep its catalog identity `dev_gpt02_relock_catalog_auditor` as `NOLOGIN CONNECTION LIMIT 0` **with its existing SCRAM verifier staged** (`pg_authid.rolpassword IS NOT NULL`), matching the already provisioned root-only `/etc/credstore.encrypted/gpt02-issue159-relock-catalog-dsn`. Keep the *three operational* roles `NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL`; their normal cleanup policy must not be applied to the independent auditor.

**Observed incident:** Supabase CST-DEV `postgres_logs` records a 2026-11-18 09:34:02.376 UTC (16:34:02 WIB) `mgmt-api` / `postgres` statement (`LOG`, SQLSTATE `00000`) containing `ALTER ROLE dev_gpt02_relock_catalog_auditor`, `NOLOGIN`, `CONNECTION LIMIT 0`, and `PASSWORD NULL`. At 09:58 UTC the auditor verifier was observed NULL. These facts strongly associate an administrative role reset with the credential loss; the logs do **not** identify which person or ChatGPT session submitted the statement, nor independently establish the transaction's commit. Do not attribute an operator without further evidence.

The auditor verifier was restored from the **existing encrypted credential** through a specifically user-reviewed and approved guarded DEV transaction at approximately 10:30 UTC. The SCRAM verifier matched in memory; independent Supabase readback confirmed `NOLOGIN` and a staged verifier. A subsequent real supervisor oneshot connected successfully with auditor login temporarily limited to one connection, then the auditor was relocked while retaining its verifier. The timer remains inactive/disabled and no operational role was opened.

**Required read-only custody preflight before any reviewed live session test:**

```sql
SELECT
  (SELECT count(*) FROM pg_authid
    WHERE rolname='dev_gpt02_relock_catalog_auditor'
      AND NOT rolcanlogin AND rolconnlimit=0 AND rolpassword IS NOT NULL
      AND NOT rolsuper AND NOT rolcreaterole AND NOT rolbypassrls) = 1
    AS independent_auditor_staged_but_locked,
  (SELECT count(*) FROM pg_authid
    WHERE rolname IN ('dev_gpt02_attestor_evidence',
      'dev_gpt02_issuer_evidence', 'gpt02_issuer_evidence_reader')
      AND NOT rolcanlogin AND rolconnlimit=0 AND rolpassword IS NULL) = 3
    AS operational_roles_dormant,
  (SELECT count(*) FROM pg_stat_activity
    WHERE usename IN ('dev_gpt02_relock_catalog_auditor',
      'dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence',
      'gpt02_issuer_evidence_reader')) = 0 AS no_scoped_sessions,
  (SELECT count(*) FROM gpt02_relock_audit.writer_issuance_watchdog
    WHERE cleaned_at IS NULL) = 0 AS no_open_windows;
```

Execute only through a pre-existing authorized DEV **read-only** administrative connection. All four booleans must be true. This query does not reveal the verifier and does not authorize a role unlock. If the auditor verifier is missing, **NO-GO**: do not start the timer or grant LOGIN. Restore solely through the separately approved encrypted credential process with a guarded rollback and postcondition. Do not generalize `PASSWORD NULL` cleanup from the operational roles to the auditor; do not introduce a new connector, password, or automatic credential reset. The earlier source reference SQL has an **initial-creation-only** prerequisite that the auditor has NULL password; it must not be re-applied to an already installed and provisioned live CST-DEV schema.

## Authorization/review gate

This test **requires an explicitly reviewed and permitted execution path** for a bounded, test-only native login window. A prior attempt to open a scoped operational role was stopped by the execution safety gate and **must not be worked around by a different tool or credential**.

Before any execution, a reviewer must confirm:

1. DEV project reference and host pin, exact role allowlist and TLS `verify-full`, existing service source hashes, dedicated single-connection credential custody, and zero existing sessions/open watchdog rows.
2. One expendable DEV-only test task ID greater than 139, with a unique canonical SHA-256 scope; do not touch historical Task `170`/`171`, archived signatures, real Super Admin intent or issuer lease.
3. **Only one** of the three fixed roles, preferably the existing dedicated issuer reader for a read-only session, and **no wider grants**. Never activate a signer, writer RPC, dispatch, or approval gate for this test.
4. A bounded expiry no more than 120 seconds from database server time (prefer 45–60 seconds), connection limit 1, and an independent functioning auditor timer. No plaintext password in shell arguments, logs, issue comments, chat, or persisted temporary files.
5. A fail-safe operator rollback route that can relock the exact role and stop the timer if the supervisor does not. Keep the timer **disabled across boot** until the release review.

## One-window native proof (only after the above review)

- Confirm the initial role catalog baseline, exact `rolvaliduntil`, schema privileges, watchdog history and empty session count.
- Atomically, in **one database transaction**, insert one allowlisted watchdog row with `previous_valid_until`, task/scope binding and bounded `expires_at`, then grant only temporary `LOGIN CONNECTION LIMIT 1` using its pre-staged scoped credential and matching `VALID UNTIL`. A watchdog entry created after role activation is forbidden.
- Use the existing encrypted credentials and pinned TLS to establish exactly one **read-only** native PostgreSQL session for the named role, verify `session_user` and TLS, and confirm the backend PID appears once in `pg_stat_activity`. Do not call any writer RPC or touch business data.
- Deliberately terminate the **window coordinator**, not the independent watchdog and not PostgreSQL, after the window has committed. Keep the read-only backend session connected so expiry must trigger termination.
- At expiry, verify Phase A commits `NOLOGIN`, limit 0, password NULL and exactly restored `VALID UNTIL` **before** Phase B; verify the independent auditor then terminates the old session and marks `cleaned_at` exactly once.
- Validate the client experiences a forced database disconnect and that the matching PID and role session count are zero. A normal client close before expiry is **not** proof of forced termination.
- Re-run the cleanup functions only through their scoped auditor identity to verify idempotency and no new approval/issuer/lease events. No worker command or Final ACK may be created as a byproduct.

## Acceptance evidence / outcome

Mark `NATIVE_ACTIVE_SESSION_RELOCK_PASS` **only** when all of the following are supported by recorded, time-stamped, non-secret evidence: the same role and single backend PID connected before expiry; coordinator killed after a committed issuance row; Phase A relocked the role first; Phase B terminated the still-connected PID; `cleaned_at >= expires_at`; original `VALID UNTIL` restored exactly; zero role sessions; unchanged business ledger and authorization gates; timer not boot-enabled.

On missing evidence, partial failure, timeout, stale session, unexpected grant, or safety-denied execution: **NO-GO**, do not retry by weakening scope. Relock the exact target and auditor, stop timer, clear any test credential only when custody allows, retain watchdog audit history, and verify zero sessions. The native forced-session proof and full Approval → Attestor → Issuer Evidence → Lease E2E remain **unproven until independently completed**.

## Release boundaries

- Keep [Draft PR #1762](https://github.com/Travelintrips/Core-AI-Foundation/pull/1762) unmerged until this proof, task-bound one-use Super Admin evidence, independent issuer readiness, and final release review pass.
- Do not reuse expired approvals, issue positive dispatch leases or enable PROD/DELL dispatch.
- This document neither turns on the timer nor authorizes operational GPT02.
