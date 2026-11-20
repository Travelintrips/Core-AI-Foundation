#!/usr/bin/env python3
"""Issue159 proposed one-read chain against PRE-EXISTING locked relock schema.

DISPOSABLE postgres:16-alpine / postgres:17-alpine --network none ONLY. Source-only proposal:
no CST-DEV credentials, no live grants, signers, issuer or DELL.
Existing five tables and writer relock routines MUST survive unchanged.
"""
from __future__ import annotations
import os
import subprocess
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs" / "dev"
MIGRATIONS = (
    ("existing-auditor",
     "gpt02-issue159-minimal-catalog-auditor-existing-role.REVIEW_ONLY.sql"),
    ("one-read-ledgers",
     "gpt02-issue159-one-read-consumption-attestation.PROPOSED.sql"),
    ("one-read-consumer",
     "gpt02-issue159-one-read-consumer-rpc.PROPOSED.sql"),
    ("database-ttl",
     "gpt02-issue159-reader-issuance-server-clock.PROPOSED.sql"),
    ("canonical-approval-fence",
     "gpt02-issue159-canonical-approval-fence.PROPOSED.sql"),
    ("current-approval-guard",
     "gpt02-issue159-canonical-reader-guard.PROPOSED.sql"),
)
TABLES = ("approvals", "operator_links", "receipts",
          "core_identity_receipts", "post_consumption_fences")


def call(args, *, stdin=None, check=True):
    r = subprocess.run(
        args, input=stdin, text=True, capture_output=True, timeout=60
    )
    if check and r.returncode:
        raise RuntimeError("DISPOSABLE_CHAIN_COMMAND_FAILED:" + r.stderr[-900:])
    return r


def admin(name, statement, check=True):
    return call([
        "docker", "exec", "-i", name, "psql", "-X",
        "-v", "ON_ERROR_STOP=1", "-U", "root_admin",
        "-d", "postgres", "-At"
    ], stdin=statement, check=check)


def owner(name, statement, check=True):
    return call([
        "docker", "exec", "-i", "-e", "PGPASSWORD=synthetic_migrator_only",
        name, "psql", "-X", "-w", "-h", "127.0.0.1",
        "-v", "ON_ERROR_STOP=1", "-U", "postgres",
        "-d", "postgres", "-At"
    ], stdin=statement, check=check)


def snapshot(name):
    out = admin(name, """
SELECT (
 SELECT oid::text FROM pg_namespace WHERE nspname='gpt02_relock_audit'
)||'|'||(
 SELECT oid::text FROM pg_roles WHERE rolname='dev_gpt02_relock_catalog_auditor'
)||'|'||(
 SELECT oid::text FROM pg_proc WHERE oid=
   'gpt02_relock_audit.relock_expired_phase_a()'::regprocedure
)||'|'||(
 SELECT oid::text FROM pg_proc WHERE oid=
   'gpt02_relock_audit.relock_expired_phase_b()'::regprocedure
)||'|'||(
 SELECT count(*) FROM pg_auth_members
 WHERE member='postgres'::regrole AND roleid='gpt02_store_owner'::regrole
)||'|'||(
 SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_relock_audit'
   AND p.proname IN ('relock_expired_phase_a','relock_expired_phase_b')
   AND p.prosecdef AND p.proowner='postgres'::regrole
)||'|'||(
 SELECT string_agg(COALESCE(p.proacl::text,''),';' ORDER BY p.proname)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_relock_audit'
   AND p.proname IN ('relock_expired_phase_a','relock_expired_phase_b')
);
""").stdout.strip()
    if '|2|' not in out:
        raise AssertionError("WRITER_BASELINE_DRIFT")
    return out


def main():
    image=os.environ.get('GPT02_CHAIN_TEST_PG_IMAGE','postgres:16-alpine')
    if image not in ('postgres:16-alpine','postgres:17-alpine'):
        raise AssertionError('POSTGRES_FIXTURE_IMAGE_NOT_ALLOWED')
    source = []
    for label,file in MIGRATIONS:
        data = (DOCS / file).read_text(encoding="utf-8")
        if not data.startswith("-- GPT02") or not data.strip().endswith(
            ("COMMIT;", "-- NO LIVE READER, AUTHORIZATION, SIGNER OR FINAL ACK.",
             "-- Proposal remains source-only, no live permission or release.",
             "-- End review-only proposal. No live activation.")
        ):
            # Some original proposals include a trailing draft-only comment;
            # validate the transactional SQL without relying on wording.
            stripped="\n".join(line for line in data.splitlines()
                if not line.lstrip().startswith("--")).strip()
            if not stripped.startswith("BEGIN;") or not stripped.endswith("COMMIT;"):
                raise AssertionError("MIGRATION_TRANSACTION_REQUIRED:" + label)
        source.append((label,data))
    name = "gpt02-chain-"+uuid.uuid4().hex[:9]
    try:
        call([
            "docker","run","--rm","-d","--network","none",
            "--name",name,"-e","POSTGRES_USER=root_admin",
            "-e","POSTGRES_PASSWORD=fixture_only",image,
        ])
        for _ in range(120):
            ready = call([
                "docker","exec","-e","PGPASSWORD=fixture_only",name,
                "psql","-X","-w","-h","127.0.0.1",
                "-U","root_admin","-d","postgres","-Atc","SELECT 1"
            ],check=False)
            if ready.returncode==0 and ready.stdout.strip()=="1":
                break
            time.sleep(.25)
        else:
            raise AssertionError("DISPOSABLE_PG_TCP_FINAL_NOT_READY")

        admin(name,"""
CREATE ROLE postgres LOGIN CREATEROLE NOINHERIT
 PASSWORD 'synthetic_migrator_only';
GRANT CREATE ON DATABASE postgres TO postgres;
GRANT SELECT ON pg_catalog.pg_authid TO postgres;
GRANT pg_read_all_stats TO postgres;
CREATE ROLE gpt02_store_owner NOLOGIN NOINHERIT;
CREATE SCHEMA gpt02_private AUTHORIZATION gpt02_store_owner;
REVOKE ALL ON SCHEMA gpt02_private FROM PUBLIC;
""")
        for table in TABLES:
            admin(name, f"""
CREATE TABLE gpt02_private.{table} (id integer);
ALTER TABLE gpt02_private.{table} OWNER TO gpt02_store_owner;
ALTER TABLE gpt02_private.{table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.{table} FORCE ROW LEVEL SECURITY;
""")
        owner(name,"""
CREATE SCHEMA gpt02_relock_audit AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA gpt02_relock_audit FROM PUBLIC;
CREATE ROLE dev_gpt02_relock_catalog_auditor
 NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;
GRANT USAGE ON SCHEMA gpt02_relock_audit
 TO dev_gpt02_relock_catalog_auditor;
CREATE FUNCTION gpt02_relock_audit.relock_expired_phase_a()
 RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
 AS $sql$ SELECT 0 $sql$;
CREATE FUNCTION gpt02_relock_audit.relock_expired_phase_b()
 RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
 AS $sql$ SELECT 0 $sql$;
REVOKE ALL ON FUNCTION gpt02_relock_audit.relock_expired_phase_a() FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_relock_audit.relock_expired_phase_b() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.relock_expired_phase_a()
 TO dev_gpt02_relock_catalog_auditor;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.relock_expired_phase_b()
 TO dev_gpt02_relock_catalog_auditor;
""")
        before=snapshot(name)
        assert admin(name,
            "SELECT NOT pg_has_role('postgres','gpt02_store_owner','SET')"
        ).stdout.strip()=="t"
        print("PASS_ORIGINAL_LOCKED_SCHEMA_OWNER_AND_WRITERS_SEEDED")
        for stage,sql in source:
            r=owner(name,sql,check=False)
            if r.returncode:
                raise RuntimeError("INSTALL_CHAIN_STAGE_"+stage+"_FAILED:"+r.stderr[-1100:])
            if snapshot(name)!=before:
                raise AssertionError("HISTORICAL_RELOCK_OBJECT_REPLACED:"+stage)
            print("PASS_STAGE_ADD_ONLY_"+stage.upper().replace("-","_"))
        # Original roles must remain dormant; never LOGIN or password.
        result = admin(name,"""
SELECT count(*) FROM pg_authid WHERE rolname IN (
 'dev_gpt02_relock_catalog_auditor',
 'dev_gpt02_reader_claim_consumer',
 'dev_gpt02_reader_admission_guard'
) AND NOT rolcanlogin AND rolconnlimit=0
 AND NOT rolinherit AND NOT rolbypassrls AND rolpassword IS NULL;
""").stdout.strip()
        if result!="3":
            raise AssertionError("EXPECTED_ALL_THREE_SERVICE_ROLES_STILL_LOCKED:"+result)
        count=admin(name,"""
SELECT
 (SELECT COUNT(*) FROM gpt02_relock_audit.reader_issuances)||'|'||
 (SELECT COUNT(*) FROM gpt02_relock_audit.reader_consumptions)||'|'||
 (SELECT COUNT(*) FROM gpt02_relock_audit.reader_approval_fences);
""").stdout.strip()
        if count!="0|0|0":
            raise AssertionError("EMPTY_HANDED_OFF_LEDGER_REQUIRED:"+count)
        # No implicit reader, worker or public privilege after staging.
        if admin(name,"SELECT COUNT(*) FROM pg_roles WHERE rolname LIKE 'dev_gpt02_task_%'").stdout.strip()!="0":
            raise AssertionError("INADVERTENT_TASK_READER_CREATED")
        if admin(name,"SELECT pg_has_role('postgres','gpt02_store_owner','SET')").stdout.strip()!="f":
            raise AssertionError("OWNER_SET_PRIVILEGE_WIDENED")
        print("PASS_LOCKED_SERVICE_ROLES_EMPTY_LEDGERS_NO_TASK_ROLE_NO_OWNER_ESCALATION")
        acl=admin(name,"""
SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='gpt02_relock_audit'
AND p.proname IN (
 'scoped_reader_fully_locked','reader_consumption_persisted',
 'consume_reader_once','canonical_reader_current_guard')
AND p.prosecdef AND p.proowner='postgres'::regrole
AND NOT EXISTS (
 SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
 WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE');
""").stdout.strip()
        if acl!='4':
            raise AssertionError('PRIVATE_DEFINER_PUBLIC_EXECUTE_NOT_REVOKED:'+acl)
        rls=admin(name,"""
SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='gpt02_relock_audit'
AND c.relname IN ('reader_issuances','reader_consumptions','reader_approval_fences')
AND c.relkind='r' AND c.relowner='postgres'::regrole
AND c.relrowsecurity AND c.relforcerowsecurity;
""").stdout.strip()
        if rls!='3':
            raise AssertionError('ONE_READ_LEDGER_FORCE_RLS_NOT_PRESERVED:'+rls)
        print('PASS_FOUR_PINNED_PRIVATE_DEFINER_ACLS_NO_PUBLIC_EXECUTE')
        print('PASS_THREE_NEW_LEDGERS_FORCE_RLS_OWNER_PRESERVED')
        # Installing an already reviewed stage again must fail closed; no
        # attempt to recreate or overwrite historical objects is permitted.
        for stage,sql in source:
            retry=owner(name,sql,check=False)
            if retry.returncode == 0:
                raise AssertionError("REPLAY_MIGRATION_ALLOWED:"+stage)
            if snapshot(name)!=before:
                raise AssertionError("REPLAY_DAMAGED_EXISTING_WRITERS:"+stage)
        print("PASS_ALL_SIX_MIGRATIONS_REPLAY_DENIED")
        print("SOURCE_ONLY_NETWORKLESS_PG16_PG17_DISPOSABLE_RELEASE_NO_GO")
    finally:
        call(["docker","rm","-f",name],check=False)


if __name__=="__main__":
    main()
