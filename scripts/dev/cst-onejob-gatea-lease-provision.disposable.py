#!/usr/bin/env python3
"""CST-DEV Gate-A lease principal + ACL atomic apply/rollback QA.

Actual PostgreSQL16 inside one Docker --network none container; never
connects to Supabase/PROD. Synthetic roles only. No real permissions,
credentials, signatures, LOGIN or webhook actions.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[2]
NAME="cst-gatea-privilege-txqa-"+str(os.getpid())
BASE=(ROOT/"docs/dev/cst-onejob-gatea-stage-lease.PROPOSED.sql").read_text()
ACL=(ROOT/"docs/dev/cst-onejob-gatea-lease-access.PROPOSED.sql").read_text()
APPLY=(ROOT/"docs/dev/cst-onejob-gatea-lease-acl-provision.CSTDEV-ONLY.sql").read_text()
ROLLBACK=(ROOT/"docs/dev/cst-onejob-gatea-lease-acl-rollback.CSTDEV-ONLY.sql").read_text()

def run(args,input=None,allow=False,timeout=40):
    p=subprocess.run(args,input=input,text=True,capture_output=True,timeout=timeout)
    if p.returncode and not allow:
        raise RuntimeError("GATEA_PROVISION_QA_COMMAND_FAILED_"+str(p.returncode)+":"+
                           p.stderr.strip()[:140])
    return p

def sql(statement,allow=False):
    return run(["docker","exec","-i",NAME,"psql","-X","-qAt","-F","|",
                "-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres"],
               input=statement,allow=allow)

def rows(statement):
    return [row.strip().split("|") for row in sql(statement).stdout.splitlines()
            if row.strip()]

def need(ok,code):
    if not ok:raise RuntimeError("GATEA_PROVISION_QA_"+code)

def main():
    # Ensure the atomic migration contains the exact ACL proposal, not a
    # silently loosened copy.
    body=ACL[ACL.index("DO $scope$"):ACL.rfind("COMMIT;")].strip()
    need(body in APPLY,"SOURCE_ACL_BLOCK_DRIFT")
    need("UPDATE (heartbeat_at)" in APPLY,"HEARTBEAT_ONLY_GRANT_MISSING")
    for source in (APPLY,ROLLBACK):
        upper="\n".join(ln for ln in source.splitlines()
            if not ln.lstrip().startswith("--")).upper()
        for denied in ("ALTER ROLE ","VALID UNTIL ","PASSWORD ","SECURITY DEFINER",
                       "BYPASSRLS TRUE","GRANT CREATEROLE"):
            need(denied not in upper,"SOURCE_FORBIDDEN_"+denied)

    run(["docker","run","-d","--rm","--network","none",
         "--name",NAME,"--memory","384m","--cpus","1",
         "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"],timeout=90)
    try:
        for _ in range(120):
            p=run(["docker","exec",NAME,"psql","-h","127.0.0.1",
                   "-X","-qAt","-U","postgres","-d","postgres",
                   "-c","SELECT 1"],allow=True)
            if p.returncode==0 and p.stdout.strip()=="1":
                time.sleep(.2)
                t=run(["docker","exec",NAME,"psql","-h","127.0.0.1",
                       "-X","-qAt","-U","postgres","-d","postgres",
                       "-c","SELECT 1"],allow=True)
                if t.returncode==0 and t.stdout.strip()=="1":break
            time.sleep(.15)
        else: raise RuntimeError("GATEA_PROVISION_QA_DB_NOT_READY")
        sql("CREATE SCHEMA ai_platform;")
        sql("CREATE ROLE cst_team_model_pilot_stage_login NOLOGIN NOINHERIT NOBYPASSRLS;")
        sql("SET cst_gatea.reviewed_dev_migration='true';\n"+BASE)

        # Exact rollback rehearsal of migration before persistent commit.
        dry=APPLY.replace("COMMIT;\n","ROLLBACK;\n")
        need(dry!=APPLY,"DRYRUN_REPLACEMENT_MISSING")
        sql(dry)
        need(rows("SELECT count(*) FROM pg_roles WHERE rolname IN "
          "('cst_gatea_watchdog_lease_reader','cst_gatea_stage_lease_writer')")==[["0"]],
          "DRYRUN_LEFT_ROLE")
        need(rows("SELECT count(*) FROM pg_policies WHERE tablename='cst_gatea_stage_leases'")==[["0"]],
          "DRYRUN_LEFT_POLICY")

        sql(APPLY)
        need(rows("SELECT count(*) FROM pg_roles WHERE rolname IN "
          "('cst_gatea_watchdog_lease_reader','cst_gatea_stage_lease_writer')"
          " AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper "
          "AND NOT rolbypassrls")==[["2"]],"ROLE_ATTRIBUTES_WRONG")
        need(rows("SELECT count(*) FROM pg_policies WHERE tablename='cst_gatea_stage_leases'")==[["4"]],
             "POLICY_COUNT_WRONG")
        need(rows("SELECT count(*) FROM ai_platform.cst_gatea_stage_leases")==[["0"]],
             "PERSISTENT_LEASE_INSERTED")
        need(rows("SELECT relrowsecurity::int,relforcerowsecurity::int "
          "FROM pg_class WHERE oid='ai_platform.cst_gatea_stage_leases'::regclass")==[["1","1"]],
          "RLS_DRIFT")

        # The migration cannot safely be applied twice.
        dup=sql(APPLY,allow=True)
        need(dup.returncode!=0 and
             "CST_DEV_GATEA_LEASE_MIGRATION_PREFLIGHT_DENIED" in dup.stderr,
             "SECOND_APPLY_NOT_REJECTED")

        # Rollback must refuse while any active lease row exists.
        sql("INSERT INTO ai_platform.cst_gatea_stage_leases VALUES "
            "('xssrfshdrtdfupgqwfdw','"+("a"*32)+"','"+("b"*40)
            +"',now()-interval '2 seconds',now()+interval '2 minutes',"
            "now()-interval '1 second','ACTIVE')")
        denied=sql(ROLLBACK,allow=True)
        need(denied.returncode!=0 and
             "CST_DEV_GATEA_ACL_ROLLBACK_SAFETY_DENIED" in denied.stderr,
             "LIVE_ROW_ROLLBACK_NOT_DENIED")
        need(rows("SELECT count(*) FROM pg_policies WHERE tablename='cst_gatea_stage_leases'")==[["4"]],
             "REJECTED_ROLLBACK_PARTIAL_MUTATION")
        sql("DELETE FROM ai_platform.cst_gatea_stage_leases;")
        sql(ROLLBACK)
        need(rows("SELECT count(*) FROM pg_roles WHERE rolname IN "
          "('cst_gatea_watchdog_lease_reader','cst_gatea_stage_lease_writer')")==[["0"]],
          "ROLLBACK_LEFT_ROLE")
        need(rows("SELECT count(*) FROM pg_policies WHERE tablename='cst_gatea_stage_leases'")==[["0"]],
          "ROLLBACK_LEFT_POLICY")
        need(rows("SELECT relrowsecurity::int,relforcerowsecurity::int "
          "FROM pg_class WHERE oid='ai_platform.cst_gatea_stage_leases'::regclass")==[["1","1"]],
          "ROLLBACK_DISABLED_RLS")
        need(rows("SELECT count(*) FROM ai_platform.cst_gatea_stage_leases")==[["0"]],
          "ROLLBACK_LEFT_LEASE")
        need(rows("SELECT rolcanlogin::int FROM pg_roles "
          "WHERE rolname='cst_team_model_pilot_stage_login'")==[["0"]],
          "STAGE_LOGIN_MUTATED")
        print("CST_GATEA_ATOMIC_ROLE_ACL_ROLLBACK_DISPOSABLE_PASS "+json.dumps({
           "postgres":16,"network":"none","baseTablePreserved":True,
           "twoNoLoginRoles":True,"atomicApply":True,
           "dryrunRollbackNoResidue":True,
           "duplicateApplyDenied":True,
           "nonEmptyRollbackDeniedWithoutPartialChanges":True,
           "emptyRollbackRemovedRolesAndPolicies":True,
           "forcedRlsPreserved":True,
           "stageLoginRemainedNoLogin":True,
           "realCstDevUntouched":True,"prodUntouched":True,
           "relockCredentialCreated":False,"releaseDecision":"NO_GO"
        },sort_keys=True))
    finally:
        run(["docker","rm","-f",NAME],allow=True,timeout=20)

if __name__=="__main__":
    try: main()
    except Exception as exc:
        print("CST_GATEA_ATOMIC_ROLE_ACL_ROLLBACK_DISPOSABLE_FAIL "+str(exc)[:200])
        sys.exit(2)
