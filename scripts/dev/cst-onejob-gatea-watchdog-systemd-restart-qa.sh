#!/usr/bin/env bash
# CST-DEV Gate A: disposable independent watchdog systemd restart QA.
# Never install/enable a real watchdog, open database LOGIN, or access Supabase.
set -Eeuo pipefail
[[ "$(id -u)" == 0 ]] || { echo QA_ROOT_REQUIRED; exit 3; }
for executable in systemd-run systemctl python3 mktemp; do
  command -v "$executable" >/dev/null || { echo "QA_MISSING_TOOL_$executable"; exit 3; }
done
repo="$(cd "$(dirname "$0")/../.." && pwd)"
runner="$(mktemp /run/cst-gatea-watchdog-runner-XXXXXXXX.py)"
tmp="$(mktemp -d /run/cst-gatea-watchdog-systemd-XXXXXXXX)"
unit="cst-gatea-watchdog-disposable-$$"
cleanup() {
  systemctl stop "$unit.service" >/dev/null 2>&1 || :
  rm -f -- "$runner"
  rm -rf -- "$tmp"
}
trap cleanup EXIT
cat > "$runner" <<'PY'
import json,os,signal,sys
from datetime import datetime,timedelta,timezone
from pathlib import Path
root=Path(sys.argv[1])
sys.path.insert(0,sys.argv[2])
import cst_onejob_stage_watchdog_candidate as watchdog
from cst_onejob_stage_relock_controller import ROLE_QUERY, ACTIVE_QUERY, NOLOGIN_QUERY, TERMINATE_QUERY
counter=root/"attempt"
attempt=int(counter.read_text())+1 if counter.exists() else 1
with counter.open("w") as fh:
    fh.write(str(attempt))
    fh.flush()
    os.fsync(fh.fileno())
if attempt == 1:
    os.kill(os.getpid(),signal.SIGKILL)
if attempt != 2:
    raise RuntimeError("UNEXPECTED_RESTART_COUNT")
state={"login":1,"sessions":1}
def query(statement):
    if statement == ROLE_QUERY:
        return [[state["login"],0,0,0,1]]
    if statement == ACTIVE_QUERY:
        return [[state["sessions"]]]
    if statement == NOLOGIN_QUERY:
        state["login"]=0
        return []
    if statement == TERMINATE_QUERY:
        state["sessions"]=0
        return [[1]]
    raise RuntimeError("UNAUTHORIZED_SYNTHETIC_SQL")
now=datetime.now(timezone.utc)
lease={
    "project":watchdog.PROJECT,
    "nonce":"a"*32,
    "sourceSha":"b"*40,
    "issuedAt":now-timedelta(seconds=40),
    "expiresAt":now+timedelta(minutes=2),
    "heartbeatAt":now-timedelta(seconds=30),
    "state":"ACTIVE"
}
status=watchdog.check_once(query,lambda:lease,now=now,approved_source_sha="b"*40)
assert status["status"]=="RELOCKED_STALE_OR_ABSENT_LEASE",status
assert state=={"login":0,"sessions":0},state
payload={
    "result":"PASS",
    "source":"SYNTHETIC_ONLY",
    "systemdRestartAfterSIGKILL":True,
    "attemptCount":attempt,
    "heartbeatRejected":True,
    "roleRelocked":True,
    "residualSessions":0,
    "supabaseAccess":False,
    "realWatchdogInstalled":False,
    "vpsRebootProven":False,
    "supavisorDrainingProven":False,
    "operationalDecision":"NO_GO"
}
dest=root/"result.json"
scratch=root/"result.tmp"
with scratch.open("w") as fh:
    json.dump(payload,fh,sort_keys=True)
    fh.flush()
    os.fsync(fh.fileno())
os.replace(scratch,dest)
PY
chmod 0644 "$runner"
systemd-run --quiet --collect --unit "$unit" \
  --property=Restart=on-abnormal \
  --property=RestartSec=1s \
  --property=StartLimitIntervalSec=30 \
  --property=StartLimitBurst=3 \
  --property=TimeoutStartSec=30 \
  --property=ProtectSystem=strict \
  --property=ReadWritePaths="$tmp" \
  --property=ProtectHome=yes \
  --property=PrivateTmp=yes \
  --property=NoNewPrivileges=yes \
  --property=MemoryMax=128M \
  /usr/bin/python3 -B "$runner" "$tmp" "$repo/scripts/dev" >/dev/null
for count in $(seq 1 90); do
  [[ -s "$tmp/result.json" ]] && break
  if [[ "$(systemctl is-failed "$unit.service" 2>/dev/null || :)" == failed ]]; then
    echo QA_SYSTEMD_TRANSIENT_FAILED
    exit 2
  fi
  sleep .25
done
[[ -s "$tmp/result.json" ]] || { echo QA_NO_RESTART_RESULT; exit 2; }
/usr/bin/python3 - "$tmp/result.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]))
assert p["attemptCount"]==2 and p["systemdRestartAfterSIGKILL"]
assert p["roleRelocked"] and p["residualSessions"]==0
assert p["realWatchdogInstalled"] is False
assert p["operationalDecision"]=="NO_GO"
print("CST_GATEA_SYSTEMD_WATCHDOG_RESTART_QA_PASS "+json.dumps(p,sort_keys=True))
PY
