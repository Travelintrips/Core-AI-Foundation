#!/usr/bin/env bash
# Real operational-capable one-session broker in a disposable NO-NET QA sandbox.
# It uses the SAME broker source, not an additional mock implementation.
# No real CST-DEV/PROD IP, password, signer, SQL, job or release permission.
set -Eeuo pipefail
[[ "$(id -u)" == "0" ]] || { echo QA_ROOT_REQUIRED_FOR_NAMESPACE_SETUP;exit 4; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOLDER="cst-onejob-opbroker-netnone-qa"
if docker inspect "$HOLDER" >/dev/null 2>&1;then echo QA_NAME_OCCUPIED;exit 3;fi
SOCKETDIR="$(mktemp -d /tmp/cst-onejob-broker-qa-XXXXXX)"
EVIDENCE="$(mktemp -d /tmp/cst-onejob-policy-evidence-XXXXXX)"
UPSTREAM_PID=""
BROKER_PID=""
cleanup(){
  for pid in "$BROKER_PID" "$UPSTREAM_PID";do
    if [[ -n "$pid" ]];then kill "$pid" 2>/dev/null||true;wait "$pid" 2>/dev/null||true;fi
  done
  docker rm -f "$HOLDER" >/dev/null 2>&1||true
  rm -rf "$EVIDENCE"
  rm -rf "$SOCKETDIR"
}
trap cleanup EXIT
chmod 0755 "$EVIDENCE"
chown 28500:28501 "$SOCKETDIR"
chmod 0750 "$SOCKETDIR"
SOCK="$SOCKETDIR/pg-pooler.sock"
docker run -d --name "$HOLDER" --network none --read-only \
 --user 10001:10001 --cap-drop ALL --security-opt no-new-privileges \
 --memory 96m --pids-limit 48 --entrypoint node node:22-alpine \
 -e 'setInterval(()=>{},10000)' >/dev/null
PID=$(docker inspect "$HOLDER" --format '{{.State.Pid}}')
[[ "$PID" -gt 1 ]]
[[ "$(readlink "/proc/$PID/ns/net")" != "$(readlink /proc/1/ns/net)" ]]
echo "QA_NAMESPACE_NETWORK_NONE=true"

cat >"$EVIDENCE/upstream.js" <<'JS'
const net=require("net");
const s=net.createServer(c=>{
 console.log("MOCK_UPSTREAM_CONNECTED");
 c.once("data",bytes=>{
   c.end("ACK:"+bytes.toString());
 });
});
s.listen(6543,"127.0.0.1",()=>console.log("MOCK_UPSTREAM_READY"));
JS
nsenter --target "$PID" --net /usr/bin/node "$EVIDENCE/upstream.js" >"$EVIDENCE/upstream.log" 2>&1 &
UPSTREAM_PID=$!
for i in $(seq 1 35);do
  if grep -q "MOCK_UPSTREAM_READY" "$EVIDENCE/upstream.log";then break;fi
  sleep .1
done
grep -q "MOCK_UPSTREAM_READY" "$EVIDENCE/upstream.log"

# QA signer is root-owned; the broker can only read a pinned public key
# and a SIGNED scope manifest. No credential/private signing key is mounted.
python3 - "$EVIDENCE" "$SOCK" "$PID" "$ROOT" <<'PY'
import base64, json, os, sys
from pathlib import Path
from datetime import datetime,timedelta,timezone
from hashlib import sha256
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
folder=Path(sys.argv[1]);sock=sys.argv[2];pid=int(sys.argv[3])
job=483
now=datetime.now(timezone.utc)
ts=lambda dt:dt.isoformat(timespec="milliseconds").replace("+00:00","Z")
manifest={
 "version":1,"mode":"DISPOSABLE_NETWORK_NONE_QA",
 "project":"xssrfshdrtdfupgqwfdw","companyId":"1",
 "sourceSha":"a"*40,"jobId":job,
 "requestId":"cst-ai-team-company1-dev:pilot-"+"b"*20,
 "ownerApprovalSha256":"c"*64,"subscriberArmedSha256":"d"*64,
 "allowedDestinationIp":"127.0.0.1","destinationHostname":"localhost",
 "destinationPort":6543,"socketPath":sock,
 "brokerUid":28500,"brokerGid":28501,"workerUid":28502,"workerGid":28501,
 "networkNamespaceInode":os.stat(f"/proc/{pid}/ns/net").st_ino,
 "issuedAt":ts(now-timedelta(seconds=5)),
 "expiresAt":ts(now+timedelta(minutes=2)),
 "nonce":"e"*32
}
key=Ed25519PrivateKey.generate()
pub=key.public_key()
pem=pub.public_bytes(serialization.Encoding.PEM,
    serialization.PublicFormat.SubjectPublicKeyInfo)
pin=sha256(pub.public_bytes(serialization.Encoding.DER,
    serialization.PublicFormat.SubjectPublicKeyInfo)).hexdigest()
raw=json.dumps(manifest,separators=(",",":"),ensure_ascii=False).encode()
signature=base64.b64encode(key.sign(raw)).decode()
(folder/"public.pem").write_bytes(pem)
(folder/"envelope.json").write_text(json.dumps(
    {"manifest":manifest,"signatureBase64":signature}),encoding="utf8")
(folder/"pin").write_text(pin,encoding="ascii")
(folder/"forged.json").write_text(json.dumps(
    {"manifest":{**manifest,"jobId":484},"signatureBase64":signature}),encoding="utf8")
for name in ["public.pem","envelope.json","pin","forged.json"]:
    (folder/name).chmod(0o644)
print("SYNTHETIC_POLICY_SIGNED_BY_SEPARATE_QA_ROOT")
PY
PIN=$(cat "$EVIDENCE/pin")
# Forged scope must fail even BEFORE creating a socket.
set +e
nsenter --target "$PID" --net -- \
 setpriv --no-new-privs --bounding-set=-all --reuid=28500 --regid=28501 --clear-groups \
 /usr/bin/python3 -B "$ROOT/scripts/dev/cst_team_onejob_operational_broker.py" \
 --qa-run --envelope "$EVIDENCE/forged.json" --public-key "$EVIDENCE/public.pem" \
 --pinned-sha256 "$PIN" >"$EVIDENCE/forged.log" 2>&1
RC=$?
set -e
[[ "$RC" == 2 ]]
grep -q "CST_ONEJOB_BROKER_MANIFEST_SIGNATURE_INVALID" "$EVIDENCE/forged.log"
[[ ! -e "$SOCK" ]]
echo "FORGED_SCOPE_DENIED_BEFORE_SOCKET_BIND=true"

nsenter --target "$PID" --net -- \
 setpriv --no-new-privs --bounding-set=-all --reuid=28500 --regid=28501 --clear-groups \
 /usr/bin/python3 -B "$ROOT/scripts/dev/cst_team_onejob_operational_broker.py" \
 --qa-run --envelope "$EVIDENCE/envelope.json" --public-key "$EVIDENCE/public.pem" \
 --pinned-sha256 "$PIN" >"$EVIDENCE/broker.log" 2>&1 &
BROKER_PID=$!
for i in $(seq 1 50);do
 if [[ -S "$SOCK" ]] && grep -q "CST_ONEJOB_BROKER_READY_NO_DISPATCH" "$EVIDENCE/broker.log";then break;fi
 if ! kill -0 "$BROKER_PID" 2>/dev/null;then break;fi
 sleep .1
done
[[ -S "$SOCK" ]] || { cat "$EVIDENCE/broker.log";exit 6;}
[[ "$(stat -c '%a %u:%g' "$SOCK")" == "660 28500:28501" ]]
echo "NONROOT_SIGNED_BROKER_READY=true"

# Bad UID shares socket GID but must fail *kernel peer check* before dial.
CLIENT='const net=require("net");
const sock=process.argv[1],mode=process.argv[2];
const c=net.connect({path:sock});let finished=false,bytes=0;
const done=(label,ok)=>{if(finished)return;finished=true;console.log(label);c.destroy();if(!ok)process.exitCode=7;};
c.setTimeout(1800);
c.on("connect",()=>c.write("HELLO_QA"));
c.on("data",b=>{bytes+=b.length;if(mode==="ALLOW")done(b.toString(),b.toString()==="ACK:HELLO_QA");else done("BAD_PEER_WAS_FORWARDED",false)});
c.on("error",e=>{if(mode==="DENY")done("WRONG_PEER_REJECTED",true);else done("CLIENT_ERROR",false)});
c.on("close",()=>{if(!finished)done("WRONG_PEER_CLOSED",mode==="DENY"&&bytes===0)});
c.on("timeout",()=>done("PEER_TIMEOUT",false));'
setpriv --reuid=28503 --regid=28501 --clear-groups \
 /usr/bin/node -e "$CLIENT" "$SOCK" DENY
# Wrong UID cannot reach the upstream mock, regardless of socket filesystem GID.
[[ "$(grep -c 'MOCK_UPSTREAM_CONNECTED' "$EVIDENCE/upstream.log"||true)" == 0 ]]
setpriv --reuid=28502 --regid=28501 --clear-groups \
 /usr/bin/node -e "$CLIENT" "$SOCK" ALLOW
wait "$BROKER_PID"
BROKER_PID=""
[[ ! -S "$SOCK" ]]
[[ "$(grep -c 'MOCK_UPSTREAM_CONNECTED' "$EVIDENCE/upstream.log"||true)" == 1 ]]
grep -q "CST_ONEJOB_BROKER_PEER_DENIED" "$EVIDENCE/broker.log"
grep -q "CST_ONEJOB_BROKER_ONE_SESSION_CLOSED" "$EVIDENCE/broker.log"
echo "SIGNED_ONE_SESSION_BROKER_REAL_SOURCE_QA_PASS"
echo "NO_AUTH_OR_PG_DB_NO_PROD_NO_DISPATCH"
