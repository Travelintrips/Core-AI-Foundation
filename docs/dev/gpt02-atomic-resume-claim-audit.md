# DEV GPT02 atomic resume claim — schema and authorization audit

Date: 2026-11-08. Scope: **CST-DEV Supabase only**, read-only catalog inspection; not deployed.

## Confirmed facts from DEV information_schema / pg_constraint
- `ai_platform.ai_coding_bridge_commands.id` and `ai_coding_bridge_responses.id/command_id` are UUID.
- Responses reference commands through `ai_coding_bridge_responses_command_id_fkey`; command status is constrained to `RECEIVED | PROCESSING | COMPLETED | FAILED | CANCELLED`. There is **no** `PAUSED` or `BLOCKED` command status.
- Response kinds include `ACK, PROGRESS, CHECKPOINT, BLOCKER, COMPLETED, FAILED`.
- `ai_coding_bridge_presence.lease_token` is a UUID but is **worker presence**, not command-exclusive ownership.
- `dev_gpt02_resume_grants` and `dev_gpt02_resume_command_leases` do not yet exist. Do not assume any existing authorization data can be used as a grant.

## P0 blockers before executing the proposed SQL
1. The draft `dev_gpt02_claim_resume` checks a grant row, but **does not re-validate the referenced command status or latest response inside the transaction**. An approved grant alone is insufficient.
2. No authoritative persistent proof of native checkpoint attestation and receiver ACK is connected to the claim transaction. The read-only Recovery Review cannot authorize the SQL function. A server-verified, replay-resistant evidence reference must be tied to the grant and blocker.
3. The proposed grant/lease tables need foreign keys and exact command-response relationship enforcement, plus privileges/RLS review. API-facing `anon` and `authenticated` roles must not access these tables or the claim function.
4. Fencing must be enforced at **worker dispatch and completion writes**, not only when the lease is acquired. An expired worker must not commit an old command outcome after a new fence is issued.
5. Gate HTTP 429 `Retry-After`, circuit-open state, retries-used, active previous recovery and human approval within the same trusted claim path. The current SQL has none of those checks.
6. The persisted command status `FAILED` is not a paused state; prior FAILED command must **not** be silently reopened or interpreted as safe resume. Design explicit allowed transitions and immutable history.

## Required tests prior to permitting any execution
- isolated PostgreSQL (not shared PROD): three simultaneous connections contend for the *same* grant; exactly one claim succeeds;
- transaction rollback after forced error leaves grant unconsumed and no lease;
- retry/replay with same grant cannot acquire a second lease;
- expired/released lease reacquisition increments fencing token, and old owner cannot write results;
- mismatched command/response/worker, revoked/expired grant, absent attestation fail closed;
- latest FAILED/COMPLETED and new HTTP 429 / `Retry-After` deny dispatch;
- DB privileges demonstrate unapproved actors cannot create/approve grants or invoke claim;
- worker ACK/read-back + job registry status verified in DEV, with zero duplicate command dispatch.

## Decision
**NO-GO for migration, dispatch and E2E PASS.** PR #1660 is an RFC, not runnable production-ready migration. Keep flags OFF. Fix P0 defects and verify test results before any change to DEV DB schema.

## Verified live DEV readback (2026-11-08)
Command `169a7492-cfd8-4a56-bb57-18001b6b5968` currently has `status=FAILED`, latest response `CHECKPOINT`, latest checkpoint acknowledged, and no latest `BLOCKER`. No grant or exclusive command lease is verified. Thus `mayDispatchWorker=false`. This readback is **not** proof of native cryptographic attestation or exclusive concurrency safety.

## Draft security hardening
The proposed SQL now declares command/response foreign keys, enables RLS on both new DEV tables, revokes API role access, and **unconditionally denies** the claim function via `RESUME_DISPATCH_GUARD_NOT_IMPLEMENTED`. This makes accidental activation fail closed while the missing DB-side evidence / retry / rate-limit / actor authorization checks are designed and tested. The document remains an RFC; the schema has not been applied. Foreign keys alone do not establish that response IDs belong to the same command—this remains a P0 requirement.
