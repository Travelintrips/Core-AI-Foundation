#!/usr/bin/env python3
"""Isolated PG16/PG17 fixture: owner-helper maintenance candidate only."""
import os, secrets, subprocess, time, uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
HELPER=ROOT/"docs/dev/gpt02-issue159-store-owner-relock-helper-maintenance.REVIEW_ONLY.sql"
IMAGE=os.environ.get("GPT02_RELOCK_TEST_PG_IMAGE","postgres:16-alpine")
if IMAGE not in ("postgres:16-alpine","postgres:17-alpine"):
    raise SystemExit("UNAPPROVED_DISPOSABLE_POSTGRES_IMAGE")
def call(args,input=None,check=True):
    r=subprocess.run(args,input=input,text=True,capture_output=True,timeout=50)
    if check and r.returncode:raise RuntimeError("FIXTURE_FAILED:"+r.stderr[-800:])
    return r
def psql(db,user,pw,query,check=True):
    return call(["docker","exec","-i","-e","PGPASSWORD="+pw,db,"psql","-X","-w",
        "-v","ON_ERROR_STOP=1","-h","127.0.0.1","-U",user,"-d","postgres","-At"],query,check)
def one(db,user,pw,query):return psql(db,user,pw,query).stdout.strip()
def main():
    # The alternative installer may change only the admission guard,
    # never the owner-owned SECURITY DEFINER helper body or exact grants.
    canonical=(ROOT/"docs/dev/gpt02-issue159-store-owner-relock-helper.PROPOSED.sql").read_text()
    alternate=HELPER.read_text()
    marker="CREATE FUNCTION gpt02_private.revoke_expired_scoped_reader_grants"
    assert marker in canonical and marker in alternate
    assert canonical.split(marker,1)[1] == alternate.split(marker,1)[1], "OWNER_HELPER_BODY_DRIFT"
    print("PASS_STORE_OWNER_HELPER_BODY_PARITY",flush=True)
    db="issue159-owner-maint-"+uuid.uuid4().hex[:10]
    rootpw=secrets.token_urlsafe(24); pgpw=secrets.token_urlsafe(24)
    mpw=secrets.token_urlsafe(24)
    try:
        call(["docker","run","--rm","-d","--network","none","--name",db,
              "-e","POSTGRES_USER=fixture_root","-e","POSTGRES_PASSWORD="+rootpw,IMAGE])
        for i in range(150):
            if psql(db,"fixture_root",rootpw,"SELECT 1;",False).returncode==0:break
            time.sleep(0.2)
        else:raise AssertionError("PG_FIXTURE_NOT_READY")
        psql(db,"fixture_root",rootpw,f"""
CREATE ROLE postgres LOGIN CREATEROLE NOINHERIT PASSWORD '{pgpw}';
CREATE ROLE gpt02_store_owner NOLOGIN NOINHERIT;
CREATE ROLE gpt02_owner_maintenance LOGIN NOINHERIT NOSUPERUSER
    NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '{mpw}';
CREATE ROLE outsider NOLOGIN;
CREATE SCHEMA gpt02_private AUTHORIZATION gpt02_store_owner;
REVOKE ALL ON SCHEMA gpt02_private FROM PUBLIC;
""")
        assert one(db,"fixture_root",rootpw,
          "SELECT NOT rolcanlogin FROM pg_roles WHERE rolname='gpt02_store_owner'")=="t"
        # Unapproved maintenance has no owner SET grant.
        denied=psql(db,"gpt02_owner_maintenance",mpw,
              "SET ROLE gpt02_store_owner;\n"+HELPER.read_text(),False)
        assert denied.returncode!=0
        print("PASS_MAINTENANCE_UNGRANTED_DENIED",flush=True)
        # Even if postgres gains SET in the fixture, session_user is wrong.
        psql(db,"fixture_root",rootpw,
          "GRANT gpt02_store_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;")
        denied=psql(db,"postgres",pgpw,
          "SET ROLE gpt02_store_owner;\n"+HELPER.read_text(),False)
        assert denied.returncode!=0 and "GPT02_OWNER_MAINTENANCE_SESSION_REQUIRED" in denied.stderr
        psql(db,"fixture_root",rootpw,"REVOKE gpt02_store_owner FROM postgres;")
        print("PASS_POSTGRES_IMPERSONATION_DENIED",flush=True)
        # Grant only the exact, synthetic maintenance SET capability.
        psql(db,"fixture_root",rootpw,
          "GRANT gpt02_store_owner TO gpt02_owner_maintenance WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;")
        # Extra memberships make the installer fail closed.
        psql(db,"fixture_root",rootpw,
          "GRANT outsider TO gpt02_owner_maintenance WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;")
        denied=psql(db,"gpt02_owner_maintenance",mpw,
          "SET ROLE gpt02_store_owner;\n"+HELPER.read_text(),False)
        assert denied.returncode!=0 and "GPT02_MAINTENANCE_MEMBERSHIP_INVALID" in denied.stderr
        psql(db,"fixture_root",rootpw,"REVOKE outsider FROM gpt02_owner_maintenance;")
        print("PASS_EXTRA_ROLE_MEMBERSHIP_DENIED",flush=True)
        # Correct original session and narrow SET may install genuine owner helper.
        ok=psql(db,"gpt02_owner_maintenance",mpw,
          "SET ROLE gpt02_store_owner;\n"+HELPER.read_text())
        assert "CREATE FUNCTION" in ok.stdout
        assert one(db,"fixture_root",rootpw,
          "SELECT p.proowner='gpt02_store_owner'::regrole AND p.prosecdef "
          "FROM pg_proc p WHERE p.oid="
          "'gpt02_private.revoke_expired_scoped_reader_grants(name)'::regprocedure")=="t"
        assert one(db,"fixture_root",rootpw,
          "SELECT NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) acl "
          "WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') "
          "FROM pg_proc p WHERE p.oid="
          "'gpt02_private.revoke_expired_scoped_reader_grants(name)'::regprocedure")=="t"
        print("PASS_HELPER_OWNED_BY_STORE_OWNER_NO_PUBLIC_EXECUTE",flush=True)
        # Independent administrator revokes the temporary right and the password.
        psql(db,"fixture_root",rootpw,
          "REVOKE gpt02_store_owner FROM gpt02_owner_maintenance;"
          "ALTER ROLE gpt02_owner_maintenance NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL;")
        assert one(db,"fixture_root",rootpw,
          "SELECT NOT rolcanlogin AND rolconnlimit=0 AND rolpassword IS NULL "
          "FROM pg_authid WHERE rolname='gpt02_owner_maintenance'")=="t"
        assert one(db,"fixture_root",rootpw,
          "SELECT NOT pg_has_role('gpt02_owner_maintenance','gpt02_store_owner','SET')")=="t"
        assert one(db,"fixture_root",rootpw,
          "SELECT NOT rolcanlogin FROM pg_roles WHERE rolname='gpt02_store_owner'")=="t"
        print("PASS_MAINTENANCE_RELOCK_PASSWORD_CLEARED_OWNER_NOLOGIN",flush=True)
        print("DISPOSABLE_ONLY_NO_CST_DEV_PROD_OR_DELL",IMAGE,flush=True)
    finally:
        call(["docker","rm","-f",db],check=False)
if __name__=="__main__":main()
