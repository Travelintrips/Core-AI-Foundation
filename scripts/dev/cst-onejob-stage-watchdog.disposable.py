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
        sql("ALTER ROLE cst_team_model_pilot_stage_login LOGIN VALID UNTIL '2099-01-01';")
        run(["docker","exec","-d",NAME,"psql","-U","cst_team_model_pilot_stage_login",
             "-d","postgres","-c","SELECT pg_sleep(55)"])
        for _ in range(40):
            if query(w.ACTIVE_QUERY)==[["1"]]:break
            time.sleep(.1)
        else:raise RuntimeError("ORPHAN_SESSION_NOT_OBSERVED")
        # This callback reads the durable lease through a separate
        # administrative SQL transaction, not Python process memory.
        def lease():
            rows=query("SELECT project,nonce,source_sha,issued_at,expires_at,"
                       "heartbeat_at,state FROM qa_stage_lease;")
            verify(len(rows)==1,"LEASE_ROW_COUNT")
            values=rows[0]
            return dict(zip(("project","nonce","sourceSha","issuedAt","expiresAt",
                             "heartbeatAt","state"),[
                values[0],values[1],values[2],
                *(datetime.fromisoformat(v.replace(" ","T")) for v in values[3:6]),
                values[6]]))
        before=query(w.ROLE_QUERY)
        verdict=w.check_once(query,lease,now=now,approved_source_sha="b"*40)
        verify(verdict["status"]=="RELOCKED_STALE_OR_ABSENT_LEASE","NOT_RELOCKED")
        verify(query(w.ROLE_QUERY)==[["0","0","0","0","1"]],"ROLE_STILL_OPEN")
        verify(query(w.ACTIVE_QUERY)==[["0"]],"LIVE_SESSION_REMAINS")
        verify(sql("SELECT 1;",user="cst_team_model_pilot_stage_login",allowed=True).returncode!=0,"NEW_LOGIN_ALLOWED")
        verify(query("SELECT rolcanlogin::int FROM pg_roles WHERE rolname='cst_watchdog_unrelated'")==[["0"]],"FOREIGN_ROLE_CHANGED")
        print("CST_GATEA_WATCHDOG_DISPOSABLE_PASS "+json.dumps({
            "network":"none","project":"SYNTHETIC_POSTGRES16_ONLY",
            "roleInitiallyOpen":before[0][0]=="1",
            "orphanedSessionObserved":True,"durableLeaseReadFromSql":True,
            "staleHeartbeatRejected":True,"roleRelocked":True,
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
