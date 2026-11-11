# GPT02 Issue #159 — DEV writer boundary review

Date: 2026-11-12
Scope: DEV only. Review/design record; no database or service mutation.

## Observed runtime boundary

- Four signer units are active: approval, Hub, Core, Issuer.
- Each signer has `GPT02_ISSUE159_SIGNING_ENABLED=false`.
- Signer units run with `PrivateNetwork=yes` and `RestrictAddressFamilies=AF_UNIX`.
- Signers can reach the Hub/Core and Issuer read-only evidence sockets, but cannot open a PostgreSQL TCP connection.
- Existing encrypted credential inventory contains only Hub/Core/Issuer read-only DSNs and four encrypted signer private-key files. No GPT02 lifecycle-writer DSN is provisioned.
- The independent issuer reader uses a dedicated read-only DB login. It must remain read-only.
- `gpt02_core_prep_login`, `gpt02_core_prep_owner`, `gpt02_store_owner`, `dev_gpt02_evidence_owner`, `dev_gpt02_attestor_evidence`, and `dev_gpt02_issuer_evidence` are NOLOGIN roles.
- The six requested operational RPC functions are absent.
- All six lifecycle evidence tables have ENABLE + FORCE RLS. Existing table owners are non-login. Existing reader policies are SELECT-only. Append-only triggers reject UPDATE/DELETE/TRUNCATE.
- `prepare_core_task_dormant` is SECURITY DEFINER and explicitly checks `session_user='gpt02_core_prep_login'`; that role is currently NOLOGIN. It is not an operational RPC entry point.

## Why the writer path cannot be enabled by a GRANT alone

The signer processes are deliberately network-isolated and hold no database connection. Giving a SQL EXECUTE grant to a NOLOGIN role does not create a usable connection path. Granting broad table access to `service_role`, a reader login, or a signer process would break the current trust boundary. The read-only issuer DSN must not be repurposed for writes.

## Implemented safe prerequisite: signed-packet admission contract

Added `deploy/ai-coding-standalone-dev/gpt02_issue159_writer_broker_contract.py` and isolated tests at `scripts/dev/test_gpt02_issue159_writer_broker_contract.py`.

- Verifies canonical detached Ed25519 signatures for Approval, Hub, Core and Issuer domains.
- Requires four distinct public-key fingerprints; same-key role impersonation is rejected.
- Cross-binds task, command, attempt, nonce, approval digest, operator link, worker, receipt and fence identifiers.
- Rejects expired approval/evidence and task IDs <= 136.
- Returns evidence verification only. Database writes, nonce/lease consumption, signing, authorization and dispatch remain false / NO_GO.
- Is deliberately pure: no socket, DB driver, filesystem credential read, private key import, task creation or dispatch surface.
- Isolated synthetic-key tests: 8/8 PASS. These do not create any real approval or task and do not prove live signer output.

## Implemented verification ingress (not a database writer)

Added `deploy/ai-coding-standalone-dev/gpt02_issue159_writer_broker_runtime.py`.

- Private Unix socket accepts only bounded `POST /verify-packet` JSON.
- Loads the four root-owned DEV public keys and verifies each against the root-owned `trust-fingerprints.json` manifest; all four SPKI fingerprints must be distinct.
- Calls the pure four-domain Ed25519 evidence verifier; malformed, tampered, expired, cross-role and mismatched-root packets fail closed.
- Does not connect to PostgreSQL, read private credentials, sign, consume nonce/lease, create tasks/commands, grant authority or dispatch.
- Socket integration tests use disposable synthetic keys and a temporary Unix socket. Runtime is not installed or enabled as a systemd service.
- Targeted broker tests: contract 8/8 PASS; runtime 5/5 PASS. Combined Issue #159 Python suite: 74/74 PASS. Python compile and git diff check PASS.
- Live public-root preflight against the existing DEV public keys + fingerprint manifest: PASS; no socket bound and no database connection.

This is a verification ingress prerequisite only. It is intentionally not described as an operational writer broker.

## Required minimal bridge before operational migration

1. Add one separate DEV lifecycle-writer broker, isolated from signer private-key custody.
2. Signers submit signed, canonical, domain-separated evidence to that broker over a local Unix socket. The broker verifies signatures against the pinned four public roots and checks the single authenticated Super Admin approval evidence through the existing read-only approval reader.
3. The broker connects to Supabase with a new, dedicated encrypted lifecycle-writer DSN. Its database role is NOINHERIT, non-superuser, no BYPASSRLS, no CREATEDB/CREATEROLE, no memberships, connection limit 1, and has EXECUTE only on the six reviewed RPC functions. It has no direct table DML.
4. RPC functions are SECURITY DEFINER with fixed `search_path=pg_catalog`, fully qualified object references, strict DEV/task/company/attempt/nonce/expiry checks, transaction-scoped advisory locks, unique constraints, and append-only writes. Function owners remain non-login and retain RLS policies scoped to their own exact writes.
5. Every transition verifies the prior persisted row and exact identity tuple; caller booleans never prove a signature, consumed nonce, fence, or lease.
6. The migration must fail on schema/owner/policy/constraint drift, preserve FORCE RLS, preserve immutability, and keep dispatch authorization false until a separately reviewed gate. No automatic dispatch is included.

## Explicitly prohibited

- Do not change the signer units' network sandbox.
- Do not reuse the issuer-reader DSN or any reader login for writes.
- Do not grant table DML to `authenticated`, `service_role`, signer roles, or readers.
- Do not enable or load signer private keys for operational signing.
- Do not create a task, command, approval, nonce receipt, signature, lease, or dispatch during this writer-boundary preparation.
- Do not change PROD.

## Current decision

The signed-packet verifier contract is staged and isolated tests pass, but it is not a running broker. NO-GO for operational lifecycle migration until the dedicated writer broker, real signer evidence interface, and restricted DB credential exist and are independently verified. Existing 61/61 Issue #159 Python tests and the isolated PostgreSQL fence-receipt test remain valid for their tested contracts, but do not prove the missing writer bridge or live lifecycle.

[executed on device: srv1792369 (0891e23a-6a6b-4f8c-a16a-962e888e2014)]