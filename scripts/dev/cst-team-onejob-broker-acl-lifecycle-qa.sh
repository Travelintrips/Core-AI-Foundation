#!/usr/bin/env bash
# Disposable CST-DEV one-job QA: prove the EXISTING mock broker cannot dial
# upstream until a namespace-only kernel default-drop ACL is active.
# No real pooler, credentials, PROD or database access. Docker creates and
# removes its normal bridge/NAT rules; no persistent host firewall policy edit.
set -Eeuo pipefail
if [[ "$(id -u)" != "0" ]]; then echo "QA_REQUIRES_VPS_ROOT_FOR_NAMESPACE_SETUP"; exit 3; fi
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NET="cst-onejob-combined-qa-$$"
ALLOW="cst-onejob-qa-allow-$$"
DENY="cst-onejob-qa-deny-$$"
HOLDER="cst-onejob-qa-holder-$$"
DIR="$(mktemp -d /tmp/cst-onejob-combined-XXXXXX)"
BROKER_PID=""
cleanup() {
  if [[ -n "$BROKER_PID" ]]; then
    kill "$BROKER_PID" 2>/dev/null || true
    wait "$BROKER_PID" 2>/dev/null || true
  fi
  for name in "$HOLDER" "$DENY" "$ALLOW"; do
    docker rm -f "$name" >/dev/null 2>&1 || true
  done
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$DIR"
}
trap cleanup EXIT
for exe in docker nft nsenter setpriv node python3; do command -v "$exe" >/dev/null || exit 4; done
chmod 0755 "$DIR"
mkdir "$DIR/socket"
chown 28500:28501 "$DIR/socket"
chmod 0750 "$DIR/socket"
SOCK="$DIR/socket/pg-pooler.sock"
if docker network inspect "$NET" >/dev/null 2>&1; then exit 5; fi

# Local, disposable mock endpoints. NEVER use a real pooler address here.
docker network create --driver bridge "$NET" >/dev/null
docker run -d --name "$ALLOW" --network "$NET" --read-only \
  --cap-drop ALL --security-opt no-new-privileges --memory 96m --pids-limit 48 \
  --entrypoint node node:22-alpine -e '
const net=require("net");
net.createServer(s=>{
  console.log("MOCK_UPSTREAM_CONNECTED");
  s.once("data",b=>s.end("MOCK_ACK:"+b.toString()));
}).listen(6543,"0.0.0.0");
' >/dev/null
docker run -d --name "$DENY" --network "$NET" --read-only \
  --cap-drop ALL --security-opt no-new-privileges --memory 96m --pids-limit 48 \
  --entrypoint node node:22-alpine -e '
require("net").createServer(s=>s.end("FORBIDDEN_MOCK_ACK")).listen(6543,"0.0.0.0");
' >/dev/null

# The namespace starts with an IDLE, no-traffic holder, not the broker.
docker run -d --name "$HOLDER" --network "$NET" --read-only \
  --user 10001:10001 --cap-drop ALL --security-opt no-new-privileges \
  --memory 96m --pids-limit 48 --entrypoint node node:22-alpine \
  -e 'setInterval(()=>{},10000)' >/dev/null
sleep 0.4
IP_ALLOW="$(docker inspect "$ALLOW" --format '{{(index .NetworkSettings.Networks "'"$NET"'").IPAddress}}')"
IP_DENY="$(docker inspect "$DENY" --format '{{(index .NetworkSettings.Networks "'"$NET"'").IPAddress}}')"
PID="$(docker inspect "$HOLDER" --format '{{.State.Pid}}')"
[[ "$PID" -gt 1 && "$IP_ALLOW" != "$IP_DENY" ]]
[[ "$(readlink "/proc/$PID/ns/net")" != "$(readlink /proc/1/ns/net)" ]]
[[ "$(docker inspect "$HOLDER" --format '{{.HostConfig.Privileged}}')" == false ]]
[[ "$(docker inspect "$HOLDER" --format '{{json .HostConfig.CapDrop}}')" == '["ALL"]' ]]
# Docker may create a private ip nat table in the container namespace.
# Reject other pre-existing tables, but do not mutate Docker's own NAT table.
EXISTING="$(nsenter --target "$PID" --net nft list tables)"
if [[ -n "$EXISTING" && "$EXISTING" != "table ip nat" ]]; then
  echo "UNEXPECTED_QA_NAMESPACE_TABLES_REFUSE_START"
  exit 6
fi
echo "PREEXISTING_PRIVATE_DOCKER_NAT_RECOGNIZED"

# Install the single-destination, default-DROP rule into THIS namespace ONLY.
node --input-type=module -e '
const m=await import(process.argv[1]);
process.stdout.write(m.renderOneJobQaEgressPolicy(process.argv[2]));
' "$ROOT/scripts/dev/cst-team-onejob-nft-egress-qa.mjs" "$IP_ALLOW" > "$DIR/rules.nft"
nsenter --target "$PID" --net nft -f "$DIR/rules.nft"
echo "ACL_INSTALLED_BEFORE_BROKER_START=true"

# Generate actual allow+deny counters and independently read back the kernel.
CLIENT='const net=require("net");
const s=net.connect({host:process.argv[1],port:6543});
let done=false;const mode=process.argv[2];
const finish=(value,valid)=>{if(done)return;done=true;
 console.log("EGRESS_"+mode+"="+value);s.destroy();if(!valid)process.exitCode=7;};
s.setTimeout(1400);
s.on("data",d=>finish(d.toString(),mode==="ALLOW"&&d.toString().startsWith("MOCK_ACK:")));
s.on("connect",()=>{if(mode==="DENY")finish("UNEXPECTED_CONNECTION",false);else s.write("PING")});
s.on("timeout",()=>finish("DEFAULT_DROP",mode==="DENY"));
s.on("error",e=>finish("ERROR_"+e.code,false));
';
nsenter --target "$PID" --net /usr/bin/node -e "$CLIENT" "$IP_ALLOW" ALLOW
nsenter --target "$PID" --net /usr/bin/node -e "$CLIENT" "$IP_DENY" DENY
nsenter --target "$PID" --net nft -j list table inet cst_onejob_egress_qa |
  /usr/bin/node "$ROOT/scripts/dev/cst-team-onejob-nft-egress-qa.mjs" --audit-kernel-qa "$IP_ALLOW" > "$DIR/verified.json"
/usr/bin/node -e '
const x=JSON.parse(require("fs").readFileSync(process.argv[1]));
if(x.qaNamespacePolicyVerified!==true || x.operationalAuthority!==false
  || x.allowPackets<1||x.denyPackets<1)process.exit(6);
console.log("KERNEL_QA_ALLOW_DENY_EVIDENCE_PASS");
' "$DIR/verified.json"

# Start exactly the tested mock broker (not the operational forbidden entry)
# as a distinct non-root UID in the already-filtered namespace.
cat > "$DIR/mock-broker.mjs" <<'JS'
import { connect } from "node:net";
import { pathToFileURL } from "node:url";
const [modulePath,socketPath,mockIp]=process.argv.slice(2);
const m=await import(pathToFileURL(modulePath).href);
if(process.getuid()!==28500||process.getgid()!==28501)throw Error("BROKER_IDENTITY_MISMATCH");
const broker=await m.startOfflineMockBroker({
  socketPath,
  peerIdentity:{uid:28502,gid:28501},
  dialMock:()=>connect({host:mockIp,port:6543}),
});
console.log("MOCK_BROKER_READY_AFTER_ACL");
const finish=async()=>{await broker.close();process.exit(0)};
process.on("SIGTERM",()=>void finish());
JS
cat > "$DIR/client.js" <<'JS'
const net=require("net"),sock=process.argv[2],expect=process.argv[3];
const s=net.connect({path:sock});
let received=false,done=false;
function finish(label,good){if(done)return;done=true;console.log(label);s.destroy();if(!good)process.exitCode=8;}
s.setTimeout(3200);
s.once("connect",()=>s.write("QA_ONLY"));
s.once("data",b=>{received=true;finish("CLIENT_ACK="+b.toString(),expect==="allow"&&b.toString()==="MOCK_ACK:QA_ONLY")});
s.once("error",e=>finish("CLIENT_ERROR="+e.code,expect==="deny"&&(e.code==="EACCES"||e.code==="ECONNRESET")));
s.once("timeout",()=>finish("CLIENT_TIMEOUT",false));
s.once("close",()=>{if(!done)finish("CLIENT_DENIED_BEFORE_ACK",expect==="deny"&&!received)});
JS
chmod 0644 "$DIR/mock-broker.mjs" "$DIR/client.js"
nsenter --target "$PID" --net -- \
  setpriv --no-new-privs --bounding-set=-all --reuid=28500 --regid=28501 --clear-groups \
  /usr/bin/node "$DIR/mock-broker.mjs" \
  "$ROOT/scripts/dev/cst-team-onejob-fixed-db-broker.mjs" \
  "$SOCK" "$IP_ALLOW" >"$DIR/broker.log" 2>&1 &
BROKER_PID=$!
for i in $(seq 1 30); do
  if [[ -S "$SOCK" ]] && grep -q "MOCK_BROKER_READY_AFTER_ACL" "$DIR/broker.log"; then break; fi
  sleep 0.15
done
[[ -S "$SOCK" ]] || { cat "$DIR/broker.log"; exit 9; }
[[ "$(stat -c %a "$SOCK")" == "660" ]]
echo "MOCK_BROKER_STARTED_AFTER_ACL=true"

# Same socket GID: wrong UID reaches broker but is rejected by SO_PEERCRED.
setpriv --reuid=28503 --regid=28501 --clear-groups \
  /usr/bin/node "$DIR/client.js" "$SOCK" deny
HITS_BEFORE="$(docker logs "$ALLOW" 2>&1 | grep -c 'MOCK_UPSTREAM_CONNECTED' || true)"
# The preflight probe already caused exactly one connection. Wrong peer adds none.
[[ "$HITS_BEFORE" == "1" ]]
setpriv --reuid=28502 --regid=28501 --clear-groups \
  /usr/bin/node "$DIR/client.js" "$SOCK" allow
HITS_AFTER="$(docker logs "$ALLOW" 2>&1 | grep -c 'MOCK_UPSTREAM_CONNECTED' || true)"
[[ "$HITS_AFTER" == "2" ]]
echo "KERNEL_PEER_DENIED_BEFORE_UPSTREAM=true"
echo "APPROVED_PEER_FORWARDED_EXACTLY_ONCE=true"
echo "CST_DEV_MOCK_BROKER_ACL_PEERCRED_INTEGRATION_PASS"
echo "NO_SUPABASE_OR_DB_CREDENTIALS_NO_PERSISTENT_HOST_FIREWALL_CHANGE"
