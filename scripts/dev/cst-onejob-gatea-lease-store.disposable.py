#!/usr/bin/env python3
"""CST-DEV Gate A SQL lease contract QA on disposable PostgreSQL16, network none.

This test explicitly does NOT apply a migration to Supabase CST-DEV/PROD,
provision operational credentials, generate a signed authorization,
deploy a watchdog, or enable any real role.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import time
from datetime import timezone

sys.path.insert(0,str(Path(__file__).resolve().parent))
import cst_onejob_gatea_lease_reader as lease
import cst_onejob_stage_watchdog_candidate as watchdog

NAME="cst-gatea-lease-qa-"+str(os.getpid())
ROOT=Path(__file__).resolve().parents[2]
DDL=ROOT/"docs/dev/cst-onejob-gatea-stage-lease.PROPOSED.sql"

def run(argv,input=None,allow=False,timeout=40):
    p=subprocess.run(argv,input=input,text=True,capture_output=True,timeout=timeout)
    if p.returncode!=0 and not allow:
        raise RuntimeError("GATEA_QA_COMMAND_FAILED:"+str(p.returncode)+":"+
                           p.stderr.strip()[:155])
    return p

def psql(statement,user="postgres",allow=False):
    return run(["docker","exec","-i",NAME,"psql","-X","-qAt","-F","|",
                "-v","ON_ERROR_STOP=1","-U",user,"-d","postgres"],
                input=statement,allow=allow)

def query(statement):
    return [x.strip().split("|") for x in psql(statement).stdout.splitlines()
            if x.strip()]

def need(ok,code):
    if not ok:raise RuntimeError("GATEA_QA_"+code)

def main():
    ddl=DDL.read_text()
    need("PROPOSED DATA MODEL ONLY" in ddl and "CST-DEV" in ddl, "SOURCE_WARNING_MISSING")
    # Nothing in the migration grants login, grants public access, or
    # installs a SECURITY DEFINER function. Only a deny-by-default table.
    executable=chr(10).join(line for line in ddl.splitlines()
                         if not line.lstrip().startswith("--")).upper()
    for forbidden in ("SECURITY DEFINER","ALTER ROLE ","GRANT SELECT",
                      "GRANT INSERT","CREATE POLICY ","CREATE ROLE "):
        need(forbidden not in executable,"UNSAFE_MIGRATION_TEXT_"+forbidden)
    run(["docker","run","-d","--rm","--network","none","--name",NAME,
         "--memory","384m","--cpus","1",
         "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"],timeout=90)
    try:
        for _ in range(130):
            q=run(["docker","exec",NAME,"psql","-h","127.0.0.1",
                   "-X","-qAt","-U","postgres","-d","postgres",
                   "-c","SELECT 1"],allow=True)
            if q.returncode==0 and q.stdout.strip()=="1":
                time.sleep(.25)
                ok=run(["docker","exec",NAME,"psql","-h","127.0.0.1",
                        "-X","-qAt","-U","postgres","-d","postgres",
                        "-c","SELECT 1"],allow=True)
                if ok.returncode==0 and ok.stdout.strip()=="1":break
            time.sleep(.16)
        else:raise RuntimeError("GATEA_QA_PG_NOT_READY")

        psql("CREATE SCHEMA ai_platform;")
        absent=psql(ddl,allow=True)
        need(absent.returncode!=0 and
             "CST_GATEA_PROPOSED_MIGRATION_REVIEW_REQUIRED" in absent.stderr,
             "MIGRATION_WITHOUT_REVIEW_DID_NOT_DENY")
        need(query("SELECT to_regclass('ai_platform.cst_gatea_stage_leases') IS NULL")==[["t"]],
             "GUARD_FAILURE_WROTE_TABLE")

        psql("SET cst_gatea.reviewed_dev_migration='true';\n"+ddl)
        need(query("SELECT relrowsecurity::int,relforcerowsecurity::int "
          "FROM pg_class WHERE oid='ai_platform.cst_gatea_stage_leases'::regclass")==[["1","1"]],
             "RLS_ENFORCEMENT_MISSING")
        need(query("SELECT count(*) FROM pg_policies WHERE schemaname='ai_platform' "
          "AND tablename='cst_gatea_stage_leases'")==[["0"]],
             "UNEXPECTED_RLS_POLICY_CREATED")
        need(query("SELECT count(*) FROM information_schema.role_table_grants "
          "WHERE table_schema='ai_platform' AND table_name='cst_gatea_stage_leases' "
          "AND grantee='PUBLIC'")==[["0"]],
             "UNEXPECTED_PUBLIC_GRANT")
        need(lease.read_project_lease(query) is None,"LEASE_NOT_EMPTY")
        now=lease.read_database_utc_clock(query)
        need(now.tzinfo==timezone.utc,"CLOCK_NOT_UTC")
        for invalid in (
            ("not-dev","a"*32,"b"*40,"now()","now()+interval '3 minutes'",
             "now()","ACTIVE"),
            (lease.PROJECT,"bad","b"*40,"now()","now()+interval '3 minutes'",
             "now()","ACTIVE"),
            (lease.PROJECT,"a"*32,"invalid","now()","now()+interval '3 minutes'",
             "now()","ACTIVE"),
            (lease.PROJECT,"a"*32,"b"*40,"now()","now()+interval '11 minutes'",
             "now()","ACTIVE"),
            (lease.PROJECT,"a"*32,"b"*40,"now()","now()+interval '3 minutes'",
             "now()+interval '4 minutes'","ACTIVE"),
        ):
            project,nonce,source,issued,expires,beat,state=invalid
            # Every string is a literal from this disposable test, never HTTP.
            q=("INSERT INTO ai_platform.cst_gatea_stage_leases "
               "(project,nonce,source_sha,issued_at,expires_at,heartbeat_at,state)"
               "VALUES ('"+project+"','"+nonce+"','"+source+"',"+
               issued+","+expires+","+beat+",'"+state+"')")
            need(psql(q,allow=True).returncode!=0,"UNSAFE_ROW_ACCEPTED")

        psql("INSERT INTO ai_platform.cst_gatea_stage_leases "
             "VALUES ('"+lease.PROJECT+"','"+("a"*32)+"','"+("b"*40)+"',"
             "now()-interval '45 seconds',now()+interval '3 minutes',"
             "now()-interval '30 seconds','ACTIVE')")
        info=lease.read_project_lease(query)
        need(info is not None and set(info)=={
            "project","nonce","sourceSha","issuedAt","expiresAt",
            "heartbeatAt","state"},"LEASE_SCHEMA_READER_MISMATCH")
        need(info["sourceSha"]=="b"*40 and info["state"]=="ACTIVE","LEASE_READ_DRIFT")
        need(info["issuedAt"] < info["heartbeatAt"] < info["expiresAt"],
             "LEASE_ORDER_DRIFT")
        need(psql("INSERT INTO ai_platform.cst_gatea_stage_leases "
                  "VALUES ('"+lease.PROJECT+"','"+("c"*32)+"','"+("b"*40)+"',"
                  "now(),now()+interval '3 minutes',now(),'ACTIVE')",allow=True).returncode!=0,
             "TWO_PROJECT_LEASES_ALLOWED")

        # Test RLS defense in depth, including simulated accidental SELECT
        # grant to an untrusted actor, only inside isolated PostgreSQL.
        psql("CREATE ROLE qa_untrusted NOLOGIN NOBYPASSRLS;")
        psql("GRANT USAGE ON SCHEMA ai_platform TO qa_untrusted;")
        psql("GRANT SELECT ON ai_platform.cst_gatea_stage_leases TO qa_untrusted;")
        hidden=query("SET ROLE qa_untrusted; "
                     "SELECT count(*) FROM ai_platform.cst_gatea_stage_leases;")
        need(hidden==[["0"]],"RLS_EXPOSED_LEASE")
        need(psql("SET ROLE qa_untrusted; "
                  "UPDATE ai_platform.cst_gatea_stage_leases SET state='CLOSED'",
                  allow=True).returncode!=0,"UNTRUSTED_WRITER_PERMITTED")

        # The role is a disposable mirror. It is NOT CST-DEV's actual login.
        psql("CREATE ROLE cst_team_model_pilot_stage_login "
             "NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 1;")
        psql("CREATE ROLE qa_unrelated NOLOGIN NOBYPASSRLS;")
        psql("ALTER ROLE cst_team_model_pilot_stage_login "
             "LOGIN VALID UNTIL '2099-01-01';")
        run(["docker","exec","-d",NAME,"psql","-U",
             "cst_team_model_pilot_stage_login","-d","postgres",
             "-c","SELECT pg_sleep(40)"])
        for _ in range(45):
            if query(watchdog.ACTIVE_QUERY)==[["1"]]:break
            time.sleep(.1)
        else:raise RuntimeError("GATEA_QA_STAGE_SESSION_NOT_OBSERVED")
        # Legacy disposable schema QA still exercises the existing policy;
        # restricted-runner integration is separately proven on PG17.
        outcome=watchdog.check_once(query,lambda:lease.read_project_lease(query),
            now=lease.read_database_utc_clock(query),approved_source_sha="b"*40)
        need(outcome["status"]=="RELOCKED_STALE_OR_ABSENT_LEASE",
             "LIVE_DISPOSABLE_HEARTBEAT_NOT_RELOCKED")
        need(query(watchdog.ROLE_QUERY)==[["0","0","0","0","1"]],
             "STAGE_ROLE_NOT_RELOCKED")
        need(query(watchdog.ACTIVE_QUERY)==[["0"]],"STAGE_SESSION_LEFT_OPEN")
        need(psql("SELECT 1",user="cst_team_model_pilot_stage_login",
                  allow=True).returncode!=0,"NEW_LOGIN_NOT_DENIED")
        need(query("SELECT rolcanlogin::int FROM pg_roles "
                   "WHERE rolname='qa_unrelated'")==[["0"]],
             "UNRELATED_ROLE_CHANGED")
        print("CST_GATEA_DURABLE_LEASE_SCHEMA_DISPOSABLE_PASS "+json.dumps({
            "network":"none","postgresVersion":16,
            "migrationGuardDeniedWithoutMarker":True,
            "singleProjectLeaseEnforced":True,"tenMinuteBoundaryEnforced":True,
            "wrongProjectAndNonceDenied":True,
            "rlsEnabledAndForced":True,"noPoliciesCreated":True,
            "untrustedReaderSawRows":0,"untrustedWriterDenied":True,
            "databaseClockUsed":True,
            "expiredHeartbeatTriggeredRelock":True,
            "stageLoginAfterRelockDenied":True,"residualStageSessions":0,
            "productionTouched":False,"cstDevTouched":False,
            "watchdogCredentialInstalled":False,"realAuthIssued":False,
            "releaseDecision":"NO_GO"},sort_keys=True))
    finally:
        run(["docker","rm","-f",NAME],allow=True,timeout=25)

if __name__=="__main__":
    try:
        main()
    except Exception as err:
        print("CST_GATEA_DURABLE_LEASE_SCHEMA_DISPOSABLE_FAIL "+str(err)[:250])
        sys.exit(2)