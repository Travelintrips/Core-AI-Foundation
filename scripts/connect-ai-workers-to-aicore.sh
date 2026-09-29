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
  provider_json='{"baseUrl":"https://aicore.cstlogistic.co.id/api/ai/agent-runtime/v1","api":"openai-completions","models":[{"id":"ai-core-agent","name":"AI Core Agent","reasoning":false,"input":["text"],"contextWindow":128000,"maxTokens":8192}]}'
  models_json='{"ai-core/ai-core-agent":{"alias":"AI Core"}}'

  compose run -T --rm --no-deps --entrypoint node openclaw     dist/index.js config set models.providers.ai-core "$provider_json" --strict-json --merge
  compose run -T --rm --no-deps --entrypoint node openclaw     dist/index.js config set models.providers.ai-core.apiKey     --ref-provider default --ref-source env --ref-id AI_CORE_SCOPED_AGENT_TOKEN
  compose run -T --rm --no-deps --entrypoint node openclaw     dist/index.js config set agents.defaults.models "$models_json" --strict-json --merge
  compose run -T --rm --no-deps --entrypoint node openclaw     dist/index.js config set agents.defaults.model.primary '"ai-core/ai-core-agent"' --strict-json
}

apply() {
  local token api_base health_code models_code
  token="$(env_value AI_CORE_SCOPED_AGENT_TOKEN)"
  [ -n "$token" ] || fail "AI_CORE_SCOPED_AGENT_TOKEN is empty; run prepare first"
  api_base="$(env_value AI_CORE_BASE_URL)"
  api_base="${api_base:-https://aicore.cstlogistic.co.id/api}"

  health_code="$(curl -sS -o /tmp/ai-agent-health.json -w '%{http_code}'     --connect-timeout 15 --max-time 30     -H "x-ai-agent-token: $token"     "$api_base/ai/agent-runtime/health" || true)"
  cat /tmp/ai-agent-health.json 2>/dev/null || true
  [ "$health_code" = "200" ] || fail "AI Core agent runtime health failed HTTP $health_code"

  models_code="$(curl -sS -o /tmp/ai-agent-models.json -w '%{http_code}'     --connect-timeout 15 --max-time 30     -H "x-ai-agent-token: $token"     "$api_base/ai/agent-runtime/v1/models" || true)"
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

  AI_WORKERS_ENV_FILE="$ENV_FILE" bash "$SCRIPT_DIR/ai-workers-healthcheck.sh"

  log "AI Core agent runtime connection=PASS"
  log "OpenHands -> AI Core model runtime=PASS"
  log "OpenClaw -> AI Core custom provider=PASS"
  log "n8n -> AI Core scoped token=PASS"
}

case "$MODE" in
  prepare) prepare false ;;
  rotate) prepare true ;;
  apply) apply ;;
  verify)
    apply
    ;;
  *)
    fail "Usage: $0 [prepare|rotate|apply|verify]"
    ;;
esac
