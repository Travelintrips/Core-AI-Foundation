#!/usr/bin/env bash
# CST-DEV: disposable actual Supavisor TLS through a default-deny nft netns.
# No DB credentials, no login, no persistent namespace, no host nft mutation.
set -Eeuo pipefail
[[ "$(id -u)" == 0 ]] || { echo QA_ROOT_REQUIRED; exit 3; }
for cmd in docker nsenter nft openssl getent timeout awk sort; do
  command -v "$cmd" >/dev/null || { echo QA_TOOL_MISSING; exit 3; }
done
HOST=aws-1-ap-southeast-2.pooler.supabase.com
CA=/etc/cst-onejob-dev/gatea-watchdog/supabase-root-2021.pem
PIN=807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA
NAME=cst-gatea-pooler-tls-qa-$$
tmp=$(mktemp -d /tmp/cst-gatea-pooler-egress-XXXXXXXX)
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || :
  rm -rf -- "$tmp"
}
trap cleanup EXIT
[[ -f "$CA" && ! -L "$CA" ]] || { echo QA_PINNED_CA_NOT_AVAILABLE; exit 3; }
actual=$(openssl x509 -in "$CA" -outform der | sha256sum | awk '{print toupper($1)}')
[[ "$actual" == "$PIN" ]] || { echo QA_PINNED_CA_HASH_MISMATCH; exit 3; }
mapfile -t ips < <(getent ahostsv4 "$HOST" | awk '!seen[$1]++{print $1}' | sort -u)
[[ "${#ips[@]}" -gt 0 && "${#ips[@]}" -le 4 ]] || { echo QA_DNS_CARDINALITY_UNTRUSTED; exit 3; }
for ip in "${ips[@]}"; do
  [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo QA_DNS_IP_INVALID; exit 3; }
done
docker run -d --rm --network bridge --name "$NAME" --read-only \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 24 \
  --memory 96m --entrypoint node node:22-alpine \
  -e 'setInterval(()=>{},30000)' >/dev/null
P=$(docker inspect "$NAME" --format '{{.State.Pid}}')
[[ "$P" =~ ^[0-9]+$ && "$P" -gt 1 ]]
[[ "$(readlink /proc/$P/ns/net)" != "$(readlink /proc/1/ns/net)" ]] || { echo QA_HOST_NS_DENIED; exit 3; }
nsenter -t "$P" -n nft list tables > "$tmp/prior-tables"
[[ ! -s "$tmp/prior-tables" ]] || { echo QA_UNEXPECTED_EXISTING_NFT; exit 3; }
{
  echo "table inet cst_gatea_disposable_pooler_tls {"
  echo " chain output {"
  echo "  type filter hook output priority 0; policy drop;"
  for ip in "${ips[@]}"; do
    echo "  ip daddr $ip tcp dport 6543 counter accept"
  done
  echo "  counter drop"
  echo " }"
  echo "}"
} > "$tmp/policy.nft"
nsenter -t "$P" -n nft -f "$tmp/policy.nft"
echo QA_DISPOSABLE_DEFAULT_DENY_NAMESPACE=TRUE
verified=0
for ip in "${ips[@]}"; do
  if timeout 12 nsenter -t "$P" -n openssl s_client -starttls postgres \
      -connect "$ip:6543" -servername "$HOST" -verify_hostname "$HOST" \
      -CAfile "$CA" -verify_return_error -brief \
      < /dev/null >"$tmp/tls.log" 2>&1; then
    if grep -q "Verification: OK" "$tmp/tls.log" &&
       grep -q "Protocol version: TLS" "$tmp/tls.log"; then
       verified=1
       break
    fi
  fi
done
[[ "$verified" == 1 ]] || {
 echo QA_PINNED_REAL_POOLER_TLS_NOT_VERIFIED
 sed -n '1,6p' "$tmp/tls.log" || :
 exit 2
}
echo QA_REAL_SUPAVISOR_TLS_FROM_NAMESPACE=PASS
# The same reachable IP must be blocked on unauthorized TCP 443.
if timeout 3 nsenter -t "$P" -n bash -c \
      'echo >/dev/tcp/$1/443' dummy "$ip" >/dev/null 2>&1; then
   echo QA_UNAUTHORIZED_PORT_UNEXPECTEDLY_OPEN
   exit 2
fi
nsenter -t "$P" -n nft -a list chain inet cst_gatea_disposable_pooler_tls output > "$tmp/counters"
grep -q 'policy drop' "$tmp/counters" || { echo QA_DEFAULT_DROP_MISSING; exit 2; }
python3 - "$tmp/counters" "$ip" <<'PY'
import re,sys
raw=open(sys.argv[1]).read()
ip=re.escape(sys.argv[2])
allow=re.search(r"ip daddr "+ip+r" tcp dport 6543 counter packets (\d+)",raw)
lines=[int(n) for n in re.findall(r"counter packets (\d+) bytes",raw)]
if allow is None or int(allow.group(1))<=0 or not lines or lines[-1]<=0:
 print("QA_KERNEL_ALLOW_DENY_COUNTERS_NOT_BOTH_OBSERVED")
 sys.exit(2)
print("QA_KERNEL_POOLER_ALLOW_PACKETS_POSITIVE=TRUE")
print("QA_KERNEL_OTHER_PORT_DENY_PACKETS_POSITIVE=TRUE")
PY
echo CST_GATEA_REAL_SUPAVISOR_TLS_DISPOSABLE_NETNS_PASS
echo LIVE_DATABASE_CREDENTIAL_NOT_USED=TRUE
echo HOST_FIREWALL_UNMODIFIED=TRUE
echo OPERATIONS_LOGIN_NOT_ENABLED=TRUE
echo RELEASE_DECISION=NO_GO