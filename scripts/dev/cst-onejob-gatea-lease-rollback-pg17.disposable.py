#!/usr/bin/env python3
"""PostgreSQL17 rollback regression: creator ADMIN grant is not an unsafe actor.

Disposable isolated Docker (--network none); no Supabase, secrets, LOGIN or PROD.
"""
import os
from pathlib import Path
import subprocess
import sys
import time
import json

ROOT=Path(__file__).resolve().parents[2]
NAME="cst-gatea-lease-rollback17-qa-"+str(os.getpid())
BASE=(ROOT/"docs/dev/cst-onejob-gatea-stage-lease.PROPOSED.sql").read_text()
APPLY=(ROOT/"docs/dev/cst-onejob-gatea-lease-acl-provision.CSTDEV-ONLY.sql").read_text()
ROLLBACK=(ROOT/"docs/dev/cst-onejob-gatea-lease-acl-rollback.CSTDEV-ONLY.sql").read_text()

def run(args,input=None,allowed=False,timeout=50):
    p=subprocess.run(args,input=input,capture_output=True,text=True,timeout=timeout)
    if p.returncode and not allowed:
        raise RuntimeError("QA_COMMAND_FAILED_"+str(args[0])+"_"+str(p.returncode)+"_"+p.stderr[-160:])
    return p

def sql(q,allowed=False):
    return run(["docker","exec","-i",NAME,"psql","-X","-qAt","-F","|",
      "-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres"],input=q,allowed=allowed)

def get(q):
    return [x.split("|") for x in sql(q).stdout.splitlines() if x.strip()]

def require(value,msg):
    if not value:raise RuntimeError("GATEA_PG17_ROLLBACK_"+msg)

def main():
    run(["docker","run","-d","--rm","--network","none","--name",NAME,
         "--cpus","1","--memory","384m","-e","POSTGRES_HOST_AUTH_METHOD=trust",
         "mirror.gcr.io/library/postgres:17-alpine"],timeout=90)
    try:
        for _ in range(110):
            ready=run(["docker","exec",NAME,"psql","-X","-qAt","-U",
              "postgres","-d","postgres","-c","SELECT 1"],allowed=True)
            if ready.returncode==0 and ready.stdout.strip()=="1":
                time.sleep(.3)
                stable=run(["docker","exec",NAME,"psql","-X","-qAt",
                  "-U","postgres","-d","postgres","-c","SELECT 1"],allowed=True)
                if stable.returncode==0 and stable.stdout.strip()=="1":break
            time.sleep(.2)
        else:raise RuntimeError("DISPOSABLE_PG17_NOT_READY")
        sql("CREATE SCHEMA ai_platform; CREATE ROLE cst_team_model_pilot_stage_login NOLOGIN NOINHERIT NOBYPASSRLS;")
        sql("SET cst_gatea.reviewed_dev_migration='true';\n"+BASE)
        sql("""CREATE ROLE cst_gatea_watchdog_relock NOLOGIN NOINHERIT NOCREATEROLE NOBYPASSRLS;
        CREATE POLICY cst_gatea_watchdog_exact_lease_read
          ON ai_platform.cst_gatea_stage_leases
          FOR SELECT TO cst_gatea_watchdog_relock
          USING (project='xssrfshdrtdfupgqwfdw');""")
        sql(APPLY)
        require(get("SELECT count(*) FROM pg_policies WHERE schemaname='ai_platform' AND tablename='cst_gatea_stage_leases'")==[["5"]],"APPLY_MUST_PRESERVE_5_POLICIES")
        # Reproduce creator's role grants observed on real Supabase PG17:
        # member postgres, ADMIN=true, INHERIT=false, SET=false.
        sql("""GRANT cst_gatea_watchdog_lease_reader,
                    cst_gatea_stage_lease_writer TO postgres
                    WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;""")
        member_rows=get("""SELECT target.rolname,member.rolname,
           m.admin_option::int,m.inherit_option::int,m.set_option::int
          FROM pg_auth_members m JOIN pg_roles target ON target.oid=m.roleid
          JOIN pg_roles member ON member.oid=m.member
          WHERE target.rolname IN ('cst_gatea_watchdog_lease_reader','cst_gatea_stage_lease_writer')
            AND member.rolname='postgres' ORDER BY target.rolname""")
        require(len(member_rows)==2 and all(x[2:]==["1","0","0"] for x in member_rows),
                "EXPECTED_ADMIN_MEMBERSHIP_NOT_REPRODUCED")
        sql("CREATE ROLE qa_untrusted NOLOGIN NOCREATEROLE NOBYPASSRLS;")
        sql("GRANT cst_gatea_stage_lease_writer TO qa_untrusted WITH ADMIN FALSE, INHERIT FALSE, SET FALSE;")
        denied=sql(ROLLBACK,allowed=True)
        require(denied.returncode!=0 and "CST_DEV_GATEA_ACL_ROLLBACK_SAFETY_DENIED" in denied.stderr,
          "UNEXPECTED_MEMBERSHIP_DID_NOT_DENY_ROLLBACK")
        require(get("SELECT count(*) FROM pg_policies WHERE schemaname='ai_platform' AND tablename='cst_gatea_stage_leases'")==[["5"]],
          "REJECTED_ROLLBACK_PARTIAL_MUTATION")
        sql("REVOKE cst_gatea_stage_lease_writer FROM qa_untrusted;")
        sql(ROLLBACK)
        require(get("SELECT count(*) FROM pg_roles WHERE rolname IN ('cst_gatea_watchdog_lease_reader','cst_gatea_stage_lease_writer')")==[["0"]],
           "ROLE_REMAINED")
        require(get("SELECT policyname FROM pg_policies WHERE schemaname='ai_platform' AND tablename='cst_gatea_stage_leases'")==[["cst_gatea_watchdog_exact_lease_read"]],
           "ORIGINAL_WATCHDOG_POLICY_REMOVED")
        require(get("SELECT relrowsecurity::int,relforcerowsecurity::int FROM pg_class WHERE oid='ai_platform.cst_gatea_stage_leases'::regclass")==[["1","1"]],
           "RLS_DISABLED")
        require(get("SELECT rolcanlogin::int FROM pg_roles WHERE rolname='cst_team_model_pilot_stage_login'")==[["0"]],
           "STAGE_LOGIN_DRIFT")
        print("CST_GATEA_LEASE_ACL_PG17_CREATOR_MEMBERSHIP_ROLLBACK_PASS "+json.dumps({
           "network":"none","postgres":17,
           "expectedPostgresAdminMembership":True,
           "unexpectedMemberDenied":True,"rollbackClean":True,
           "existingWatchdogPolicyPreserved":True,
           "stageNoLoginPreserved":True,"forcedRlsPreserved":True,
           "realDevTouched":False,"prodTouched":False,
           "operationalDecision":"NO_GO"
        },sort_keys=True))
    finally:
        run(["docker","rm","-f",NAME],allowed=True,timeout=30)

if __name__=="__main__":
    try:main()
    except Exception as err:
        print("CST_GATEA_LEASE_ACL_PG17_CREATOR_MEMBERSHIP_ROLLBACK_FAIL "+str(err)[:220],flush=True)
        sys.exit(2)