# GPT02 CST-DEV — Super Admin Owner ledger reader

## Verified live DB baseline — 24 Nov 2026

- Project: `xssrfshdrtdfupgqwfdw` (**DEV only**).
- Human authorization: fresh signed CST Hub Google Super Admin `admcst001@gmail.com`, plus active GPT02 Owner link.
- Database reader principal: `gpt02_owner_ledger_reader_dev`.
- This is a **separate PostgreSQL identity**. The user account is never granted database access directly.
- Reader: LOGIN / NOBYPASSRLS / NOINHERIT / connection limit 1 / password NULL until independently sealed provisioning.
- Reader role defaults: `default_transaction_read_only=on`, `statement_timeout=5s`, `idle_in_transaction_session_timeout=5s`.
- Private `gpt02_owner_approval` schema: USAGE and only approved column-level SELECT on two FORCE RLS tables. No schema CREATE or table INSERT/UPDATE/DELETE.
- RLS reads only the CST-DEV GPT02 scope for exact Owner email, worker and final consumed/approved states.
- Direct SQL under temporary `SET ROLE` in a transaction verified exactly one APPROVED decision + one CONSUMED challenge, and denied writes and sensitive hash columns. Temporary role membership was revoked; schema-owner membership restored.

## New code — candidate, feature OFF by default

DEV-only `GET /api/gpt02-owner-ledger/decision/:challengeId`:

1. Exact Host + allowed Origin, one Bearer token, no cookie-based identity.
2. Trusted Hub verifies fresh Google Super Admin session and active GPT02 Owner link.
3. Separate, root-only credential mount with exact path `/run/credentials/gpt02-owner-ledger-reader/reader.json`. No credentials in API output, frontend, dotenv or GitHub.
4. TLS-pinned PostgreSQL connection uses **only** `gpt02_owner_ledger_reader_dev`, never the main application writer pool. Database identity, read-only transaction, and default read-only setting are checked before the SELECT.
5. Parameterized SQL matches Owner subject, Supabase ID, email, project, worker, scope, challenge ID, APPROVED/CONSUMED and chronology. Independently rehashes the canonical signed manifest before returning a redacted receipt with execution/signing/dispatch false.
6. No grant, executor, signer, dispatch, new approval or timer action.

The feature flag `GPT02_OWNER_LEDGER_READER_ENABLED=true` is intentionally **NOT** set on VPS. No secret has been provisioned.

## Required custodian handoff — before runtime activation

A separately authorized database/secret custodian must:
- Establish a **new reader-only password** through an approved secure channel. Never paste/read it in chat or GitHub; do not copy the existing writer password. The role currently has PASSWORD NULL.
- Store the matching JSON as an **encrypted-at-rest** runtime credential and load it into the app as a root-protected ephemeral file exactly at the expected path. Expected keys: `database`, `host`, `password`, `port`, `projectId`, `sslMode`, `user`. Enforce mode 0600; no symlinks.
- Verify the dedicated Supabase CA file `/etc/gpt02-dev/supabase-root-ca-2021.crt` is authentic and current. Verify host `db.xssrfshdrtdfupgqwfdw.supabase.co`, port 5432, database postgres, `verify-full` and exact reader principal. Do not bypass certificate checks.
- Validate that the process running the API can securely read the decrypted runtime credential **without exposing it to user requests or logging**. A file mounted only on VPS but not available to the container is insufficient.
- Check one genuinely signed Super Admin session GET 200 (redacted receipt), missing session 401, other role 403, wrong origin 404 and read failure 503. Verify database logs show only the limited reader principal.
- Enable the feature in the isolated DEV runtime only after the above PASS. Do not enable in PROD.

**Explicitly NOT permitted:** assign `gpt02_owner_ledger_reader_dev` to `authenticated`/browser roles; expose Postgres password to JavaScript; give reader an INSERT/UPDATE/DELETE policy, BYPASSRLS or SUPERUSER; reuse runtime writer credentials; generate a false approval; grant signer/dispatch/executor authority.

## Current gate

Source implementation and 17 isolated HTTP/custody tests PASS. Operational secret provisioning, signed-browser-to-reader E2E and live dedicated-role TLS connection have not passed. Executor remains NO-GO.
