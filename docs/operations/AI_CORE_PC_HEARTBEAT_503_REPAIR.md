# AI Core PC worker heartbeat 503 — repair and acceptance

## Objective
Restore reliable `openclaw-pc-worker` heartbeat to production AI Core, verify server registry ACTIVE, and only report completion after end-to-end tests pass.

## Confirmed observations (2026-10-09 WIB)
- Travelintrips PC scheduled tasks `AI Core OpenClaw PC Heartbeat` and `AI Core OpenClaw PC Work Consumer` were RUNNING.
- PC heartbeat POST to its configured AI Core endpoint intermittently returned HTTP 503 and sometimes HTTP 200.
- VPS `srv1792369` backend `http://127.0.0.1:18082/api/health` returned 200.
- `https://dev-aicore.cstlogistic.co.id/api/health` returned 200.
- `https://aicore.cstlogistic.co.id/api/health` repeatedly returned 503; production resolves through Hostinger infrastructure, not necessarily this DEV VPS.
- Production Verify GitHub workflow run 37835987619 was in progress at last check.
- OpenClaw model agent authentication 401 invalid_api_key is a **separate** problem.

## Required repair
1. Inspect production Hostinger app deployment status, upstream port, proxy route, origin logs, WAF and health checks. Avoid changing DNS blindly or routing production to DEV.
2. Fix actual production origin/proxy error, deploy through the authorized Hostinger production workflow.
3. Add resilient heartbeat diagnostics: log HTTP status and bounded retry/backoff, never log bearer tokens. Differentiate worker process, server presence lease and OpenClaw model readiness.
4. Check Windows task automatic restart and heartbeat cadence versus server lease expiry.

## Mandatory acceptance checks
- Production `/api/health` returns HTTP 200 on repeated checks over several minutes from PC and VPS.
- Authenticated PC heartbeat POST returns HTTP 200 on repeated checks.
- AI Core external-agent registry reports `openclaw-pc-worker` ACTIVE, healthy, eligible, and fresh `lastSeenAt`.
- A harmless real external-agent command is claimed and acknowledged by PC; its completion is independently confirmed by command progress.
- No secrets appear in logs, PRs or reports.
- Record exact CI run, deployment verification, and timestamps. Do not claim fixed before all applicable checks pass.

## Current verdict
**NOT FIXED** — production routing intermittently returns 503; root cause and final end-to-end verification remain open.
