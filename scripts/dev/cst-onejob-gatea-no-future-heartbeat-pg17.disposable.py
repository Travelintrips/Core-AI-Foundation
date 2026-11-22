#!/usr/bin/env python3
"""Gate A future-heartbeat DB/RLS hardening: disposable PostgreSQL17, no network.

Uses exact official lease + relock-only + lease ACL source files from the PR,
never live CST-DEV, PROD, a Supabase credential or remote network.
"""
from __future__ import annotations
import json, os, subprocess, sys, time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
NAME="cst-gatea-no-future-qa-"+str(os.getpid())
SCHEMA=(ROOT/"docs/dev/cst-onejob-gatea-stage-lease.PROPOSED.sql").read_text()
RELOCK=(ROOT/"docs/dev/cst-gatea-relock-only.CSTDEV-ONLY.PROPOSED.sql").read_text()
ACL=(ROOT/"docs/dev/cst-onejob-gatea-lease-acl-provision.CSTDEV-ONLY.sql").read_text()
PATCH=(ROOT/"docs/dev/cst-gatea-heartbeat-no-future.CSTDEV-ONLY.sql").read_text()
ROLLBACK=(ROOT/"docs/dev/cst-gatea-heartbeat-no-future.ROLLBACK-CSTDEV-ONLY.sql").read_text()

def cmd(args,input=None,allow=False,timeout=45):
    p=subprocess.run(args,input=input,text=True,capture_output=True,timeout=timeout)
    if p.returncode and not allow:
        raise RuntimeError("QA_CMD_"+str(p.returncode)+"_"+p.stderr[-200:])
    return p

def sql(statement,allow=False):
    return cmd(["docker","exec","-i",NAME,"psql","-X","-qAt",
                "-v","ON_ERROR_STOP=1","-F","|",
                "-U","postgres","-d","postgres"],input=statement,allow=allow)
def rows(query):
    return [x.split("|") for x in sql(query).stdout.strip().splitlines() if x]
def need(condition,name):
    if not condition:raise RuntimeError("GATEA_FUTURE_HEARTBEAT_"+name)

def as_writer(statement,allow=False):
    # Only isolated postgres superuser SET ROLE into a NOLOGIN synthetic role.
    return sql("SET ROLE cst_gatea_stage_lease_writer;\n"+statement+
               "\nRESET ROLE;",allow=allow)

def main():
    cmd(["docker","run","-d","--rm","--network","none",
       "--name",NAME,"--memory","384m","--cpus","1",
       "-e","POSTGRES_HOST_AUTH_METHOD=trust",
       "mirror.gcr.io/library/postgres:17-alpine"],timeout=90)
    try:
        for _ in range(120):
            ping=cmd(["docker","exec",NAME,"psql","-qAt","-U","postgres",
              "-d","postgres","-c","SELECT 1"],allow=True)
            if ping.returncode==0 and ping.stdout.strip()=="1":
                time.sleep(.3)
                ping=cmd(["docker","exec",NAME,"psql","-qAt","-U","postgres",
                    "-d","postgres","-c","SELECT 1"],allow=True)
                if ping.returncode==0 and ping.stdout.strip()=="1":break
            time.sleep(.15)
        else:raise RuntimeError("DISPOSABLE_PG17_NOT_READY")
        sql("CREATE SCHEMA ai_platform; "
            "CREATE ROLE cst_team_model_pilot_stage_login "
            "NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 1; "
            "CREATE TABLE ai_platform.cst_onejob_owner_approvals(status text);")
        sql("SET cst_gatea.reviewed_dev_migration='true';\n"+SCHEMA)
        sql(RELOCK)
        sql(ACL)
        need(rows("SELECT count(*) FROM pg_policies WHERE schemaname='ai_platform' "
             "AND tablename='cst_gatea_stage_leases'")==[["5"]],
             "BASELINE_FIVE_POLICIES_MISSING")
        # Before the hardening patch, official RLS permits a future timestamp.
        insert_future="""INSERT INTO ai_platform.cst_gatea_stage_leases
          VALUES ('xssrfshdrtdfupgqwfdw','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          clock_timestamp(),clock_timestamp()+interval '2 minutes',
          clock_timestamp()+interval '30 seconds','ACTIVE');"""
        need(as_writer(insert_future).returncode==0,"PRE_PATCH_FUTURE_INSERT_NOT_ALLOWED")
        need(rows("SELECT count(*) FROM ai_platform.cst_gatea_stage_leases")==[["1"]],
             "PRE_PATCH_NO_ROW")
        as_writer("UPDATE ai_platform.cst_gatea_stage_leases "
                  "SET heartbeat_at=clock_timestamp()+interval '45 seconds';")
        need(rows("SELECT (heartbeat_at>clock_timestamp())::int "
                  "FROM ai_platform.cst_gatea_stage_leases")==[["1"]],
             "PRE_PATCH_FUTURE_UPDATE_NOT_POSSIBLE")
        sql("DELETE FROM ai_platform.cst_gatea_stage_leases")
        # Existing PostgreSQL17 policy grammar + role preflight must match.
        sql(PATCH)
        need(rows("SELECT count(*) FROM pg_policies WHERE schemaname='ai_platform' "
                  "AND tablename='cst_gatea_stage_leases'")==[["5"]],
             "PATCH_POLICY_COUNT_DRIFT")
        need(rows("SELECT relrowsecurity::int,relforcerowsecurity::int "
             "FROM pg_class WHERE oid='ai_platform.cst_gatea_stage_leases'::regclass")
             ==[["1","1"]],"FORCED_RLS_DRIFT")
        need(as_writer(insert_future,allow=True).returncode!=0,
             "FUTURE_INSERT_NOT_DENIED")
        insert_now="""INSERT INTO ai_platform.cst_gatea_stage_leases
          VALUES ('xssrfshdrtdfupgqwfdw','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          clock_timestamp()-interval '3 seconds',
          clock_timestamp()+interval '2 minutes',
          clock_timestamp()-interval '1 second','ACTIVE');"""
        as_writer(insert_now)
        need(as_writer("UPDATE ai_platform.cst_gatea_stage_leases "
             "SET heartbeat_at=clock_timestamp()+interval '30 seconds';",
             allow=True).returncode!=0,"FUTURE_UPDATE_NOT_DENIED")
        as_writer("UPDATE ai_platform.cst_gatea_stage_leases "
                  "SET heartbeat_at=clock_timestamp();")
        need(rows("SELECT (heartbeat_at<=clock_timestamp())::int "
                  "FROM ai_platform.cst_gatea_stage_leases")==[["1"]],
             "VALID_HEARTBEAT_LOST")
        need(as_writer("UPDATE ai_platform.cst_gatea_stage_leases "
             "SET expires_at=clock_timestamp()+interval '20 minutes';",
             allow=True).returncode!=0,"IMMUTABLE_EXPIRY_WRITABLE")
        # Rollback is forbidden with any row; no partial policy changes.
        denied=sql(ROLLBACK,allow=True)
        need(denied.returncode!=0 and
             "CST_GATEA_FUTURE_HEARTBEAT_ROLLBACK_DENIED" in denied.stderr,
             "ACTIVE_LEASE_ROLLBACK_ALLOWED")
        need(as_writer("UPDATE ai_platform.cst_gatea_stage_leases "
             "SET heartbeat_at=clock_timestamp()+interval '30 seconds';",
             allow=True).returncode!=0,"REJECTED_ROLLBACK_PARTIAL_POLICY_CHANGE")
        sql("DELETE FROM ai_platform.cst_gatea_stage_leases")
        sql(ROLLBACK)
        need(rows("SELECT with_check FROM pg_policies "
                  "WHERE schemaname='ai_platform' AND tablename='cst_gatea_stage_leases' "
                  "AND policyname='gatea_stage_lease_write_insert'")==
             [["(project = 'xssrfshdrtdfupgqwfdw'::text)"]],
             "CLEAN_ROLLBACK_DID_NOT_RESTORE")
        sql(PATCH)
        need(sql(PATCH,allow=True).returncode!=0,
             "REPEATED_HARDENING_NOT_FAIL_CLOSED")
        need(rows("SELECT rolcanlogin::int FROM pg_roles "
             "WHERE rolname='cst_team_model_pilot_stage_login'")==[["0"]],
             "STAGE_LOGIN_CHANGED")
        need(rows("SELECT rolcanlogin::int FROM pg_roles "
             "WHERE rolname='cst_gatea_watchdog_relock'")==[["0"]],
             "WATCHDOG_LOGIN_CHANGED")
        print("CST_GATEA_NO_FUTURE_HEARTBEAT_PG17_DISPOSABLE_PASS "+
          json.dumps({"network":"none","postgres":17,
            "oldWriterCouldWriteFutureHeartbeat":True,
            "futureInsertDeniedAfterPatch":True,
            "futureUpdateDeniedAfterPatch":True,
            "validInsertAndHeartbeatAllowed":True,
            "fivePoliciesPreserved":True,"forcedRlsPreserved":True,
            "rollbackDeniedWithActiveLease":True,
            "rollbackRestoredPolicies":True,
            "secondApplyDenied":True,
            "sourceShaRoleLoginUnchanged":True,"realDevTouched":False,
            "prodTouched":False,"operationalDecision":"NO_GO"},sort_keys=True))
    finally:
        cmd(["docker","rm","-f",NAME],allow=True,timeout=25)

if __name__=="__main__":
    try:main()
    except Exception as e:
        print("CST_GATEA_NO_FUTURE_HEARTBEAT_PG17_DISPOSABLE_FAIL "+str(e)[:230])
        sys.exit(2)