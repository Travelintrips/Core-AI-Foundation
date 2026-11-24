#!/usr/bin/env python3
"""Privileged relock-only function authorization QA on disposable PostgreSQL17.

Network none; no real Supabase/database secret; no live user, signer or service.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).resolve().parent))
import cst_onejob_stage_watchdog_runner as runner
DDL=ROOT/"docs/dev/cst-gatea-relock-only.CSTDEV-ONLY.PROPOSED.sql"
ROLLBACK=ROOT/"docs/dev/cst-gatea-relock-only.ROLLBACK-CSTDEV-ONLY.sql"
NAME="cst-gatea-relock-only-pg17-"+str(os.getpid())
STAGE="cst_team_model_pilot_stage_login"
WATCHER="cst_gatea_watchdog_relock"
RELOCK_SQL="SELECT role_login::int,remaining_sessions,scope_ok::int FROM cst_gatea_relock_private.relock_stage_now();"

def run(argv,*,input=None,allow_failure=False,timeout=45):
    p=subprocess.run(argv,input=input,text=True,capture_output=True,timeout=timeout)
    if p.returncode and not allow_failure:
        raise RuntimeError("QA_CMD_FAIL_"+str(argv[0])+"_"+str(p.returncode)+"_"+p.stderr[-200:])
    return p

def sql(statement,user="postgres",allow_failure=False):
    return run(["docker","exec","-i",NAME,"psql","-X","-qAt","-v",
       "ON_ERROR_STOP=1","-F","|","-U",user,"-d","postgres"],
       input=statement,allow_failure=allow_failure)

def rows(statement,user="postgres"):
    return [line.split("|") for line in sql(statement,user).stdout.strip().splitlines()
            if line]

def need(ok,msg):
    if not ok:raise RuntimeError("GATEA_RELOCK_ONLY_"+msg)

def main():
    run(["docker","run","-d","--rm","--network","none","--name",NAME,
         "--memory","384m","--cpus","1",
         "-e","POSTGRES_HOST_AUTH_METHOD=trust",
         "mirror.gcr.io/library/postgres:17-alpine"],timeout=90)
    try:
        for _ in range(120):
            r=run(["docker","exec",NAME,"psql","-qAt","-U","postgres",
                   "-d","postgres","-c","SELECT 1"],allow_failure=True)
            if r.returncode==0 and r.stdout.strip()=="1":
                time.sleep(.4)
                stable=run(["docker","exec",NAME,"psql","-qAt","-U",
                       "postgres","-d","postgres","-c","SELECT 1"],
                       allow_failure=True)
                if stable.returncode==0 and stable.stdout.strip()=="1":
                    break
            time.sleep(.2)
        else:raise RuntimeError("DISPOSABLE_PG17_NOT_READY")
        sql("""CREATE SCHEMA ai_platform;
CREATE ROLE cst_team_model_pilot_stage_login
 NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER CONNECTION LIMIT 1;
CREATE ROLE qa_untrusted NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE TABLE ai_platform.cst_onejob_owner_approvals(status text);
CREATE TABLE ai_platform.cst_gatea_stage_leases(
 project text PRIMARY KEY,
 nonce text NOT NULL,source_sha text NOT NULL,
 issued_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 heartbeat_at timestamptz NOT NULL,state text NOT NULL);
ALTER TABLE ai_platform.cst_gatea_stage_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.cst_gatea_stage_leases FORCE ROW LEVEL SECURITY;""")
        sql(DDL.read_text())
        need(rows("SELECT rolcanlogin::int,rolcreaterole::int,rolbypassrls::int,"
                  "rolsuper::int FROM pg_roles WHERE rolname='"+WATCHER+"'")==
             [["0","0","0","0"]],"WATCHER_ROLE_SCOPE")
        need(rows("SELECT count(*) FROM pg_policies WHERE schemaname='ai_platform' "
                  "AND tablename='cst_gatea_stage_leases'")==[["1"]],
             "EXACTLY_ONE_LEASE_READER_POLICY")
        # No client connects as watchdog until an independently approved login.
        need(sql("SELECT 1",user=WATCHER,allow_failure=True).returncode!=0,
             "WATCHER_LOGIN_OPEN_UNEXPECTED")
        # Synthetic QA-only LOGINs. Never execute the following on live DEV.
        sql("ALTER ROLE "+WATCHER+" LOGIN; ALTER ROLE qa_untrusted LOGIN;")
        need(sql("SELECT * FROM cst_gatea_relock_private.relock_stage_now()",
                 user="qa_untrusted",allow_failure=True).returncode!=0,
             "UNTRUSTED_EXEC_GRANTED")
        need(sql("SELECT * FROM cst_gatea_relock_private.relock_stage_now()",
                 user="postgres",allow_failure=True).returncode!=0,
             "POSTGRES_SESSION_GUARD_IGNORED")
        for banned in (
           "ALTER ROLE "+STAGE+" LOGIN;",
           "ALTER ROLE "+STAGE+" NOLOGIN;",
           "CREATE ROLE qa_attacker LOGIN;",
           "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid<>pg_backend_pid();",
           "CREATE FUNCTION cst_gatea_relock_private.evil() RETURNS int LANGUAGE SQL AS 'SELECT 1';",
        ):
            need(sql(banned,user=WATCHER,allow_failure=True).returncode!=0,
                 "WATCHER_PRIVILEGE_ESCAPED")
        need(rows(RELOCK_SQL,user=WATCHER)==[["0","0","1"]],
             "CLOSED_BASELINE_FUNCTION_REJECTED")
        # Even accidental privileges cannot let other roles call the definer.
        sql("""INSERT INTO ai_platform.cst_gatea_stage_leases VALUES (
'xssrfshdrtdfupgqwfdw',
'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
now()-interval '30 seconds',now()+interval '5 minutes',now(),'ACTIVE');""")
        need(rows("SELECT count(*) FROM ai_platform.cst_gatea_stage_leases",
                  user=WATCHER)==[["1"]],"WATCHER_CANNOT_READ_BOUND_LEASE")
        need(sql("UPDATE ai_platform.cst_gatea_stage_leases SET state='CLOSED'",
                 user=WATCHER,allow_failure=True).returncode!=0,
             "WATCHER_CAN_WRITE_LEASE")
        need(sql("SELECT * FROM ai_platform.cst_onejob_owner_approvals",
                 user=WATCHER,allow_failure=True).returncode!=0,
             "WATCHER_CAN_READ_OTHER_TABLE")
        sql("ALTER ROLE "+STAGE+" LOGIN VALID UNTIL '2099-01-01';")
        run(["docker","exec","-d",NAME,"psql","-X","-qAt","-U",STAGE,
             "-d","postgres","-c","SELECT pg_sleep(45);"])
        for _ in range(45):
            if rows("SELECT count(*) FROM pg_stat_activity WHERE usename='"+STAGE+"'")==[["1"]]:
                break
            time.sleep(.12)
        else:raise RuntimeError("STAGE_SESSION_NOT_ESTABLISHED")
        # The real Python watchdog is the caller: test the complete composed
        # DB UTC clock -> RLS lease read -> stale heartbeat -> fixed function.
        sql("UPDATE ai_platform.cst_gatea_stage_leases "
            "SET issued_at=now()-interval '50 seconds', "
            "heartbeat_at=now()-interval '30 seconds'")
        def watcher_query(statement):
            return rows(statement,user=WATCHER)
        outcome=runner.run_watchdog_check(watcher_query,"b"*40)
        need(outcome["status"]=="RELOCKED_STALE_OR_ABSENT_LEASE",
             "COMPOSED_RUNNER_FAILED_TO_RELOCK")
        got=rows(RELOCK_SQL,user=WATCHER)  # repeated containment idempotent
        need(got==[["0","0","1"]],"STAGE_RELOCK_RESULT_"+str(got))
        need(rows("SELECT rolcanlogin::int FROM pg_roles WHERE rolname='"+STAGE+"'")==[["0"]],
             "STAGE_ROLE_STILL_LOGIN")
        need(rows("SELECT count(*) FROM pg_stat_activity WHERE usename='"+STAGE+"'")==[["0"]],
             "STAGE_SESSIONS_REMAIN")
        need(sql("SELECT 1",user=STAGE,allow_failure=True).returncode!=0,
             "NEW_STAGE_LOGIN_ALLOWED")
        need(rows("SELECT rolcanlogin::int FROM pg_roles WHERE rolname='qa_untrusted'")==[["1"]],
             "UNRELATED_ROLE_CHANGED")
        need(rows("SELECT has_function_privilege('anon',"
                  "'cst_gatea_relock_private.relock_stage_now()','EXECUTE')")==[["f"]] if
             rows("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon')")==[["t"]] else True,
             "ANON_FUNCTION_EXEC_GIVEN")
        # Rollback is deliberately forbidden while any lease is present.
        sql("ALTER ROLE "+WATCHER+" NOLOGIN;")
        need(sql(ROLLBACK.read_text(),allow_failure=True).returncode!=0,
             "ROLLBACK_WITH_ACTIVE_LEASE_WAS_ALLOWED")
        sql("DELETE FROM ai_platform.cst_gatea_stage_leases;")
        sql(ROLLBACK.read_text())
        need(rows("SELECT to_regnamespace('cst_gatea_relock_private') IS NULL")==[["t"]],
             "PRIVATE_SCHEMA_REMAINED_AFTER_ROLLBACK")
        need(rows("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='"+WATCHER+"')")==[["f"]],
             "WATCHER_ROLE_REMAINED_AFTER_ROLLBACK")
        need(rows("SELECT to_regclass('ai_platform.cst_gatea_stage_leases') IS NOT NULL")==[["t"]],
             "ROLLBACK_DESTROYED_LEASE_STORAGE")
        print("CST_GATEA_RELOCK_ONLY_PG17_DISPOSABLE_PASS "+json.dumps({
          "postgres":17,"network":"none","watcherInitiallyNoLogin":True,
          "watcherNoCreateRole":True,"watcherDirectAlterDenied":True,
          "watcherDirectCreateRoleDenied":True,"postgresSessionFunctionCallDenied":True,
          "untrustedExecuteDenied":True,"watcherLeaseReadOnly":True,
          "watcherCannotReadOtherTables":True,
          "openedSyntheticStageThenRelocked":True,
          "residualStageSessions":0,"newStageLoginDenied":True,
          "rollbackActiveLeaseDenied":True,"rollbackAfterCleanPass":True,
          "realDevTouched":False,"prodTouched":False,
          "operationalDecision":"NO_GO"},sort_keys=True))
    finally:
        run(["docker","rm","-f",NAME],allow_failure=True,timeout=25)

if __name__=="__main__":
    try:main()
    except Exception as e:
        print("CST_GATEA_RELOCK_ONLY_PG17_DISPOSABLE_FAIL "+str(e)[:200],flush=True)
        sys.exit(2)