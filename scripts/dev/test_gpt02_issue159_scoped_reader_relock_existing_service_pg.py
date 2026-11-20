#!/usr/bin/env python3
"""Native PG16/17 proof: scoped reader relock with EXISTING Phase-A/B service.

Tests the reviewed add-only SQL on a networkless ephemeral PostgreSQL only.
The existing writer Phase-A/B functions and their OIDs/ACLs are preserved.
A scoped native LOGIN can read seven private-table columns before relock;
then Phase A disables login/password; Phase B terminates an active session,
revokes base and column privileges through original owner helper, and marks
cleanup only AFTER committed independent proof. No new VPS service or timer.
"""
from __future__ import annotations
import os, secrets, subprocess, time, uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
SQL=ROOT/"docs/dev/gpt02-issue159-scoped-reader-relock-add-only.REVIEW_ONLY.sql"
HELPER=ROOT/"docs/dev/gpt02-issue159-store-owner-relock-helper-maintenance.REVIEW_ONLY.sql"
IMAGE=os.environ.get("GPT02_SCOPED_RELOCK_TEST_PG_IMAGE","postgres:16-alpine")
if IMAGE not in ("postgres:16-alpine","postgres:17-alpine"):
    raise SystemExit("DISPOSABLE_IMAGE_ALLOWLIST_REQUIRED")
ROLE="dev_gpt02_task_183_aaaaaaaaaaaa"
AUDITOR="dev_gpt02_relock_catalog_auditor"
TABLES=("approvals","operator_links","receipts","core_identity_receipts",
        "post_consumption_fences","issuer_evidences","issuer_lease_consumptions")

def run(args,sql=None,check=True,timeout=50):
    p=subprocess.run(args,input=sql,text=True,capture_output=True,timeout=timeout)
    if check and p.returncode:
        raise RuntimeError("DISPOSABLE_SCOPED_RELOCK_COMMAND_FAILED:"+p.stderr[-3500:])
    return p

def query(name,user,password,sql,check=True):
    return run(["docker","exec","-i","-e","PGPASSWORD="+password,name,
                "psql","-X","-w","-h","127.0.0.1","-U",user,
                "-d","postgres","-v","ON_ERROR_STOP=1","-At"],sql=sql,check=check)

def scalar(name,user,password,sql):
    return query(name,user,password,sql).stdout.strip().splitlines()[-1]

def main():
    proposed=SQL.read_text(encoding="utf-8")
    if ("CREATE FUNCTION gpt02_relock_audit.relock_reader_phase_a()" not in proposed
        or "CREATE FUNCTION gpt02_relock_audit.relock_reader_phase_b()" not in proposed
        or "CREATE OR REPLACE FUNCTION gpt02_relock_audit.relock_expired_" in proposed
        or "CREATE SCHEMA gpt02_relock_audit" in proposed
        or "ALTER ROLE dev_gpt02_relock_catalog_auditor LOGIN" in proposed):
        raise AssertionError("ADD_ONLY_RELOCK_SOURCE_CONTRACT_BROKEN")
    name="gpt02-scoped-relock-"+uuid.uuid4().hex[:10]
    rp=secrets.token_urlsafe(26);pp=secrets.token_urlsafe(26)
    mp=secrets.token_urlsafe(26);ap=secrets.token_urlsafe(26)
    scopedpw=secrets.token_urlsafe(26)
    held=None
    try:
        run(["docker","run","--rm","-d","--network","none","--name",name,
             "-e","POSTGRES_USER=fixture_root",
             "-e","POSTGRES_PASSWORD="+rp,IMAGE])
        for _ in range(120):
            t=query(name,"fixture_root",rp,"SELECT 1;",check=False)
            if t.returncode==0 and t.stdout.strip()=="1":break
            time.sleep(.25)
        else:
            raise AssertionError("DISPOSABLE_FINAL_PG_SERVER_NOT_READY")
        query(name,"fixture_root",rp,f"""
CREATE ROLE postgres LOGIN CREATEROLE NOINHERIT PASSWORD '{pp}';
GRANT CREATE ON DATABASE postgres TO postgres;
GRANT SELECT ON pg_catalog.pg_authid TO postgres;
GRANT pg_signal_backend TO postgres WITH INHERIT TRUE, SET FALSE;
CREATE ROLE gpt02_store_owner NOLOGIN NOINHERIT;
CREATE ROLE gpt02_owner_maintenance LOGIN NOINHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '{mp}';
CREATE ROLE {AUDITOR} NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;
CREATE SCHEMA gpt02_private AUTHORIZATION gpt02_store_owner;
REVOKE ALL ON SCHEMA gpt02_private FROM PUBLIC;
-- Existing CST-DEV grants postgres schema USAGE without table SELECT/DDL.
GRANT USAGE ON SCHEMA gpt02_private TO postgres;
CREATE SCHEMA gpt02_relock_audit AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA gpt02_relock_audit FROM PUBLIC;
GRANT USAGE ON SCHEMA gpt02_relock_audit TO {AUDITOR};
GRANT gpt02_store_owner TO gpt02_owner_maintenance
 WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
""")
        for table in TABLES:
            query(name,"fixture_root",rp,f"""
CREATE TABLE gpt02_private.{table}(id integer,label text);
ALTER TABLE gpt02_private.{table} OWNER TO gpt02_store_owner;
ALTER TABLE gpt02_private.{table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.{table} FORCE ROW LEVEL SECURITY;
""")
        # Owner maintenance is a fixture-only principal, fully retired
        # before any writer or auditor reader role is activated.
        query(name,"gpt02_owner_maintenance",mp,
              "SET ROLE gpt02_store_owner;\n"+HELPER.read_text())
        query(name,"fixture_root",rp,
              "REVOKE gpt02_store_owner FROM gpt02_owner_maintenance;"
              "ALTER ROLE gpt02_owner_maintenance NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL;")
        if scalar(name,"fixture_root",rp,
           "SELECT NOT rolcanlogin AND rolconnlimit=0 AND rolpassword IS NULL FROM pg_authid "
           "WHERE rolname='gpt02_owner_maintenance'")!="t":
            raise AssertionError("OWNER_MAINTENANCE_NOT_RETIRED")
        query(name,"postgres",pp,"""
CREATE TABLE gpt02_relock_audit.writer_issuance_watchdog(
 role_name name PRIMARY KEY,cleaned_at timestamptz);
CREATE FUNCTION gpt02_relock_audit.relock_expired_phase_a()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$ SELECT 0 $fn$;
CREATE FUNCTION gpt02_relock_audit.relock_expired_phase_b()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$ SELECT 0 $fn$;
REVOKE ALL ON FUNCTION gpt02_relock_audit.relock_expired_phase_a() FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_relock_audit.relock_expired_phase_b() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.relock_expired_phase_a()
 TO dev_gpt02_relock_catalog_auditor;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.relock_expired_phase_b()
 TO dev_gpt02_relock_catalog_auditor;
""")
        def snapshot():
            return scalar(name,"fixture_root",rp,"""
SELECT string_agg(p.oid::text||'|'||p.proacl::text,'#' ORDER BY p.proname)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='gpt02_relock_audit'
AND p.proname IN ('relock_expired_phase_a','relock_expired_phase_b')
""")
        prior=snapshot()
        query(name,"postgres",pp,proposed)
        if prior!=snapshot():raise AssertionError("EXISTING_WRITER_FUNCTION_OIDS_OR_ACLS_CHANGED")
        if scalar(name,"fixture_root",rp,
            "SELECT count(*) FROM pg_roles WHERE rolname='"+AUDITOR+"' AND NOT rolcanlogin AND rolconnlimit=0")!="1":
            raise AssertionError("AUDITOR_WAS_UNLOCKED_ON_ADD_ONLY_INSTALL")
        if scalar(name,"fixture_root",rp,"SELECT count(*) FROM pg_class WHERE oid="
            "'gpt02_relock_audit.reader_issuance_watchdog'::regclass "
            "AND relrowsecurity AND relforcerowsecurity")!="1":
            raise AssertionError("NEW_WATCHDOG_NOT_FORCE_RLS")
        replay=query(name,"postgres",pp,proposed,check=False)
        if replay.returncode==0 or "SCOPED_RELOCK_ADD_ONLY_PREFLIGHT_DENIED" not in replay.stderr:
            raise AssertionError("MIGRATION_REPLAY_NOT_DENIED")
        print("PASS_ADD_ONLY_EXISTING_PHASE_A_B_PRESERVED_AND_ROLE_STILL_NOLOGIN",flush=True)
        query(name,"postgres",pp,f"""
CREATE ROLE {ROLE} NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;
""")
        query(name,"fixture_root",rp,"SET ROLE gpt02_store_owner;\n"+
            "GRANT USAGE ON SCHEMA gpt02_private TO "+ROLE+";"+
            "\n".join(
                f"GRANT SELECT (id,label) ON gpt02_private.{t} TO {ROLE};"
                f"CREATE POLICY isolated_reader ON gpt02_private.{t} "
                f"FOR SELECT TO {ROLE} USING (true);"
                for t in TABLES
            )+
            "RESET ROLE;")
        query(name,"postgres",pp,f"""
INSERT INTO gpt02_relock_audit.reader_issuance_watchdog(
 role_name,task_id,scope_sha256,issued_at,expires_at)
VALUES('{ROLE}',183,'{"a"*64}',
 clock_timestamp()-interval '5 seconds',
 clock_timestamp()-interval '1 second');
""")
        invalid=query(name,"postgres",pp,
             "SELECT gpt02_relock_audit.relock_reader_phase_a()",check=False)
        if invalid.returncode==0 or "SCOPED_RELOCK_INDEPENDENT_AUDITOR_REQUIRED" not in invalid.stderr:
            raise AssertionError("POSTGRES_DIRECT_SCOPE_RELOCK_PERMITTED")
        query(name,"fixture_root",rp,
              f"ALTER ROLE {ROLE} LOGIN CONNECTION LIMIT 1 PASSWORD '{scopedpw}';"
              f"ALTER ROLE {AUDITOR} LOGIN CONNECTION LIMIT 1 PASSWORD '{ap}';")
        testread=query(name,ROLE,scopedpw,
             "SELECT count(*) FROM gpt02_private.approvals",check=False)
        if testread.returncode:
            raise AssertionError("PRECONDITION_NATIVE_READER_NOT_PRIVILEGED")
        # Hold one active session during the first phase; after NOLOGIN,
        # Phase B must terminate it and validate a clean SQL catalog.
        held=subprocess.Popen(["docker","exec","-i","-e","PGPASSWORD="+scopedpw,
              name,"psql","-X","-w","-h","127.0.0.1","-U",ROLE,
              "-d","postgres","-Atc","SELECT pg_sleep(22)"],
              stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        for _ in range(75):
            busy=scalar(name,"fixture_root",rp,
                "SELECT count(*) FROM pg_stat_activity WHERE usename='"+ROLE+"' "
                "AND state='active'")
            if busy=="1":break
            if held.poll() is not None:
                raise AssertionError("READER_SESSION_DIED_BEFORE_RELOCK")
            time.sleep(.1)
        else:raise AssertionError("ACTIVE_SCOPED_READER_NOT_OBSERVED")
        before=query(name,AUDITOR,ap,
             "SELECT gpt02_relock_audit.relock_reader_phase_b()",check=False)
        if before.returncode==0 or "SCOPED_RELOCK_PHASE_A_NOT_COMMITTED" not in before.stderr:
            raise AssertionError("B_ALLOWED_BEFORE_A")
        if scalar(name,AUDITOR,ap,
            "SELECT gpt02_relock_audit.relock_reader_phase_a()")!="1":
            raise AssertionError("PHASE_A_DID_NOT_DISABLE_READER_LOGIN")
        if scalar(name,"fixture_root",rp,
            f"SELECT NOT rolcanlogin AND rolconnlimit=0 AND rolpassword IS NULL "
            f"FROM pg_authid WHERE rolname='{ROLE}'")!="t":
            raise AssertionError("PHASE_A_ROLE_NOT_LOCKED")
        if query(name,ROLE,scopedpw,"SELECT 1",check=False).returncode==0:
            raise AssertionError("NEW_LOGIN_ALLOWED_AFTER_PHASE_A")
        print("PASS_NATIVE_READER_LOGIN_DISABLED_BEFORE_PHASE_B",flush=True)
        # Nested owner revoke/ledger update must rollback on a late abort,
        # while Phase-A's committed NOLOGIN remains immutable.
        failed=query(name,AUDITOR,ap,
            "BEGIN;SELECT gpt02_relock_audit.relock_reader_phase_b();"
            "SELECT 1/0;COMMIT;",check=False)
        if failed.returncode==0 or "division by zero" not in failed.stderr:
            raise AssertionError("LATE_TRANSACTION_ABORT_NOT_REPRODUCED:"+failed.stderr[-1400:])
        if scalar(name,"fixture_root",rp,
            "SELECT count(*) FROM gpt02_relock_audit.reader_issuance_watchdog "
            "WHERE cleaned_at IS NULL")!="1":
            raise AssertionError("LATE_ABORT_EARLY_CLEANUP_MARKER")
        if scalar(name,"fixture_root",rp,
            "SELECT has_any_column_privilege('"+ROLE+"',"
            "'gpt02_private.approvals','SELECT')")!="t":
            raise AssertionError("LATE_ABORT_DID_NOT_ROLLBACK_OWNER_REVOKE")
        clean=scalar(name,AUDITOR,ap,
            "SELECT gpt02_relock_audit.relock_reader_phase_b()")
        if clean!="1":raise AssertionError("RELOCK_B_NOT_COMMITTED")
        stdout,stderr=held.communicate(timeout=15)
        held=None
        if scalar(name,"fixture_root",rp,
            "SELECT count(*) FROM pg_stat_activity WHERE usename='"+ROLE+"'")!="0":
            raise AssertionError("SCOPED_READER_SESSION_SURVIVED")
        if scalar(name,"fixture_root",rp,
            "SELECT count(*) FROM gpt02_relock_audit.reader_issuance_watchdog "
            "WHERE cleaned_at IS NULL")!="0":
            raise AssertionError("SCOPED_LEDGER_PENDING_AFTER_CLEAN")
        if scalar(name,"fixture_root",rp,
            "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE n.nspname='gpt02_private' AND c.relname IN "
            "('approvals','operator_links','receipts','core_identity_receipts',"
            "'post_consumption_fences','issuer_evidences','issuer_lease_consumptions') "
            "AND (has_table_privilege('"+ROLE+"',c.oid,'SELECT') "
            "OR has_any_column_privilege('"+ROLE+"',c.oid,'SELECT'))")!="0":
            raise AssertionError("PRIVATE_TABLE_OR_COLUMN_ACL_SURVIVED")
        if scalar(name,"fixture_root",rp,
            "SELECT has_schema_privilege('"+ROLE+"','gpt02_private','USAGE')")!="f":
            raise AssertionError("PRIVATE_SCHEMA_USAGE_SURVIVED")
        if scalar(name,AUDITOR,ap,
            "SELECT gpt02_relock_audit.relock_reader_phase_a()")!="0" or scalar(
              name,AUDITOR,ap,"SELECT gpt02_relock_audit.relock_reader_phase_b()")!="0":
            raise AssertionError("POSTRELOCK_REPLAY_DID_NOT_RETURN_ZERO")
        if prior!=snapshot():
            raise AssertionError("WRITER_PHASE_A_B_CHANGED_BY_SCOPED_CLEANUP")
        print("PASS_NATIVE_PHASE_B_ABORT_ROLLBACK_THEN_SEVEN_TABLE_COLUMN_ACL_REVOKE",flush=True)
        print("PASS_NATIVE_ACTIVE_SESSION_TERMINATED_ZERO_SESSIONS",flush=True)
        print("PASS_OLD_WRITER_FUNCTION_OIDS_ACLS_UNCHANGED_AND_REPLAY_SAFE",flush=True)
        query(name,"fixture_root",rp,
           f"ALTER ROLE {AUDITOR} NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL;")
        if scalar(name,"fixture_root",rp,
           "SELECT NOT rolcanlogin AND rolconnlimit=0 AND rolpassword IS NULL "
           "FROM pg_authid WHERE rolname='"+AUDITOR+"'")!="t":
            raise AssertionError("TEST_AUDITOR_NOT_RELOCKED")
        print("PASS_AUDITOR_FINALLY_LOCKED_NO_CST_DEV_OR_PROD_CHANGE",flush=True)
    finally:
        if held is not None and held.poll() is None:
            held.kill()
            try:held.communicate(timeout=3)
            except Exception:pass
        run(["docker","rm","-f",name],check=False)
if __name__=="__main__":
    main()
