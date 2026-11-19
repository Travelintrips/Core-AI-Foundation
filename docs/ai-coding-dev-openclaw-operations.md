# AI Coding DEV / OpenClaw operational verification

This runbook is for the standalone **DEV** workspace. It does not authorize PROD changes or bypass authentication.

## Observed facts

- AI Coding DEV runs on VPS localhost port 18188 (admin dashboard) and has a separate legacy task API on 18186.
- The dashboard's `jobs` queue is processed by `durable_worker.py`. The legacy `tasks` queue is not connected to that worker. Do not replay queued legacy tasks without reviewing payloads.
- The Python Docker coding-test path has passed an isolated worker-to-approval E2E test. It does **not** generate code automatically or open pull requests.
- On Windows `DESKTOP-CPS76BH`, `openclaw status` reported gateway reachable at `ws://127.0.0.1:18789`, gateway and node scheduled tasks running, **Host desktop: disabled**, and **Channels: No channels configured**. Those facts do not establish that AI Core can remotely drive the browser.

## Read-only checks on the authorized Windows machine

```powershell
openclaw status --deep
openclaw security audit
openclaw --help
```

Review outputs locally and redact tokens, session IDs and private paths before sharing.

## Configuration principles

1. Enable desktop/browser access only through the OpenClaw-supported configuration and authorized Windows user session, after inspecting supported settings and security audit results.
2. Keep the gateway bound to loopback or an authenticated private transport; never expose its token or unauthenticated control port.
3. Configure a verified command delivery route from AI Core to OpenClaw and validate with a harmless browser-open operation before allowing more actions.
4. Preserve authentication/MFA for admin actions; use expiring trusted sessions to reduce repeat prompts rather than disabling access controls.
5. Require explicit approval for PROD, secret access, irreversible deletion, privilege escalation, and external publication.
6. OpenClaw may execute authorized coding work delegated through AI Core, including source changes and tests, under the Resource-First, Human-Last SOP. Preserve stable job identity, scoped worker authorization, branch protections, CI evidence, and critical-action approval gates. A handshake alone does not authorize production mutation.

## Acceptance criteria

- OpenClaw status confirms gateway, node and supported desktop/browser capability enabled.
- A harmless command is delivered through the actual AI Core -> OpenClaw route and acknowledged with evidence from the PC.
- AI Coding DEV login with an existing authorized session opens the dashboard; fresh MFA is entered by the human if required.
- A DEV-only job is submitted through the authenticated dashboard, executed by the worker, tested in an isolated Docker environment, and reaches the approval gate.
- Unauthorized access, replayed approval, non-allowlisted repository and PROD mutation are rejected.
- No claim of autonomous code generation until a separate code-generation pipeline and PR E2E actually pass.

## Deployment note

This GitHub change is documentation and verification criteria only. The OpenClaw installation and AI Coding DEV app currently reside outside this repository. A GitHub PR cannot by itself change those machines; a reviewed deployment mechanism is required.
