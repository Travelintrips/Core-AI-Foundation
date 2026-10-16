#!/usr/bin/env bash
# Read-only smoke: DEV OAuth discovery must be JSON, never frontend HTML.
set -euo pipefail
issuer="https://dev-aicore.cstlogistic.co.id"
for host in dev.cstlogistic.co.id dev-aicore.cstlogistic.co.id; do
  for path in /.well-known/oauth-authorization-server /.well-known/oauth-protected-resource; do
    payload="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "https://$host$path")"
    printf '%s' "$payload" | jq -e 'type=="object"' >/dev/null
    if [[ "$path" == "/.well-known/oauth-authorization-server" ]]; then
      printf '%s' "$payload" | jq -e --arg iss "$issuer" '.issuer==$iss and (.code_challenge_methods_supported|index("S256")!=null)' >/dev/null
    fi
    echo "DEV_OAUTH_DISCOVERY=PASS host=$host path=$path"
  done
done
