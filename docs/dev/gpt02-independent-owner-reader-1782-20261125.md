# GPT02-1782 independent Owner-ledger reader — DEV only

## Purpose and exact scope

The Owner authorized a separately provisioned GPT02-1782 reader while preserving
Task190's password, credential and consumer. The existing
`gpt02_owner_ledger_reader_dev` login is shared with Task190, so this change pins
a new identity, `gpt02_owner_ledger_reader_1782_dev`, throughout the loader,
native Owner reader, DBA custodian and signed DBA receipt verifier. There is no
old-role fallback, shared-role membership or `SET ROLE` path.

The only permitted ledger target in the staging policies is original challenge
`9c4f21e1-48af-4f7f-9830-931b84e3e846`, with scope `GPT02_RELOCK_CST_DEV`,
project `xssrfshdrtdfupgqwfdw`, environment DEV, worker
`openclaw-vps-main`, Owner `admcst001@gmail.com`, and final
CONSUMED/APPROVED states. No new Owner approval is created or consumed.

## Database staging — separate administrative and owner custody

The plan is split into two explicit operational files. Neither runs during
application startup, loading or deployment. Independently verify the selected
Supabase project is `xssrfshdrtdfupgqwfdw`; database name alone is insufficient.

### Phase A: administrative role staging

[Phase A SQL](../../scripts/migrations/20261125_gpt02_1782_independent_owner_reader_DEV_ONLY.sql)
runs through the existing authorized `postgres` role-administration connection.
It verifies that actor's CREATEROLE capability and the original matching Owner
decision, requires the new identity to be absent, and creates only:

- `gpt02_owner_ledger_reader_1782_dev` as `NOLOGIN`, `PASSWORD NULL`, expired validity.
- No superuser, create-database, create-role, replication, bypass-RLS or inheritance capability.
- Its own one-connection limit, read-only default, five-second statement and idle-transaction timeouts.
- Database CONNECT, with no schema usage, ledger column grants or policies.

Phase A grants no role memberships and does not change Task190 or any existing
owner. PostgreSQL can implicitly give a non-superuser CREATEROLE creator ADMIN
OPTION on the new role; the transaction disables automatic SET/INHERIT self
grant and verifies that the new reader has no parent-role membership.

After Phase A, the authorized custodian may independently provision and seal a
fresh password for the new role while keeping it NOLOGIN and its staged validity
expired. That custody work cannot create ledger access. Leave all reader
activation gates closed until Phase B is legitimately completed and verified.

### Phase B: existing schema/table-owner custody

[Phase B SQL](../../scripts/migrations/20261125_gpt02_1782_owner_custodian_reader_grants_DEV_ONLY.sql)
must run through an **existing legitimate custody path** as
`gpt02_relock_owner_approval_owner`. It first verifies that exact actor owns the
private schema and both existing FORCE RLS tables, and that Phase A's independent
role still has the exact NOLOGIN/expired/non-administrative attributes and no
parent-role membership. The owner is NOLOGIN/NOBYPASS and FORCE RLS applies;
its preflight uses catalog metadata and never reads actual Owner decision rows.

Phase B only grants direct schema USAGE and the exact required column SELECT,
then adds two SELECT policies restricted to original challenge
`9c4f21e1-48af-4f7f-9830-931b84e3e846` and existing Owner/scope/worker/status
predicates. The challenge policy also pins DEV and project; the decision policy
resolves its challenge through that policy. Existing PUBLIC read policies or
pre-existing policies for this new role require reconciliation. Final checks
reject table-wide SELECT, writes, schema CREATE or extra readable columns.

Phase B does not CREATE/ALTER ROLE, set a password, enable LOGIN, change an
owner, grant SET/INHERIT or alter an existing policy. It can run after a password
has been independently sealed because it never reads password/hash material.
Both transactions fail closed and roll back on a failed guard or SQL error.

### Observed custody boundary

An authorized attempt of the original combined plan returned PostgreSQL 42501
(must be owner of table). Independent readback confirmed full rollback: the
new role was absent and neither new policy existed. The administrative session
has CREATEROLE, but lacks schema-USAGE/ledger-SELECT grant options and usable
SET authority to the existing owner. Thus role administration and ledger
authorization are distinct capabilities on this deployment.

The split permits useful Phase A and independent encrypted custody work without
pretending that the administrative session can grant ledger access. Phase B
remains an actual technical dependency until the existing owner-custodian path
is available. Do not self-grant SET/INHERIT, change ownership, disable RLS, or
create a privileged helper to bypass that boundary. The existing Owner remains
the sole human approver; this is not a request for another human decision.

## Fixed runtime contract

The credential remains a seven-key JSON object with `database`, `host`,
`password`, `port`, `projectId`, `sslMode` and `user`.
The `user` value must now be `gpt02_owner_ledger_reader_1782_dev`.
Existing fixed paths, credential name `reader.json`, TLS hostname/CA, private
file policies, feature flags, service units and release gates remain applicable.

The DBA V2 receipt must name the new reader role. A correctly signed receipt
naming the old role is rejected. Its audience, field order, worker-generation
binding and lifetime checks are unchanged; worker V2 receipt fields do not
change. Keep activation disabled until the installed loader, API image and
host custodian bundle all contain this same fixed identity.

## Authorized provisioning and bounded verification

After staging is verified, the authorized custodian provisions a fresh password
for the new login and places its matching JSON directly into the separate
systemd-encrypted input, without persistent plaintext, logs, command arguments,
chat or GitHub. No Task190 password, hash, DSN or ciphertext is an input.
Enable LOGIN only with the approved bounded password-expiry window after both
staging phases, sealed custody and the matching source deployment are verified. Password expiry blocks
new password authentication; it does not terminate an existing session.

Use the existing Owner-authenticated worker issuer and separate host DBA
custodian. The custodian's native TLS/read-only/column SELECT probe must pass
under the new session and effective role before publishing its DBA receipt.
Keep Task190 running and leave its connection limit unchanged.

For final reader acceptance, use a real fresh signed Google Owner session:

`GET /api/gpt02-owner-ledger/decision/9c4f21e1-48af-4f7f-9830-931b84e3e846`

Require the matching redacted receipt. Verify that another challenge is not
visible, missing/wrong Owner identity is denied, unavailable reader fails
closed, and both SQL session identities are the dedicated login.
Reading the historic decision does not require another approval or reopen its
expired approval window. Custody/reader PASS does not grant relock, signing,
dispatch or execution.

## Recovery and evidence

Before live activation, retain the exact previous deployment and installed
loader/custodian hashes. On failure, disable the reader feature and the new
login through the authorized procedure, close only this reader's own sessions,
and reconcile evidence before retrying. Bound credential-file mounts hold an
inode snapshot: recreating the affected DEV container is required to refresh or
remove its credential mount. Leave Task190 and the shared role untouched.

The staging transaction rolls back on an assertion or DDL failure. After a
successful staging commit, leaving the new role NOLOGIN is a safe recovery
state; do not drop shared objects or remove unrelated grants. Source tests and
NOLOGIN staging are not proof of live password custody or Owner-ledger E2E.

## Verification references

- [PostgreSQL 17 CREATE ROLE](https://www.postgresql.org/docs/17/sql-createrole.html)
  documents role attributes and password-only VALID UNTIL semantics.
- [PostgreSQL 17 CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html)
  documents SELECT scope and the OR combination of permissive policies.
- [PostgreSQL 17 connection defaults](https://www.postgresql.org/docs/17/runtime-config-client.html)
  documents `createrole_self_grant`.
