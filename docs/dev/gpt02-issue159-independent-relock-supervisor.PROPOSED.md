# GPT02 Issue159 — Independent relock supervisor DEV (staged, NO-GO)

This extends the existing tested two-phase PostgreSQL watchdog. It does not replace the signer, issuer reader, Hub/Core readbacks or historical evidence.

## Sources

- gpt02_issue159_relock_catalog_supervisor.mjs: one-shot Node program, reusing the already-installed PostgreSQL driver, exact DEV hostname and TLS verification. It cannot send DELL commands.
- gpt02-issue159-relock-catalog-auditor.service: independent DynamicUser and systemd encrypted credential binding. No shell.
- gpt02-issue159-relock-catalog-auditor.timer: proposed 5-second cadence; NOT ENABLED.
- Existing gpt02_issue159_relock_admin_custody.READONLY.py verifies exact pinned [Service] settings.

## Mandatory release gates not currently satisfied

1. Independent PostgreSQL login dev_gpt02_relock_catalog_auditor with NO CREATEROLE, SUPERUSER, BYPASSRLS, or GPT02 table access.
2. An encrypted host-bound relock-catalog-dsn credential provisioned through an approved credential-management action, not chat, environment variables, or reused issuer secrets.
3. Separate owner-reviewed, restricted private PostgreSQL functions gpt02_relock_audit.relock_expired_phase_a() and gpt02_relock_audit.relock_expired_phase_b() returning bounded integer counts, callable ONLY by the independent role. Phase A commits NOLOGIN/PASSWORD NULL before phase B terminates sessions and records the durable cleanup. NO arbitrary SQL identifiers are passed from the service.
4. A live DEV expired-issuance test proving exact-role custody, session termination, revoke/readback, independent crash recovery, plus a complete review of RLS/function grants and password lifecycle.
5. Explicit service activation review; do not enable its timer until these gates PASS.

The current source performs NO privilege creation, installs NO database routines, reads no private keys, grants no signing or dispatch permission, and makes no change to PROD. The release decision remains NO_GO.

## Synthetic tests

- Node 4/4 service contract checks using only fixtures
- Python existing role custody metadata guard 13/13 PASS
- systemd-analyze verify on the proposed unit and timer

The service can be installed on the DEV host as an INACTIVE, DISABLED unit guarded by ConditionPathExists for the encrypted credential. That is staging, not proof of operational readiness.


## CST-DEV DBA/security handoff — authenticated owner maintenance (REVIEW ONLY)

**Scope and status.** Owner approval permits pursuit of an independently
authenticated DBA/security route for CST-DEV (`xssrfshdrtdfupgqwfdw`) only.
It is **not** permission to self-grant `postgres` additional roles, impersonate
Supabase internal `supabase_admin`, create a GPT02 task, unlock issuer/signers,
run DELL commands, or touch PROD. Do not merge or apply this Draft proposal
as a substitute for the independent owner/security review.

The exact-head source and disposable PG16/PG17 test baseline for this
procedure is commit `7514368d93910717c44c67962e93210695e833c4`
(PR #1754); 5/5 GitHub workflows SUCCESS. Tests cover the *direct*
owner fixture and a synthetic `gpt02_owner_maintenance` session that
installs the identical owner-held helper, revokes temporary membership,
locks that maintenance role, then completes Phase A/B and rollback
recovery. This does not demonstrate a live CST-DEV operational watchdog.

### 1. Independently authenticated DBA/owner change

Only a separately authorized DBA/security custodian may perform the
following controlled change. The connected project `postgres` actor
cannot currently `SET ROLE gpt02_store_owner`, and the existing owner
role is deliberately `NOLOGIN`; neither boundary is to be weakened
to make the current connector work.

1. Confirm that `gpt02_private` and the five private tables are still owned
   by `gpt02_store_owner`, with RLS/policies and existing source unchanged.
2. Review the existing **alternative installer** at
   `docs/dev/gpt02-issue159-store-owner-relock-helper-maintenance.REVIEW_ONLY.sql`.
   It does not itself create any login or membership. Independently
   approve a narrow, ephemeral `gpt02_owner_maintenance` identity
   with only `SET` (not `INHERIT` or `ADMIN`) on the existing NOLOGIN
   owner, separately authenticated from `postgres`, issuer, signer or
   auditor credentials.
3. Verify original session identity, helper function owner,
   `SECURITY DEFINER`, pinned search path and exact nested EXECUTE grant.
   The function body/grants must match the canonical owner-helper file.
   Abort on owner or grant drift.
4. End the maintenance SQL connection and independently revoke the
   ephemeral membership, set maintenance `NOLOGIN`, connection limit 0,
   and password NULL. **Do not count this as complete yet.**
5. Independently enumerate and close **all remaining maintenance
   sessions**, including sessions which switched effective role with
   `SET ROLE`. Verify zero matching authenticated sessions and no
   owner SET membership, then retain the readback evidence. Stop with
   NO-GO if any active session cannot be conclusively closed.

**Critical PostgreSQL session property:** isolated PG16 testing confirmed
that `REVOKE` membership and `ALTER ROLE NOLOGIN PASSWORD NULL` do
not by themselves terminate an already-authenticated session that has
`SET ROLE gpt02_store_owner`. The original session can remain
effective as the table owner. Therefore the role/credential relock is
not a complete security closure without independently verified
session termination. An attempted automated termination test from
this assistant was blocked by the execution safety gate; no alternative
path to bypass that gate is approved. The DBA must provide
independent evidence under the organization's normal change process.

### 2. Phase A/B and credential custody — separate gates

After step 1 is independently approved and audited, review the existing
`docs/dev/gpt02-issue159-two-phase-owner-split-relock.PROPOSED.sql`
against the **already existing** inert
`dev_gpt02_relock_catalog_auditor`. Do not replay a migration that
tries to recreate the role or grant broad rights. The exact tested
private Phase A/B RPCs remain scoped to relock and must not make
`signingPermitted` or `dispatchPermitted` true.

A different authorized credential custodian must then supply a
**dedicated encrypted, host-bound systemd credential** for the independent
supervisor, matching the pinned service file. No secret may be supplied
in chat, GitHub, general environment variables, terminal output or
reused signer/issuer credentials. Check root-only ownership/mode and
systemd credential identity *without reading or printing the secret*.
The service and its timer stay inactive/disabled until an independently
reviewed live-DEV E2E relock gate passes.

The live E2E proof must use a **fresh synthetic DEV-only scoped reader**
(not historical Task #170/#171), show exact authenticated role,
time-bound expiry, Phase A durable NOLOGIN/password-null, Phase B
target-session termination, five-table and column/schema privilege
revocation, incoming/outgoing role membership checks, rollback/retry,
idempotence and zero remaining scoped sessions. No signing, dispatch,
DELL or PROD action is part of this test.

### 3. Safe read-only catalogue attestation (no password values)

The DBA can capture the following **read-only** catalogue snapshot
before and after each independently approved change. Zero sessions
must be checked in a new connection after all maintenance connections
have closed, not only in the maintenance connection itself.

```sql
SELECT
  current_user AS acting_database_role,
  session_user AS authenticated_database_role,
  current_setting('server_version') AS postgres_version,
  (SELECT rolcanlogin FROM pg_roles
     WHERE rolname='gpt02_store_owner') AS owner_can_login,
  (SELECT COUNT(*) FROM pg_stat_activity
     WHERE usename='gpt02_owner_maintenance') AS maintenance_sessions,
  (SELECT COUNT(*) FROM pg_stat_activity
     WHERE usename='dev_gpt02_relock_catalog_auditor') AS auditor_sessions,
  (SELECT rolcanlogin FROM pg_roles
     WHERE rolname='dev_gpt02_relock_catalog_auditor') AS auditor_can_login,
  (SELECT rolpassword IS NULL FROM pg_authid
     WHERE rolname='dev_gpt02_relock_catalog_auditor')
     AS auditor_password_null,
  (SELECT COUNT(*) FROM pg_roles
     WHERE rolname='gpt02_owner_maintenance') AS maintenance_role_count,
  (SELECT COUNT(*) FROM pg_auth_members
     WHERE member=to_regrole('gpt02_owner_maintenance')
        OR roleid=to_regrole('gpt02_owner_maintenance'))
     AS maintenance_membership_count,
  to_regprocedure(
    'gpt02_private.revoke_expired_scoped_reader_grants(name)'
  ) IS NOT NULL AS owner_helper_installed,
  to_regprocedure(
    'gpt02_relock_audit.relock_expired_phase_a()'
  ) IS NOT NULL AS phase_a_installed,
  to_regprocedure(
    'gpt02_relock_audit.relock_expired_phase_b()'
  ) IS NOT NULL AS phase_b_installed;
```

Function owner, `SECURITY DEFINER`, `search_path`, and exact function
ACLs must additionally be checked in `pg_proc`; merely seeing the
procedure name is **not** sufficient. Preserve the live result in an
approved audit location without credentials.

**Operational gate: NO-GO** until genuine independent owner and
credential custody evidence plus live DEV E2E exists. The previous
disposable PASS is not permission to enable the timer. Keep
CST-DEV supervisor inactive and PROD unchanged.
