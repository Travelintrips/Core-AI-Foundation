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
