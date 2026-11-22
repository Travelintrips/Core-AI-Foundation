#!/usr/bin/env python3
"""CST-DEV Gate-A least-privilege lease ACL QA. NO connected Supabase/PROD.

Validates separate NOLOGIN reader/writer ACLs on a network-none disposable
PostgreSQL16. This is NOT a relock-admin permission, credential, deployment
or technical approval. All container resources are removed in finally.
"""
from __future__ import annotations
import json,os,subprocess,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import cst_onejob_gatea_lease_reader as lease
ROOT=Path(__file__).resolve().parents[2]
NAME="cst-gatea-lease-acl-qa-"+str(os.getpid())
DDL=(ROOT/"docs/dev/cst-onejob-gatea-stage-lease.PROPOSED.sql").read_text()
ACL=(ROOT/"docs/dev/cst-onejob-gatea-lease-access.PROPOSED.sql").read_text()
PROJECT="xssrfshdrtdfupgqwfdw"
READER="cst_gatea_watchdog_lease_reader"
WRITER="cst_gatea_stage_lease_writer"
TABLE="ai_platform.cst_gatea_stage_leases"

def sh(args,input=None,allow=False,timeout=35):
    p=subprocess.run(args,input=input,text=True,capture_output=True,timeout=timeout)
    if p.returncode!=0 and not allow:
        raise RuntimeError("ACL_QA_CMD_FAILED:"+str(p.returncode)+":"+p.stderr.strip()[:135])
    return p

def sql(statement,allow=False):
    return sh(["docker","exec","-i",NAME,"psql","-X","-qAt","-F","|",
      "-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres"],
      input=statement,allow=allow)

def rows(statement):
    return [r.strip().split("|") for r in sql(statement).stdout.splitlines()
            if r.strip()]

def need(good,code):
    if not good:raise RuntimeError("ACL_QA_"+code)

def as_role(role,statement,allow=False):
    return sql("SET ROLE "+role+";\n"+statement,allow=allow)

def apply_acl(allow=False):
    return sql("SET cst_gatea.reviewed_dev_migration='true';\n"+ACL,allow=allow)

def main():
    for fragment in ("CREATE ROLE ","ALTER ROLE ","SECURITY DEFINER",
                     "GRANT cst_gatea","TO PUBLIC","DATABASE_URL"):
        executable="\n".join(ln for ln in ACL.splitlines() if not ln.lstrip().startswith("--"))
        need(fragment not in executable,"SOURCE_FORBIDDEN_"+fragment)
    sh(["docker","run","-d","--rm","--name",NAME,"--network","none",
        "--memory","384m","--cpus","1",
        "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"],timeout=90)
    try:
        for _ in range(100):
            check=sh(["docker","exec",NAME,"psql","-h","127.0.0.1",
                "-U","postgres","-d","postgres","-qAt","-c","SELECT 1"],allow=True)
            if check.returncode==0 and check.stdout.strip()=="1":
                time.sleep(.25)
                again=sh(["docker","exec",NAME,"psql","-h","127.0.0.1",
                    "-U","postgres","-d","postgres","-qAt","-c","SELECT 1"],allow=True)
                if again.returncode==0 and again.stdout.strip()=="1":break
            time.sleep(.15)
        else:raise RuntimeError("ACL_QA_PG_NOT_READY")
        sql("CREATE SCHEMA ai_platform;")
        sql("SET cst_gatea.reviewed_dev_migration='true';\n"+DDL)
        # A source ACL without its exact prepared NOLOGIN roles must DENY.
        pre=apply_acl(allow=True)
        need(pre.returncode!=0 and "CST_GATEA_NOLOGIN_SCOPED_ROLE_REQUIRED" in pre.stderr,
             "MISSING_IDENTITY_ALLOWED")
        need(rows("SELECT count(*) FROM pg_policies WHERE tablename='cst_gatea_stage_leases'")==[["0"]],
             "ABORT_LEFT_POLICY")
        sql("CREATE ROLE "+READER+" LOGIN NOINHERIT NOBYPASSRLS;")
        sql("CREATE ROLE "+WRITER+" NOLOGIN NOINHERIT NOBYPASSRLS;")
        pre=apply_acl(allow=True)
        need(pre.returncode!=0 and "CST_GATEA_NOLOGIN_SCOPED_ROLE_REQUIRED" in pre.stderr,
             "LOGIN_READER_PERMITTED")
        sql("ALTER ROLE "+READER+" NOLOGIN;")
        # No permissions should be conferred before explicit review flag.
        no_review=sql(ACL,allow=True)
        need(no_review.returncode!=0 and "CST_GATEA_LEASE_ACL_REVIEW_OR_RLS_REQUIRED" in no_review.stderr,
             "UNREVIEWED_ACL_ALLOWED")
        apply_acl()
        need(rows("SELECT count(*) FROM pg_policies WHERE schemaname='ai_platform' "
                  "AND tablename='cst_gatea_stage_leases'")==[["4"]],
             "POLICY_COUNT_WRONG")
        need(rows("SELECT rolcanlogin::int,rolbypassrls::int FROM pg_roles WHERE rolname='"+READER+"'")==[["0","0"]],
             "READER_ATTRIBUTE_DRIFT")
        need(rows("SELECT rolcanlogin::int,rolbypassrls::int FROM pg_roles WHERE rolname='"+WRITER+"'")==[["0","0"]],
             "WRITER_ATTRIBUTE_DRIFT")
        # SELECT is intentionally column-granted, not table-granted.
        need(rows("SELECT "+",".join(
             "has_column_privilege('"+READER+"','"+TABLE+"','"+column+"','SELECT')::int"
             for column in ("project","nonce","source_sha","issued_at",
                            "expires_at","heartbeat_at","state")))==[["1"]*7],
             "READER_HAS_NO_COLUMN_SELECT")
        need(rows("SELECT has_table_privilege('"+READER+"','"+TABLE+"','SELECT')::int")==[["0"]],
             "READER_HAS_UNBOUNDED_TABLE_SELECT")
        need(rows("SELECT has_table_privilege('"+READER+"','"+TABLE+"','INSERT')::int,"
                  "has_table_privilege('"+READER+"','"+TABLE+"','UPDATE')::int,"
                  "has_table_privilege('"+READER+"','"+TABLE+"','DELETE')::int")==[["0","0","0"]],
             "READER_HAS_WRITE")
        need(rows("SELECT has_table_privilege('"+WRITER+"','"+TABLE+"','DELETE')::int")==[["0"]],
             "WRITER_HAS_DELETE")
        need(rows("SELECT has_column_privilege('"+WRITER+"','"+TABLE+"','heartbeat_at','UPDATE')::int")==[["1"]],
             "WRITER_CANNOT_HEARTBEAT")
        need(rows("SELECT "+",".join(
             "has_column_privilege('"+WRITER+"','"+TABLE+"','"+field+"','UPDATE')::int"
             for field in ("project","nonce","source_sha","issued_at","expires_at","state")
             ))==[["0"]*6],"WRITER_CAN_MUTATE_SIGNED_LEASE_FIELDS")
        need(rows("SELECT has_table_privilege('"+WRITER+"','"+TABLE+"','TRUNCATE')::int")==[["0"]],
             "WRITER_CAN_TRUNCATE")
        need(rows("SELECT relrowsecurity::int, relforcerowsecurity::int "
                  "FROM pg_class WHERE oid='"+TABLE+"'::regclass")==[["1","1"]],
             "FORCED_RLS_MISSING")
        need(as_role(READER,"SELECT count(*) FROM "+TABLE).stdout.strip()=="0",
             "EMPTY_LEASE_READER_WRONG")
        need(as_role(READER,"INSERT INTO "+TABLE+" (project) VALUES ('"+PROJECT+"')",
                     allow=True).returncode!=0,"READER_INSERT_ALLOWED")
        need(as_role(READER,"UPDATE "+TABLE+" SET state='CLOSED'",
                     allow=True).returncode!=0,"READER_UPDATE_ALLOWED")
        need(as_role(WRITER,
          "INSERT INTO "+TABLE+" VALUES ('"+PROJECT+"','"+("a"*32)+"','"+("b"*40)
          +"',now()-interval '5 seconds',now()+interval '4 minutes',"
           "now()-interval '3 seconds','ACTIVE')").returncode==0,
           "WRITER_CANNOT_INSERT")
        need(as_role(READER,"SELECT count(*) FROM "+TABLE).stdout.strip()=="1",
             "READER_CANNOT_SEE_SCOPED_LEASE")
        # Run the exact source lease reader with the *actual read-only role*
        # against PostgreSQL, not a superuser pretending to be the reader.
        def restricted_query(statement):
            p=as_role(READER,statement)
            return [r.strip().split("|") for r in p.stdout.splitlines() if r.strip()]
        snapshot=lease.read_project_lease(restricted_query)
        need(snapshot is not None and snapshot["nonce"]=="a"*32
             and snapshot["sourceSha"]=="b"*40
             and snapshot["state"]=="ACTIVE","ACTUAL_READER_QUERIES_FAILED")
        now=lease.read_database_utc_clock(restricted_query)
        need(now.tzinfo is not None and snapshot["issuedAt"]<now<snapshot["expiresAt"],
             "READER_DB_CLOCK_MISMATCH")
        need(as_role(WRITER,"UPDATE "+TABLE+" SET heartbeat_at=now() WHERE project='"+PROJECT+"';"
                     " SELECT count(*) FROM "+TABLE).stdout.strip()=="1",
             "WRITER_CANNOT_REFRESH_HEARTBEAT")
        for statement in (
             "UPDATE "+TABLE+" SET nonce='"+("c"*32)+"'",
             "UPDATE "+TABLE+" SET source_sha='"+("c"*40)+"'",
             "UPDATE "+TABLE+" SET issued_at=now()",
             "UPDATE "+TABLE+" SET expires_at=now()+interval '2 minutes'",
             "UPDATE "+TABLE+" SET state='CLOSED'",
             "UPDATE "+TABLE+" SET project='other-project'",
        ):
            need(as_role(WRITER,statement,allow=True).returncode!=0,
                 "WRITER_CAN_CHANGE_SIGNED_LEASE_OR_STATE")
        need(as_role(WRITER,"UPDATE "+TABLE+" SET expires_at=now()+interval '11 minutes'",
                     allow=True).returncode!=0,"UNBOUNDED_WRITE_ALLOWED")
        need(as_role(WRITER,"DELETE FROM "+TABLE,
                     allow=True).returncode!=0,"WRITER_DELETE_ALLOWED")
        sql("CREATE TABLE ai_platform.qa_private_other (data text);")
        need(as_role(READER,"SELECT * FROM ai_platform.qa_private_other",
                     allow=True).returncode!=0,"READER_CAN_READ_OTHER_TABLE")
        sql("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;"
            "CREATE ROLE aicore_dev_runtime NOLOGIN;")
        for role in ("anon","authenticated","aicore_dev_runtime"):
            need(rows("SELECT has_table_privilege('"+role+"','"+TABLE+"','SELECT')::int,"
                "has_table_privilege('"+role+"','"+TABLE+"','INSERT')::int,"
                "has_table_privilege('"+role+"','"+TABLE+"','UPDATE')::int")==[["0","0","0"]],
                "SHARED_ROLE_ACCESS_"+role)
        need(apply_acl(allow=True).returncode!=0,"REAPPLY_NOT_DENIED")
        print("CST_GATEA_LEASE_ACL_DISPOSABLE_PASS "+json.dumps({
          "postgres":16,"network":"none","exactProjectOnly":True,
          "readerLogin":False,"writerLogin":False,"readerWritesDenied":True,
          "writerCanInsertAndHeartbeat":True,"writerCannotDelete":True,
          "writerImmutableSignedFields":True,"writerCannotExtendLease":True,
          "forcedRls":True,"unrelatedTableDenied":True,
          "actualSourceReaderAndDbClockRoleScoped":True,
          "anonAuthenticatedSharedCoreDenied":True,
          "unsafeCredentialsNotProvisioned":True,
          "noSupabaseConnection":True,"prodTouched":False,
          "relockAdminRoleCreated":False,"sourceOnly":True,
          "releaseDecision":"NO_GO"},sort_keys=True))
    finally:
        sh(["docker","rm","-f",NAME],allow=True,timeout=20)

if __name__=="__main__":
    try:main()
    except Exception as e:
        print("CST_GATEA_LEASE_ACL_DISPOSABLE_FAIL "+str(e)[:200])
        sys.exit(2)
