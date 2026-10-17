# ChatGPT - AI Core - OpenClaw Z Fold4 cyclic handshake (DEV)

Status: design contract, not live deployment. Issue #1290. PR #1291.

## Intended cycle
1. ChatGPT sends authenticated handshake with session/job correlation ID, last known event ID, capabilities, and current state to AI Core.
2. AI Core returns a **routine job SOP** and authorized, DEV-scoped dispatch plan; this is separate from blocker-only recovery SOP.
3. AI Core dispatches to an explicitly paired Z Fold4 device through the DEV Android Bridge. The bridge MUST NOT assign untagged jobs or bypass pairing.
4. Z Fold4 claims the assigned job, executes only approved actions, and posts a signed result event.
5. AI Core validates event signature, identity, idempotency, job state, evidence, and callback receipt. Receipt/ACK is not equivalent to verified completion.
6. ChatGPT reads the verified result, reports its own next action/status to AI Core, and receives the next SOP/job continuation. Repeat until COMPLETED, CANCELLED, or HUMAN_APPROVAL_REQUIRED.

## Safety and operational invariants
- No direct coding command from ChatGPT to AI Core; source edits through GitHub.
- DEV first. PROD unchanged until explicit promotion gates PASS.
- Retry at most 3 times with bounded backoff; idempotency keyed by session + job + event; replay-safe resume after reconnect.
- Routine SOP on handshake; blocker SOP only on actual blocker; connector recovery SOP only on disconnect/auth failure.
- Never silently reauthorize OAuth, bypass device permissions, or perform destructive actions without approval.
- Keep evidence for claim, execution, result, callback, ACK, and ChatGPT continuation separately.

## Existing code inspected
- `artifacts/api-server/src/services/aiCoreAutonomousJobProtocolService.ts`: commands, result schema and transitions.
- `artifacts/api-server/src/services/aiCoreAutonomousJobCoordinatorService.ts`: storage-neutral coordinator; requires durable store.
- `android-bridge/dev-receiver/job-dispatcher.mjs`: DEV-only queued job grants to paired devices.
- `android-bridge/dev-receiver/server.mjs`: signed result intake, currently RECEIVED_UNVERIFIED.

## Required implementation and E2E gates
- Add authenticated handshake/session continuation API with durable cursor, policy version and routine SOP response.
- Connect dispatch to the existing DEV-only paired-device grant mechanism and persist claim/lease.
- Add trusted receipt consumer that verifies device result and commits job transition; report verified callback and ACK to ChatGPT.
- Test normal handshake -> SOP -> Z Fold4 claim -> tap/type/scroll -> result -> verification -> ChatGPT report -> next job; test reconnect, duplicate events, offline device, expired token, OAuth human approval, and forbidden PROD scope.
- No merge or PROD deploy until tests and physical-device evidence PASS.
