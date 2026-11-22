#!/usr/bin/env python3
"""Actual PostgreSQL16 watchdog stale-heartbeat containment, network none.

A synthetic stage role opens a long-lived session; watchdog policy is invoked
through a separate administrative SQL callback after a durable lease heartbeat
becomes stale. QA does NOT kill a real launcher or install a daemon.
No live DB, Supabase, signer, technical authority, or source deployment.
"""
import json,os,sys,subprocess,time
from pathlib import Path
from datetime import datetime,timedelta,timezone
sys.path.insert(0,str(Path(__file__).resolve().parent))
import cst_onejob_stage_watchdog_candidate as w

NAME="cst-stage-watchdog-disposable-"+str(os.getpid())
def run(argv,input=None,allowed=False,timeout=45):
    p=subprocess.run(argv,input=input,text=True,capture_output=True,timeout=timeout)
    if p.returncode and not allowed:raise RuntimeError("QA_COMMAND_FAILED_"+str(p.returncode))
    return p
def sql(q,user="postgres",allowed=False):
    return run(["docker","exec","-i",NAME,"psql","-X","-qAt","-F","|",
                "-v","ON_ERROR_STOP=1","-U",user,"-d","postgres"],input=q,allowed=allowed)
def query(q):
    return [line.strip().split("|") for line in sql(q).stdout.splitlines() if line.strip()]
def verify(ok,label):
    if not ok:raise RuntimeError("QA_"+label)
def main():
    run(["docker","run","-d","--rm","--network","none","--name",NAME,
         "--memory","384m","--cpus","1",
         "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"],timeout=90)
    try:
        for _ in range(130):
            q=run(["docker","exec",NAME,"psql","-h","127.0.0.1","-X","-qAt",
                   "-U","postgres","-d","postgres","-c","SELECT 1"],allowed=True)
            if q.returncode==0 and q.stdout.strip()=="1":
                time.sleep(.2)
                break
            time.sleep(.15)
        else:raise RuntimeError("PG_NOT_READY")
        sql("CREATE ROLE cst_team_model_pilot_stage_login NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 1;")
        sql("CREATE ROLE cst_watchdog_unrelated NOLOGIN NOBYPASSRLS;")
        sql("CREATE TABLE qa_stage_lease(project text PRIMARY KEY, nonce text NOT NULL,"
            " source_sha text NOT NULL, issued_at timestamptz NOT NULL,"
            " expires_at timestamptz NOT NULL, heartbeat_at timestamptz NOT NULL,"
            " state text NOT NULL);")
        now=datetime.now(timezone.utc)
        fmt=lambda d:d.strftime("%Y-%m-%d %H:%M:%S+00")
        sql("INSERT INTO qa_stage_lease VALUES ('"+w.PROJECT+"','"+("e"*32)+"','"+("b"*40)
            +"','"+fmt(now-timedelta(seconds=50))+"','"+fmt(now+timedelta(minutes=3))
            +"','"+fmt(now-timedelta(seconds=25))+"','ACTIVE');")
        # Separate synthetic JIT launcher opens the role, starts a real
        # database session and remains alive. It is then SIGKILLed before
        # a DIFFERENT watchdog process does all of the cleanup.
        launcher_child=r"""
import subprocess,sys,time
container=sys.argv[1]
def run(args,statement=None):
    p=subprocess.run(args,input=statement,text=True,capture_output=True,timeout=20)
    if p.returncode:raise RuntimeError("SYNTHETIC_LAUNCHER_SQL_FAILED")
run(["docker","exec","-i",container,"psql","-X","-qAt",
     "-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres"],
    "ALTER ROLE cst_team_model_pilot_stage_login LOGIN VALID UNTIL '2099-01-01';")
run(["docker","exec","-d",container,"psql",
     "-U","cst_team_model_pilot_stage_login","-d","postgres",
     "-c","SELECT pg_sleep(55)"])
print("SYNTHETIC_LAUNCHER_OPENED_ROLE",flush=True)
time.sleep(60)
"""
        launcher=subprocess.Popen([sys.executable,"-B","-c",launcher_child,NAME],
                                  stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            verify(launcher.stdout.readline().strip()=="SYNTHETIC_LAUNCHER_OPENED_ROLE",
                   "LAUNCHER_DID_NOT_OPEN_ROLE")
            for _ in range(40):
                if query(w.ACTIVE_QUERY)==[["1"]]:break
                time.sleep(.1)
            else:raise RuntimeError("ORPHAN_SESSION_NOT_OBSERVED")
            before=query(w.ROLE_QUERY)
            launcher.kill()
            launcher.wait(timeout=5)
            verify(launcher.returncode==-9,"LAUNCHER_SIGKILL_NOT_OBSERVED")
            verify(query(w.ACTIVE_QUERY)==[["1"]],
                   "ORPHAN_DID_NOT_SURVIVE_LAUNCHER_SIGKILL")
        finally:
            if launcher.poll() is None:
                launcher.kill()
                launcher.wait(timeout=5)
        # A separate watchdog process now reads the durable SQL heartbeat
        # and terminates the orphaned session left by the killed launcher.
        watchdog_child=r"""
import sys,subprocess,json
from datetime import datetime,timezone
sys.path.insert(0,sys.argv[1])
import cst_onejob_stage_watchdog_candidate as w
container=sys.argv[2]
def query(statement):
    p=subprocess.run(["docker","exec","-i",container,"psql","-X","-qAt",
      "-F","|","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres"],
      input=statement,text=True,capture_output=True,timeout=20)
    if p.returncode:raise RuntimeError("DISPOSABLE_CHILD_SQL_DENIED")
    return [line.strip().split("|") for line in p.stdout.splitlines() if line.strip()]
def lease():
    rows=query("SELECT project,nonce,source_sha,issued_at,expires_at,heartbeat_at,state FROM qa_stage_lease")
    if len(rows)!=1:raise RuntimeError("DISPOSABLE_CHILD_LEASE_INVALID")
    v=rows[0]
    return dict(zip(("project","nonce","sourceSha","issuedAt","expiresAt","heartbeatAt","state"),
     [v[0],v[1],v[2],*(datetime.fromisoformat(t.replace(" ","T")) for t in v[3:6]),v[6]]))
status=w.check_once(query,lease,now=datetime.now(timezone.utc),approved_source_sha="b"*40)
if status["status"]!="RELOCKED_STALE_OR_ABSENT_LEASE":
    raise RuntimeError("DISPOSABLE_CHILD_NOT_RELOCKED")
print("INDEPENDENT_WATCHDOG_CHILD_RELOCK_PASS")
"""
        child=run([sys.executable,"-B","-c",watchdog_child,
                   str(Path(__file__).resolve().parent),NAME],timeout=40)
        verify("INDEPENDENT_WATCHDOG_CHILD_RELOCK_PASS" in child.stdout,
               "INDEPENDENT_WATCHDOG_DID_NOT_RELOCK")
        verify(query(w.ROLE_QUERY)==[["0","0","0","0","1"]],"ROLE_STILL_OPEN")
        verify(query(w.ACTIVE_QUERY)==[["0"]],"LIVE_SESSION_REMAINS")
        verify(sql("SELECT 1;",user="cst_team_model_pilot_stage_login",allowed=True).returncode!=0,"NEW_LOGIN_ALLOWED")
        verify(query("SELECT rolcanlogin::int FROM pg_roles WHERE rolname='cst_watchdog_unrelated'")==[["0"]],"FOREIGN_ROLE_CHANGED")
        print("CST_GATEA_WATCHDOG_DISPOSABLE_PASS "+json.dumps({
            "network":"none","project":"SYNTHETIC_POSTGRES16_ONLY",
            "roleInitiallyOpen":before[0][0]=="1",
            "orphanedSessionObserved":True,"durableLeaseReadFromSql":True,
            "staleHeartbeatRejected":True,"roleRelocked":True,
            "jitLauncherSigkillObserved":True,
            "separateWatchdogPythonProcessRelocked":True,
            "residualStageSessions":0,"newLoginDenied":True,
            "unrelatedRoleUnchanged":True,"realCstDevTouched":False,
            "prodTouched":False,"operationalDecision":"NO_GO"},sort_keys=True))
    finally:
        run(["docker","rm","-f",NAME],allowed=True,timeout=25)

if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("CST_GATEA_WATCHDOG_DISPOSABLE_FAIL "+str(exc)[:140])
        sys.exit(2)
