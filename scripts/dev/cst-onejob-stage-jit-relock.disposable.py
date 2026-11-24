#!/usr/bin/env python3
"""CST-DEV staging JIT login/relock rehearsal: ISOLATED PostgreSQL16 only.

This intentionally does not open any network or connected database, read
systemd secrets, publish a release service or mutate a Supabase role.
Proves disabling login is insufficient without terminating old sessions.
"""
from __future__ import annotations
import json
import os
import subprocess
import sys
import time

NAME="cst-onejob-jit-relock-qa-"+str(os.getpid())
ROLE="cst_team_model_pilot_stage_login"

def run(args, sql=None, *, allow=False, timeout=30):
    p=subprocess.run(args,input=sql,text=True,capture_output=True,timeout=timeout)
    if p.returncode and not allow:
        raise RuntimeError("ISOLATED_QA_COMMAND_DENIED")
    return p

def sql(q, *, user="postgres",allow=False):
    return run(["docker","exec","-i",NAME,"psql","-X","-qAt",
                "-v","ON_ERROR_STOP=1","-U",user,"-d","postgres"],q,allow=allow)

def assert_true(test,label):
    if not test:raise RuntimeError(label)

def main():
    run(["docker","run","-d","--rm","--network","none","--name",NAME,
         "--memory","384m","--cpus","1",
         "-e","POSTGRES_DB=postgres",
         "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"],timeout=90)
    try:
        for _ in range(120):
            p=run(["docker","exec",NAME,"pg_isready","-h","127.0.0.1",
                   "-U","postgres","-d","postgres"],allow=True)
            if p.returncode==0:break
            time.sleep(.25)
        else:raise RuntimeError("FINAL_POSTGRES_NOT_READY")
        sql("CREATE ROLE "+ROLE+" NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 1;")
        assert_true(sql("SELECT NOT rolcanlogin AND NOT rolbypassrls AND rolconnlimit=1 FROM pg_roles WHERE rolname='"+ROLE+"';").stdout.strip()=="t","BASELINE_FAIL")

        # Only a synthetic short JIT window is opened in this disposable DB.
        sql("ALTER ROLE "+ROLE+" LOGIN VALID UNTIL '2099-01-01';")
        assert_true(sql("SELECT rolcanlogin FROM pg_roles WHERE rolname='"+ROLE+"';").stdout.strip()=="t","LOGIN_NOT_OPEN")
        # Start an established session, and capture its PID without printing credentials.
        client=run(["docker","exec","-d",NAME,"psql","-U",ROLE,"-d","postgres",
                    "-c","SELECT pg_sleep(80)"],timeout=10)
        assert_true(client.returncode==0,"SESSION_NOT_LAUNCHED")
        pid=None
        for _ in range(40):
            rows=sql("SELECT pid FROM pg_stat_activity WHERE usename='"+ROLE+"' AND pid<>pg_backend_pid() ORDER BY pid;").stdout.split()
            if rows:pid=int(rows[0]);break
            time.sleep(.1)
        assert_true(pid is not None,"ESTABLISHED_SESSION_NOT_OBSERVED")

        # Relock and disconnect exactly this dedicated role, never the shared runtime.
        sql("ALTER ROLE "+ROLE+" NOLOGIN CONNECTION LIMIT 1;")
        # Existing active session can still be visible after NOLOGIN.
        sessions_before=sql("SELECT count(*) FROM pg_stat_activity WHERE usename='"+ROLE+"';").stdout.strip()
        assert_true(int(sessions_before)>=1,"NOLOGIN_DID_NOT_PRESERVE_EXISTING_SESSION_FOR_PROOF")
        # Terminate only named-role sessions, and verify zero residual.
        result=sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='"+ROLE+"' AND pid<>pg_backend_pid();").stdout.strip()
        assert_true("t" in result,"TERM_DID_NOT_SUCCEED")
        for _ in range(30):
            if sql("SELECT count(*) FROM pg_stat_activity WHERE usename='"+ROLE+"';").stdout.strip()=="0":break
            time.sleep(.1)
        else:raise RuntimeError("RESIDUAL_STAGE_SESSION")
        assert_true(sql("SELECT NOT rolcanlogin AND NOT rolbypassrls AND rolconnlimit=1 FROM pg_roles WHERE rolname='"+ROLE+"';").stdout.strip()=="t","ROLE_RELOCK_INVARIANT_FAILED")
        # A fresh connection, even with trust auth, must now be rejected.
        denied=sql("SELECT 1;",user=ROLE,allow=True)
        assert_true(denied.returncode!=0,"NEW_STAGE_CONNECTION_NOT_DENIED")

        print("CST_STAGE_JIT_RELOCK_DISPOSABLE_PASS "+json.dumps({
            "project":"SYNTHETIC_POSTGRES16_ONLY",
            "network":"none","loginOpened":True,"existingSessionObserved":True,
            "noLoginDoesNotRevokeEstablishedSession":True,
            "targetedSessionTermination":True,"residualRoleSessions":0,
            "newLoginDenied":True,"roleBypassRls":False,"roleConnLimit":1,
            "connectedCstDevTouched":False,"prodTouched":False,
            "releaseDecision":"NO_GO"},sort_keys=True))
    finally:
        run(["docker","rm","-f",NAME],allow=True,timeout=20)

if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("CST_STAGE_JIT_RELOCK_DISPOSABLE_FAIL "+str(exc)[:120])
        sys.exit(2)
