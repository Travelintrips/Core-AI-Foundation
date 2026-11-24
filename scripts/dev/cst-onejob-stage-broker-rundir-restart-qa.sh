#!/usr/bin/env bash
# CST-DEV disposable systemd RuntimeDirectory crash/restart evidence.
# DO NOT install or start the real Gate A broker. No DB, secrets, egress, signer.
set -Eeuo pipefail
[[ $(id -u) -eq 0 ]] || { echo QA_REQUIRES_ROOT; exit 3; }
for cmd in systemd-run systemctl setpriv python3 stat; do command -v "$cmd" >/dev/null; done
suffix="$$"
dir="cst-onejob-gatea-rundir-qa-$suffix"
unit1="cst-onejob-gatea-rundir-first-$suffix"
unit2="cst-onejob-gatea-rundir-second-$suffix"
script="$(mktemp /tmp/cst-onejob-rundir-qa-XXXXXX.py)"
cleanup(){
  systemctl stop "$unit1.service" "$unit2.service" >/dev/null 2>&1 || :
  rm -f "$script"
}
trap cleanup EXIT
cat > "$script" <<'PY'
import os,socket,time
directory=os.environ.get("RUNTIME_DIRECTORY")
assert directory and directory.startswith("/run/cst-onejob-gatea-rundir-qa-")
sock=directory+"/pg-pooler.sock"
s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
s.bind(sock)
os.chmod(sock,0o660)
s.listen(1)
print("DISPOSABLE_QA_ONLY",flush=True)
while True:time.sleep(.25)
PY
chmod 0644 "$script"
# systemd retains root for the setup and drops privileges before running
# test process. UID 28500 is not an installed NSS username on this VPS.
starter="chown 28500:28501 /run/$dir && chmod 0750 /run/$dir && exec /usr/bin/setpriv --reuid=28500 --regid=28501 --clear-groups /usr/bin/python3 -B $script"
start(){
  local name="$1"
  systemd-run --unit "$name" --collect \
    --property=RuntimeDirectory="$dir" \
    --property=RuntimeDirectoryMode=0700 \
    --property=RuntimeDirectoryPreserve=no \
    /usr/bin/bash -c "$starter" >/dev/null
  for n in $(seq 1 40);do
    [[ -S "/run/$dir/pg-pooler.sock" ]] && break
    sleep .1
  done
  [[ -S "/run/$dir/pg-pooler.sock" ]]
  [[ $(stat -c '%u:%g:%a' "/run/$dir/pg-pooler.sock") == 28500:28501:660 ]]
}
start "$unit1"
echo QA_NONROOT_BROKER_SOCKET_PASS
systemctl kill --signal=SIGKILL "$unit1.service"
for n in $(seq 1 50);do
  [[ ! -e "/run/$dir" ]] && break
  sleep .1
done
[[ ! -e "/run/$dir" ]]
echo QA_SIGKILL_RUNTIME_DIRECTORY_REMOVED_PASS
start "$unit2"
echo QA_NEW_UNIT_RESTART_SOCKET_PASS
systemctl stop "$unit2.service"
for n in $(seq 1 50);do
  [[ ! -e "/run/$dir" ]] && break
  sleep .1
done
[[ ! -e "/run/$dir" ]]
echo QA_GRACEFUL_STOP_RUNTIME_DIRECTORY_REMOVED_PASS
echo QA_LIVE_DB_CHANGED_FALSE
