#!/usr/bin/env bash
# Disposable Gate A actual-kernel nftables verification, not a live broker.
# No credentials, no Supabase, no host firewall modification.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NET="cst-gatea-kernel-qa-$$"
ALLOW="$NET-allow"
DENY="$NET-deny"
HOLDER="$NET-hold"
DIR="$(mktemp -d /tmp/cst-gatea-kernel-XXXXXX)"
cleanup() {
  for n in "$HOLDER" "$DENY" "$ALLOW"; do
    docker rm -f "$n" >/dev/null 2>&1 || true
  done
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$DIR"
}
trap cleanup EXIT
[[ "$(id -u)" == 0 ]]
for c in docker nsenter nft node python3; do command -v "$c" >/dev/null; done
docker network create --driver bridge "$NET" >/dev/null
for n in "$ALLOW" "$DENY"; do
  docker run -d --name "$n" --network "$NET" --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 35 --memory 96m --entrypoint node node:22-alpine -e 'require("node:net").createServer(s=>{s.once("data",b=>s.end("MOCK_ACK:"+b.toString()))}).listen(6543,"0.0.0.0")' >/dev/null
done
docker run -d --name "$HOLDER" --network "$NET" --read-only --user 10001:10001 --cap-drop ALL --security-opt no-new-privileges --pids-limit 30 --memory 96m --entrypoint node node:22-alpine -e 'setInterval(()=>{},10000)' >/dev/null
sleep .5
A="$(docker inspect "$ALLOW" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')"
B="$(docker inspect "$DENY" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')"
P="$(docker inspect "$HOLDER" --format '{{.State.Pid}}')"
[[ "$A" != "$B" && "$P" -gt 1 ]]
[[ "$(readlink "/proc/$P/ns/net")" != "$(readlink /proc/1/ns/net)" ]]
echo "ISOLATED_NAMESPACE=PASS"
nsenter -t "$P" -n nft list tables > "$DIR/prior-tables"
# Docker's private bridge namespace can contain only its own ip nat table.
[[ ! -s "$DIR/prior-tables" || "$(cat "$DIR/prior-tables")" == "table ip nat" ]]
cat > "$DIR/gatea.nft" <<EOF
table inet cst_onejob_stage_egress {
  chain output {
    type filter hook output priority 0; policy drop;
    ip daddr $A tcp dport 6543 counter accept
    counter drop
  }
}
EOF
nsenter -t "$P" -n nft -f "$DIR/gatea.nft"
echo "DISPOSABLE_KERNEL_ACL_INSTALLED=TRUE"
nsenter -t "$P" -n node -e '
const n=require("node:net");
const c=n.connect({host:process.argv[1],port:6543});
c.setTimeout(1500);
c.on("connect",()=>c.write("QA"));
c.on("data",d=>{if(d.toString()!=="MOCK_ACK:QA")process.exitCode=3;console.log("MOCK_ALLOW="+d);c.destroy()});
c.on("timeout",()=>{console.log("MOCK_ALLOW_TIMEOUT");process.exitCode=4;c.destroy()});
c.on("error",e=>{console.log("MOCK_ALLOW_ERROR="+e.code);process.exitCode=5});
' "$A"
nsenter -t "$P" -n node -e '
const n=require("node:net");
const c=n.connect({host:process.argv[1],port:6543});
c.setTimeout(1000);
c.on("connect",()=>{console.log("DENY_UNEXPECTED_CONNECT");process.exitCode=3;c.destroy()});
c.on("timeout",()=>{console.log("MOCK_DENIED_BY_KERNEL=TRUE");c.destroy()});
c.on("error",e=>{console.log("DENY_ERROR="+e.code);process.exitCode=4});
' "$B"
nsenter -t "$P" -n python3 -B -c '
import sys
sys.path.insert(0,sys.argv[1])
import cst_onejob_preapproval_stage_broker as broker
broker.kernel_egress_ready({"allowedDestinationIp":sys.argv[2]})
print("GATE_A_REAL_KERNEL_POLICY_VERIFICATION=PASS")
' "$ROOT/scripts/dev" "$A"
echo "HOST_FIREWALL_UNMODIFIED=TRUE"
echo "LIVE_DATABASE_UNTOUCHED=TRUE"
