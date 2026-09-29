#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
STACK_DIR="$REPO_ROOT/deploy/ai-workers"
COMPOSE_FILE="$STACK_DIR/docker-compose.yml"
ENV_FILE="${AI_WORKERS_ENV_FILE:-$STACK_DIR/.env}"

log() { printf '[ai-workers-health] %s\n' "$*"; }
fail() { printf '[ai-workers-health] ERROR: %s\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "Environment file not found: $ENV_FILE"
command -v curl >/dev/null 2>&1 || fail "curl is required for health checks"

env_value() {
  local key="$1"
  awk -v key="$key" '
    index($0, key "=") == 1 {
      value=substr($0, length(key)+2)
    }
    END { print value }
  ' "$ENV_FILE"
}

env_default() {
  local key="$1"
  local fallback="$2"
  local value
  value="$(env_value "$key")"
  printf '%s' "${value:-$fallback}"
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

wait_http() {
  local name="$1"
  local url="$2"
  local header_name="${3:-}"
  local header_value="${4:-}"
  local attempts="${AI_WORKERS_HEALTH_ATTEMPTS:-40}"
  local delay="${AI_WORKERS_HEALTH_DELAY_SECONDS:-3}"

  for attempt in $(seq 1 "$attempts"); do
    if [ -n "$header_name" ]; then
      if curl --fail --silent --show-error --max-time 5         -H "$header_name: $header_value" "$url" >/dev/null 2>&1; then
        log "$name=PASS"
        return 0
      fi
    elif curl --fail --silent --show-error --max-time 5 "$url" >/dev/null 2>&1; then
      log "$name=PASS"
      return 0
    fi

    if [ "$attempt" -lt "$attempts" ]; then
      sleep "$delay"
    fi
  done

  log "$name=FAIL url=$url"
  return 1
}

wait_temporal() {
  local attempts="${AI_WORKERS_HEALTH_ATTEMPTS:-40}"
  local delay="${AI_WORKERS_HEALTH_DELAY_SECONDS:-3}"

  for attempt in $(seq 1 "$attempts"); do
    if compose exec -T temporal       tctl --address 127.0.0.1:7233 cluster health >/dev/null 2>&1; then
      log "temporal=PASS"
      return 0
    fi
    if [ "$attempt" -lt "$attempts" ]; then
      sleep "$delay"
    fi
  done

  log "temporal=FAIL"
  return 1
}

temporal_ui_port="$(env_default TEMPORAL_UI_PORT 8233)"
n8n_port="$(env_default N8N_PORT 5678)"
openhands_port="$(env_default OPENHANDS_PORT 8000)"
openclaw_port="$(env_default OPENCLAW_PORT 18789)"
openhands_key="$(env_value OPENHANDS_LOCAL_BACKEND_API_KEY)"

status=0
wait_temporal || status=1
wait_http "temporal-ui" "http://127.0.0.1:${temporal_ui_port}/" || status=1
wait_http "n8n" "http://127.0.0.1:${n8n_port}/healthz" || status=1
wait_http "openhands" "http://127.0.0.1:${openhands_port}/server_info"   "X-Session-API-Key" "$openhands_key" || status=1
wait_http "openclaw" "http://127.0.0.1:${openclaw_port}/healthz" || status=1

if [ "$status" -ne 0 ]; then
  compose ps
  fail "One or more worker services are unhealthy."
fi

compose ps
log "stack=READY"
