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

## Executed isolated PostgreSQL 16 contract tests (2026-11-08)
On VPS `srv1792369`, a disposable `postgres:16-alpine` container was started with `--network none`, an in-memory `--tmpfs` data directory, and no host port or persistent volume. Test script: `scripts/dev/test-gpt02-resume-isolated-postgres.sh` (now wired into GitHub CI). The container is removed via shell cleanup trap.

Actual readback from the **prototype** (distinct from the intentionally inert proposed SQL function):
- `RACE PASS: 1 winner, 2 rejected` (three independent PostgreSQL client sessions)
- `STATE PASS: one consumed grant and one lease`
- `REPLAY PASS`
- `ROLLBACK PASS: grant unconsumed, no partial lease` with injected PostgreSQL exception
- `FENCE PASS: old owner denied, new owner accepted` after forced lease expiry and fencing-version increment
- process exit 0

Initial harness attempt failed rollback verification because `docker exec` was missing `-i` on SQL input and had not inserted the fixture grant; the corrected harness was rerun from an empty disposable database and passed. These are **contract tests for an isolated prototype only**. They do not prove the draft `dev_gpt02_claim_resume` is runnable (it unconditionally raises 0A000), nor that cryptographically verified checkpoint/ACK, terminal events, HTTP 429 and approval identity have been enforced transactionally. PROD was not accessed or modified.

## Additional real PostgreSQL guard-contract evidence (2026-11-08)
The isolated PostgreSQL 16 harness was extended to enforce command-state, checkpoint verification, receiver ACK, latest BLOCKER, BLOCKER-command match, authenticated approval flag, bounded retry, Retry-After, and open-circuit conditions **inside the row-locked prototype claim transaction**. Run on disposable network-disabled container on VPS; process exit 0. Results:
- 3 simultaneous clients: one winner, two denied
- replay prevented; injected rollback leaves grant APPROVED and no lease
- fencing rejects stale result writes
- nine independent fail-closed scenarios rejected with zero grant consumption or lease creation: FAILED command; checkpoint invalid; receiver ACK invalid; latest response not BLOCKER; mismatched BLOCKER; missing approval; retry budget exhausted; HTTP 429 Retry-After pending; circuit breaker open

This remains **simulated evidence flags in a self-contained sandbox**, not a cryptographic attestation integration or an approved authorization record in CST-DEV. The reviewed SQL proposal remains inert (unconditional 0A000); no migration and no GPT02 worker resume. This does not establish a PASS for production dispatch, exact signed checkpoint ownership, or full lifecycle E2E.

## Fenced result write row-lock hardening (2026-11-08)
The sandbox prototype now acquires a PostgreSQL `FOR UPDATE` lock on the active command lease row before fenced result writing; this removes the lease-check / result-write race window relative to lease rotation. Repeated on disposable PostgreSQL 16, the complete harness returned exit 0 with race/replay/rollback/fence and 9 deny cases PASS. This is a prototype safeguard; all result writes in the real worker implementation would still need to use equivalent transactionally enforced fencing.

## Transactional response-command relationship prototype (2026-11-08)
Isolated PostgreSQL 16 contract now has a persisted `sandbox.response_events` relation with command ID, distinct event ID/kind and sequence. Claim logic verifies checkpoint and BLOCKER belong to the **same command**, checkpoint predates BLOCKER, latest event is BLOCKER, and no terminal FAILED/COMPLETED event exists anywhere in the command history. Four additional adversarial cases tested: missing/wrong-command BLOCKER binding; terminal FAILED before checkpoint; terminal COMPLETED after blocker; and a later CHECKPOINT making BLOCKER stale. All denied, with no consumed grants or leases. Combined test output: `EVIDENCE GUARDS PASS: thirteen rejected ...`, exit 0. This is still an isolated prototype, not a deployed validation of real signed receipts. No DEV/PROD application DB mutation or resume dispatch.

## Operator grant issuance prototype — isolated PostgreSQL 16 (2026-11-08)
Added `scripts/dev/test-gpt02-issuance-isolated-postgres.sh`, run successfully on VPS srv1792369 in a temporary, network-disabled, in-memory PostgreSQL 16 container (exit code 0), and added to GitHub CI.

The sandbox function checks a grant issuer's **database role EXECUTE permission**, a nonterminal command, signed-checkpoint/native-ACK *synthetic flags*, no active Retry-After, retry limits, same-command checkpoint and latest BLOCKER, and bounded approval TTL. Direct write access to grant tables is revoked from approver/worker test roles. Readback: worker role denied grant issuance; approved DB role created exactly one grant; duplicate approval and invalid command, evidence, response IDs, worker/operator or TTL all rejected without additional grant rows. The script removed its container on exit.

**Security limitation:** the test uses a synthetic operator name and synthetic boolean attestation. PostgreSQL `SECURITY DEFINER` execution permission is **not equivalent** to authenticating the person behind the request; the caller-provided operator label must not become trusted audit identity in a live function. No human auth integration, signed-receipt verification in the transaction, or deployment to CST-DEV is claimed. The proposed live function remains inert.
