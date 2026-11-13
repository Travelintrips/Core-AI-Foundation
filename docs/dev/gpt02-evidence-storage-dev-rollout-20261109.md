# GPT02 DEV evidence storage — applied migration and verified security boundary

Date: 2026-11-09. Scope: Supabase project **CST-DEV** (`xssrfshdrtdfupgqwfdw`). Production was not changed.

## Applied migrations (Supabase migration registry)

1. `dev_gpt02_append_only_evidence_no_runtime_authority_20261109`: installed append-only task–attempt claim and attestation nonce tables with immutable triggers, uniqueness and deferred provenance FK; no runtime INSERT grants. Repository source: `scripts/dev/migrations/20261109_gpt02_evidence_storage_no_authority.sql`.
2. `dev_gpt02_nonlogin_writer_capability_pg17_creator_guard_20261109`: created `dev_gpt02_claim_writer_nologin`, NOLOGIN / NOINHERIT, INSERT-only into the two evidence tables; no password or service connection. Repository source: `scripts/dev/migrations/20261109_gpt02_writer_nologin_no_authority.sql`.
3. `dev_gpt02_evidence_owner_no_direct_app_dml_20261109`: transferred both tables and immutable trigger functions to `dev_gpt02_evidence_owner` (NOLOGIN), removed temporary schema CREATE rights and SET ROLE rights from the `postgres` app login. Repository source: `scripts/dev/migrations/20261109_gpt02_evidence_owner_separation_fix.sql`.

Several earlier owner-transfer attempts failed their transactional postconditions, were rolled back, and did not leave a half-applied owner or migration; the successful migration has explicit guards.

## Verified directly from actual DEV service connections

- AI Core DEV application connects as `aicore_dev_runtime`; cannot INSERT, UPDATE or DELETE evidence, nor SET ROLE to the claim writer.
- AI Task Center DEV application connects as `postgres`; after the ownership repair it likewise cannot directly INSERT, UPDATE, DELETE or SET ROLE to the evidence owner/writer.
- Both evidence tables remain empty. The deferred nonce→binding FK remains enabled. Task #135 Core command remains FAILED.
- Both evidence owner and claim writer are NOLOGIN. No operational writer credential, issuer service, grant/lease, signer, or native final ACK was enabled.

## Critical residual trust limitation

The Hub DEV `postgres` login has PostgreSQL `CREATEROLE` and is a member of `pg_read_all_data`. On PostgreSQL 17 it also retains creator ADMIN membership in the new roles even after the SET option is revoked. Therefore the owner-reassignment repair prevents *direct* DML but is **not a fully isolated security boundary against arbitrary privileged SQL by the Hub application**. Reading evidence remains possible through `pg_read_all_data`.

**NO-GO** for issuer, native binding grants, worker dispatch, resume, and completion. Before any operational writer credentials can be trusted, move Hub DEV to a restricted database login, audit the app's required privileges/RLS, verify isolation from `CREATEROLE`, `pg_read_all_data`, and evidence owner/writer roles, and prove a real operator+attestor issuance workflow. Do not grant a LOGIN role writer to Hub or Core application containers.

## Tests

- Exact schema and NOLOGIN role migrations tested against isolated PostgreSQL 16: `scripts/dev/test-gpt02-nologin-writer-schema-migrations-isolated.sh`, **3/3 PASS** (permission shape, creator-only membership, replay refusal).
- PostgreSQL 17 live CST-DEV migration and readbacks succeeded. Core DEV and Hub DEV direct connection audits confirmed all direct evidence DML privileges false.
- Other Core PR #1660 isolated tests cover separate LOGIN credentials (8/8), synthetic cryptographic atomic binding (5/5), and runtime writer preflight (4/4). These remain **test-only**, not operational issuer evidence.

Production unchanged, Task #135 not modified. Recovery remains OFF.
