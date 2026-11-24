# GPT02 CST-DEV — Super Admin Owner ledger reader

## Initial catalog snapshot — 24 Nov 2026

This section records the original read-only acceptance baseline; it is not a current password or provisioning instruction.

- Project: `xssrfshdrtdfupgqwfdw` (**DEV only**).
- Human authorization: fresh signed CST Hub Google Super Admin `admcst001@gmail.com`, plus active GPT02 Owner link.
- Database reader principal: `gpt02_owner_ledger_reader_dev`. The user account is never granted database access directly.
- At the original check, the role had LOGIN / NOBYPASSRLS / NOINHERIT / connection limit 1 and no configured password. Later Task190 integration supersedes that password assumption; see below.
- Reader role defaults in that check: `default_transaction_read_only=on`, `statement_timeout=5s`, `idle_in_transaction_session_timeout=5s`.
- Private `gpt02_owner_approval` schema: USAGE and approved column-level SELECT on two FORCE RLS tables, with no schema CREATE or table INSERT/UPDATE/DELETE.
- Original RLS verification matched the CST-DEV GPT02 scope, exact Owner email, worker and final consumed/approved states.
- A temporary transactional role test originally verified one APPROVED decision and one CONSUMED challenge, rejecting writes and sensitive hash columns. That test is not evidence of a current dedicated-role TLS connection.

## Current integration evidence — 25 Nov 2026

[PR #1814](https://github.com/Travelintrips/Core-AI-Foundation/pull/1814) deployed the generation-bound custody verifier to DEV as `21717d1300889cea9166f399f0c14bb26f6a2e1c`. Its six live GET checks verified the unsigned attestation-request packet and correct denials. They did not establish Owner ledger access.

The [Task190 investigation](https://github.com/Travelintrips/Core-AI-Foundation/issues/1782#issuecomment-7139716264) established that the same PostgreSQL role is already used by a separately sealed Task190 decision reader. Its only RPC, `POST /verify-owner-recovery-approval`, is bound to Task190 and `PREPARE_ATTEMPT2_ONLY`; it does not provide the GPT02-1782 Owner challenge contract.

**A new password for this shared PostgreSQL role would be a role-wide rotation and could break Task190 reconnects.** Do not copy its sealed credential, widen its socket permissions, or treat its process health as an independent GPT02-1782 custody receipt. The custodian must reconcile the exact approved read purpose, existing consumers, connection limit and recovery procedure before any credential or role change.

The inspected implementation contains the V2 verifier and unsigned request endpoint, but no operational V2 attestation issuer, DBA receipt issuer or Owner-reader encrypted-credential loading unit. The existing service-token administration page creates/revokes tokens; it is not a custody issuer. The optional mount planner in `scripts/vps/gpt02_superadmin_reader_mount_gate.py` has no production caller. A source-only helper or an Owner coordination appointment must not be reported as an activated administrative service.

## Existing read path — feature OFF by default

DEV-only `GET /api/gpt02-owner-ledger/decision/:challengeId`:

1. Exact Host and allowed Origin, one Bearer token, no cookie-based identity.
2. Trusted Hub verifies a fresh Google Super Admin session and active GPT02 Owner link.
3. Fixed credential path `/run/credentials/gpt02-owner-ledger-reader/reader.json`; no credentials in API output, frontend, dotenv or GitHub.
4. TLS-pinned PostgreSQL connection uses only `gpt02_owner_ledger_reader_dev`, never the main application writer pool. Session identity, effective identity, read-only transaction and default read-only setting are checked before SELECT.
5. Parameterized SQL matches the original challenge, authenticated Owner, project, worker, scope, APPROVED/CONSUMED state and chronology. The canonical signed manifest is rehashed before returning a redacted receipt.
6. No grant, executor, signer, dispatch, new approval or timer action.

`GPT02_OWNER_LEDGER_READER_ENABLED` remains an explicit activation prerequisite. Source changes do not set it or install credentials.

### Protected credential and CA reads

The credential consumer and custody verifier share the protected descriptor helper. It validates root-owned parent directories without group/other write access, uses `O_NOFOLLOW | O_NONBLOCK`, checks the object actually opened, and bounds every read. Files must be regular and have a single link. Before/after descriptor metadata checks reject replacement, size changes, and mutation during reads. Every opened descriptor is closed.

| Reader input | Size limit | Ownership | Permission policy |
| --- | --- | --- | --- |
| Credential JSON | 4,096 bytes | Root UID/GID for file and parents | No group/other permissions |
| Fixed public CA | 16,384 bytes | Root UID/GID for file and parents | Public reads permitted; group/other writes denied |

Invalid UTF-8, malformed JSON, unsafe metadata and I/O failures produce the existing bounded custody-unavailable error. OS errors, paths and secret contents are not included in API errors. Tests use synthetic filesystem/DB boundaries and cannot prove real credential issuance.

## Required authorized handoff before activation

The existing Owner remains the human decision maker. The attestor and database custodian are technical capabilities with independently verified scope; their absence is not a request for a second human reviewer.

1. Establish the legitimate GPT02-1782 read contract and reconcile the shared role's Task190 consumer and connection limit. Do not automatically reset a password, add role membership or widen SELECT permissions.
2. Use the authorized worker-credential attestor and reader custodian to produce the V2 documents specified in [the custody adapter contract](gpt02-reader-custody-runtime-adapter-20261124.md). Existing Issue159/Task190 signing contracts do not implement these purposes.
3. Through that authorized custodian, supply a legitimately scoped encrypted reader credential and its protected runtime loading path. The existing credential format has exactly `database`, `host`, `password`, `port`, `projectId`, `sslMode` and `user`; mode 0600 and root custody are required.
4. Verify the public CA at `/etc/gpt02-dev/supabase-root-ca-2021.crt`, host `db.xssrfshdrtdfupgqwfdw.supabase.co`, port 5432, database `postgres`, `verify-full` and exact reader principal. Keep TLS validation enabled.
5. Connect the reviewed mount/loading implementation to the isolated DEV release path, preserving its existing mounts and rollback behavior. A host file by itself does not establish a working container mount.
6. Verify the dedicated reader's TLS identity and permitted SELECT, then test the original challenge through a genuine signed Super Admin session. Require redacted GET 200, missing-session 401, wrong-role denial, wrong-origin denial and unavailable-reader 503. Record actual runtime evidence separately from unit tests.
7. Activate only the permitted DEV feature after those prerequisites are verified. Owner ledger readback alone does not authorize signing, dispatch, execution or relock.

Do not assign this database role to browser/`authenticated` roles, expose its password to JavaScript, add INSERT/UPDATE/DELETE or BYPASSRLS/SUPERUSER, reuse application writer credentials, or generate a replacement approval to make a check pass.

## Acceptance status

The source hardening is independently testable. Operational issuer integration, credential custody, dedicated-role TLS/SELECT and signed-browser-to-reader E2E require separate live evidence. Keep the executor NO-GO until its own gates are proven.
