# AI Core worker stack

This stack adds durable execution services around the existing AI Core control plane:

```
AI Core
├── Model Router (existing AI Core routing)
│   ├── Ollama
│   ├── OpenAI
│   └── Gemini
├── Temporal
├── OpenHands
├── OpenClaw
└── n8n
```

The stack is intentionally isolated from AI Core production credentials. It does
not mount the Docker socket, Supabase service-role keys, `ADMIN_API_KEY`, or
production database credentials into agent containers.

## Trust boundaries

- **AI Core** remains the control plane, policy gate, model router, and owner of
  production approvals.
- **Temporal** provides durable workflow state, retries, and orchestration. Its
  gRPC port and UI bind to loopback only.
- **OpenHands** is the coding worker. It only sees
  `OPENHANDS_PROJECTS_PATH` (default `/opt/ai-workers/projects`) plus its own
  state volume.
- **OpenClaw** is an operations/agent gateway. Its UI/API binds to loopback and
  runs without the host Docker socket.
- **n8n** handles workflow automation with a dedicated Postgres database and
  persistent state.
- **Model routing** is not duplicated in Docker. AI Core already owns model
  routing to Ollama/OpenAI/Gemini.

All published ports use `127.0.0.1`. If a UI must be reachable remotely, put
an authenticated HTTPS reverse proxy in front of it instead of changing the
Compose bindings to `0.0.0.0).

## One-command bootstrap

Docker Engine and Docker Compose v2 must already be available on the target
host. Then run:

```bash
bash scripts/install-ai-workers.sh
```

The installer is idempotent. On every run it:

1. creates the protected environment file if it does not exist;
2. generates missing internal secrets without replacing existing values;
3. creates the OpenHands project workspace;
4. validates and pulls the pinned Compose stack;
5. starts Temporal, n8n, and OpenHands;
6. performs one-time OpenClaw onboarding when needed;
7. starts OpenClaw;
8. runs bounded health checks; and
9. prints `READY` only after every required service is healthy.

For a host-managed secret file:

```bash
AI_WORKERS_ENV_FILE=/etc/ai-core/ai-workers.env \
  bash scripts/install-ai-workers.sh
```

The installer never prints generated secrets.

## First deployment secrets

Copy `.env.example` to the protected environment file if you want to prepare
it manually. Internal database/API secrets may be left empty; the installer
will generate them. For first-time unattended OpenClaw onboarding, provide
`OPENAI_API_KEY` in the protected environment file.

OpenHands provider configuration is optional at boot. Configure
`OPENHANDS_LLM_MODEL`, `OPENHANDS_LLM_BASE_URL`, and
`OPENHANDS_LLM_API_KEY` only for the model path you explicitly want it to use.

`AI_CORE_SCOPED_AGENT_TOKEN` is deliberately separate from
`ADMIN_API_KEY`. Leave it empty until AI Core exposes a least-privilege service
token for the exact worker actions required. Do **not** substitute
`ADMIN_API_KEY`.

## Health checks

Run:

```bash
AI_WORKERS_ENV_FILE=/etc/ai-core/ai-workers.env \
  bash scripts/ai-workers-healthcheck.sh
```

Checks cover Temporal, Temporal UI, n8n, OpenHands, and OpenClaw. The script
exits non-zero if any required service is unhealthy.

Default local endpoints:

- Temporal UI: `http://127.0.0.1:8233`
- n8n: `http://127.0.0.1:5678`
- OpenHands: `http://127.0.0.1:8000/canvas`
- OpenClaw: `http://127.0.0.1:18789`

## GitHub Actions deployment

`.github/workflows/ai-workers-deploy.yml` provides a manual deployment path to
a VPS. Configure a protected GitHub Environment named `ai-workers-vps` with:

- `AI_WORKERS_SSH_HOST`
- `AI_WORKERS_SSH_USER`
- `AI_WORKERS_SSH_PRIVATE_KEY`
- `AI_WORKERS_SSH_KNOWN_HOSTS`
- optional `AI_WORKERS_ENV_B64` containing the full protected environment file
  encoded as base64

Optional repository/environment variables:

- `AI_WORKERS_DEPLOY_PATH` (default `/opt/core-ai-foundation`)
- `AI_WORKERS_REMOTE_ENV_FILE` (default `/etc/ai-core/ai-workers.env`)

The workflow deploys an exact Git commit, preserves named Docker volumes, runs
the idempotent installer, and finishes with the same health check.

## Production note

The current Temporal container uses the official `auto-setup` distribution for
a single-host bootstrap. This is suitable for bringing the durable worker stack
online without exposing it publicly. Before turning Temporal into a multi-node
or high-availability production cluster, migrate it to Temporal's production
server/schema-management deployment pattern.

Destructive production operations are intentionally outside this stack. Database
deletes, production shell access, deployments, and other high-risk actions
should continue to pass through AI Core's policy/approval gates rather than
being granted directly to OpenHands, OpenClaw, or n8n.
