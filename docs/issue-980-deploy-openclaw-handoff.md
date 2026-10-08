# Deploy verified -> OpenClaw -> ChatGPT handoff (Issue #980)

## Current state
This document is a design contract, **not** evidence that the integration is deployed. Manual OpenClaw browser control was verified against an unauthenticated ChatGPT tab only.

## Required workflow
1. On successful CI **and** production verification for a deployment, emit one persisted event with `eventId`, `taskId`, `runId`, `commitSha`, `environment`, `deploymentUrl`, `verificationUrl`, `occurredAt`, and a non-secret result summary.
2. Compute a stable idempotency key from environment, run ID, and commit SHA; store state `PENDING -> CLAIMED -> DELIVERED -> ACKNOWLEDGED`, with terminal `BLOCKED` after bounded retry.
3. An authenticated PC-specific OpenClaw worker claims the event using a short lease; do not use the shared `gcp-openclaw-main` worker identity. Reject expired/replayed events and avoid secrets in chat messages.
4. The worker must only interact with a user-approved, already logged-in ChatGPT monitoring tab. Do not launch a guest tab and report success, copy cookies, bypass login, expose CDP/Gateway publicly, or close existing Chrome sessions.
5. Submit a message containing event ID, task ID, deployment URL, commit, verification outcome, and the next authorized verification request. Verify message appears in the conversation and a reply is received before acknowledgement.
6. If the PC is offline, login is missing, or browser interaction fails, leave the event retryable and surface the exact blocker in the AI Core inbox; send WhatsApp fallback only via the authorized dedicated gateway.
7. Deduplicate across retry and restart; avoid endless ChatGPT/AI Core ping-pong and never infer that a browser message grants deployment privileges.

## Release gate
Require unit tests for idempotency, lease expiry, duplicate events, missing authentication, offline queue and retry, plus integration test and real production E2E from verified deploy to ChatGPT reply. Preserve protected approvals and only merge when CI is green. No claim of completion before production E2E evidence.

## Existing blocker
The AI Core `send_ai_core_command` request for coding was misrouted to `EXTERNAL_AGENT_STATUS`; PC OpenClaw registry was `UNAVAILABLE`. Repair these separately and record evidence in Issue #980.
