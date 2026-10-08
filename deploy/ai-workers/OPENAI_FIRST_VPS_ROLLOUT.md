# OpenAI-first AI Core + OpenClaw VPS rollout

## Goal
Use the existing AI Core conversational engine as the **primary brain** for AI Core Chat and WhatsApp, and use OpenClaw only as a bounded execution worker. This is *not* an attempt to impersonate or inject messages into an existing chatgpt.com session.

## Existing paths (do not duplicate them)
- Dashboard: `artifacts/ai-platform/src/pages/ai-core-chat.tsx`
- Chat/router: `artifacts/api-server/src/routes/ai-core-chat.ts`
- Incoming WhatsApp: `artifacts/api-server/src/routes/coding-whatsapp-webhook.ts`
- WA reply/model: `artifacts/api-server/src/services/aiCoreWhatsappChatService.ts`
- Worker: `deploy/ai-workers/openclaw-supervisor.mjs`
- Worker Compose: `deploy/ai-workers/docker-compose.yml`
- Host installer: `scripts/install-ai-workers.sh`
- Deployment workflow: `.github/workflows/ai-workers-deploy.yml`

## Rollout gates
1. Keep existing `/opt/cst-wa-gateway`, its Docker compose project, databases, Redis, and devices unchanged.
2. Establish a separate worker environment file with mode `0600`; never put API credentials in git or logs.
3. Ensure the canonical `gcp-openclaw-main` client ID has **exactly one** active executor. Existing code hardcodes that registration/dispatch identity; do **not** launch a second copy on VPS while GCP is active. A future multi-host registration change requires coordinated changes to the AI Core allowlist, registrar, compose and supervisor.
4. Run `AI_WORKERS_ENV_FILE=/etc/ai-core/ai-workers.env bash scripts/preflight-openclaw-vps.sh` on the selected VPS. This check is read-only.
5. Use the existing `ai-workers-vps` GitHub Environment secrets, protected SSH known_hosts, and manual `AI Workers VPS Deploy` workflow, **only when the intended executor host is confirmed**.
6. Run `AI_WORKERS_ENV_FILE=/etc/ai-core/ai-workers.env bash scripts/ai-workers-healthcheck.sh` and verify the agent bridge and one explicitly authorized, harmless task.
7. Test dashboard -> AI Core -> OpenClaw -> AI Core task result, then a WhatsApp inbound/reply loop with an **allowlisted** test sender. Record delivery acknowledgements and review logs for credential leakage and loops.
8. Require approval gates for prod deployments, financial changes, destructive actions, and outbound WhatsApp messages. No silent approval.

## Do not confuse identities
The OpenAI Responses API can power the same *model family* in dashboard and WhatsApp, but it does **not** import the private history/session of this ChatGPT conversation. Persist AI Core conversations in its own approved database; do not claim that a ChatGPT conversation is automatically synchronized.

## Rollback
Stop only the separate AI workers Compose project, preserving volumes and the WA Gateway project. Revert the worker deployment by exact commit; do not `docker system prune`, `docker compose down -v`, or restart unrelated containers.

## Acceptance
- PC offline while a permitted dashboard task completes.
- WA Gateway remains connected and existing messages continue delivering.
- Allowed WhatsApp sender can issue a test request and get an attributable reply.
- Non-allowed sender and destructive command cannot invoke an agent job.
- Dashboard shows a durable job identifier, state, and final outcome.
- OpenClaw gateway is not publicly exposed without authenticated reverse proxy.
