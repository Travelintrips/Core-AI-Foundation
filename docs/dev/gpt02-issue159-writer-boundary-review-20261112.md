# GPT02 Issue #159 — DEV writer boundary and lifecycle migration review

Date: 2026-11-12
Scope: DEV only. Read-only catalog review plus isolated verifier implementation. No lifecycle mutation.

## Runtime boundary observed

- Four signer units are active: approval, Hub, Core, Issuer.
- Each signer has `GPT02_ISSUE159_SIGNING_ENABLED=false`.
- Signer units use `PrivateNetwork=yes` and `RestrictAddressFamilies=AF_UNIX`.
- Signers can reach Hub/Core and Issuer read-only evidence sockets, but cannot open PostgreSQL TCP connections.
- Encrypted credential inventory contains Hub/Core/Issuer read-only DSNs and four encrypted signer private-key files. No lifecycle-writer DSN is provisioned.
- The independent Issuer reader uses a dedicated read-only database login. It must not be reused for writes.

## Database owner split and blockers (verified from DEV catalogs)

- `gpt02_private.approvals`, `operator_links`, `receipts`, `core_identity_receipts`, and `post_consumption_fences` are owned by non-login `gpt02_store_owner`.
- `gpt02_stage.core_preparations` is owned by non-login `gpt02_core_prep_owner`.
- RLS is ENABLE + FORCE on the lifecycle tables. Reader policies are SELECT-only; owner policies are limited to the non-login table owners.
- `gpt02_store_owner` has table DML only on its owned private evidence tables; it has no DML on `gpt02_stage.core_preparations`.
- `gpt02_core_prep_owner` has table DML on `core_preparations`; it has no DML on private evidence tables.
- Existing `gpt02_stage.prepare_core_task_dormant(text,integer,text,text,text,text)` is SECURITY DEFINER, owned by `gpt02_core_prep_owner`, fixed `search_path=pg_catalog`, and requires `session_user='gpt02_core_prep_login'`.
- `gpt02_core_prep_login` is currently NOLOGIN and has no direct table DML. Simply granting EXECUTE to a different broker login will fail the function's session_user guard.
- A single writer connection therefore needs a deliberate split-owner RPC design: preparation RPC owned by `gpt02_core_prep_owner`; evidence RPCs owned by `gpt02_store_owner`; all callable only by one dedicated broker login whose exact identity is checked in each RPC. Do not grant role membership or table DML to that login.
- Existing checks force `core_identity_receipts.binding_verified/may_dispatch_worker/may_issue_grant/may_close_job/core_ledger_written=false` and `post_consumption_fences.dispatch_allowed/core_ledger_written=false`, with `lease_epoch=1`. Preserve these.
- The local persisted single-Super-Admin approval intent is currently read from the DEV approval SQLite store. The Supabase private `approvals` table is a separate signed approval-evidence ledger and has no rows. Do not claim the SQLite decision is already persisted in Supabase.

## Official signer contract alignment

The verifier was compared against the canonical sources in `Core-AI-Foundation/develop`:

- `GPT02_DUAL_ACCOUNT_COMMAND_LINK` is the operator-link claims audience.
- Hub identity is `ai-task-hub.public.users`, role `super_admin`.
- Core identity is `ai-core.ai_platform.internal_users`, role `owner` or `admin`, active with password changed.
- The detached signature domains remain `GPT02_OPERATOR_LINK_V1:hub` and `GPT02_OPERATOR_LINK_V1:core`.
- Issuer lineage uses the canonical approval, operator-link, nonce receipt, identity receipt and fence fields from the official authorizer.

An earlier verifier draft used the wrong link audience and incorrectly required Core `super_admin`. That draft was corrected before this PR update; regression tests now explicitly reject those mismatches.

## Implemented persisted-approval read-only adapter (not activated)

Added `deploy/ai-coding-standalone-dev/gpt02_issue159_approval_reader_runtime.py` and `gpt02-issue159-approval-reader.service`.

- Exposes the existing `read_approval_intent` SQLite reader over a private Unix socket.
- Runs as root only so it can read the existing root-owned 0600 DEV approval DB; the systemd unit is restricted to AF_UNIX, PrivateNetwork, NoNewPrivileges, strict filesystem protection, and read-only DB/source paths.
- Socket responses expose only the exact decision binding and explicit NO_GO flags; missing, expired or mismatched decisions fail closed.
- No approval decision is created or modified; no private key is loaded; no PostgreSQL connection, signing, nonce consumption or dispatch exists.
- Isolated synthetic SQLite + Unix socket tests: 5/5 PASS; service policy tests: 2/2 PASS; systemd unit verification PASS.
- The unit file is in the PR only. It has NOT been copied into `/etc/systemd/system`, enabled or started on the VPS. No live approval was queried or created by this adapter.

## Implemented verification ingress (not a database writer)

Added:
- `deploy/ai-coding-standalone-dev/gpt02_issue159_writer_broker_contract.py`
- `deploy/ai-coding-standalone-dev/gpt02_issue159_writer_broker_runtime.py`
- isolated tests in `scripts/dev/test_gpt02_issue159_writer_broker_*.py`

The ingress:
- Accepts only bounded `POST /verify-packet` JSON over a private Unix socket.
- Reads root-owned DEV public keys and verifies each against the pinned root-owned `trust-fingerprints.json`; all four SPKI fingerprints must be distinct.
- Verifies canonical, domain-separated Ed25519 signatures and cross-binds task, command, attempt, nonce, approval digest, dual-account operator link, receipt and fence identifiers.
- Rejects expired, tampered, cross-role, wrong-root, malformed and legacy task 135/136 packets.
- Returns verification only. It has no PostgreSQL connection, no private key loading, no signing, no nonce/lease consumption, no task/command creation, no authorization and no dispatch.
- Is not installed or enabled as a systemd service.

## Local VPS verification

- Writer contract tests: 9/9 PASS.
- Writer socket tests: 5/5 PASS.
- Approval reader socket tests: 5/5 PASS.
- Approval reader service policy tests: 2/2 PASS.
- Combined Issue #159 Python regression suite: 82/82 PASS.
- Live DEV public-root + fingerprint-manifest preflight: PASS.
- Python compile and `git diff --check`: PASS.

These are isolated tests and read-only preflights. They do not prove a live signer output or E2E lifecycle.

## Isolated two-owner RPC privilege and concurrency proof

Added two disposable-only fixtures:

- `scripts/dev/gpt02_issue159_split_owner_fixture.sql`
- `scripts/dev/test_gpt02_issue159_split_owner_isolated.sh`

These demonstrate a single restricted session role calling two distinct non-login SECURITY DEFINER owners with EXECUTE-only permissions, while both append-only tables have forced RLS. In disposable PostgreSQL 16 (Docker `--network none`), the harness proves:

- writer has EXECUTE on the two fixture RPCs, while writer and reader have no direct INSERT/UPDATE/DELETE privileges;
- replay fails on UNIQUE, and unauthorized fixture Super Admin value is rejected;
- two concurrent attempts on one task yield exactly one successful insert and one reject;
- if an approval step fails after preparation inside one transaction, the earlier preparation is rolled back;
- UPDATE/DELETE/TRUNCATE are denied even to the fixture database owner/superuser through immutable triggers.

**Test result: PASS**, no live database touched. The fixture uses deliberately fictional admin identity and UUIDs. For concurrency only, its temporary login connection limit is raised from 1 to 3; this does not modify the live DEV login. The fixture is NOT a production migration and does not implement actual cryptographic approval verification or the four additional lifecycle RPCs.

## Six-RPC ordered fixture proof (disposable PG16 only)

Added:
- `scripts/dev/gpt02_issue159_six_rpc_fixture_addon.sql`
- `scripts/dev/test_gpt02_issue159_six_rpc_isolated.sh`

This fixture has all six named RPC stages, split across the same two non-login owners, and four synthetic append-only evidence ledgers. Isolated PostgreSQL 16 tests confirm:

1. `prepare_core_task` and `record_linked_approval` create fake preparation and fake admin evidence.
2. `consume_linked_approval` requires persisted approval and inserts one nonce receipt; nonce replay is rejected.
3. `reserve_post_consumption_fence` requires fresh consumed nonce, exact worker and a bounded 14-second lease; fence-before-nonce and wrong worker are rejected.
4. `record_issuer_evidence` requires the exact active fence, but the fixture deliberately accepts a **synthetic digest**; it does not verify a live issuer signature.
5. `consume_issuer_lease` requires bound issuer evidence and the active fence, records one consumption with `dispatch_allowed=false`; replay is rejected.
6. Forced RLS, no direct table DML by the writer, and a restricted EXECUTE-only interface are checked for the new ledgers; append-only DELETE/TRUNCATE cannot remove rows.

**PASS: isolated six-stage fixture only**, with no live Supabase mutation. All fixture identities, command IDs, signatures/digests and task numbers are synthetic. These functions must NOT be migrated to live DEV: they lack the production trust bridge, native signature verification, real approval provenance, schema/owner drift gates and linked Core/Hub checks. The real six lifecycle functions remain absent from Supabase DEV. No dispatch authority was granted.

## Required next steps before operational migration

1. Design and test a single restricted broker login compatible with the preparation RPC's `session_user` guard and the two distinct non-login function owners.
2. Complete the persisted approval read-back contract: one verified Supabase Super Admin session, one approval decision, no HR/Accounting approval and no additional AAL2/TOTP requirement. The writer must not accept a caller boolean or a signature alone as proof of the persisted admin decision.
3. Define six SECURITY DEFINER RPCs with fixed `search_path=pg_catalog`, fully qualified object references, exact DEV/task/company/attempt/nonce/expiry binding, transaction-scoped locks, unique/idempotency constraints, and append-only writes.
4. Run isolated PostgreSQL tests for rollback, duplicate/replay, concurrent transactions, RLS and negative privileges before any DEV catalog mutation.
5. Only then provision the encrypted DEV writer credential and enable the broker-to-RPC path.

## Explicitly prohibited

- Do not change signer network sandboxes.
- Do not reuse reader DSNs or reader logins for writes.
- Do not grant direct table DML to authenticated, service_role, readers or signer processes.
- Do not remove/relax immutable evidence constraints or enable dispatch.
- Do not create task, command, approval, nonce receipt, signature, lease or dispatch during preparation.
- Do not change PROD.

## Current decision

The verification ingress and an unactivated read-only approval adapter are implemented and isolated tests pass. The database writer, restricted writer credential, six lifecycle RPCs and live signer-to-approval-reader integration are not implemented. Operational lifecycle migration remains NO-GO.

[executed on device: srv1792369 (0891e23a-6a6b-4f8c-a16a-962e888e2014)]