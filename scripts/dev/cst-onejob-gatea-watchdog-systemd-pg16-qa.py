#!/usr/bin/env python3
"""Disposable Gate-A watchdog: systemd SIGKILL restart + persisted PostgreSQL16 relock.

NO real CST database, Supavisor, network, credentials, permanent unit or host reboot.
The sole Docker PostgreSQL instance uses --network none and is removed in finally.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NAME = "cst-gatea-wd-pgqa-" + str(os.getpid())
UNIT = "cst-gatea-wd-pgqa-" + str(os.getpid())
ROLE = "cst_team_model_pilot_stage_login"
RUNNER = r"""
import json,os,signal,subprocess,sys
from datetime import datetime,timezone
from pathlib import Path
base=Path(sys.argv[1])
sys.path.insert(0,sys.argv[2])
import cst_onejob_stage_watchdog_candidate as watchdog
container=sys.argv[3]
count=base/"attempt"
n=int(count.read_text())+1 if count.exists() else 1
with count.open("w") as f:
    f.write(str(n))
    f.flush()
    os.fsync(f.fileno())
if n == 1:
    os.kill(os.getpid(),signal.SIGKILL)
if n != 2:
    raise RuntimeError("RESTART_COUNT_INVALID")
def query(sql):
    p=subprocess.run(["docker","exec","-i",container,"psql","-X","-qAt",
        "-F","|","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres"],
        input=sql,text=True,capture_output=True,timeout=25)
    if p.returncode:
        raise RuntimeError("DISPOSABLE_PG_QUERY_FAILED")
    return [line.split("|") for line in p.stdout.splitlines() if line.strip()]
def read_lease():
    rows=query("SELECT project,nonce,source_sha,issued_at,expires_at,heartbeat_at,state FROM qa_stage_lease")
    if len(rows)!=1 or len(rows[0])!=7:
        raise RuntimeError("DURABLE_LEASE_MISSING")
    v=rows[0]
    return dict(zip(("project","nonce","sourceSha","issuedAt","expiresAt","heartbeatAt","state"),
        (v[0],v[1],v[2],*(datetime.fromisoformat(s.replace(" ","T")) for s in v[3:6]),v[6])))
result=watchdog.check_once(query,read_lease,now=datetime.now(timezone.utc),approved_source_sha="b"*40)
if result["status"]!="RELOCKED_STALE_OR_ABSENT_LEASE":
    raise RuntimeError("WATCHDOG_RELOCK_NOT_TRIGGERED")
if query(watchdog.ROLE_QUERY)!=[["0","0","0","0","1"]]:
    raise RuntimeError("ROLE_RELOCK_READBACK_FAILED")
if query(watchdog.ACTIVE_QUERY)!=[["0"]]:
    raise RuntimeError("POST_RELOCK_SESSION_NOT_ZERO")
output={"result":"PASS","watchdogRestarts":n-1,
    "independentSystemdRestartAfterSIGKILL":True,
    "leasePersistedInPostgres":True,"staleHeartbeatRejected":True,
    "relockedRole":True,"residualStageSessions":0,
    "realCstDevDbTouched":False,"prodTouched":False,
    "hostVpsRebootTested":False,"supavisorDrainTested":False,
    "realWatchdogInstalled":False,"operationalDecision":"NO_GO"}
tmp=base/"result.tmp"
with tmp.open("w") as f:
    json.dump(output,f,sort_keys=True)
    f.flush()
    os.fsync(f.fileno())
os.replace(tmp,base/"result.json")
"""

def run(args, *, input=None, allow_failure=False, timeout=45):
    p = subprocess.run(args, input=input, capture_output=True, text=True, timeout=timeout)
    if p.returncode and not allow_failure:
        raise RuntimeError("QA_COMMAND_FAILED_" + str(p.returncode) + "_" + str(args[0]))
    return p

def sql(statement, user="postgres", allow_failure=False):
    return run(["docker","exec","-i",NAME,"psql","-X","-qAt",
        "-F","|","-v","ON_ERROR_STOP=1","-U",user,"-d","postgres"],
        input=statement,allow_failure=allow_failure)

def query(statement):
    return [row.split("|") for row in sql(statement).stdout.splitlines() if row.strip()]

def assert_true(test, label):
    if not test:
        raise RuntimeError("QA_" + label)

def main():
    assert_true(os.geteuid()==0,"ROOT_REQUIRED")
    assert_true(shutil.which("systemd-run") is not None, "SYSTEMD_MISSING")
    base=Path(tempfile.mkdtemp(prefix="cst-gatea-wd-pgqa-",dir="/run"))
    container_created=False
    try:
        run(["docker","run","-d","--rm","--network","none",
            "--name",NAME,"--memory","384m","--cpus","1",
            "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"],timeout=90)
        container_created=True
        for _ in range(120):
            ready=run(["docker","exec",NAME,"psql","-U","postgres","-d","postgres",
                "-X","-qAt","-c","SELECT 1"],allow_failure=True)
            if ready.returncode==0 and ready.stdout.strip()=="1":
                break
            time.sleep(.2)
        else:
            raise RuntimeError("POSTGRES16_NOT_READY")
        sql("CREATE ROLE "+ROLE+" NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 1;")
        sql("CREATE ROLE cst_gatea_qa_unrelated NOLOGIN NOBYPASSRLS;")
        sql("CREATE TABLE qa_stage_lease(project text, nonce text, source_sha text,"
            "issued_at timestamptz,expires_at timestamptz,heartbeat_at timestamptz,state text);")
        sql("INSERT INTO qa_stage_lease VALUES ('xssrfshdrtdfupgqwfdw',"
            "'"+("e"*32)+"','"+("b"*40)+"',now()-interval '50 seconds',"
            "now()+interval '3 minutes',now()-interval '30 seconds','ACTIVE');")
        sql("ALTER ROLE "+ROLE+" LOGIN VALID UNTIL '2099-01-01';")
        run(["docker","exec","-d",NAME,"psql","-X","-qAt","-U",ROLE,
            "-d","postgres","-c","SELECT pg_sleep(55)"])
        for _ in range(50):
            if query("SELECT count(*) FROM pg_stat_activity WHERE usename='"+ROLE+"'")==[["1"]]:
                break
            time.sleep(.1)
        else:
            raise RuntimeError("REAL_SYNTHETIC_SESSION_NOT_FOUND")
        runner=base/"watchdog.py"
        runner.write_text(RUNNER)
        run(["systemd-run","--quiet","--collect","--unit",UNIT,
            "--property=Restart=on-abnormal",
            "--property=RestartSec=1s",
            "--property=StartLimitIntervalSec=30",
            "--property=StartLimitBurst=3",
            "--property=ProtectSystem=strict",
            "--property=ReadWritePaths="+str(base),
            "--property=PrivateTmp=yes",
            "--property=NoNewPrivileges=yes",
            "--property=MemoryMax=160M",
            "/usr/bin/python3","-B",str(runner),str(base),str(ROOT),NAME])
        for _ in range(100):
            if (base/"result.json").is_file():
                break
            time.sleep(.2)
        else:
            raise RuntimeError("INDEPENDENT_WATCHDOG_AUTO_RESTART_NOT_OBSERVED")
        data=json.loads((base/"result.json").read_text())
        assert_true(data["watchdogRestarts"]==1,"RESTART_COUNTER")
        assert_true(data["residualStageSessions"]==0,"ACTIVE_SESSION_AFTER_RELOCK")
        assert_true(query("SELECT rolcanlogin::int FROM pg_roles WHERE rolname='cst_gatea_qa_unrelated'")==[["0"]],"UNRELATED_ROLE_DRIFT")
        assert_true(sql("SELECT 1",user=ROLE,allow_failure=True).returncode!=0,"NEW_STAGE_LOGIN_STILL_ALLOWED")
        print("CST_GATEA_SYSTEMD_PG16_RESTART_DISPOSABLE_PASS "+
            json.dumps(data,sort_keys=True),flush=True)
    finally:
        run(["systemctl","stop",UNIT+".service"],allow_failure=True,timeout=20)
        if container_created:
            run(["docker","rm","-f",NAME],allow_failure=True,timeout=30)
        shutil.rmtree(base,ignore_errors=True)

if __name__=="__main__":
    try:
        main()
    except Exception as exc:
        print("CST_GATEA_SYSTEMD_PG16_RESTART_DISPOSABLE_FAIL "+str(exc)[:180],flush=True)
        sys.exit(2)
