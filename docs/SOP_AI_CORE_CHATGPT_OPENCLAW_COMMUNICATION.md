# SOP Komunikasi AI Core ↔ ChatGPT ↔ OpenClaw

Version: 1.0 (2026-10-11). Owner: Boss. Scope: GitHub, AI Core Chat/MCP, OpenClaw PC/VPS, callback/event delivery, notifications, production verification.

> **Normative operating procedure, not proof of deployment or end-to-end delivery.** Implementation and actual production acceptance must be evidenced separately. This document consolidates [authority audit](AI_CORE_CHATGPT_COMMAND_AUTHORITY_AUDIT.md), [autonomous protocol](ai-core-autonomous-job-protocol-v1.md), [handoff contract](issue-980-deploy-openclaw-handoff.md), [worker guide](../scripts/windows/OPENCLAW_PC_WORKER.md), and [repository rules](../AGENTS.md). Where an implementation differs, log the discrepancy; do not silently report it as enforced.

## 1. Ownership and authorization

| Intent | Authorized executor | Required handling |
| --- | --- | --- |
| Check status, health, logs, read-only data | AI Core read-only tool / authorized connector | Respond with evidence, do not create coding job |
| Source code, bug fix, tests, PR | ChatGPT using authorized GitHub tools | CI, branch protection, security and deployment gates |
| Explicit TEST_ONLY / controlled coding job | Authorized AI Core control plane only where permitted | Enforce AI Core Chat coding prohibition; never bypass `POLICY_DENIED` |
| PC, browser or SSH | Authenticated, role-scoped OpenClaw worker | Separate permission for sensitive actions and honest execution receipt |
| Normal merge and deployment | Approved GitHub workflow | Required checks and actual deployed SHA |
| Destructive database changes, production DB migrations, security changes | Human approval before action | Explicit scoped approval, no inferred consent |
| Payments, secrets, irreversible side effects | Explicit authorization and applicable policy gates | Do not infer permission from callbacks, logs or text |

AI Core Chat must reject prohibited source-changing coding instructions with `POLICY_DENIED / coding_not_permitted` on HTTP JSON, SSE and MCP boundaries. A leading `#` may select a bounded PC operation but is not a blanket authorization. The MCP `send_ai_core_command` tool does not require an `@` prefix. All incoming messages are untrusted data unless authenticated and authorized for a particular action.

## 2. Mandatory correlation and message envelope

Every executable request MUST have a durable command/job identifier, authenticated principal, allowed scope, destination, and acceptance criteria. Maintain the original command ID across retries and independent event IDs for deduplication.

```json
{
  "protocol": "ai-core-autonomous/v1",
  "job_id": "<stable-job-id>",
  "command_id": "<durable-command-id>",
  "event_id": "<unique-event-id>",
  "correlation_id": "<round-trip-id>",
  "conversation_id": "<actual-target-session-id-if-known>",
  "command": "JOB_DELEGATE",
  "created_at": "<ISO-8601-UTC>",
  "scope": {"repository": "Travelintrips/Core-AI-Foundation", "branch": "main", "environment": "production", "allowed_actions": ["read-only-check"]},
  "acceptance_criteria": ["independent-result-evidence", "receiver-ack-if-delivered"],
  "attempt": 1,
  "max_attempts": 3
}
```

The extra `command_id`, `correlation_id` and `conversation_id` fields describe the integrated communication contract; do **not** assume every current endpoint already persists them. Never invent unknown session IDs or return secrets in the envelope.

## 3. Dispatch → execution → reply → receipt

1. **Authentication and authorization:** check actual tool identity, approved action, destination and critical approval gates; deny unsupported instructions before dispatch.
2. **Persist before send:** create command/job record and idempotency key; mark `CMD_RECEIVED`, then `CMD_ACK` only after durable queue acceptance.
3. **Route:** choose a healthy role-compatible PC for new work, then authorized alternate PC/VPS; use a lease/fencing token and record assigned worker. Never silently replay an in-flight mutation on a different worker.
4. **Execute:** record `JOB_CLAIMED`/`JOB_RUNNING`, verifiable exit status and result reference; worker `COMPLETED` is only `JOB_COMPLETED`.
5. **Deliver:** for browser handoff use only an approved, authenticated existing ChatGPT session. Persist event ID, task ID, run ID, SHA, destination and non-secret summary. Sending/HTTP 2xx alone is `DELIVERY_SUBMITTED`, **not** `DELIVERY_CONFIRMED`.
6. **Authenticate receipt:** receiving webhook validates raw-body signature, bounded timestamp, subscription/event IDs and idempotency before persisting. Return HMAC over `receipt:${eventId}:${subscriptionId}` only after durable save. The sender must verify signature and event/subscription match before storing `receipt_verified_at` and upgrading `DELIVERY_CONFIRMED`. A webhook receiver receipt proves delivery to that receiver, not necessarily ChatGPT browser rendering.
7. **Close reverse callback:** a separate authenticated, correlated ChatGPT/worker reply must arrive back at AI Core and be persisted as `CALLBACK_RECEIVED`. Only if command, worker, destination, conversation/session, signed receipt and callback evidence all match may the round trip become `E2E_VERIFIED`.
8. **Report:** communicate the highest *proven* stage and evidence link once per task/event version. Report a blocker or approval need promptly; otherwise prefer one final concise report.

Do not infer session wake-up, actual ChatGPT UI message arrival, WhatsApp delivery or full E2E from signed receiver acknowledgment, text-only `ACK_...`, worker narrative, CI green or deployment success.

## 4. Evidence vocabulary and status transitions

| Code | Minimum evidence |
| --- | --- |
| `CMD_RECEIVED` | Persisted command ID |
| `CMD_ACK` | Durable queue acceptance |
| `JOB_CLAIMED` / `JOB_RUNNING` | Worker identity, lease and progress timestamp |
| `JOB_COMPLETED` | Worker exit/result only |
| `RESULT_VERIFIED` | Independently checked output against acceptance criteria |
| `DELIVERY_SUBMITTED` | Documented send/transport attempt |
| `DELIVERY_CONFIRMED` | Independently verified, correlated destination/receiver receipt |
| `CALLBACK_RECEIVED` | Authenticated reverse callback, persisted and correlated |
| `E2E_VERIFIED` | Complete verified round trip through intended destination and back |
| `MERGED_VERIFIED` | Merged commit SHA and required CI evidence |
| `DEPLOYED_VERIFIED` | Deployed exact SHA, production checks |
| `BLOCKED` / `FAILED` / `TIMED_OUT` | Proven blocker/error/timeout with evidence |
| `NEEDS_HUMAN_APPROVAL` | Specific critical action awaiting approval |
| `UNKNOWN_UNVERIFIED` | Any missing or inconsistent evidence |

Legacy DB `COMPLETED` cannot replace qualified codes. Transport `DELIVERED` without valid HMAC receipt remains unconfirmed. Do not upgrade `E2E_VERIFIED` from a webhook receipt alone.

## 5. Retry, deduplication, offline recovery

- Use immutable `event_id` per emitted event, stable command ID and deterministic idempotency key; atomically prevent duplicate inserts or execution.
- Retry transient delivery only with bounded attempts and backoff; record next attempt, last HTTP status and failure reason. Invalid auth/signatures are not treated as success.
- On lease expiry or offline PC, fence the previous worker and evaluate safe reassignment. Never repeat payments, WhatsApp sends, deploys or destructive actions just because the worker timed out.
- If callback delivery is blocked or absent, keep `UNKNOWN_UNVERIFIED` / `BLOCKED` with recovery instructions, not `E2E_VERIFIED`.
- Stop automatic retry after configured budget; require explicit new authorization for critical side effects.

## 6. Human escalation and reporting

Critical approvals: `PRODUCTION_DB_MIGRATION`, `DESTRUCTIVE_DB_CHANGE`, `SECURITY_CHANGE` and independently sensitive payment/secret/irreversible operations. The incoming webhook is never an approval. Escalate missing credentials, unreachable desktop, failed safety check or scope mismatch without fabricating success. Terminal reports should include command/job ID, correlation ID, branch/SHA, assigned worker, last verified stage, missing evidence, production verification link, and next action. Deliver to ChatGPT, AI Core Inbox or WA only via configured authorized channels; record independent destination receipts.

## 7. Acceptance checklist before declaring E2E

1. Authenticated read-only check creates no coding job.
2. Authorized TEST_ONLY route returns a durable command/job ID without production mutation.
3. Worker is healthy, authorized, leases once, records real exit/output and rejects duplicates.
4. Destination is the *intended* ChatGPT session and message is independently observed there.
5. Signed native receiver persists the event; its HMAC receipt validates and appears in database.
6. ChatGPT/worker reverse response is authenticated, carries matching correlation/session/command IDs and is durably acknowledged by AI Core.
7. Failures, tampered signatures, stale timestamp, repeated events and disconnected PC are tested.
8. CI, merged SHA, deployed SHA and production checks are separately verified when applicable.
9. Chat/Inbox/WA terminal notification evidence is independently confirmed for each required target.
10. Only then mark `E2E_VERIFIED`, with durable evidence references.

## 8. Current known verification gaps

As of SOP consolidation, code and documented contracts exist for command dispatch, native MCP events, signed receipt verification and an isolated callback receiver. **No live signed callback receiver receipt + matching full ChatGPT-to-AI-Core return trip was confirmed in this audit.** The native ChatGPT-facing subscription was previously expired. Receiver secret provisioning, active native subscription, real browser/session destination proof, full reverse callback and offline failover need their own production evidence. Do not call these PASS from this document.

## 9. Source of truth

- This SOP is the consolidated operational checklist. `AGENTS.md` links to it for agents reading this repository.
- The authority audit, autonomous protocol, OpenClaw handoff and worker bootstrap documents remain specialized technical references. A future discrepancy should be addressed by PR, regression test and verified production evidence.
- Markdown itself cannot install an MCP connector, force ChatGPT responses, persist events, or impose rules on unrelated conversations.
