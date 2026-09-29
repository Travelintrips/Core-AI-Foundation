#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
STACK_DIR="$REPO_ROOT/deploy/ai-workers"
COMPOSE_FILE="$STACK_DIR/docker-compose.yml"
ENV_TEMPLATE="$STACK_DIR/.env.example"
ENV_FILE="${AI_WORKERS_ENV_FILE:-$STACK_DIR/.env}"

log() { printf '[ai-workers] %s\n' "$*"; }
fail() { printf '[ai-workers] ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "Docker Engine is required. Install Docker, then rerun this same command."
command -v curl >/dev/null 2>&1 || fail "curl is required for bounded health checks."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required (docker compose)."

if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon is not reachable by the current user."
fi

[ -f "$COMPOSE_FILE" ] || fail "Missing $COMPOSE_FILE"
[ -f "$ENV_TEMPLATE" ] || fail "Missing $ENV_TEMPLATE"

if [ ! -f "$ENV_FILE" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  cp "$ENV_TEMPLATE" "$ENV_FILE"
  log "Created protected environment file: $ENV_FILE"
fi
chmod 600 "$ENV_FILE"

random_hex() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
    return
  fi
  od -An -N "$bytes" -tx1 /dev/urandom | tr -d ' \n'
}

env_value() {
  local key="$1"
  awk -v key="$key" '
    index($0, key "=") == 1 {
      value=substr($0, length(key)+2)
    }
    END { print value }
  ' "$ENV_FILE"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { found=0 }
    index($0, key "=") == 1 {
      if (!found) print key "=" value
      found=1
      next
    }
    { print }
    END {
      if (!found) print key "=" value
    }
  ' "$ENV_FILE" > "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
  chmod 600 "$ENV_FILE"
}

ensure_env_secret() {
  local key="$1"
  local bytes="${2:-32}"
  local current
  current="$(env_value "$key")"
  [ -n "$current" ] && return 0

  local value
  value="$(random_hex "$bytes")"
  set_env_value "$key" "$value"
  log "Generated $key"
}

ensure_env_secret TEMPORAL_POSTGRES_PASSWORD 32
ensure_env_secret N8N_POSTGRES_PASSWORD 32
ensure_env_secret N8N_ENCRYPTION_KEY 32
ensure_env_secret OPENHANDS_LOCAL_BACKEND_API_KEY 32
ensure_env_secret OPENCLAW_GATEWAY_TOKEN 32

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

log "Validating Compose configuration"
compose config --quiet

log "Pulling pinned worker images"
compose pull

projects_path="$(env_value OPENHANDS_PROJECTS_PATH)"
projects_path="${projects_path:-/opt/ai-workers/projects}"
projects_uid="$(env_value OPENHANDS_PROJECTS_UID)"
projects_gid="$(env_value OPENHANDS_PROJECTS_GID)"
openhands_version="$(env_value OPENHANDS_VERSION)"
openhands_version="${openhands_version:-1.24.0}"
openhands_image="ghcr.io/openhands/agent-canvas:${openhands_version}"

image_identity="$(docker run --rm --entrypoint sh "$openhands_image" -lc 'printf "%s:%s" "$(id -u)" "$(id -g)"')"
image_uid="${image_identity%%:*}"
image_gid="${image_identity##*:}"

if [ -z "$projects_uid" ] || [ -z "$projects_gid" ]; then
  projects_uid="$image_uid"
  projects_gid="$image_gid"
  set_env_value OPENHANDS_PROJECTS_UID "$projects_uid"
  set_env_value OPENHANDS_PROJECTS_GID "$projects_gid"
  log "Detected OpenHands workspace identity UID/GID $projects_uid:$projects_gid"
elif [ "$projects_uid:$projects_gid" = "1000:1000" ] && [ "$image_identity" != "1000:1000" ]; then
  projects_uid="$image_uid"
  projects_gid="$image_gid"
  set_env_value OPENHANDS_PROJECTS_UID "$projects_uid"
  set_env_value OPENHANDS_PROJECTS_GID "$projects_gid"
  log "Migrated legacy OpenHands workspace identity to $projects_uid:$projects_gid"
fi

if [ ! -e "$projects_path" ]; then
  mkdir -p "$projects_path"
  chown "$projects_uid:$projects_gid" "$projects_path"
  chmod 770 "$projects_path"
  log "Created OpenHands workspace: $projects_path"
elif [ ! -d "$projects_path" ]; then
  fail "OPENHANDS_PROJECTS_PATH is not a directory: $projects_path"
elif [ -z "$(find "$projects_path" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  current_owner="$(stat -c '%u:%g' "$projects_path")"
  if [ "$current_owner" != "$projects_uid:$projects_gid" ]; then
    chown "$projects_uid:$projects_gid" "$projects_path"
    chmod 770 "$projects_path"
    log "Repaired empty OpenHands workspace ownership"
  fi
fi

if ! compose run -T --rm --no-deps --entrypoint sh openhands -lc 'test -w /projects'; then
  fail "OpenHands cannot write $projects_path. Grant UID/GID $projects_uid:$projects_gid write access or change OPENHANDS_PROJECTS_PATH."
fi

log "Starting Temporal, n8n, and OpenHands"
compose up -d --remove-orphans \
  temporal-db temporal-admin-tools temporal temporal-create-namespace temporal-ui \
  n8n-db n8n openhands

openclaw_initialized=false
openclaw_provider_mode=unconfigured
if compose run -T --rm --no-deps --entrypoint sh openclaw -lc \
  'test -s /home/node/.openclaw/openclaw.json' >/dev/null 2>&1; then
  openclaw_initialized=true
  openclaw_provider_mode=configured
fi

if [ "$openclaw_initialized" != "true" ]; then
  openai_key="$(env_value OPENAI_API_KEY)"
  if [ -n "$openai_key" ]; then
    log "Running one-time OpenClaw non-interactive onboarding"
    compose run -T --rm --no-deps --entrypoint node openclaw \
      dist/index.js onboard \
      --non-interactive \
      --accept-risk \
      --skip-health \
      --mode local \
      --auth-choice openai-api-key \
      --secret-input-mode ref \
      --gateway-auth token \
      --gateway-token-ref-env OPENCLAW_GATEWAY_TOKEN \
      --skip-channels \
      --no-install-daemon

    log "Applying OpenClaw gateway policy"
    openclaw_port="$(env_value OPENCLAW_PORT)"
    openclaw_port="${openclaw_port:-18789}"
    openclaw_policy="$(printf '[{"path":"gateway.mode","value":"local"},{"path":"gateway.bind","value":"lan"},{"path":"gateway.controlUi.allowedOrigins","value":["http://localhost:%s","http://127.0.0.1:%s"]}]' "$openclaw_port" "$openclaw_port")"
    compose run -T --rm --no-deps --entrypoint node openclaw \
      dist/index.js config set --batch-json "$openclaw_policy"
    openclaw_provider_mode=configured
  else
    log "OPENAI_API_KEY not present; starting OpenClaw gateway in provider-unconfigured mode"
  fi
fi

log "Starting OpenClaw"
compose up -d openclaw

log "Running bounded health checks"
AI_WORKERS_ENV_FILE="$ENV_FILE" bash "$SCRIPT_DIR/ai-workers-healthcheck.sh"

cat <<EOF

AI worker stack: READY

Loopback endpoints:
  Temporal UI : http://127.0.0.1:$(env_value TEMPORAL_UI_PORT)
  n8n         : http://127.0.0.1:$(env_value N8N_PORT)
  OpenHands   : http://127.0.0.1:$(env_value OPENHANDS_PORT)/canvas
  OpenClaw    : http://127.0.0.1:$(env_value OPENCLAW_PORT)

Environment: $ENV_FILE
Projects:    $projects_path
OpenClaw provider mode: $openclaw_provider_mode

No Docker socket, AI Core ADMIN_API_KEY, Supabase service key, or production
database credential is mounted into these agent containers by this stack.
EOF
