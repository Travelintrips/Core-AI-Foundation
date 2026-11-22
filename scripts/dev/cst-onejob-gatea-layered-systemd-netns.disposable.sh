#!/usr/bin/env bash
# CST-DEV Gate A layered network isolation QA: real TLS, no DB authentication.
# Transient systemd cgroup IP allowlist + nftables port allowlist inside
# disposable Docker network namespace. NEVER install an operational unit,
# change the host nftables table, grant LOGIN or read any DB credential.
set -Eeuo pipefail
[[ "$(id -u)" == 0 ]] || { echo QA_ROOT_REQUIRED; exit 3; }
for c in docker nsenter nft systemd-run systemctl openssl timeout getent; do
  command -v "$c" >/dev/null || { echo QA_MISSING_TOOL; exit 3; }
done
HOST=aws-1-ap-southeast-2.pooler.supabase.com
CA=/etc/cst-onejob-dev/gatea-watchdog/supabase-root-2021.pem
PIN=807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA
name=cst-gatea-layered-netns-qa-$$
unit=cst-gatea-layered-systemd-qa-$$
tmp=$(mktemp -d /tmp/cst-gatea-layered-qa-XXXXXXXX)
cleanup() {
  systemctl stop "$unit.service" >/dev/null 2>&1 || :
  docker rm -f "$name" >/dev/null 2>&1 || :
  rm -rf -- "$tmp"
}
trap cleanup EXIT
[[ -f "$CA" && ! -L "$CA" ]] || { echo QA_PUBLIC_CA_NOT_REGULAR; exit 3; }
hash=$(openssl x509 -in "$CA" -outform der | sha256sum | awk '{print toupper($1)}')
[[ "$hash" == "$PIN" ]] || { echo QA_CA_PIN_MISMATCH; exit 3; }
ip=$(getent ahostsv4 "$HOST" | awk '$2=="STREAM" {print $1;exit}')
[[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo QA_HOST_DNS_SCOPE_DENIED; exit 3; }
# Unprivileged holder keeps its isolated netns alive.
docker run --rm -d --network bridge --name "$name" --read-only \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 22 \
  --memory 64m --entrypoint node node:22-alpine \
  -e 'setInterval(()=>{},30000)' >/dev/null
pid=$(docker inspect "$name" --format '{{.State.Pid}}')
[[ "$pid" =~ ^[0-9]+$ && "$pid" -gt 1 ]]
ns=$(readlink "/proc/$pid/ns/net")
[[ "$ns" != "$(readlink /proc/1/ns/net)" ]] || {
 echo QA_NAMESPACE_WOULD_BE_HOST; exit 3;
}
# Deny everything except one resolved Supavisor IP on TCP/6543.
nsenter -t "$pid" -n nft list tables > "$tmp/prior"
[[ ! -s "$tmp/prior" ]] || {
 echo QA_DISPOSABLE_NAMESPACE_NFT_NOT_EMPTY; exit 3;
}
cat > "$tmp/policy.nft" <<EOF
table inet cst_gatea_layered_qa {
 chain output {
  type filter hook output priority 0; policy drop;
  ip daddr $ip tcp dport 6543 counter accept
  counter drop
 }
}
EOF
nsenter -t "$pid" -n nft -f "$tmp/policy.nft"
# systemd applies a second, independent IP-only restriction around the same
# non-root program that uses the preconfigured network namespace.
systemd-run --quiet --wait --pipe --collect --unit "$unit" \
  --property=DynamicUser=yes \
  --property=User=cst-onejob-gatea-watchdog \
  --property=NoNewPrivileges=yes \
  --property=NetworkNamespacePath="/proc/$pid/ns/net" \
  --property=IPAddressDeny=any \
  --property=IPAddressAllow="$ip/32" \
  --property=LoadCredential="watchdog-ca:$CA" \
  /usr/bin/python3 -B -c '
import os, subprocess, sys, socket
from pathlib import Path
ip,hostname,expected_ns = sys.argv[1:]
current_ns=os.readlink("/proc/self/ns/net")
if os.geteuid()==0 or current_ns!=expected_ns:
 print("QA_LAYERED_NAMESPACE_IDENTITY_NOT_VERIFIED");sys.exit(2)
ca=str(Path(os.environ["CREDENTIALS_DIRECTORY"])/"watchdog-ca")
argv=["/usr/bin/timeout","12","/usr/bin/openssl","s_client",
      "-starttls","postgres","-connect",ip+":6543",
      "-servername",hostname,"-verify_hostname",hostname,
      "-CAfile",ca,"-verify_return_error","-brief"]
r=subprocess.run(argv,input="",capture_output=True,text=True,timeout=16)
if r.returncode!=0 or "Verification: OK" not in r.stderr:
 print("QA_LAYERED_SUPAVISOR_TLS_DENIED");sys.exit(2)
print("CST_GATEA_LAYERED_REAL_SUPAVISOR_TLS_PASS")
# Same allowed IP but a DISALLOWED port must be stopped by nft, not by
# IPAddressAllow. The timeout or connection failure proves no TCP accept.
s=socket.socket();s.settimeout(2)
try:
 s.connect((ip,443))
 print("QA_LAYERED_PORT443_UNEXPECTEDLY_CONNECTED");sys.exit(2)
except OSError:
 print("CST_GATEA_LAYERED_SAME_IP_WRONG_PORT_DENIED")
finally:s.close()
' "$ip" "$HOST" "$ns"
# Verify both egress paths actually matched kernel counters.
nsenter -t "$pid" -n nft -a list chain inet cst_gatea_layered_qa output > "$tmp/counters"
python3 - "$tmp/counters" "$ip" <<'PY'
import re,sys
s=open(sys.argv[1]).read()
ip=re.escape(sys.argv[2])
allow=re.search(r"ip daddr "+ip+r" tcp dport 6543 counter packets (\d+)",s)
all_counts=[int(n) for n in re.findall(r"counter packets (\d+) bytes",s)]
if "policy drop" not in s or not allow or int(allow.group(1))==0 or not all_counts or all_counts[-1]==0:
 print("QA_LAYERED_KERNEL_ALLOW_DENY_COUNTERS_NOT_PROVEN");sys.exit(2)
print("CST_GATEA_LAYERED_KERNEL_ALLOW_DENY_COUNTERS_PASS")
PY
echo CST_GATEA_LAYERED_SYSTEMD_NFT_REAL_POOLER_QA_PASS
echo CREDENTIAL_USED=PUBLIC_CA_ONLY
echo STAGING_LOGIN_NOT_OPENED=TRUE
echo NO_PERSISTENT_SERVICE_CREATED=TRUE
echo HOST_NFTABLES_NOT_MODIFIED=TRUE
echo OPERATIONAL_RELEASE_DECISION=NO_GO