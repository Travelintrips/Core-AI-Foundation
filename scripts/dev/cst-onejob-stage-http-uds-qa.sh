#!/usr/bin/env bash
# Disposable stage HTTP UDS transport QA, no internet or live service.
set -Eeuo pipefail
[[ "$(id -u)" == 0 ]] || { echo QA_REQUIRES_ROOT; exit 2; }
for cmd in docker curl setpriv; do command -v "$cmd" >/dev/null; done
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="cst-onejob-http-uds-qa-$$"
DIR="$(mktemp -d /tmp/cst-onejob-http-uds-qa-XXXXXX)"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || :; rm -rf "$DIR"; }
trap cleanup EXIT
chmod 0755 "$DIR"
mkdir -p "$DIR/app/scripts" "$DIR/socket"
cat > "$DIR/app/scripts/hostinger-start.cjs" <<'JS'
const http=require("node:http");
http.createServer((req,res)=>res.end("CST_ONEJOB_STAGE_HTTP_UDS_QA")).listen(3000,"127.0.0.1");
JS
chmod 0755 "$DIR/app" "$DIR/app/scripts"
chmod 0644 "$DIR/app/scripts/hostinger-start.cjs"
chown 28502:33 "$DIR/socket"
chmod 2750 "$DIR/socket"
docker image inspect node:22-alpine >/dev/null
docker run -d --name "$NAME" --network none --user 28502:28501 --group-add 33 --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 50 --memory 96m --tmpfs /run:rw,nosuid,nodev,size=24m --mount "type=bind,src=$DIR/app,dst=/app,readonly" --mount "type=bind,src=$DIR/socket,dst=/run/cst-onejob-stage-http" --mount "type=bind,src=$ROOT/deploy/cst-onejob-vps/owner-stage-bootstrap/stage-http-unix-supervisor.cjs,dst=/run/stage-supervisor.cjs,readonly" --entrypoint node node:22-alpine /run/stage-supervisor.cjs >/dev/null
result=""
for n in $(seq 1 25); do
  if [[ -S "$DIR/socket/api.sock" ]]; then
    result="$(setpriv --reuid=33 --regid=33 --clear-groups curl -fsS --max-time 2 --unix-socket "$DIR/socket/api.sock" http://localhost/api/ai/dev/onejob/owner-stage-readiness 2>/dev/null || :)"
    [[ "$result" == CST_ONEJOB_STAGE_HTTP_UDS_QA ]] && break
  fi
  sleep 0.2
done
[[ "$result" == CST_ONEJOB_STAGE_HTTP_UDS_QA ]]
[[ "$(stat -c '%u:%g:%a' "$DIR/socket/api.sock")" == "28502:33:660" ]]
[[ "$(docker inspect "$NAME" --format '{{.HostConfig.NetworkMode}}')" == none ]]
[[ "$(docker inspect "$NAME" --format '{{json .NetworkSettings.Ports}}')" == "{}" ]]
echo CST_ONEJOB_HTTP_UDS_QA_HOST_ACCESS_PASS
# A local untrusted UID outside the Nginx group must not traverse the dir.
if setpriv --reuid=28503 --regid=28503 --clear-groups curl -fsS --max-time 2 --unix-socket "$DIR/socket/api.sock" http://localhost/api/qa >/dev/null 2>&1; then
  echo CST_ONEJOB_HTTP_UDS_QA_UNAUTHORIZED_UID_CONNECTED
  exit 8
fi
echo CST_ONEJOB_HTTP_UDS_QA_UNAUTHORIZED_UID_DENIED_PASS
docker stop --time 3 "$NAME" >/dev/null
[[ ! -S "$DIR/socket/api.sock" ]]
echo CST_ONEJOB_HTTP_UDS_QA_SOCKET_CLEANUP_PASS
echo CST_ONEJOB_HTTP_UDS_QA_PROD_CHANGED_FALSE
