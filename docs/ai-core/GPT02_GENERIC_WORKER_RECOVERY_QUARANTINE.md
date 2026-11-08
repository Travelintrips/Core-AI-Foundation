# GPT02 recovery must NOT run through ordinary external-agent claims

## Verified runtime risk — Nov 9, 2026 WIB

Actual DELL worker `dell-wake-event-listener.mjs` subscribes to targeted SSE, then calls `dell-wake-executor-once.mjs`. The worker has an **ordinary command claim token/renew lease**, but no recovery reservation fencing token. The server's generic `/ai/agent-runtime/work/claim` used to accept assigned `RECEIVED` work or expired `PROCESSING` work without a GPT02 recovery exclusion.

## Implemented safety barrier (DEV feature work)

- `submitCodingBridgeCommand` rejects recovery-marked metadata **before** DB lookups or worker notifications. Recovery issuer MUST NOT use this generic submission function.
- The generic claim SQL excludes recovery-marked commands **inside** `SELECT ... FOR UPDATE SKIP LOCKED`, including commands targeted explicitly by UUID. Null/false marker values still quarantine.
- Markers: `gpt02Recovery`, `gpt02RecoveryParentCommandId`, `recoveryParentCommandId`, `recovery_parent_command_id`, or `parentCommandId` when `capability=chatgpt:wake`.
- Claim logic for ordinary non-recovery commands, including existing continuity watches, remains unchanged.
- Unit tests include falsy-marker bypass and unrelated parent identifiers. Network-isolated PostgreSQL 16 test compiles the **exact Drizzle SQL fragment** from source, confirms recovery direct-target remains RECEIVED and ordinary target can become PROCESSING.

## Remaining blocker — never claim final PASS from this barrier

This is **marker quarantine**, not an unforgeable recovery parent-child relationship. A malicious or incorrectly issued child lacking mandatory markers could still be eligible for the generic queue. Before any recovery issuer is enabled, enforce canonical marker+parent identity server-side and bind the command atomically to `gpt02_dev_recovery_command_links`. Prefer an owner-controlled narrow DB verification function or a non-bypassable DB constraint for the generic claim path, without giving runtime broad SELECT. Recovery dispatch must require a server-verified, monotonically increasing fencing token validated by the native DELL worker and renewal/result endpoints. Signed native ACK/result and exclusion of untagged legacy attempts remain unresolved. All existing GPT02 recovery flags MUST stay OFF. No changes to PROD or running DELL worker in this PR.
