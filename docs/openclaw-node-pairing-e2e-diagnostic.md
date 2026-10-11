# OpenClaw node pairing and E2E diagnostic (DEV)

This document describes an observed integration failure and a bounded repair path. It does not enable desktop access by itself.

## Evidence (2026-10-12)

- Windows host: `DESKTOP-CPS76BH`. `openclaw node status` reported a registered, running Windows Scheduled Task configured with `node run --host docker.cstlogistic.co.id --port 443 --tls --context-path /aicore-dell-pair-20261009/bridge --display-name dell-latitude-7400 --commands browser.proxy,ollama.chat,ollama.models`.
- The local Windows OpenClaw gateway is `ws://127.0.0.1:18789`; `openclaw nodes status` returned `Known: 0 · Paired: 0 · Connected: 0`; `openclaw nodes pending` returned no pending requests. **This local gateway is not the remote gateway to which the Windows node service is configured to connect.** Do not use local `nodes status` as evidence about remote pairing.
- Local managed Chrome browser was independently verified: `openclaw browser open https://example.com`, `openclaw browser snapshot --format aria --limit 30`, `openclaw browser close t4` succeeded.
- AI Core routed operational jobs to `openclaw-pc-worker-2`. One remote worker run opened and closed a browser test tab with seven tool calls and zero failures, but reported `deliveryCode=UNKNOWN_UNVERIFIED`, `e2eCode=UNKNOWN_UNVERIFIED` and `sourceReplyDeliveryState=missing`.
- A request to target `DESKTOP-CPS76BH` failed because the worker found no paired node with that **name**. The actual local node identity reported by `openclaw node identity` is `861a4b881ca65d710ce349be65770176f3565277b53800e6bbb8b6e0afae294d`. Do not assume the hostname is a gateway node identifier.
- Another remote run failed with no connected nodes. A restart was attempted, but post-restart connectivity was not verified.

## Repair workflow

1. Inspect the **remote gateway** at `docker.cstlogistic.co.id` using its authorized admin access. List `nodes pending`, `nodes status`, `nodes describe` and gateway logs there, not on the unrelated local gateway. Confirm TLS, context path and gateway identity match the Windows service. Never print gateway tokens.
2. If a pairing request for the exact Windows device identity exists, approve only that request using the authorized gateway operator; otherwise inspect Windows node service logs and remote gateway authentication errors before re-pairing. Do not broadly auto-approve devices.
3. Confirm the remote gateway lists the Windows device ID as **connected** and advertises `browser.proxy`. Use the gateway's actual node ID, not `DESKTOP-CPS76BH`, when invoking it.
4. Execute a harmless browser-open/read-title/close operation **through the remote gateway to the Windows node**. Independently verify on the Windows PC. Keep the local browser test separate from the remote-node test.
5. Validate AI Core's response callback/delivery pipeline separately: `JOB_COMPLETED` alone is insufficient. Require a terminal success response, concrete tool evidence, and verified delivery/e2e codes before declaring full E2E PASS.
6. Preserve least-privilege command allowlist (`browser.proxy,ollama.chat,ollama.models`) and existing authentication. Do not enable unrestricted desktop execution, modify PROD, or delegate coding to AI Core/OpenClaw.

## Machine-readable acceptance checklist

| Check | Required result |
| --- | --- |
| Windows node service | Running and connected to intended remote gateway |
| Remote gateway pairing | Exact device identity paired, connected, browser.proxy present |
| Remote node browser action | Open/read/close succeeds with PC-side evidence |
| AI Core work queue | Routed to expected worker with no tool errors |
| Callback | Delivery verified; source reply present |
| E2E | Verified PASS rather than UNKNOWN_UNVERIFIED |

This repository does not contain the deployed OpenClaw gateway or Windows node service configuration; merging documentation cannot itself repair those running services.
