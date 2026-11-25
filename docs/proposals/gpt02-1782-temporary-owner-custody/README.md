# GPT02-1782: proposed temporary Owner-role delegation

**REVIEW ONLY — NEW OWNER SECURITY APPROVAL REQUIRED.** The current Phase B approval does not authorize acquiring `SET ROLE`. These artifacts neither claim that permission nor apply any change to CST DEV. The isolated fixture completed four tests successfully; it did not connect to Supabase, publish custody evidence, activate a reader, or dispatch a task.

## Exact proposed scope

The current, parent-reported read-only capability result is `current_user = session_user = postgres`, connection role setting `none`, a non-superuser session, existing ADMIN membership on `gpt02_relock_owner_approval_owner`, and effective SET/INHERIT false. The Owner role is NOLOGIN. There is no demonstrated existing executor able to act as that table owner. This report describes those observations; the fixture did not re-query the live project.

The proposed new permission is to let this exact authenticated `postgres` session temporarily act as the existing Owner role **only while executing the reviewed Phase B statements**, then remove its own temporary membership before the same transaction commits. It is real Owner-role authority during that transaction, not an assertion that ADMIN already constitutes user authorization. PostgreSQL itself does not require an additional platform superuser for an ADMIN holder to grant itself SET; the human authorization boundary still requires a new, explicit approval.

The target remains CST DEV project `xssrfshdrtdfupgqwfdw`, database `postgres`, original challenge `9c4f21e1-48af-4f7f-9830-931b84e3e846`, and dedicated reader `gpt02_owner_ledger_reader_1782_dev`. Any eventual approval must identify the complete candidate hash, exact DEV connection, permitted single transaction, and preserved boundaries. A draft PR, successful fixture, existing Phase B approval, or callback does not provide that authorization.

## Candidate transaction

`owner_custodian_candidate.sql` contains one outer BEGIN/COMMIT. Its Phase B statement body is byte-for-byte identical to the canonical source at Core commit `522da5db476a513c469d700505507160eef73bfb`, Git blob `444bad054492ed77a565600d2d1bba02ba3dd1fe`. The original migration is unchanged. Only its outer BEGIN/COMMIT are omitted from the embedded body, because nesting the original file would let its COMMIT publish a temporary membership before cleanup.

The candidate performs the following sequence:

1. Require PostgreSQL major 17, database `postgres`, and a direct non-superuser session where both session user and current user are `postgres`. Require the exact existing NOLOGIN, non-admin, NOBYPASSRLS Owner role, one ADMIN-only membership from a different superuser grantor, and effective SET/INHERIT false.
2. Acquire a bounded cooperative advisory transaction lock. Snapshot every membership row with all seven fields, including OID and grantor, plus public role attributes, table ownership/RLS flags, and existing policies. No password column is read. Pin backend PID and transaction ID.
3. Create the separate row with `GRANT gpt02_relock_owner_approval_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres`. The original bootstrap-issued ADMIN row is retained.
4. Before using SET, prove the membership was inserted by this transaction. The membership row and its grantor ACL dependency in `pg_shdepend` must both have this transaction's `xmin`; all other membership rows must still match the complete baseline. This additional check closes the demonstrated precheck/GRANT race described below.
5. `SET LOCAL ROLE gpt02_relock_owner_approval_owner`; execute the pinned Phase B body. Its effects are schema USAGE, fourteen challenge columns, ten decision columns, and two SELECT policies restricted to the original approved DEV challenge and decision.
6. `SET LOCAL ROLE NONE`; verify the original direct actor, backend and transaction. NONE explicitly returns to the session user; RESET ROLE could instead restore a connection-time role setting.
7. Revoke only the postgres-granted row, using `REVOKE gpt02_relock_owner_approval_owner FROM postgres GRANTED BY postgres RESTRICT`. There is no CASCADE and no attempt to change or revoke the bootstrap grantor's row.
8. Require the entire membership baseline, public role attributes, existing policies and Owner/RLS state to be preserved; require exactly the two intended reader policies. The original Phase B verification already requires the exact column grants, USAGE without CREATE, no broad table SELECT, and no write grants. Commit only after these assertions pass.

Timeouts are 3 seconds for locks, 15 seconds per statement, 10 seconds idle in transaction and 30 seconds for the complete transaction. Errors are not caught and converted to success. The caller must abort and disconnect on an error; it must not skip failed statements, recover by committing a partial transaction, or retry automatically.

The reader remains NOLOGIN with its expired validity. The candidate does not set or read a password, change any owner, disable RLS, change Task190 role grants, publish a receipt, activate services, or prove reader E2E. Any later LOGIN/validity change and bounded reader verification remain separate authorized operations.

## Grantor and concurrency reasoning

PostgreSQL 17's role-attributes documentation expressly describes the creator's bootstrap-issued `ADMIN TRUE, SET FALSE, INHERIT FALSE` membership, the inability to change that original grant as its creator, and the ADMIN holder's ability to grant itself a separate SET/INHERIT membership. GRANTED BY pins which grantor's row is created and later revoked. The catalog key contains role, member **and grantor**.

PG17 `AddRoleMems` and `DelRoleMems` serialize changes to the target role until transaction end. A baseline SELECT before GRANT, however, does not yet hold that lock. Another administrator could create the same postgres-granted membership in that gap. Plain GRANT followed by REVOKE could update and then erase that administrator's row.

The candidate therefore also checks the new row's grantor dependency. In the PG17 implementation, a new membership INSERT creates this `pg_shdepend` ACL dependency; updating an existing membership does not recreate it. Requiring both row versions to belong to the current transaction prevents a concurrent pre-existing grant from being treated as ours. The isolated race test commits a different SET-false row after preflight and before GRANT: the candidate aborts, preserving that other row's OID and options. This is a PG17-specific implementation guard, reviewed against REL_17_6 source and exercised on cached PG17.12. A different major version is rejected.

“No other-session exposure” has a precise scope: this transaction never commits its temporary SET membership. Warm and newly connected non-superuser postgres observers see SET false, and an actual SET ROLE in another session fails. This does not claim to prevent an independently authorized administrator or superuser from making a separate grant. The advisory lock coordinates this procedure; it is not a security barrier against arbitrary administrators.

## Isolated verification

Command, from this directory on a Docker host with the pinned image already cached:

```sh
python3 -B test_owner_custodian_pg17.py --evidence evidence_pg17.json
```

The runner accepts no connection URL, existing container name, project credential, or alternative image. It uses immutable cached image `sha256:a77aa70e641402a21411b92b721c58d10f23b50ae5fdd2333efd22d166e1e5f7` with `--pull=never`. Runtime was PostgreSQL **17.12**, with network `none`, no published ports or host binds, one newly created fixture volume, 384 MiB RAM, 0.5 CPU and 128 PIDs. The bootstrap superuser is `fixture_bootstrap`. It creates a separate non-superuser `postgres`, then a direct postgres login creates the roles, producing the genuine automatic bootstrap ADMIN-only membership. The proposal is never run from a superuser session that merely switched roles.

| Case | Observed result |
| --- | --- |
| Error after schema GRANT while acting as Owner | Entire membership, roles, grants and policy baseline restored |
| Client disconnect during the same partial phase | Entire baseline restored |
| Another postgres session inserts its own membership between preflight and GRANT | Candidate aborts; other membership OID/options remain intact |
| Successful Phase B, with warm and fresh concurrent postgres observers | Other-session SET denied; same backend/XID throughout; intended grants persist; all original memberships restored; post-commit SET denied |

The success case additionally exercises RLS on synthetic original and unrelated rows, rejects an ungranted private column, and checks the old reader's fixture grants/policy, Owner identity, FORCE RLS, NOLOGIN and expired validity. It proves the database authorization mechanics on a synthetic cluster, not live CST ledger contents or custody E2E.

Final execution: remote process 824987, exit 0, 7.09 seconds. The test container and volume were both verified absent after cleanup. Full bounded evidence is in `evidence_pg17.json`.

Two earlier diagnostic runs passed the three failure/race cases, then hit the configured idle timeout because the test observer called `pg_get_expr` while CREATE POLICY held its table DDL lock. The test was corrected to inspect raw membership and policy count during that open DDL transaction. No candidate timeout or privilege guard was weakened. `evidence_initial_timeout.json` preserves the initial result rather than presenting it as a pass.

## Requirements before any live application

An explicit new Owner approval must cover the temporary Owner-role authority and exact complete candidate, not merely the already-approved Phase B grants. Fresh read-only evidence must confirm the actual grantor/OID/options and non-superuser/session baseline, protected schema/table ownership, RLS/FORCE RLS, staged NOLOGIN reader, and exact DEV project connection.

The execution mechanism must deliver the **whole candidate on one pinned backend in one transaction**. Do not submit its statements in separate HTTP requests, split them into autocommit operations, embed the original migration's COMMIT, or wrap this in a SECURITY DEFINER function. The fixture proves this behavior for its direct psql connection; it does not certify an external execution tool's transaction handling. The live PostgreSQL service is reported as 17.6; the available isolated image is 17.12. Platform-specific restrictions remain a preflight/review matter, not something to bypass.

After an approved execution, an independent read-only session must confirm exact original membership OIDs and options, SET/INHERIT false, unchanged role/Owner/RLS/Task190 state, and the intended reader ACL/policy delta. Failure, timeout, disconnection, unknown commit outcome, baseline drift, or a pre-existing postgres-granted membership requires read-only reconciliation; no automatic retry or wider privileges are proposed.

## Primary references

- PostgreSQL 17 role attributes: https://www.postgresql.org/docs/17/role-attributes.html
- PostgreSQL 17 GRANT, role grantor/options: https://www.postgresql.org/docs/17/sql-grant.html
- PostgreSQL 17 REVOKE, grantor and RESTRICT: https://www.postgresql.org/docs/17/sql-revoke.html
- PostgreSQL 17 SET ROLE, session user and LOCAL/NONE: https://www.postgresql.org/docs/17/sql-set-role.html
- PostgreSQL 17 transaction atomicity/visibility: https://www.postgresql.org/docs/17/tutorial-transactions.html
- PostgreSQL 17 shared membership catalog: https://www.postgresql.org/docs/17/catalog-pg-auth-members.html
- PostgreSQL 17 shared dependencies and xmin: https://www.postgresql.org/docs/17/catalog-pg-shdepend.html and https://www.postgresql.org/docs/17/ddl-system-columns.html
- Exact PG17.6 grant implementation: https://github.com/postgres/postgres/blob/REL_17_6/src/backend/commands/user.c
- Exact PG17.6 unique membership key: https://github.com/postgres/postgres/blob/REL_17_6/src/include/catalog/pg_auth_members.h
- Pinned original Phase B: https://github.com/Travelintrips/Core-AI-Foundation/blob/522da5db476a513c469d700505507160eef73bfb/scripts/migrations/20261125_gpt02_1782_owner_custodian_reader_grants_DEV_ONLY.sql
