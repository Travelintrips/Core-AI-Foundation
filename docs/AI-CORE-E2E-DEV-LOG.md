# AI Core DEV — OpenClaw — ChatGPT E2E Log

**Scope:** DEV only. **Status:** FAILED / not verified. **Last checked:** 2026-10-23.

> Public repository. Never add tokens, credentials, private configuration, personally identifying data, or raw sensitive logs. This is a session checkpoint, not continuous monitoring.

## Objective

Verify AI Core DEV → PC OpenClaw worker → authorized ChatGPT browser tab → exact ACK → callback → AI Core DEV records **COMPLETED** for the same command. Do not infer success from a browser connection alone.

## Verified observations

| Step | Result |
| --- | --- |
| Authenticated DEV command creation | PASS (HTTP 201) |
| DEV worker claims command | PASS |
| OpenClaw gateway available | PASS after restart |
| Chrome extension relay lists ChatGPT tabs | PASS |
| Duplicate authorized target tab | One duplicate closed |
| Exact ChatGPT ACK verified | NO |
| AI Core callback COMPLETED | NO — FAILED |

### Commands

- `30f955b7-2557-4758-a085-fe851b4ec2d1`: FAILED.
- `99538848-5d04-43a8-905a-2ba6a82cd453`: FAILED; latest response read from `GET /api/ai/core-chat/external-work/:id`.

Both failures reported:

```text
Action needs AI Core routing; no local model was invoked
```

Sanitized metadata: `reason=requires_ai_core_routing`, `mode=model-free`, `modelInvoked=false`, `verified=false`, `e2eCode=UNKNOWN_UNVERIFIED`.

**Important:** This proves the worker's reported result was unverified. It does **not** establish the underlying root cause. The generic `/ai/coding/bridge/responses` endpoint lists only unacknowledged responses, oldest first, max 100; use command-specific readback for evidence.

## Next investigation

1. Inspect the *running* PC bridge worker's instruction dispatch for `chatgpt_e2e_test` and compare with the intended browser handler. Confirm whether the handler is actually invoked.
2. Trace the origin of `requires_ai_core_routing` and whether fallback handling discards the original handler error.
3. Verify the authorized target ChatGPT tab is attached and unique.
4. Make only reviewed DEV-scoped changes, then submit a fresh uniquely identified test.
5. Read back the command-specific result. Record exact ACK, callback, status, and error. Mark PASS **only** if exact ACK and AI Core `COMPLETED` are both verified.

## Run template

```text
Date/time:
External command ID:
Internal command ID:
Worker claim:
Browser handler invoked:
Exact ACK observed:
Callback result:
Command-specific readback:
Fix / commit:
Result: PASS / FAILED / BLOCKED
Next action:
```

## Guardrails

No PROD changes. No secret logging. No bypass of authorization or approval. Do not manually mark `COMPLETED` to simulate success. This file must be updated after each test; it does not itself schedule automatic monitoring.
