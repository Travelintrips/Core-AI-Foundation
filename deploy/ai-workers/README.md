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
  state volume. The installer detects the UID/GID of the pinned Agent Canvas
  image and applies it only when creating a new workspace or repairing an empty
  legacy workspace; an existing non-empty directory is never recursively re-owned.
- **OpenClaw** is an operations/agent gateway. Its UI/API binds to loopback and
  runs without the host Docker socket. The OpenClaw supervisor also polls AI
  Core's scoped work queue and executes only work explicitly assigned to
  `gcp-openclaw-main`; production-critical actions remain owned by AI Core.
- **n8n** handles workflow automation with a dedicated Postgres database and
  persistent state.
- **Model routing** is not duplicated in Docker. AI Core already owns model
  routing to Ollama/OpenAI/Gemini.

All published ports use `127.0.0.1`. If a UI must be reachable remotely, put
an authenticated HTTPS reverse proxy in front of it instead of changing the
Compose bindings to `0.0.0.0`.

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
5. initializes Temporal PostgreSQL schemas and the default namespace;
6. starts Temporal, n8n, and OpenHands;
7. generates a dedicated `AI_CORE_SCOPED_AGENT_TOKEN` when it is missing;
8. configures OpenHands and OpenClaw to use the scoped AI Core agent runtime;
9. starts the OpenClaw gateway with the AI Core bounded-work dispatcher;
10. falls back to direct OpenClaw provider onboarding only when no scoped runtime is available;
11. runs bounded local and AI Core bridge health checks; and
12. prints `READY` only after every required service endpoint is healthy.

For a host-managed secret file:

```bash
AI_WORKERS_ENV_FILE=/etc/ai-core/ai-workers.env \
  bash scripts/install-ai-workers.sh
```

The installer never prints generated secrets.

## First deployment secrets

Copy `.env.example` to the protected environment file if you want to prepare
it manually. Internal database/API secrets may be left empty; the installer
will generate them.

`AI_CORE_SCOPED_AGENT_TOKEN` is deliberately separate from `ADMIN_API_KEY`.
When empty, the installer generates a dedicated random token and never prints
it. AI Core stores only its SHA-256 hash and authorizes explicit scopes
`model:chat`, `agent:presence`, and `agent:work`. Presence is restricted to
the canonical OpenClaw/OpenHands/n8n registry IDs. `agent:work` only lets a
registered worker claim work already assigned to its own canonical client ID;
it does not grant production deploy, merge, production credentials, or a
general-purpose AI Core admin API. Do
**not** substitute `ADMIN_API_KEY`.

When the scoped token is present, OpenHands is configured automatically with
`openai/ai-core-agent` and an AI Core OpenAI-compatible base URL. OpenClaw gets
a custom `ai-core/ai-core-agent` provider whose API key is an environment
reference to the same scoped token. Provider credentials such as OpenAI and
Gemini keys stay inside AI Core production and are not mounted into the worker
containers.

If the scoped route is deliberately disabled, direct OpenClaw provider
onboarding remains available as a compatibility fallback. The gateway still
binds only to loopback on the host.

## Health checks

Run:

```bash
AI_WORKERS_ENV_FILE=/etc/ai-core/ai-workers.env \
  bash scripts/ai-workers-healthcheck.sh
```

Checks cover Temporal, Temporal UI, n8n, OpenHands, and OpenClaw. When a scoped
agent token is configured, the script also verifies the authenticated AI Core
agent-runtime bridge without spending model tokens. The script exits non-zero
if any required service endpoint is unhealthy.

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

Temporal uses the supported `temporalio/server` image with
`temporalio/admin-tools` for PostgreSQL schema initialization and namespace
creation. The database network is internal and the gRPC/UI ports remain
loopback-only. This single-host Compose topology is suitable for the worker
control plane, but a multi-node or high-availability deployment should move to
Temporal's production clustering patterns.

Destructive production operations are intentionally outside this stack.
Database deletes, production shell access, deployments, and other high-risk
actions should continue to pass through AI Core's policy/approval gates rather
than being granted directly to OpenHands, OpenClaw, or n8n.
