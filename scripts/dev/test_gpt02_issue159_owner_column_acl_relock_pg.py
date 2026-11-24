#!/usr/bin/env python3
"""Issue159 owner helper: native seven-table AND column-level ACL revocation.

Runs existing canonical owner-helper source with a synthetic nested auditor
wrapper against Docker PostgreSQL 16 or 17 (--network none). Includes a role
that genuinely can SELECT private test rows before revoke, then cannot read
them after cleanup even while its synthetic SELECT policy still exists.

NO CST-DEV/PROD connection, credentials, systemd, issuer or DELL.
"""
from __future__ import annotations
import os, secrets, subprocess, time, uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
HELPER=ROOT/"docs/dev/gpt02-issue159-store-owner-relock-helper-maintenance.REVIEW_ONLY.sql"
CANONICAL=ROOT/"docs/dev/gpt02-issue159-store-owner-relock-helper.PROPOSED.sql"
IMAGE=os.environ.get("GPT02_COLUMN_RELOCK_TEST_PG_IMAGE","postgres:16-alpine")
if IMAGE not in ("postgres:16-alpine","postgres:17-alpine"):
    raise SystemExit("POSTGRES_FIXTURE_IMAGE_NOT_APPROVED")
TABLES=("approvals","operator_links","receipts","core_identity_receipts",
        "post_consumption_fences","issuer_evidences","issuer_lease_consumptions")
SCOPE="dev_gpt02_task_183_aaaaaaaaaaaa"
ROGUE="untrusted_reader_role"

def run(args, *, input=None, check=True):
    p=subprocess.run(args,input=input,text=True,capture_output=True,timeout=60)
    if check and p.returncode:
        raise RuntimeError("DISPOSABLE_SCOPE_RELOCK_FAILED:"+p.stderr[-850:])
    return p

def db(name,user,pw,sql,*,check=True):
    return run(["docker","exec","-i","-e","PGPASSWORD="+pw,name,
        "psql","-X","-w","-h","127.0.0.1","-U",user,
        "-d","postgres","-v","ON_ERROR_STOP=1","-At"],
        input=sql,check=check)

def one(name,user,pw,sql):
    return db(name,user,pw,sql).stdout.strip()

def is_readable(name,root_pw):
    sql="SET ROLE "+SCOPE+"; SELECT count(*) FROM gpt02_private.approvals; RESET ROLE;"
    return db(name,"fixture_root",root_pw,sql,check=False)

def call_auditor(name,pw,role=SCOPE,*,check=True):
    return db(name,"dev_gpt02_relock_catalog_auditor",pw,
        "SELECT gpt02_relock_audit.synthetic_revoke_scope('"+role+"'::name);",
        check=check)

def main():
    canonical=CANONICAL.read_text(encoding="utf-8")
    maintenance=HELPER.read_text(encoding="utf-8")
    marker="CREATE FUNCTION gpt02_private.revoke_expired_scoped_reader_grants"
    if not marker in canonical or not marker in maintenance:
        raise AssertionError("MISSING_EXISTING_HELPER")
    if canonical.split(marker,1)[1] != maintenance.split(marker,1)[1]:
        raise AssertionError("EXISTING_HELPER_MUST_HAVE_IDENTICAL_BODY")
    if ("aclexplode(a.attacl)" not in maintenance
        or "REVOKE SELECT (%I)" not in maintenance
        or "RELOCK_SCOPE_EFFECTIVE_ACL_REMAINS" not in maintenance):
        raise AssertionError("MISSING_EXPLICIT_COLUMN_GRANT_REVOKE")
    name="gpt02-seven-col-"+uuid.uuid4().hex[:9]
    rootpw=secrets.token_urlsafe(26)
    maintpw=secrets.token_urlsafe(26)
    auditpw=secrets.token_urlsafe(26)
    pgpw=secrets.token_urlsafe(26)
    try:
        run(["docker","run","--rm","-d","--network","none",
             "--name",name,"-e","POSTGRES_USER=fixture_root",
             "-e","POSTGRES_PASSWORD="+rootpw,IMAGE])
        for _ in range(100):
            r=db(name,"fixture_root",rootpw,"SELECT 1;",check=False)
            if r.returncode==0 and r.stdout.strip()=="1":break
            time.sleep(.25)
        else:raise AssertionError("FINAL_TCP_POSTGRES_NOT_READY")
        db(name,"fixture_root",rootpw,f"""
CREATE ROLE postgres LOGIN CREATEROLE NOINHERIT PASSWORD '{pgpw}';
CREATE ROLE gpt02_store_owner NOLOGIN NOINHERIT;
CREATE ROLE gpt02_owner_maintenance LOGIN NOINHERIT
 NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '{maintpw}';
CREATE ROLE dev_gpt02_relock_catalog_auditor LOGIN NOINHERIT PASSWORD '{auditpw}';
CREATE ROLE {SCOPE} NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;
CREATE ROLE {ROGUE} NOLOGIN NOINHERIT;
CREATE SCHEMA gpt02_private AUTHORIZATION gpt02_store_owner;
CREATE SCHEMA gpt02_relock_audit AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA gpt02_private FROM PUBLIC;
GRANT USAGE ON SCHEMA gpt02_relock_audit TO dev_gpt02_relock_catalog_auditor;
GRANT gpt02_store_owner TO gpt02_owner_maintenance
 WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT {SCOPE} TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
""")
        for table in TABLES:
            db(name,"fixture_root",rootpw,f"""
CREATE TABLE gpt02_private.{table} (id integer,label text,description text);
ALTER TABLE gpt02_private.{table} OWNER TO gpt02_store_owner;
ALTER TABLE gpt02_private.{table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.{table} FORCE ROW LEVEL SECURITY;
""")
        db(name,"fixture_root",rootpw,"SET ROLE gpt02_store_owner;\n"+
            f"GRANT USAGE ON SCHEMA gpt02_private TO {SCOPE},postgres;\n"+
            "\n".join(
              f"GRANT SELECT (id,label) ON gpt02_private.{t} TO {SCOPE};"
              f"CREATE POLICY scoped_allow ON gpt02_private.{t} FOR SELECT "
              f"TO {SCOPE} USING (true);"
              for t in TABLES
            )+
            f"GRANT SELECT ON TABLE gpt02_private.receipts TO {SCOPE};\n"
            "RESET ROLE;")
        prior=one(name,"fixture_root",rootpw,f"""
SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='gpt02_private'
 AND c.relname IN ('approvals','operator_links','receipts',
  'core_identity_receipts','post_consumption_fences','issuer_evidences',
  'issuer_lease_consumptions')
 AND has_any_column_privilege('{SCOPE}',c.oid,'SELECT');
""")
        if prior!="7":raise AssertionError("PRECONDITION_7_TABLES_ACCESS_NOT_GRANTED")
        if is_readable(name,rootpw).returncode!=0:
            raise AssertionError("PRECONDITION_NATIVE_PRIVATE_TABLE_NOT_READABLE")
        print("PASS_PRECONDITION_READER_CAN_READ_NATIVE_SEVEN_TABLE_COLUMN_GRANTS",flush=True)
        installed=db(name,"gpt02_owner_maintenance",maintpw,
                     "SET ROLE gpt02_store_owner;\n"+maintenance)
        if installed.returncode!=0:raise AssertionError("MAINTENANCE_HELPER_NOT_INSTALLED")
        db(name,"postgres",pgpw,"""
CREATE FUNCTION gpt02_relock_audit.synthetic_revoke_scope(p_role name)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $wrap$
BEGIN
 IF session_user<>'dev_gpt02_relock_catalog_auditor'
 OR current_user<>'postgres'
 THEN RAISE EXCEPTION 'AUDITOR_WRAPPER_DENIED' USING ERRCODE='42501';END IF;
 PERFORM gpt02_private.revoke_expired_scoped_reader_grants(p_role);
END $wrap$;
REVOKE ALL ON FUNCTION gpt02_relock_audit.synthetic_revoke_scope(name) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.synthetic_revoke_scope(name)
 TO dev_gpt02_relock_catalog_auditor;
""")
        wrong=db(name,"postgres",pgpw,
                "SELECT gpt02_private.revoke_expired_scoped_reader_grants('"+
                SCOPE+"'::name);",check=False)
        if wrong.returncode==0 or "RELOCK_OWNER_HELPER_CALLER_DENIED" not in wrong.stderr:
            raise AssertionError("POSTGRES_DIRECT_HELPER_BYPASS")
        print("PASS_DIRECT_POSTGRES_HELPER_BYPASS_DENIED",flush=True)
        # If a scoped reader is also member of another role, fail with all
        # existing SELECT grants intact (no silent partial cleanup).
        db(name,"fixture_root",rootpw,f"GRANT {ROGUE} TO {SCOPE} WITH INHERIT FALSE, SET FALSE;")
        bad=call_auditor(name,auditpw,check=False)
        if bad.returncode==0 or "RELOCK_SCOPE_MEMBERSHIP_NOT_ISOLATED" not in bad.stderr:
            raise AssertionError("UNTRUSTED_SCOPED_MEMBERSHIP_NOT_DENIED")
        db(name,"fixture_root",rootpw,f"REVOKE {ROGUE} FROM {SCOPE};")
        if is_readable(name,rootpw).returncode!=0:
            raise AssertionError("REVOKED_GRANTS_BEFORE_VALID_CLEANUP")
        print("PASS_SCOPED_READER_EXTRA_MEMBERSHIP_DENIED",flush=True)
        wrong=call_auditor(name,auditpw,"postgres",check=False)
        if wrong.returncode==0 or "RELOCK_SCOPE_INVALID" not in wrong.stderr:
            raise AssertionError("ARBITRARY_ROLE_REVOKE_NOT_DENIED")
        call_auditor(name,auditpw)
        after=one(name,"fixture_root",rootpw,f"""
SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='gpt02_private'
AND c.relname IN ('approvals','operator_links','receipts',
  'core_identity_receipts','post_consumption_fences','issuer_evidences',
  'issuer_lease_consumptions')
AND (has_table_privilege('{SCOPE}',c.oid,'SELECT')
 OR has_any_column_privilege('{SCOPE}',c.oid,'SELECT'));
""")
        if after!="0":raise AssertionError("COLUMN_SELECT_RESIDUAL_AFTER_REVOKE:"+after)
        if one(name,"fixture_root",rootpw,
               f"SELECT has_schema_privilege('{SCOPE}','gpt02_private','USAGE')")!="f":
            raise AssertionError("PRIVATE_SCHEMA_USAGE_RESIDUAL")
        if is_readable(name,rootpw).returncode==0:
            raise AssertionError("READER_CAN_STILL_READ_PRIVATE_DATA_AFTER_REVOKE")
        call_auditor(name,auditpw)
        if one(name,"fixture_root",rootpw,
               f"SELECT (SELECT count(*) FROM pg_stat_activity WHERE usename='{SCOPE}')::text")!="0":
            raise AssertionError("SYNTHETIC_CLEANUP_LEFT_SESSIONS")
        print("PASS_SEVEN_TABLE_AND_COLUMN_REVOKE_SCOPED_READER_DENIED",flush=True)
        print("PASS_IDEMPOTENT_OWNER_HELPER_NO_RESIDUAL_SESSIONS",flush=True)
        print("DISPOSABLE_ONLY_NO_LIVE_DB_ROLE_OR_PROD_CHANGE_"+IMAGE,flush=True)
    finally:
        run(["docker","rm","-f",name],check=False)

if __name__=="__main__":main()
