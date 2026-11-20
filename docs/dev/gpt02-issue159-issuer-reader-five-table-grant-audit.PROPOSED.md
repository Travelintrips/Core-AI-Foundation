# GPT02 DEV Issue159 — five-table issuer-reader grant gap (PROPOSED, NO APPLY)

**Status: REVIEW REQUIRED / NO_GO.** Read-only findings on CST-DEV `xssrfshdrtdfupgqwfdw`, 14 November 2026. This file is a design and verification gate, **not an executable migration or approval to enable a database login**. No role, credential, policy, unit, dispatch, or PROD changes were made.

## Observed mismatch

The existing VPS `gpt02-issue159-issuer-reader.service` executes `/opt/gpt02-reader-runtime/scripts/dev/gpt02-issuer-reader-runtime.mjs`. Its canonical `GPT02_ISSUE159_ISSUER_LEDGER_SQL` reads joined claims/receipts/fence data from:

| table | columns referenced by runtime query (including joins and WHERE) |
|---|---|
| `gpt02_private.approvals` | `claims,digest,command_id,attempt_id,task_id,company_id,approver_id,nonce` |
| `gpt02_private.operator_links` | `claims,link_digest,command_id,attempt_id,hub_task_id,company_id,hub_operator_id,approval_digest,link_id,hub_execution_id,core_task_id` |
| `gpt02_private.receipts` | `id,command_id,nonce,digest,consumed_at` |
| `gpt02_private.core_identity_receipts` | `receipt_id,command_id,link_id,operator_user_id,hub_operator_id,link_digest,binding_verified,may_dispatch_worker,may_issue_grant,may_close_job,core_ledger_written` |
| `gpt02_private.post_consumption_fences` | `fence_id,receipt_id,command_id,link_id,hub_execution_id,core_task_id,attempt_id,worker_id,lease_epoch,lease_started_at,lease_expires_at,dispatch_allowed,core_ledger_written` |

All five tables have FORCE ROW LEVEL SECURITY. Each has an existing `issuer_evidence_reader_select` RLS policy for `gpt02_issuer_evidence_reader`; however, the role presently has **no SELECT privilege on any of these five tables**. The policy alone does not confer table access.

Additional verified facts: the role is `NOLOGIN`, connection limit `0`, `PASSWORD NULL`, `NOINHERIT`, no elevated flags; zero sessions. It has SELECT only on the separate `issuer_evidences` and `issuer_lease_consumptions` relations (both FORCE RLS), and no write privileges on the audited GPT02 tables. The encrypted DSN path exists on VPS with root:root 0600 metadata; it was never decrypted or tested. The issuer-reader and four operational signer units remain disabled/inactive.

## Security gap requiring independent review BEFORE any grant

The two scoped policies for `approvals` and `operator_links` constrain company/task/environment. But the current reader policy on each of `receipts`, `core_identity_receipts`, and `post_consumption_fences` uses `USING (true)`. Granting table-wide SELECT, even on a NOLOGIN role intended to become a one-connection account, would broaden direct visibility beyond the intended joined lineage. **Do not simply GRANT SELECT ON ALL TABLES or clone a broad `USING (true)` pattern into a live migration.**

Preferred hardening: choose an independently reviewed, narrowly scoped read interface returning only verified lineage for an exact task/command/attempt/receipt/fence, with immutable DEV-only predicates, signed approval linkage, strict caller identity, pinned schema/search_path and explicit EXECUTE grants. Alternatively, review column-level SELECT for only the above referenced columns plus replacing broad RLS predicates with correctly bounded relational policies; test that policies do not recurse, leak cross-task data, or expose unrelated owner rows. An existing SECURITY DEFINER interface must not be assumed safe merely because it is private: review owner, search_path, RLS bypass, table privileges, and ability to call from anon/authenticated/PUBLIC.

## Release acceptance tests (disposable PG17 preferred; no live deployment)

1. Apply the proposed narrow authorization to disposable schema with the same names/column types and FORCE RLS, with independent security review.
2. Under a disposable replica of reader privileges, exact legitimate same-task joined lookup is allowed; wrong company, environment, task, command, attempt, receipt, link, fence, worker, epoch and expired lease are denied/empty.
3. Direct queries to unrelated rows in all five tables are denied by RLS; neither a different task's receipt nor a different worker fence can be enumerated.
4. `INSERT/UPDATE/DELETE/TRUNCATE/CREATE` are denied; privileged issuer routines deny EXECUTE; `anon/authenticated/PUBLIC` gain no new access.
5. No role membership escalation, `BYPASSRLS`, `CREATEROLE`, `SUPERUSER`, or `SET ROLE` bypass.
6. Only after exact-head tests/review: owner-approved **separate** one-shot DEV credential provisioning; single native TLS-verified read-only connection; bounded timeout; read-back, and mandatory re-lock to `NOLOGIN`, connection limit 0, `PASSWORD NULL`, zero sessions.
7. A reader connectivity PASS is **not** issuer positive authorization, signer readiness, gateway authentication, worker dispatch, or Final ACK. No Task #166 replay.

**Current decision: `SAFETY_PREFLIGHT_BLOCKED / NO_GO`** until the direct visibility gap is resolved without expanding authority.
