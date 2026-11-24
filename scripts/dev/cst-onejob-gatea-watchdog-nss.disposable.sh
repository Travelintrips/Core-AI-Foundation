#!/usr/bin/env bash
# CST DEV VPS-only nonsecret systemd NSS QA. No real unit, database or key.
set -Eeuo pipefail
[[ "$(id -u)" -eq 0 ]] || { echo QA_ROOT_REQUIRED; exit 3; }
for executable in systemd-run systemctl setpriv id getent; do
 command -v "$executable" >/dev/null || { echo "QA_MISSING_$executable"; exit 3; }
done
# This host deliberately does not have OS passwd/group identities at the
# fixed numeric IDs used by the stage client and watchdog.
if getent passwd 28502 >/dev/null || getent group 28503 >/dev/null; then
 echo QA_NSS_IDENTITY_EXISTS_DIFFERENT_MODEL
 exit 3
fi
a="cst-gatea-nss-direct-$$"
b="cst-gatea-nss-wrapper-$$"
set +e
systemd-run --quiet --wait --pipe --collect --unit "$a" \
 --property=User=28502 --property=Group=28503 --property=NoNewPrivileges=yes \
 /usr/bin/true >/dev/null 2>&1
bad=$?
set -e
[[ "$bad" -eq 217 ]] || { echo QA_DIRECT_USER_FAILED_UNEXPECTED_CODE; exit 2; }
actual=$(systemd-run --quiet --wait --pipe --collect --unit "$b" \
 --property=User=root --property=Group=root --property=NoNewPrivileges=yes \
 /usr/bin/setpriv --no-new-privs --bounding-set=-all \
 --reuid=28502 --regid=28503 --clear-groups /usr/bin/id -u)
[[ "$actual" == 28502 ]] || { echo QA_NONROOT_WRAPPER_IDENTITY_DENIED; exit 2; }
echo "CST_GATEA_WATCHDOG_UID_WRAPPER_QA_PASS directNumericSystemdExit=217 wrapperUid=28502 liveUnitInstalled=false realCredentialRead=false"
