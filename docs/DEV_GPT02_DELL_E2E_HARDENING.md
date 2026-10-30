# GPT02 DELL DEV — E2E hardening

Scope: AI Core DEV only (dev.cstlogistic.co.id / Supabase xssrfshdrtdfupgqwfdw). No PROD changes.

## Tracked runtime source

- scripts/dev/dell-wake-executor.mjs — fail-closed worker, lease, receipt delivery.
- scripts/windows/ai-core/dev-chatgpt-wake-once.py and dev_chatgpt_native_transport.py — bound native ChatGPT send and attestation.
- scripts/windows/ai-core/dev-chatgpt-ax-identity-readonly.js, dev-chatgpt-cdp-reader-navigate.js and dev-chatgpt-cdp-snapshot.js — exact Chromium/CDP identity checks for gpt02-dell-dev.
- scripts/dev/sql/20261031_gpt02_final_callback_dev.sql — reviewed DEV-only projection of a server-verified terminal attestation into Final Callback.

Never commit the per-device allowlist, browser profile, OAuth tokens, session cookies, private keys, receipts, logs or event-specific signatures.

## Restart and deploy runbook

1. Query DEV for zero RECEIVED or PROCESSING commands assigned to openclaw-dell-chatgpt-wake-dev; ensure no live Python helper. Reconcile existing incident markers before proceeding.
2. Stop ONLY scheduled task AI Core DELL Wake Executor DEV, make restricted backups of live scripts, and deploy reviewed files to %LOCALAPPDATA%\AI-Core with the expected exact filenames. Do not replace account bindings or secrets.
3. Run node --check for the executor and 3 CDP adapters, and python -m py_compile for the Python helpers. Confirm the current bound conversation ID is registered in DEV and accessible in exactly one gpt02-dell-dev tab (port 18803).
4. On Supabase DEV only, review and apply the SQL file if its trigger is absent; never run it automatically in PROD. Confirm RLS/role permissions remain in place and trigger enabled.
5. Start one executor. Check exactly one worker, no helper or incident marker, no unclaimed historical work.
6. Submit exactly one NEW official DEV test command with unique correlation ID; never replay an outcome-unknown command. Require one ACK, one COMPLETED response, E2E_VERIFIED, DELIVERY_CONFIRMED, and exactly one automatically created Final Callback linked by command_id.
7. When helper has ended and reader marker is CAPTURE_VERIFIED, close only its exact reader target, retaining the original conversation tab.

## Verified evidence

31 October 2026 WIB: command 3188bf51-3933-4701-b448-1e02c3c091c4 returned COMPLETED / E2E_VERIFIED / DELIVERY_CONFIRMED, one ACK, one verified terminal response and one automatically recorded Final Callback. Post-check: one DELL executor, zero Python helpers, zero pending commands, one GPT02 tab, zero blank reader tabs, no incident.

That is proof for this DEV test only; future restart and deployment must be reverified. Do not synthesize attestation, relax binding checks, or promote to PROD based solely on this result.

## Local regression

- Python: python -m unittest discover -s scripts/windows/ai-core -p test_dev_chatgpt_*.py -q
- Node: node scripts/dev/test-dell-wake-executor.mjs
- Syntax: node --check on executor and 3 CDP adapters.
- SQL: verify trigger status, RLS, and Final Callback count with read-only queries. Avoid manual insertion of test callback rows.
