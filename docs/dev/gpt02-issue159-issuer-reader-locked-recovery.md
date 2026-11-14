# GPT02 DEV Issue159 — issuer reader custody and bounded restoration

**Status:** Read-only diagnosis and release gate. This is **not** a credential
activation procedure, a deploy workflow, or authorization to dispatch.

## Evidence already established

- On 11 November 2026, the independent reader role
  `gpt02_issuer_evidence_reader` was temporarily activated with
  `LOGIN`, connection limit **1**, and a dedicated encrypted systemd credential
  solely for a real native read-only/TLS/RLS connectivity proof.
- That test was deliberately followed by `NOLOGIN`, connection limit **0**,
  termination of temporary reader sessions and `PASSWORD NULL`. The temporary
  credential ceased to be valid for the database. The test proof was never
  approval to run a permanent reader service or signing/dispatch.
- A later source deployment created/enabled
  `gpt02-issue159-issuer-reader.service`, which expects that same role to
  authenticate and independently verify its native identity before opening
  the private Unix socket.
- On 14 November 2026 at 06:56 UTC (13:56 WIB), systemd logged
  `ISSUER_READER_INITIAL_NATIVE_HEALTH_FAILED`, then stopped retrying after
  multiple failures. The database catalog confirmed the role still has
  **NOLOGIN, connection limit 0, no password, zero active sessions**.
- This is **an expected custody lock versus an active-service configuration
  mismatch**, not proof that the Supabase database, TLS certificate,
  gateway, credentials, code, or DELL worker is broken.

## Single read-only preflight

Run from the authorized CST-DEV database administration session (not PROD).
Do not select `rolpassword` itself or disclose any credential:

```sql
SELECT r.rolname, r.rolcanlogin, r.rolconnlimit,
       NOT r.rolinherit AS noinherit,
       NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
            OR r.rolbypassrls OR r.rolreplication) AS unprivileged,
       r.rolpassword IS NOT NULL AS has_password,
       (r.rolvaliduntil IS NULL OR r.rolvaliduntil>clock_timestamp())
         AS password_not_expired,
       (SELECT count(*) FROM pg_stat_activity a WHERE a.usename=r.rolname)
         AS active_sessions
FROM pg_authid r
WHERE r.rolname='gpt02_issuer_evidence_reader';
```

The systemd and container preflight is read-only as well:

```sh
systemctl show gpt02-issue159-issuer-reader.service \
  -p ActiveState -p SubState -p Result -p ExecMainStatus -p NRestarts
systemctl is-active gpt02-issue159-verifier.service
systemctl is-active gpt02-issue159-approval-reader.service
docker ps --filter name=core-ai-dev --format '{{.Names}} {{.Status}}'
```

## Disposition: explicit states, no guess-based restart

| Database + credential evidence | Reader unit | Decision |
| --- | --- | --- |
| NOLOGIN, limit 0, no valid password | failed/inactive | **EXPECTED_CUSTODY_LOCKED**. Keep release `NO_GO`. Do not restart in a loop or widen privileges. |
| LOGIN, limit 1, independent, valid encrypted credential, strict SELECT/RLS, no elevated grants | inactive/failed | **REVIEWED_NATIVE_READER_PROOF_REQUIRED**. Only a specifically approved DEV-only one-shot proof may restart/recheck the reader. |
| LOGIN, limit 1, native role/TLS/RLS health PASS | active | **READ_ONLY_CONNECTIVITY_PASS**. Reader health is *not* signing, issuer grant or dispatch authority. |
| Any unexpected role, membership, writer permission, schema drift or mismatched credential | any | **SECURITY_HOLD**. Do not rearm, deploy or dispatch. |

## Requirements before changing the locked role

1. Obtain an explicit owner/PIC approval for the **DEV-only, time-bounded
   reader authentication proof** (not a generic `lanjut`, release grant or
   Super Admin task approval). Verify scope and expiry.
2. Audit the actual separate encrypted systemd credential custody. The
   currently stored password, if any, must **not** be assumed valid; the
   database currently has no password configured for this role.
3. Use the reviewed one-shot credential provisioning path to authenticate a
   dedicated role with one connection, NOINHERIT, read-only transaction,
   pinned TLS, no privileged routines and no writable relations. Do not
   reuse the shared AI Core database password. Never show a password in
   logs, chat, commits or Actions.
4. Prove the native reader health and immediately return to the approved
   custody state. If the reader service is intended to remain persistent,
   approve that **separately** with a long-lived credential/rotation/restart
   policy; otherwise the service cannot honestly remain healthy while
   the role is locked.
5. All operational signers, issuer positive grants and worker dispatch
   remain disabled. A real same-command-ID Task→Issuer→DELL→Final ACK test
   requires **another**, fresh, authenticated Super Admin approval after
   these infrastructure checks.

## Do-not-do list

- Do not grant `LOGIN` alone; with `PASSWORD NULL` this cannot work.
- Do not reset, print, copy or reuse credentials merely to make systemd green.
- Do not change PROD or remove historical `NO_DISPATCH` constraints.
- Do not mark active-reader health as a real GPT02 callback or Final ACK.
- Do not replay expired historical Task #166.
- Do not treat Draft PR #1754/its disposable CI as an applied DEV migration.
