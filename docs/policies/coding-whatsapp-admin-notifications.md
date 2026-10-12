# Coding WhatsApp Admin Notification & Approval Policy

Status: proposed policy change for Issue #1142. Supersedes the coding lifecycle notification suppression introduced in PR #739 **only** for the events specified below, once implemented and verified. This document does not itself enable runtime notifications.

## Responsibility
- ChatGPT handles coding through GitHub branches and pull requests.
- AI Core monitors and correlates tasks/events and coordinates delivery, not coding delegated by ChatGPT.
- OpenClaw operates authorized devices when necessary.

## Notification rules
- Send exactly one WhatsApp admin notification per uniquely verified coding job terminal outcome: COMPLETED only after required CI checks, merge, deployment and production verification/E2E have all succeeded. Include job ID, PR, commit, check results and deployment proof.
- Send exactly one actionable approval request when a real human gate is encountered; include scoped action, job/approval ID, expiry, and approve/reject instructions.
- On FAILED/BLOCKED, attempt bounded safe recovery first. Notify admin only if human intervention is required or the failure is terminal and actionable; do not spam transient lifecycle updates.
- No messages for CHECKPOINT, QUEUED, PROCESSING, routine retries, or duplicate webhook events.
- Do not treat a GitHub green event alone as COMPLETED. Do not treat a gateway send ACK as WhatsApp delivery or as verified two-way communication.

## WhatsApp inbound decisions
- Accept SETUJU / TOLAK / STATUS with an unambiguous job or approval ID, plus existing signed token mechanisms.
- Authenticate webhook signature and admin sender allowlist; verify action scope, expiry, nonce, replay resistance, idempotency and audit trail.
- A reply may resume only the correlated, pending job after a persisted and authenticated decision. Destructive, security-critical and production database changes always require explicit human approval.
- Persist outbound provider message ID, delivery receipt, inbound message ID, approval decision, correlation ID and callback receipt.

## Reliability and rollout
- Durable outbox/inbox with bounded retries, exponential backoff, dead-letter and operator diagnostics. Deduplicate by event + job + notification type.
- Feature-flag rollout; retain billing/top-up alerts. Keep secrets in secret manager and do not expose them in logs.
- Tests: unauthorized sender, invalid signature, replay, duplicate event, expired approval, wrong job ID, CI partial-green, failed deployment, retry and delivered receipts.
- Run TEST_ONLY E2E proving GitHub completion -> WA delivered -> admin response -> persisted approval -> resumed correlated job -> verified callback receipt.
- Merge/deploy only when required security checks and deployment verification succeed. Never mark this policy live without E2E evidence.
