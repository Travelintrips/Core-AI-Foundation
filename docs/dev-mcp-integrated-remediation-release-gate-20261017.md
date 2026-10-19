# AI Core MCP DEV — integrated remediation and release gate
Issue #1318 / PR #1319. DEV only.

## Verified baseline
- DEV image core-ai-dev:vps-6860fe0e3d7f healthy.
- OAuth, handshake, subscription, event read PASS. OAuth principal channel does not verify browser conversation ACK.
- Internal connector key configured; previous upstream 401 resolved. Provider NO_LLM is a separate issue.
- send_ai_core_command failed 503; precise failing query still unverified. Startup logs identify ai_jobs, ai_workers, ai_settings, design_render_items access denials and index ownership error; not proven to cause the command 503.
- Runtime role aicore_dev_runtime, RLS enabled. SELECT only on ai_coding_tasks, ai_coding_runs, ai_jobs and coding bridge commands/responses. ai_coding_bridge_presence has S/I/U. No privileges on ai_workers, ai_settings, design_render_items.
- Current task/run UPDATE RLS policies are unrestricted true predicates, though actual UPDATE privilege absent. Never grant UPDATE until these policies are replaced.

## One coordinated implementation / DEV release
1. Add correlation IDs and sanitized SQLSTATE and relation identifiers to /ai/core-chat/messages logs to find the FIRST failing SQL (never expose SQL parameters/secrets).
2. Verify OAuth subject/client/scopes at MCP; propagate a short-lived signed service assertion downstream. Never trust client conversationId for ownership.
3. Introduce ownership/provenance association for coding tasks and runs and separate authorized worker identity for task completion; plan legacy-row handling.
4. Replace permissive RLS UPDATE policy and add narrowly scoped INSERT/UPDATE grants together atomically, only once server identity checks are present. Never BYPASSRLS or blanket schema grants.
5. Move CREATE INDEX and schema DDL to owner-run migrations; separately assess ai_jobs, ai_workers, ai_settings and design_render_items startup operations for least privilege or disable DEV-unneeded startup jobs.
6. Verify durable terminal event producer maps server-derived OAuth channel and read/ack transaction-local context; ensure cross-principal denial and no duplicate ACK.
7. Explicitly distinguish verified MCP OAuth channel ACK from browser ChatGPT session callback. Never report verified browser callback without client proof.
8. Test a deterministic bounded DEV transport event not dependent on provider LLM; diagnose OpenAI API key NO_LLM separately.

## Release acceptance
- CI PASS including scoped RLS negative tests and identity signature tests, DEV-only migration dry-run / rollback.
- Subject A can create own task, B cannot read/update/ACK A's tasks, invalid scope and non-DEV branch denied; worker can close assigned task.
- Exactly one real DEV terminal responseId returned by MCP event read, ACK recorded, re-read no duplicate; cross-principal ACK denied.
- DEV deployment SHA and health PASS, no changes to PROD.
- Do not merge this draft PR or claim FULL E2E PASS until implementation and proof are complete.