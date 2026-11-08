# GPT02 — integrated lifecycle completion contract (DEV)

**Scope:** Job 135, Human Review 6, AI Core / GPT02 / AI Task Center. **One integration backlog and one acceptance suite.**
This RFC is a whole-system plan, not permission to deploy worker execution. CI green on an individual component does not imply E2E PASS. DEV and PROD are completely separated.

## Current baseline
- PR #1671: distinguish new command identity from replay.
- PR #1672: fail-closed candidate reservation ledger.
- PR #1673: authenticated, DEV-only reservation route, default OFF.
- PR #1674: read-only reviewer preflight.
- PR #1676: durable parent-child candidate matching and lease *data model*, no executable lease issuer.
- **Still missing**: evidence-backed legacy untagged exclusion, authorized live DEV reservation readback, atomic issuer, lease CAS/heartbeat, 429 and worker gates, native ACK and verified completion, unified monitoring.

## Full critical-path delivery contract

| Gate | Component | Integration requirement | Acceptance proof |
|---|---|---|---|
| 01 | Intake + responsibility | Job owner, assignee, worker selection and timeline persist in same job record | readback from AI Task Center and audit |
| 02 | Human review | Real authenticated assigned reviewer, origin protections, revocation recheck | authorized/unauthorized E2E |
| 03 | Artifact | SHA-256 verified source bytes, not user-provided digest | recompute and bind same Job ID |
| 04 | Anti-replay/legacy | Durable command ancestry; fail closed for *unclassified* legacy commands | adversarial legacy fixtures |
| 05 | Reservation | Exactly one persisted parent/candidate; idempotency same key, 409 new key | concurrent PostgreSQL + readback |
| 06 | Atomic issuer | Single transaction revalidates reviewer, candidate, parent, writes command+durable link | crash and rollback tests |
| 07 | Lease fencing | Monotonic token; ownership, expiry, heartbeat, stale token denied, recovery | competing worker and crash tests |
| 08 | Rate-limit/health | 429 Retry-After, circuit, worker reachability; never bypass | injected 429 and health outage tests |
| 09 | Dispatch gate | Explicit separate approval, fresh issuer and lease, policy checks | negative and positive E2E |
| 10 | Native handshake | Signed native attestation plus bound conversation ACK | tampered, stale and valid token tests |
| 11 | Progress + escalation | Event-driven timeline with actor, owner, progress and blocker routing | job dashboard readback |
| 12 | Completion | No close without verified output, matching native ACK, reviewer gates | fails closed and explicit completion proof |

## Batch implementation structure
Build a **single integrated DEV release candidate** containing (a) typed lifecycle state/evidence contract, (b) storage and transactions, (c) dispatcher and native receipt handoff, (d) dashboard projections, (e) E2E/fault-injection harness. PRs can be split by review surface but must all be mapped to the same acceptance gates before rollout. No partial feature's success qualifies as final PASS.

## Required technical invariants
- Persist all events with immutable job, review, parent command, candidate command, actor, timestamp and evidence IDs; reject unbound/duplicate/missing proofs.
- Idempotency and lineage must hold under concurrent requests and retries *across processes*. A JSON tag alone is never sufficient legacy exclusion.
- Worker must submit the current database fencing token on every state transition; expired/stale owner cannot report success or release another worker's lease.
- On HTTP 429 use server-provided Retry-After and circuit breaker; never fan out retries to three workers.
- No polling loop that duplicates commands. Dashboard updates should be driven by persisted lifecycle events.
- DEV-only feature flags default OFF. PROD migration/deploy not in scope.
- A read-only dashboard snapshot **never** issues execution authority; issuance/dispatch needs a separate authorized transaction.

## E2E acceptance matrix
- Happy path: intake → assignment → human review → integrity → legacy audit → reserve → atomic child issuance → exclusive lease → dispatch → native ACK → progress → verified completion.
- Negative: missing reviewer, wrong owner, CSRF/origin, revoked approval, invalid SHA, duplicate command, legacy untagged, parallel POST (same/different key), disconnect/timeout/rollback, expired lease, stolen token, worker failure, 429 Retry-After, lost ACK, stale callback, duplicated events, dashboard reconnect, failed final output.
- Cross-environment: no mutation of production and verify DEV SHA, env flag and RLS.
- Quantitative proof: record test run, SHA, DB transaction counts, observed commands/leases, network receipts and audit event IDs. Do not infer PASS from 200/CI alone.

## Immediate fail-closed blockers
1. Establish a defensible legacy-attempt identification and transactional exclusion strategy.
2. Prove live DEV migration/readback permissions and reviewer-bound preflight without changing flags.
3. Implement issuer and lease semantics in an integrated DEV candidate, with dedicated execution approval and 429 guards.
4. Run full E2E in an isolated worker and DB before any authorized limited DEV live test.

## Dashboard requirement
Each job must show owner, responsible human, AI worker, last native event, actual progress backed by events, current blocker, next action and whether human approval is needed. Unknown progress is **unknown**, not a fabricated percentage.

**Job 135 may be marked final PASS only when all 12 gates have independent authoritative evidence, a real native ACK, verified output, and no pending blocker.**


## Implemented lease service in this candidate
`gpt02DevRecoveryLease.ts` implements disabled-by-default backend CAS acquire, heartbeat and release, with ownership and current fencing token checks. A verified durable child link and RECEIVED child state are required for acquisition; no HTTP routes expose these methods. The separate `AI_CORE_DEV_GPT02_LEASE_MUTATIONS_ENABLED` flag remains OFF and is effective **only** under `APP_ENV=development`. Every response explicitly denies command issuance, dispatch and job closing.

**Lease release receipt:** the add-on DEV-only append-only receipt migration records reservation, fencing token and previous owner. Release updates the lease and inserts the receipt within the same transaction. Idempotent retry requires that exact owner-bound receipt and an unchanged unowned lease token. A missing receipt fails closed. Runtime permissions, authorized migration and independent integration tests remain mandatory before enabling the feature. This module is not wired into any worker and does not imply lifecycle readiness.

## Rate-limit and circuit evidence guard in this candidate
`gpt02LifecycleRateLimitGate.ts` evaluates a persisted health/circuit/rate-limit observation, including HTTP 429 Retry-After delta-seconds and HTTP-date. Unknown history, unhealthy workers and OPEN/HALF_OPEN circuits fail closed. It does not retry, poll, queue, or dispatch. The future state machine must source those observations from authenticated server-owned records, not client-supplied booleans.


## Legacy census and job projection coverage
`gpt02LegacyAttemptAudit.ts` provides a DEV-only read-only bridge census of potential previous commands, without returning sensitive instructions. The existence or *absence* of tagged descendants alone **cannot establish no legacy execution**; the census always sets `legacyUntaggedAttemptsExcluded=false` and blocks issuance. A future issuer requires operator-reviewed cross-ledger migration and durable exclusion, not a time-window count. The typed E2E diagnostic now also requires independently bound `intakeAssignment` and `progressEscalation` evidence (13 fine-grained evidence fields mapping to the 12 acceptance stages). No completion percentage may be inferred from these fields.

## Transaction-bound issuer preflight (non-issuing)
`gpt02DevIssuerTransactionPreflight.ts` performs a DEV-only **read-only** transaction locking the assigned human review, terminal FAILED parent, and reservation in fixed order. It verifies matching job/actor/candidate, reviewer recommendation and prototype SHA, then queries known candidates, links and tagged children. Any mismatch fails closed. **Even a clean snapshot always returns `UNTAGGED_LEGACY_EXCLUSION_NOT_PROVEN`**, and all issuance/dispatch booleans remain false. No route is exposed. A future actual issuer must obtain separate authorization, resolve cross-ledger historical attempts, create child+lineage atomically under the same locks, enforce circuit/worker gates and produce native proof. Component test PASS never authorizes worker execution.

## Reproducible isolated atomic issuer concurrency harness
Run `bash scripts/tests/gpt02_issuer_atomic_isolated.sh` only on a host with Docker. It creates a disposable PostgreSQL 16 container with `--network none`, applies the DEV reservation and lineage migrations, then runs two competing transactions locking the same parent. Expected A=1 child and link, B=0 due to the parent lock and durable link. It also injects an uncommitted child insert followed by ROLLBACK and confirms zero orphan commands. The harness automatically removes the database container and scratch logs on exit. This is a **transaction-pattern regression test**, not an operational issuer or proof of prior legacy attempt exclusion. It does not access any live DEV or PROD database.

## Read-only timeline projection
`gpt02Job135TimelineProjection.ts` projects persisted, explicitly command-bound response facts for the Job 135 dashboard: accountable human, assigned AI, latest event ID/time/kind, blocker and native ACK evidence. No invented percentage: `progressPercent=null` unless a separate authoritative task breakdown supplies a denominator. A COMPLETE response without server-verified attestation, receiver ACK and validated result cannot qualify even for final review. The projection never dispatches or closes the job; no handler, live subscription or UI is wired by this module. Do not display its synthetic test evidence as real runtime status.

## Authenticated DEV timeline readback (server, not yet dashboard UI)
`GET /ai/human-tasks/:id/gpt02-timeline?parentCommandId=<UUID>&jobId=<int>` is an authenticated owner/admin-only read-only DEV route subject to the existing human lifecycle review session guard, restricted DEV hostname and strict request parsing. It checks Human Review job/command binding, reads the parent/reserved candidate's bridge responses (max 100; overflow fails closed), and consults the established native checkpoint verification service. Terminal `COMPLETED` **never** means the output is verified: without independent result verification `resultVerified=false`, percentage unknown, job close denied. The actor and worker label cannot be guessed from arbitrary metadata. `Cache-Control: no-store`, no mutation, no dispatch.

This is a **backend data-read path only**. AI Task Center UI is not yet wired, and current DEV database/hostname readback has not been independently verified. The route may return 503 if DEV release or migration permissions do not include reservation tables; avoid claiming deployment PASS before an authenticated live GET.

## Human Task Center panel (on-demand, no polling)
The existing Human Task detail dialog now renders `Gpt02DevTimelinePanel` for `ai_core_lifecycle` tasks. The operator explicitly selects **Periksa timeline**; the authenticated read-only API is fetched with credentials, `cache:no-store`, strict job/command URL parameters, and a negative-authority response check. On HTTP/parse/permission errors, the UI displays a failure, never a fictitious PASS. Owner and worker are shown as unverified when the readback has no authoritative assignment; no made-up completion percentage, automatic polling, dispatch or close controls are present. This feature requires approved DEV deployment plus a real authenticated GET against the actual database before anyone claims runtime UI PASS.
The timeline endpoint allows only `dev.cstlogistic.co.id` and `dev-ai-task.cstlogistic.co.id`, under authenticated owner/admin session; arbitrary hostnames and PROD remain denied. A route regression checks the AI Task Center DEV hostname. UI fetch remains manually triggered and fail-closed.


## Real DEV DB schema and permission audit (2026-11-08)
A **read-only** database probe through the existing DEV connection confirmed Human Review 6 is accepted and bound to Job 135; the FAILED parent command has two persisted worker responses. Unlike `information_schema.tables`, `to_regclass` confirmed the recovery reservation table **exists**. Current DEV runtime role has schema USAGE but **no SELECT** on `gpt02_dev_recovery_reservations`. Missing information_schema visibility was privilege filtering, not proof of missing migration.

Timeline readback now first checks Human Review binding, then separately checks catalog existence and `has_table_privilege` before querying reservations. A denied SELECT returns an explicit `reservationReadbackStatus=SELECT_PERMISSION_DENIED`, while the baseline parent responses remain visible as read-only diagnostics; candidate and issuer remain UNVERIFIED. No DB grants, migration, role changes, worker dispatch or PROD mutations were performed. A limited read grant should only be considered after security and authorized operational review.

## Narrow DEV reservation timeline reader (proposal, not applied)
The real DEV role is aicore_dev_runtime; RLS is enabled with zero policies on the reservation table and direct SELECT is denied. Instead of relaxing RLS or granting table SELECT, a separately reviewed SECURITY DEFINER function gpt02_dev_timeline_candidate_reader(review_id,job_id,parent_uuid) returns only the candidate UUID when it matches the Human Review source module and job/parent binding. Only EXECUTE on this narrow function is granted to the DEV runtime role; PUBLIC and browser roles are denied. The API requires its existing authenticated admin/owner session and DEV hostname guard. When the function is missing or EXECUTE denied, timeline continues parent-only and declares the missing reader explicitly.

Test harness scripts/tests/gpt02_timeline_reader_isolated.sh runs PostgreSQL 16 with network disabled, validates migration denial without authorized session, double migration idempotence, denied direct SELECT, positive matching candidate and negative cross-review/job/parent cases. Isolated test PASS. This test uses synthetic fixture identities and must never run against live DEV/PROD. A later authorized DEV migration and real session readback are separate acceptance gates. No lease or dispatcher flags changed.
