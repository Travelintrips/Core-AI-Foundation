#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${AI_WORKERS_ENV_FILE:-/etc/ai-core/ai-workers.env}"

[ -f "$ENV_FILE" ] || {
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
}

token="$(awk '
  index($0, "AI_CORE_SCOPED_AGENT_TOKEN=") == 1 {
    value=substr($0, length("AI_CORE_SCOPED_AGENT_TOKEN=")+1)
  }
  END { print value }
' "$ENV_FILE")"

[ -n "$token" ] || {
  echo "AI_CORE_SCOPED_AGENT_TOKEN is empty" >&2
  exit 1
}

printf '%s' "$token" | sha256sum | awk '{print $1}'
