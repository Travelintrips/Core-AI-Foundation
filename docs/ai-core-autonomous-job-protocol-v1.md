# AI Core Autonomous Job Protocol v1

This is a versioned **message contract**, not an authorization bypass or a guarantee that a ChatGPT conversation can be woken remotely. Execution requires a connected, authenticated dispatcher and durable job runner.

## Envelope
Every command and result MUST carry:
- `protocol: "ai-core-autonomous/v1"`
- `job_id`: stable unique identifier (never create another job on retry)
- `event_id`: unique event identifier for idempotency
- `command`: one of `JOB_START`, `JOB_CONTINUE`, `JOB_FIX`, `JOB_VERIFY`, `JOB_DELEGATE`, `JOB_STATUS`, `JOB_CANCEL`
- `created_at`: ISO-8601 UTC timestamp
- `scope`: repository, branch, environment and explicit approved actions
- `acceptance_criteria`: machine-checkable conditions
- `attempt` and `max_attempts`: bounded retries

## Execution policy
1. AI Core owns durable job state and dispatch. ChatGPT/GitHub owns source patches. OpenClaw owns authorized desktop/SSH/browser operations.
2. Only an authenticated connector or runner may issue actionable commands. A Markdown instruction by itself does not initiate background execution.
3. Persist each command before dispatch; deduplicate on `event_id`; lease the job to one executor at a time; recover expired leases without duplicating effects.
4. Never treat a green CI badge as production verification. Record PR merge commit, deployed SHA for each production domain, health results, and relevant E2E run ID.
5. Mark `COMPLETED` only if every acceptance criterion is proven. `VERIFIED` evidence must have source, timestamp and reference.
6. Routine approved actions can proceed automatically within branch protections and deployment policies. No instruction here disables critical authorization gates.
7. On failure, attach error evidence and issue `JOB_FIX` (bounded). On inaccessible environments, issue `JOB_DELEGATE` to a permitted OpenClaw client. If retry budget expires, use `BLOCKED` with a concrete reason.
8. Never invent a PR, deployment, test run, device availability, or result. Never include secrets in progress events.
9. Send Boss terminal reports only, except for critical approvals or unrecoverable blockers. Forward progress events to AI Core.

## State machine
`QUEUED -> RUNNING -> VERIFYING -> COMPLETED`
`RUNNING/VERIFYING -> RETRYING -> RUNNING`
`RUNNING/VERIFYING -> BLOCKED`
`QUEUED/RUNNING/VERIFYING/RETRYING -> CANCELLED`
A terminal state is immutable unless a new explicit job is created.

## Result envelope
```json
{
  "protocol": "ai-core-autonomous/v1",
  "job_id": "CWS-EXAMPLE",
  "event_id": "unique-event-id",
  "status": "VERIFYING",
  "step": "production_health",
  "result": "pending",
  "evidence": [{"kind": "github_run", "ref": "https://github.com/org/repo/actions/runs/123", "observed_at": "2026-10-09T00:00:00Z"}],
  "error": null,
  "next_action": "JOB_VERIFY",
  "attempt": 1,
  "requires_boss_approval": false
}
```

## Delivery requirements
Implement transport separately: authenticated queue/endpoint, callback receipt, persistence, retries with backoff, event subscriptions, watchdog, and authorization. Test duplicate deliveries, offline PC failover, false-green CI, approval boundary, and full terminal E2E before claiming autonomy.
