# AI Core Communication Protocol v1.0 — session pairing and wake-up contract

Status: implementation specification; **not** production E2E evidence. Supplements [canonical SOP](SOP_AI_CORE_CHATGPT_OPENCLAW_COMMUNICATION.md).

## Boundaries
- ChatGPT-initiated coding stays in GitHub. AI Core coordinates authorized worker operations.
- MCP responses can continue an active tool call; asynchronous MCP events do **not** independently wake a finished ChatGPT turn.
- For a stopped conversation, OpenClaw PC may use the authorized browser UI to send a new message to a **verified** existing conversation. No browser challenge bypass.
- Android-originated conversations are not assumed visible to PC; pairing must prove the exact conversation.

## Capability handshake
Client sends `handshake.request` with protocol version, authenticated principal, requested capabilities, client-generated nonce and optional verified conversation locator. AI Core responds with server nonce, capability version, supported commands, allowed scopes, worker health and a short-lived pairing token. Never assume that the MCP transport exposes ChatGPT conversation URL or ID.

## Session registry
Store `session_registry_id`, `principal_id`, `conversation_url`, `conversation_id`, `client_nonce_hash`, `server_nonce_hash`, `pairing_token_hash`, `pairing_expires_at`, `verified_at`, `worker_id`, `revoked_at`, and `last_seen_at`. Validate ChatGPT origin and URL pattern; never trust a URL asserted solely by a worker. Bind a short-lived challenge to the browser conversation through an observable, authenticated matching exchange. Multiple tabs must not reuse one challenge. If matching cannot be proved, mark `PAIRING_UNVERIFIED` and do not wake.

## Command/event envelope
Required: `protocol_version`, `command_id`, `job_id`, `correlation_id`, `event_id`, `session_registry_id`, `principal_id`, `target_worker_id`, `action`, `allowed_scope`, `created_at`, `expires_at`, `idempotency_key`. Never put credentials or unredacted shell output into browser wake text.

## Delivery state machine
`CMD_RECEIVED -> CMD_ACK -> JOB_CLAIMED -> JOB_RUNNING -> JOB_COMPLETED -> RESULT_VERIFIED -> DELIVERY_SUBMITTED -> DELIVERY_CONFIRMED -> CALLBACK_RECEIVED -> CHATGPT_RESUMED -> E2E_VERIFIED`.
Statuses are evidence-qualified, not assumed linear: failures and offline states persist separately. Browser submission alone does not prove arrival. Text ACK alone does not prove a return callback or resumption. `CHATGPT_RESUMED` requires a distinct correlated action or readback after wake-up; `E2E_VERIFIED` requires the authenticated return trip.

## Durable outbox and retries
Persist before dispatch. Unique event ID + command idempotency key, atomic claim/lease, fencing tokens, bounded exponential retries and dead-letter queue. Retry browser wake only when no destination receipt exists; never duplicate irreversible operations. Record worker execution evidence, browser destination evidence, signed receiver receipt, reverse callback and continuation evidence independently.

## Security
Authenticate every endpoint and principal. Use HMAC on raw callback body with timestamp/nonce replay protection, rotate secrets, reject expired events, enforce per-worker capability allowlists. No automatic authorization for production DB mutations, destructive operations, payment, secrets or security changes. Human approval is separate from an event payload.

## Required tests
1. Fresh handshake and version negotiation.
2. Pair correct browser conversation among two open tabs.
3. Reject wrong tab, expired challenge and Android session without proof.
4. Route DNS read-only to VPS and PowerShell read-only to PC.
5. Persist callback, verify HMAC receipt, reject replay/tampering.
6. Resume from stopped turn via OpenClaw and prove ChatGPT's correlated follow-up.
7. Recover from offline worker without duplicate execution or duplicate wake messages.
8. Verify CI, deployed SHA, production health and real round-trip evidence separately.

No feature is labeled PASS without its test artifact, durable correlation IDs and production evidence.
