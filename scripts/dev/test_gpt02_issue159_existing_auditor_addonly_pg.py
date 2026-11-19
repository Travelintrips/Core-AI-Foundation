#!/usr/bin/env python3
"""Issue159 EXISTING-ROLE auditor add-only proposal, disposable PG16 test.

NO LIVE DATABASE. Never install credentials or activate a service. Verifies
the old no-login auditor role and already-existing writer Phase A/B survive
a review-only new boolean audit function install without re-creation.
"""
from __future__ import annotations
from pathlib import Path
import os
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
PROPOSAL = ROOT / "docs/dev/gpt02-issue159-minimal-catalog-auditor-existing-role.REVIEW_ONLY.sql"
TABLES = (
    "approvals", "operator_links", "receipts",
    "core_identity_receipts", "post_consumption_fences"
)
AUDITOR = "dev_gpt02_relock_catalog_auditor"
FUNCTION = "gpt02_relock_audit.scoped_reader_fully_locked(name)"


def run(args, *, stdin=None, check=True):
    p = subprocess.run(args, input=stdin, text=True,
                       capture_output=True, timeout=45)
    if check and p.returncode:
        raise RuntimeError("DISPOSABLE_ADD_ONLY_FAILED:" + p.stderr[-1300:])
    return p


def admin(name, statement, check=True):
    return run([
        "docker", "exec", "-i", name, "psql", "-X",
        "-v", "ON_ERROR_STOP=1", "-U", "root_admin",
        "-d", "postgres", "-At",
    ], stdin=statement, check=check)


def migrator(name, statement, check=True):
    return run([
        "docker", "exec", "-i", "-e", "PGPASSWORD=synthetic_migrator_only",
        name, "psql", "-X", "-w", "-h", "127.0.0.1",
        "-v", "ON_ERROR_STOP=1", "-U", "postgres",
        "-d", "postgres", "-At",
    ], stdin=statement, check=check)


def catalog(name):
    r = admin(name, """
SELECT (
  SELECT oid::text FROM pg_namespace
   WHERE nspname='gpt02_relock_audit'
)||'|'||(
  SELECT oid::text FROM pg_roles
   WHERE rolname='dev_gpt02_relock_catalog_auditor'
)||'|'||(
  SELECT oid::text FROM pg_proc
   WHERE oid='gpt02_relock_audit.relock_expired_phase_a()'::regprocedure
)||'|'||(
  SELECT oid::text FROM pg_proc
   WHERE oid='gpt02_relock_audit.relock_expired_phase_b()'::regprocedure
);
""")
    return r.stdout.strip()


def main():
    sql = PROPOSAL.read_text()
    stripped = "\n".join(
        line for line in sql.splitlines()
        if not line.lstrip().startswith("--")
    )
    if (
        not stripped.startswith("BEGIN;")
        or not stripped.rstrip().endswith("COMMIT;")
        or "CREATE SCHEMA gpt02_relock_audit" in stripped
        or "CREATE ROLE dev_gpt02_relock_catalog_auditor" in stripped
        or "ALTER ROLE" in stripped
        or "CREATE FUNCTION gpt02_relock_audit.scoped_reader_fully_locked(" not in stripped
        or "SECURITY DEFINER" not in stripped
        or "REVOKE ALL ON FUNCTION" not in stripped
        or "GRANT EXECUTE ON FUNCTION" not in stripped
    ):
        raise AssertionError("NOT_ADD_ONLY_REVIEW_CONTRACT")
    image = os.environ.get('GPT02_ADD_ONLY_TEST_PG_IMAGE','postgres:16-alpine')
    if image not in ('postgres:16-alpine','postgres:17-alpine'):
        raise AssertionError('DISPOSABLE_POSTGRES_IMAGE_ALLOWLIST_REQUIRED')
    name="gpt02-existing-auditor-"+uuid.uuid4().hex[:9]
    try:
        run([
            "docker","run","--rm","-d","--network","none",
            "--name",name,"-e","POSTGRES_USER=root_admin",
            "-e","POSTGRES_PASSWORD=fixture_only",image,
        ])
        for _ in range(120):
            p=run([
                "docker","exec","-e","PGPASSWORD=fixture_only",name,
                "psql","-X","-w","-h","127.0.0.1","-U","root_admin",
                "-d","postgres","-Atc","SELECT 1",
            ],check=False)
            if p.returncode==0:
                break
            time.sleep(0.25)
        else:
            raise RuntimeError("FINAL_DISPOSABLE_TCP_POSTGRES_UNAVAILABLE")
        admin(name,"""
CREATE ROLE postgres LOGIN CREATEROLE NOINHERIT PASSWORD 'synthetic_migrator_only';
GRANT CREATE ON DATABASE postgres TO postgres;
GRANT SELECT ON pg_catalog.pg_authid TO postgres;
CREATE ROLE gpt02_store_owner NOLOGIN NOINHERIT;
CREATE SCHEMA gpt02_private AUTHORIZATION gpt02_store_owner;
""")
        for table in TABLES:
            admin(name,
                "CREATE TABLE gpt02_private."+table+"(id int);"
                "ALTER TABLE gpt02_private."+table+" OWNER TO gpt02_store_owner;"
                "ALTER TABLE gpt02_private."+table+" ENABLE ROW LEVEL SECURITY;"
                "ALTER TABLE gpt02_private."+table+" FORCE ROW LEVEL SECURITY;")
        migrator(name,"""
CREATE SCHEMA gpt02_relock_audit AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA gpt02_relock_audit FROM PUBLIC;
CREATE ROLE dev_gpt02_relock_catalog_auditor
 NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;
GRANT USAGE ON SCHEMA gpt02_relock_audit
 TO dev_gpt02_relock_catalog_auditor;
-- Existing historical writer routines are synthetic stand-ins here.
CREATE FUNCTION gpt02_relock_audit.relock_expired_phase_a()
 RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
 AS $sql$ SELECT 0 $sql$;
CREATE FUNCTION gpt02_relock_audit.relock_expired_phase_b()
 RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
 AS $sql$ SELECT 0 $sql$;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.relock_expired_phase_a()
 TO dev_gpt02_relock_catalog_auditor;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.relock_expired_phase_b()
 TO dev_gpt02_relock_catalog_auditor;
""")
        previous = catalog(name)
        # Drift: any inadvertently enabled auditor login must deny before DDL.
        admin(name,"ALTER ROLE dev_gpt02_relock_catalog_auditor LOGIN")
        denied=migrator(name,sql,check=False)
        if denied.returncode==0 or "ISSUE159_EXISTING_AUDITOR_ADDITION_PREFLIGHT_DENIED" not in denied.stderr:
            raise AssertionError("PREEXISTING_AUDITOR_LOGIN_DRIFT_NOT_DENIED")
        admin(name,"ALTER ROLE dev_gpt02_relock_catalog_auditor NOLOGIN")
        print("PASS_EXISTING_AUDITOR_LOGIN_DRIFT_DENIED_NO_APPLY")
        # Drift: incorrect private table owner must deny before install.
        admin(name,"ALTER TABLE gpt02_private.approvals OWNER TO root_admin")
        denied=migrator(name,sql,check=False)
        if denied.returncode==0 or "ISSUE159_EXISTING_AUDITOR_ADDITION_PREFLIGHT_DENIED" not in denied.stderr:
            raise AssertionError("PRIVATE_TABLE_OWNER_DRIFT_NOT_DENIED")
        admin(name,"ALTER TABLE gpt02_private.approvals OWNER TO gpt02_store_owner")
        print("PASS_EXISTING_PRIVATE_TABLE_OWNER_DRIFT_DENIED_NO_APPLY")
        if admin(name,"SELECT to_regprocedure('"+FUNCTION+"') IS NULL").stdout.strip()!="t":
            raise AssertionError("FAILED_PREFLIGHT_LEFT_NEW_ROUTINE")
        # A real pre-staged schema and locked role can accept only the add-on.
        migrator(name,sql)
        if catalog(name)!=previous:
            raise AssertionError("EXISTING_SCHEMA_ROLE_OR_WRITER_CHANGED")
        writers=admin(name,"""
SELECT has_function_privilege('dev_gpt02_relock_catalog_auditor',
 'gpt02_relock_audit.relock_expired_phase_a()','EXECUTE')
 AND has_function_privilege('dev_gpt02_relock_catalog_auditor',
 'gpt02_relock_audit.relock_expired_phase_b()','EXECUTE');
""")
        if writers.stdout.strip()!='t':
            raise AssertionError('EXISTING_RELOCK_WRITER_GRANTS_CHANGED')
        found=admin(name,"""
SELECT p.prosecdef AND pg_get_userbyid(p.proowner)='postgres'
AND has_function_privilege('dev_gpt02_relock_catalog_auditor',
 p.oid,'EXECUTE')
AND NOT EXISTS (
 SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
 WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
)
FROM pg_proc p WHERE p.oid='gpt02_relock_audit.scoped_reader_fully_locked(name)'::regprocedure;
""")
        if found.stdout.strip()!="t":
            raise AssertionError("ADD_ONLY_AUDITOR_FUNCTION_CUSTODY_INVALID")
        locked=admin(name,"""
SELECT NOT rolcanlogin AND rolconnlimit=0 AND NOT rolinherit
AND NOT rolbypassrls AND rolpassword IS NULL
FROM pg_authid
WHERE rolname='dev_gpt02_relock_catalog_auditor';
""")
        if locked.stdout.strip()!="t":
            raise AssertionError("ADD_ONLY_UNLOCKED_OR_REPLACED_AUDITOR")
        print("PASS_EXISTING_AUDITOR_SCHEMA_ROLE_WRITER_OIDS_AND_ACLS_PRESERVED")
        print("PASS_ADD_ONLY_SECURITY_DEFINER_ACL_AND_AUDITOR_NOLOGIN")
        # A second migration must not silently overwrite inspected logic.
        repeat=migrator(name,sql,check=False)
        if repeat.returncode==0 or "ISSUE159_EXISTING_AUDITOR_ADDITION_PREFLIGHT_DENIED" not in repeat.stderr:
            raise AssertionError("REPEATED_INSTALL_NOT_DENIED")
        if catalog(name)!=previous:
            raise AssertionError("REPEAT_CHANGED_PREVIOUS_OBJECTS")
        print("PASS_REPLAY_INSTALL_DENIED_EXISTING_OBJECTS_UNCHANGED")
        print("SOURCE_ONLY_DISPOSABLE_PG16_NO_LIVE_CREDENTIAL_OR_ROLE_CHANGE")
    finally:
        run(["docker","rm","-f",name],check=False)


if __name__=="__main__":
    main()
