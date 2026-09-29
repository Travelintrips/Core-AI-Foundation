#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
STACK_DIR="$REPO_ROOT/deploy/ai-workers"
COMPOSE_FILE="$STACK_DIR/docker-compose.yml"
ENV_FILE="${AI_WORKERS_ENV_FILE:-/etc/ai-core/ai-workers.env}"
MODE="${1:-verify}"

log() { printf '[ai-workers-connect] %s\n' "$*"; }
fail() { printf '[ai-workers-connect] ERROR: %s\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "Missing $ENV_FILE"
command -v docker >/dev/null 2>&1 || fail "Docker is required"
command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v openssl >/dev/null 2>&1 || fail "openssl is required"

env_value() {
  local key="$1"
  awk -v key="$key" 'index($0,key"=")==1 {v=substr($0,length(key)+2)} END{print v}' "$ENV_FILE"
}

set_env_value() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN{found=0}
    index($0,key"=")==1 {if(!found) print key"="value; found=1; next}
    {print}
    END{if(!found) print key"="value}
  ' "$ENV_FILE" > "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
  chmod 600 "$ENV_FILE"
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

agent_http_code() {
  local token="$1" output="$2" url="$3" cfg code rc
  cfg="$(mktemp)"
  chmod 600 "$cfg"
  printf 'header = "x-ai-agent-token: %s"\n' "$token" > "$cfg"
  set +e
  code="$(curl --config "$cfg" -sS -o "$output" -w '%{http_code}' \
    --connect-timeout 15 --max-time 30 "$url")"
  rc=$?
  set -e
  rm -f "$cfg"
  if [ "$rc" -ne 0 ]; then
    printf '000'
  else
    printf '%s' "$code"
  fi
}

prepare() {
  local rotate="${1:-false}" token token_hash
  token="$(env_value AI_CORE_SCOPED_AGENT_TOKEN)"
  if [ "$rotate" = "true" ]; then
    token=""
  fi
  if [ -z "$token" ]; then
    token="$(openssl rand -hex 32)"
    set_env_value AI_CORE_SCOPED_AGENT_TOKEN "$token"
    if [ "$rotate" = "true" ]; then log "Rotated scoped AI Core agent token"; else log "Generated scoped AI Core agent token"; fi
  fi

  set_env_value OPENHANDS_LLM_API_KEY "$token"
  set_env_value OPENHANDS_LLM_BASE_URL "https://aicore.cstlogistic.co.id/api/ai/agent-runtime/v1"
  set_env_value OPENHANDS_LLM_MODEL "openai/ai-core-agent"

  token_hash="$(printf '%s' "$token" | sha256sum | awk '{print $1}')"
  printf 'token_hash=%s\n' "$token_hash"
  printf 'token_value=REDACTED\n'
  printf 'openhands_model=%s\n' "$(env_value OPENHANDS_LLM_MODEL)"
  printf 'openhands_base_url=%s\n' "$(env_value OPENHANDS_LLM_BASE_URL)"
}

configure_openclaw() {
  local provider_json models_json
  provider_json='{"baseUrl":"https://aicore.cstlogistic.co.id/api/ai/agent-runtime/v1","api":"openai-completions","authHeader":true,"models":[{"id":"ai-core-agent","name":"AI Core Agent","reasoning":false,"input":["text"],"contextWindow":128000,"maxTokens":8192}]}'
  models_json='{"ai-core/ai-core-agent":{"alias":"AI Core"}}'

  compose run -T --rm --no-deps --entrypoint node openclaw     dist/index.js config set models.providers.ai-core "$provider_json" --strict-json --merge
  compose run -T --rm --no-deps --entrypoint node openclaw     dist/index.js config set models.providers.ai-core.apiKey     --ref-provider default --ref-source env --ref-id AI_CORE_SCOPED_AGENT_TOKEN
  compose run -T --rm --no-deps --entrypoint node openclaw     dist/index.js config set agents.defaults.models "$models_json" --strict-json --merge
  compose run -T --rm --no-deps --entrypoint node openclaw     dist/index.js config set agents.defaults.model.primary '"ai-core/ai-core-agent"' --strict-json
}

# Verification never prepares/rotates tokens, sets configuration, or restarts
# containers. It does create one diagnostic gateway conversation and may consume
# a small number of model tokens. No delivery channel is selected.
verify() {
  local smoke_timeout="${AI_WORKERS_SMOKE_TIMEOUT_SECONDS:-60}"
  local smoke_session
  command -v timeout >/dev/null 2>&1 || fail "GNU timeout is required for bounded model verification"
  if [[ ! "$smoke_timeout" =~ ^[0-9]{1,3}$ ]]; then
    fail "AI_WORKERS_SMOKE_TIMEOUT_SECONDS must be an integer from 5 to 120"
  fi
  smoke_timeout=$((10#$smoke_timeout))
  if (( smoke_timeout < 5 || smoke_timeout > 120 )); then
    fail "AI_WORKERS_SMOKE_TIMEOUT_SECONDS must be an integer from 5 to 120"
  fi

  AI_WORKERS_ENV_FILE="$ENV_FILE" bash "$SCRIPT_DIR/ai-workers-healthcheck.sh" || \
    fail "Worker endpoint health failed; gateway model smoke was not run"
  compose exec -T openclaw node dist/index.js config validate >/dev/null 2>&1 || \
    fail "OpenClaw configuration validation failed"

  smoke_session="aicore-verify-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"
  # Execute through the running gateway, not a fresh compose-run container or
  # the host token. This detects host-health PASS / gateway-auth 401 mismatches.
  # Discard provider output: it may contain sensitive diagnostic information.
  if ! timeout --signal=TERM --kill-after=5s "$((smoke_timeout + 15))s" \
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
    exec -T openclaw node dist/index.js agent \
    --agent main --session-id "$smoke_session" \
    --message 'Connectivity check only. Reply exactly AICORE_SMOKE_OK. Do not use tools.' \
    --thinking off --timeout "$smoke_timeout" --json >/dev/null 2>&1; then
    fail "OpenClaw gateway model smoke failed. Endpoint health alone does not verify model execution. No configuration was changed by verify."
  fi

  log "openclaw-gateway-model=PASS"
  log "openhands=HEALTH_ONLY; coding task execution not verified"
  log "n8n=HEALTH_ONLY; workflow execution not verified"
  log "temporal=HEALTH_ONLY; application workflow execution not verified"
  log "worker registration, heartbeat and commit/deploy automation not verified"
}

apply() {
  local token api_base health_code models_code
  token="$(env_value AI_CORE_SCOPED_AGENT_TOKEN)"
  [ -n "$token" ] || fail "AI_CORE_SCOPED_AGENT_TOKEN is empty; run prepare first"
  api_base="$(env_value AI_CORE_BASE_URL)"
  api_base="${api_base:-https://aicore.cstlogistic.co.id/api}"

  health_code="$(agent_http_code "$token" /tmp/ai-agent-health.json "$api_base/ai/agent-runtime/health")"
  cat /tmp/ai-agent-health.json 2>/dev/null || true
  [ "$health_code" = "200" ] || fail "AI Core agent runtime health failed HTTP $health_code"

  models_code="$(agent_http_code "$token" /tmp/ai-agent-models.json "$api_base/ai/agent-runtime/v1/models")"
  cat /tmp/ai-agent-models.json 2>/dev/null || true
  [ "$models_code" = "200" ] || fail "AI Core agent runtime models failed HTTP $models_code"

  configure_openclaw

  compose up -d openhands openclaw n8n

  compose exec -T openhands sh -lc '
    test "$LLM_MODEL" = "openai/ai-core-agent" &&
    test "$LLM_BASE_URL" = "https://aicore.cstlogistic.co.id/api/ai/agent-runtime/v1" &&
    test -n "$LLM_API_KEY" &&
    test -n "$AI_CORE_SCOPED_AGENT_TOKEN"
  '

  compose exec -T openclaw sh -lc 'test -n "$AI_CORE_SCOPED_AGENT_TOKEN"'
  compose exec -T n8n sh -lc 'test -n "$AI_CORE_SCOPED_AGENT_TOKEN"'

  compose run -T --rm --no-deps --entrypoint node openclaw     dist/index.js models list 2>/dev/null | grep -q 'ai-core/ai-core-agent'

  verify
}

case "$MODE" in
  prepare) prepare false ;;
  rotate) prepare true ;;
  apply) apply ;;
  verify) verify ;;
  *)
    fail "Usage: $0 [prepare|rotate|apply|verify]"
    ;;
esac
