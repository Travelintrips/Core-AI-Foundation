#!/usr/bin/env bash
# Read-only canonical DEV OAuth + MCP discovery smoke.
# Do not infer that OAuth tokens or historical client channels can be migrated.
set -euo pipefail

host="dev.cstlogistic.co.id"
issuer="https://${host}"
resource="${issuer}/api/ai/core-chat/mcp"

for path in /.well-known/oauth-authorization-server /.well-known/oauth-protected-resource/api/ai/core-chat/mcp; do
  payload="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "${issuer}${path}")"
  printf '%s' "$payload" | jq -e 'type=="object"' >/dev/null
  if [[ "$path" == "/.well-known/oauth-authorization-server" ]]; then
    printf '%s' "$payload" | jq -e \
      --arg iss "$issuer" \
      '.issuer==$iss and
       .authorization_endpoint==($iss+"/api/ai/core-chat/oauth/authorize") and
       .token_endpoint==($iss+"/api/ai/core-chat/oauth/token") and
       (.code_challenge_methods_supported|index("S256")!=null) and
       (.grant_types_supported|index("refresh_token")!=null) and
       (.scopes_supported|index("ai_core.events")!=null)' >/dev/null
  else
    printf '%s' "$payload" | jq -e \
      --arg iss "$issuer" --arg resource "$resource" \
      '.resource==$resource and
       (.authorization_servers|index($iss)!=null) and
       (.scopes_supported|index("ai_core.events")!=null)' >/dev/null
  fi
  echo "DEV_OAUTH_DISCOVERY=PASS host=$host path=$path"
done

# A missing OAuth credential must not be treated as a successful MCP read.
status="$(curl --silent --show-error --connect-timeout 5 --max-time 15 \
  --output /dev/null --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":"dev-oauth-smoke","method":"tools/call","params":{"name":"read_ai_core_events","arguments":{"conversationId":"not-authorized","limit":1}}}' \
  "$resource")"
test "$status" = 401
echo "DEV_OAUTH_UNAUTHENTICATED_READ=PASS host=$host status=$status"
