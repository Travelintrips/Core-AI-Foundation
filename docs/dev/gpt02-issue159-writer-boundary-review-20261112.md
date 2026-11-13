# GPT02 Issue #159 — DEV writer boundary and lifecycle migration review

## Update 13 Nov 2026 — current evidence supersedes historical blockers

**Authoritative later-status note (DEV only).** This document retains the 12
November forensic timeline. Statements below that the six lifecycle RPCs
are absent, the reader/verifier not installed, or the one-shot signer/attestor
not integrated are **historical**, not current. Do not rebuild any previously
PASS components merely because an earlier paragraph says they were absent.

### Verified existing capabilities (not an E2E PASS)

- Six lifecycle RPCs are already present in CST-DEV: preparation is in
  `gpt02_stage`; approval, consumption, fence, issuer evidence and issuer
  lease functions are in `gpt02_private`. SECURITY DEFINER ownership,
  pinned `search_path=pg_catalog`, and exact executor-role grants have
  been verified separately. **Do not reapply the disposable fixture SQL.**
- On 13 November, database catalog readback verified both
  `dev_gpt02_attestor_evidence` and `dev_gpt02_issuer_evidence` have
  `NOLOGIN`, `CONNECTION LIMIT 0`, `NOBYPASSRLS`, no memberships,
  and no direct table DML across seven private lifecycle ledgers.
  Attestor has only `record_linked_approval` EXECUTE; issuer has
  `consume_linked_approval`, `reserve_post_consumption_fence`,
  `record_issuer_evidence` and `consume_issuer_lease` EXECUTE.
- The existing verifier, approval reader, issuer reader and lineage reader
  were observed active on VPS `srv1792369`. Existing root-only supervised
  one-shot orchestration performs approval → Hub → Core → attestor → issuer
  *only if* both independent encrypted writer credentials and all
  prerequisite trust evidence exist. Each one-shot unit remains static and
  inactive. The runner also proves a **new** systemd ExecStart/exit occurred;
  a skipped ConditionPathExists service cannot report a false success.
- Approval, operator-link, receipt, identity-receipt, fence, issuer-evidence
  and issuer-lease-consumption private ledgers each contained **zero rows**
  in the latest read-only DEV audit. No real signer execution, writer RPC
  mutation, fresh task/OTP, or dispatcher activation was performed.
- GitHub Four-Signer Contract CI
  [#43390833980](https://github.com/Travelintrips/Core-AI-Foundation/actions/runs/43390833980)
  completed **SUCCESS** on commit
  `84ef1605c4f84858de1cfffeaa60f7df190d83a2`, including existing
  approval/issuer tests and isolated PostgreSQL security checks. This is
  code readiness only, not proof of operational credentials or DELL E2E.
- The existing `ai_platform.chatgpt_attestation_final_callbacks_dev`
  contains 29 **historical** callback records; the latest
  `verified_at` was **2026-11-09 22:57 WIB**, with **zero**
  on 12–13 Nov WIB. Those callbacks do not establish a new Issue #159
  lifecycle Final ACK. Current issuer verifier returns
  `dispatchPermitted=false` and existing Final ACK remains a separate
  independently authenticated proof. Do not change a NO-GO field to
  manufacture dispatch authority.

### Remaining operational boundary — no automatic credential activation

1. An authorized DBA/operator must provision **separate** restricted
   CST-DEV attestor and issuer PostgreSQL logins and host-encrypted
   systemd credentials using an approved interactive administrative session,
   without pasting any passwords or DSNs into ChatGPT, CI, logs or issues.
   Credential targets consumed by the existing units are
   `/etc/credstore.encrypted/gpt02-issue159-attestor-dsn` and
   `/etc/credstore.encrypted/gpt02-issue159-issuer-dsn`.
   As audited, both are **absent**. Do not bypass the earlier rejected
   noninteractive administration path.
2. Before changing login state, recheck exact project `xssrfshdrtdfupgqwfdw`,
   role-only EXECUTE grants, empty in-flight ledger, FORCE RLS, root-private
   credential custody, pinned TLS, and all one-shot units inactive/static.
   Never reuse a reader/service_role/postgres credential for a writer.
3. Once that independent administrative boundary is satisfied, carry out
   **one fresh** bound Super Admin approval and one supervised DEV run;
   read back signed approval, nonce receipt, fence, issuer evidence and lease
   by exact command/attempt. Do not reuse historical Task #150/#151.
   A failed run requires reconciliation; there is no automatic retry.
4. Even an issuer `LEASE_CONSUMED_NO_DISPATCH` receipt is **not**
   authorization to dispatch to DELL. Review and authorize the separately
   protected command issue/dispatch path, then verify an independent DELL
   callback, attestation, and Final ACK linked to that same command.
   No PROD change or PR merge is justified until this E2E evidence exists.
5. After a supervised test, review whether writer role LOGIN should be
   returned to NOLOGIN and sealed credentials disabled; preserve immutable
   ledger and diagnostic evidence rather than deleting/replaying it.

**Current release decision: DEV standby/CI PASS; real authorized writer
activation, DELL dispatch and native Final ACK E2E remain NO-GO.**

---

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


### TypeScript ↔ Python interoperability regression (synthetic test-only)

The optional writer verifier admission route is additionally tested against
the **actual published TypeScript signer contract**, not a second Python-only
model. The cross-language fixture uses ephemeral Ed25519 keys generated only
in a test process. It checks Python → TypeScript role-specific signatures,
TypeScript → Python four-signer packet verification, matching
domain-separated SHA-256 signing-byte hashes, tampering and role-swap
denial, and all authorization/dispatch flags remaining false. This test is
part of the GitHub Four-Signer Contract CI and does not install any
new service or private credential.

The six existing Supabase DEV lifecycle RPCs remain privately scoped;
anonymous and authenticated users cannot execute them. Operational
attestor/issuer login credentials remain disabled. This evidence
**does not** grant signing, lease consumption or native dispatch.

### Live DEV six-RPC privilege and RLS gate

A read-only query using the reviewed lifecycle catalogue script against
Supabase CST-DEV returned 6/6 exact SECURITY DEFINER RPC signatures with
pinned search paths and minimum executor grants; 8/8 explicitly listed
lifecycle tables with owner-scoped FORCE RLS; 7/7 expected fail-closed
constraints; and 6/6 dedicated NOLOGIN, NO BYPASSRLS roles.

The query explicitly excludes PUBLIC, anon, authenticated, service_role,
and the dormant claim writer from executing the six RPCs. It also tests
the intended preparation/attestor/issuer roles separately, so no role
can silently inherit the wrong execution surface. The previous script
assumed 6 total tables; the current schema correctly has 8. This false
NO_GO has been replaced with exact table and role matrices.

Gate output: CATALOG_PRIVILEGE_STANDBY_PASS_NOT_E2E_AUTHORIZED.
It is a **read-only standby catalog PASS**, not authorization to enable
a privileged login, sign, consume nonce, or dispatch.
