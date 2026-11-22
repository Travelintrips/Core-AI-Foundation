#!/usr/bin/env bash
# CST-DEV Gate A source-only credential custody QA (synthetic text).
# No live watchdog, database login, Supabase, external network, or real secret.
set -Eeuo pipefail
[[ "$(id -u)" == 0 ]] || { echo QA_ROOT_REQUIRED; exit 3; }
for command in systemd-run systemctl python3 getent mktemp; do
  command -v "$command" >/dev/null || { echo QA_MISSING_TOOL; exit 3; }
done
user=cst-onejob-gatea-watchdog
if getent passwd "$user" >/dev/null; then
  echo QA_UNEXPECTED_PERMANENT_USER
  exit 3
fi
tmp="$(mktemp -d /run/cst-gatea-dynamic-cred-XXXXXXXX)"
unit="cst-gatea-dyncred-disposable-$$"
cleanup() {
  systemctl stop "$unit.service" >/dev/null 2>&1 || :
  rm -rf -- "$tmp"
}
trap cleanup EXIT
printf 'GATEA_SYNTHETIC_QA_NOT_A_SECRET\n' > "$tmp/synthetic-credential"
chmod 0600 "$tmp/synthetic-credential"
output="$(timeout 25 systemd-run --quiet --wait --pipe --collect --unit "$unit" \
    --property=DynamicUser=yes \
    --property=User="$user" \
    --property=NoNewPrivileges=yes \
    --property=ProtectSystem=strict \
    --property=ProtectHome=yes \
    --property=PrivateTmp=yes \
    --property=LoadCredential=watchdog-db:"$tmp/synthetic-credential" \
    /usr/bin/python3 -B -c '
import os,sys,stat
path=os.environ.get("CREDENTIALS_DIRECTORY","")+"/watchdog-db"
try:
    metadata=os.stat(path)
    okay=(os.geteuid()!=0 and os.access(path,os.R_OK) and
           stat.S_ISREG(metadata.st_mode) and
           not bool(metadata.st_mode & 0o007))
except (OSError,ValueError):
    okay=False
print("GATEA_DYNAMIC_CREDENTIAL_READABLE="+str(okay))
sys.exit(0 if okay else 3)
')"
[[ "$output" == *"GATEA_DYNAMIC_CREDENTIAL_READABLE=True"* ]] ||
  { echo QA_DYNAMIC_CREDENTIAL_INACCESSIBLE; exit 2; }
# systemd must not persist an actual OS login account after the test.
if getent passwd "$user" >/dev/null; then
  echo QA_PERMANENT_LOGIN_ACCOUNT_UNEXPECTED
  exit 2
fi
# Missing-source credential must fail before executing even a harmless
# binary, instead of silently running without the admin relock credential.
missing_unit="cst-gatea-dyncred-missing-$$"
set +e
timeout 20 systemd-run --quiet --wait --pipe --collect --unit "$missing_unit" \
  --property=DynamicUser=yes \
  --property=User="$user" \
  --property=NoNewPrivileges=yes \
  --property=LoadCredential=watchdog-db:"$tmp/absent-source" \
  /usr/bin/true >/dev/null 2>&1
missing_rc=$?
set -e
[[ "$missing_rc" -ne 0 ]] || { echo QA_MISSING_CREDENTIAL_DID_NOT_FAIL_CLOSED; exit 2; }
echo GATEA_MISSING_CREDENTIAL_DENIED=TRUE
echo CST_GATEA_DYNAMIC_CREDENTIAL_DISPOSABLE_PASS
echo QA_NO_WATCHDOG_SERVICE_INSTALLED=TRUE
echo QA_NO_REAL_DATABASE_OR_SECRET_ACCESSED=TRUE
