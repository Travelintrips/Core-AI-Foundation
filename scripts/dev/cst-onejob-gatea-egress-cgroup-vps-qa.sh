#!/usr/bin/env bash
# CST-DEV Gate A: transient VPS systemd cgroup egress/pinned TLS QA.
# No real DB authentication, role changes, secrets, production or host firewall writes.
set -Eeuo pipefail
[[ "$(id -u)" == 0 ]] || { echo CST_GATEA_EGRESS_QA_ROOT_REQUIRED; exit 3; }
host=aws-1-ap-southeast-2.pooler.supabase.com
ca=/etc/cst-onejob-dev/gatea-watchdog/supabase-root-2021.pem
expected=807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA
[[ -f "$ca" && ! -L "$ca" ]] || { echo CST_GATEA_EGRESS_QA_CA_MISSING; exit 3; }
actual=$(openssl x509 -in "$ca" -outform der | sha256sum | awk '{print toupper($1)}')
[[ "$actual" == "$expected" ]] || { echo CST_GATEA_EGRESS_QA_PIN_MISMATCH; exit 3; }
target=$(getent ahostsv4 "$host" | awk '$2=="STREAM" {print $1; exit}')
other=$(getent ahostsv4 "$host" | awk -v x="$target" '$2=="STREAM" && $1!=x {print $1; exit}')
[[ -n "$other" ]] || other=1.1.1.1
[[ "$target" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] ||
  { echo CST_GATEA_EGRESS_QA_POOLER_IP_INVALID; exit 3; }
[[ "$other" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ && "$target" != "$other" ]] ||
  { echo CST_GATEA_EGRESS_QA_OTHER_IP_INVALID; exit 3; }
unit="cst-gatea-egress-test-$$"
cleanup() {
 systemctl stop "$unit-deny.service" >/dev/null 2>&1 || :
 systemctl stop "$unit-allow.service" >/dev/null 2>&1 || :
 systemctl stop "$unit-other.service" >/dev/null 2>&1 || :
}
trap cleanup EXIT
systemd-run --quiet --wait --pipe --collect --unit "$unit-deny" \
 --property=DynamicUser=yes --property=User=cst-onejob-gatea-watchdog \
 --property=NoNewPrivileges=yes --property=IPAddressDeny=any \
 /usr/bin/python3 -c '
import socket,sys
s=socket.socket();s.settimeout(2)
try:s.connect((sys.argv[1],6543))
except OSError:
 print("CST_GATEA_CGROUP_EGRESS_DENY_ALL_PASS");sys.exit(0)
print("CST_GATEA_CGROUP_EGRESS_DENY_ALL_FAILED");sys.exit(2)
' "$target"
systemd-run --quiet --wait --pipe --collect --unit "$unit-allow" \
 --property=DynamicUser=yes --property=User=cst-onejob-gatea-watchdog \
 --property=NoNewPrivileges=yes --property=IPAddressDeny=any \
 --property=IPAddressAllow="$target/32" \
 --property=LoadCredential=watchdog-ca:"$ca" \
 /usr/bin/python3 -c '
import os,subprocess,sys
ca=os.path.join(os.environ["CREDENTIALS_DIRECTORY"],"watchdog-ca")
host="aws-1-ap-southeast-2.pooler.supabase.com"
argv=["/usr/bin/timeout","12","/usr/bin/openssl","s_client",
      "-starttls","postgres","-connect",sys.argv[1]+":6543",
      "-servername",host,"-verify_hostname",host,"-CAfile",ca,
      "-verify_return_error","-brief"]
p=subprocess.run(argv,input="",capture_output=True,text=True,timeout=16)
ok=p.returncode==0 and "Verification: OK" in p.stderr and "TLSv1.3" in p.stderr and os.geteuid()!=0
print("CST_GATEA_CGROUP_ALLOW_POOLER_PINNED_TLS_PASS" if ok else
      "CST_GATEA_CGROUP_ALLOW_POOLER_TLS_FAILED")
sys.exit(0 if ok else 2)
' "$target"
systemd-run --quiet --wait --pipe --collect --unit "$unit-other" \
 --property=DynamicUser=yes --property=User=cst-onejob-gatea-watchdog \
 --property=NoNewPrivileges=yes --property=IPAddressDeny=any \
 --property=IPAddressAllow="$target/32" \
 /usr/bin/python3 -c '
import socket,sys
s=socket.socket();s.settimeout(2)
try:s.connect((sys.argv[1],6543))
except OSError:
 print("CST_GATEA_CGROUP_OUTSIDE_ALLOWLIST_DENIED_PASS");sys.exit(0)
print("CST_GATEA_CGROUP_OUTSIDE_ALLOWLIST_FAILED");sys.exit(2)
' "$other"
echo CST_GATEA_VPS_EGRESS_PINNED_TLS_QA_PASS
echo CST_GATEA_QA_USED_NO_DB_PASSWORD_OR_LOGIN=TRUE
echo CST_GATEA_QA_CHANGED_NO_GLOBAL_FIREWALL=TRUE
echo CST_GATEA_QA_INSTALLED_NO_SERVICE=TRUE