# Travelintrips DEV hostname route — security review required

**Status: RLS approved and applied to CST-DEV; application not yet released; E2E NOT PASS.**

## Scope
An isolated `openclaw-travelintrips-tools-dev` worker receives only the exact Agent-mode request `@cek hostname pc travelintrips`.
It must remain separate from `openclaw-travelintrips-dev`, the challenge-bound browser-wake worker.
There is no shell, Git mutation, production action, or general natural-language execution.
A separate Python consumer checks source, clientId, server-required capability, exact command, and hostname before posting a callback.

## Mandatory authorization gate
The DEV database RLS for `ai_platform.ai_coding_bridge_presence`, `ai_platform.ai_coding_bridge_commands`, and `ai_platform.ai_coding_bridge_responses` explicitly enumerates old worker IDs. Nine exact-worker policies were applied to CST-DEV on 2026-11-10 via Supabase migration `dev_travelintrips_tools_hostname_rls_20261110`. Existing browser-wake policies were preserved.

**RLS approval granted on 2026-11-10.** Deploy only to DEV using the authorized release workflow. Do not relax browser-wake preflight or add wildcard policies. This release also returns server-owned `source` in the claim response for worker origin verification.

## Validation completed
- 87 focused tests PASS; TypeScript API typecheck PASS.
- PC consumer Python self-test PASS: hostname `Travelintrips`; injected `; whoami` instruction rejected.
- Existing Travelintrips wake consumer remains running.
- New `AI Core Travelintrips Hostname DEV` Scheduled Task is installed but **disabled**.

## Post-approval E2E criteria
Deploy to DEV only; preserve unchanged PROD baseline. Enable the single new consumer. Verify ACTIVE heartbeat, an authenticated commandId, claimed job, persisted result responseId, final status COMPLETED and hostname Travelintrips. Without these, keep E2E NOT PASS.
