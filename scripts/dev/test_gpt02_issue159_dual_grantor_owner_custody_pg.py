#!/usr/bin/env python3
"""Issue159: preserve real CST-DEV DUAL-GRANTOR owner membership during temporary SET.

Disposable PG16/PG17, --network none. Never connects to Supabase or reads
passwords/credentials. Reproduces the observed postgres+provider membership
rows; rejects legacy REVOKE that would silently destroy pre-existing self-grant.
This is NOT authority for a hosted database change.
"""
from __future__ import annotations
import os
import secrets
import subprocess
import time
import uuid

IMAGE = os.environ.get("GPT02_DUAL_GRANTOR_TEST_PG_IMAGE", "postgres:16-alpine")
if IMAGE not in ("postgres:16-alpine", "postgres:17-alpine"):
    raise SystemExit("DISPOSABLE_IMAGE_ALLOWLIST_REQUIRED")


def run(cmd, *, sql=None, check=True):
    result = subprocess.run(
        cmd, input=sql, text=True, capture_output=True, timeout=45,
    )
    if check and result.returncode:
        raise RuntimeError("DISPOSABLE_DUAL_GRANTOR_FAILED:" + result.stderr[-750:])
    return result


def psql(name, role, password, sql, *, check=True):
    return run([
        "docker", "exec", "-i", "-e", "PGPASSWORD="+password, name,
        "psql", "-X", "-w", "-h", "127.0.0.1", "-U", role,
        "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At",
    ], sql=sql, check=check)


def memberships(name, password):
    return psql(name, "fixture_root", password, """
SELECT grantor::regrole::text || '|' || admin_option::text || '|' ||
 inherit_option::text || '|' || set_option::text
FROM pg_auth_members WHERE roleid='gpt02_store_owner'::regrole
 AND member='postgres'::regrole ORDER BY grantor::regrole::text;
""").stdout.strip().splitlines()


def assert_baseline(name, password, expected):
    rows = memberships(name, password)
    if rows != expected:
        raise AssertionError("DUAL_GRANTOR_MEMBERSHIP_DRIFT:"+repr(rows))
    role = psql(name,"fixture_root",password, """
SELECT NOT rolcanlogin AND NOT rolinherit AND rolpassword IS NULL
FROM pg_authid WHERE rolname='gpt02_store_owner';
""").stdout.strip()
    if role!="t":
        raise AssertionError("OWNER_NOLOGIN_OR_PASSWORD_DRIFT")
    can_set=psql(name,"fixture_root",password,
        "SELECT pg_has_role('postgres','gpt02_store_owner','SET');").stdout.strip()
    if can_set!="f":
        raise AssertionError("TRANSIENT_OWNER_SET_LEFT_ACTIVE")


def main():
    name="gpt02-dual-grantor-"+uuid.uuid4().hex[:10]
    root_pw=secrets.token_urlsafe(24)
    try:
        run([
            "docker","run","--rm","-d","--network","none",
            "--name",name,"-e","POSTGRES_USER=fixture_root",
            "-e","POSTGRES_PASSWORD="+root_pw,IMAGE,
        ])
        for _ in range(120):
            ok=psql(name,"fixture_root",root_pw,"SELECT 1;",check=False)
            if ok.returncode==0 and ok.stdout.strip()=="1":
                break
            time.sleep(.25)
        else:
            raise RuntimeError("FINAL_DISPOSABLE_PG_TCP_NOT_READY")

        psql(name,"fixture_root",root_pw,"""
CREATE ROLE postgres LOGIN CREATEROLE NOINHERIT PASSWORD 'synthetic_does_not_leave_fixture';
CREATE ROLE gpt02_store_owner NOLOGIN NOINHERIT;
CREATE SCHEMA gpt02_private AUTHORIZATION gpt02_store_owner;
REVOKE ALL ON SCHEMA gpt02_private FROM PUBLIC;
GRANT gpt02_store_owner TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
""")
        # Non-superuser postgres holds real ADMIN; model its existing SECOND
        # grantor row, instead of pretending it has only one membership.
        psql(name,"postgres","synthetic_does_not_leave_fixture",
            "GRANT gpt02_store_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET FALSE;")
        expected=[
            "fixture_root|true|false|false",
            "postgres|false|false|false",
        ]
        assert_baseline(name,root_pw,expected)
        print("PASS_DUAL_GRANTOR_SUPABASE_STYLE_BASELINE",flush=True)

        denied=psql(name,"postgres","synthetic_does_not_leave_fixture",
                    "SET ROLE gpt02_store_owner;",check=False)
        if denied.returncode==0:
            raise AssertionError("OWNER_SET_ALLOWED_WITHOUT_TEMPORARY_GRANT")
        print("PASS_DEFAULT_OWNER_SET_DENIED",flush=True)

        # Demonstrate a DANGEROUS existing runbook. REVOKE removes the
        # preexisting postgres-issued row; rollback must restore it.
        historical=psql(name,"postgres","synthetic_does_not_leave_fixture","""
BEGIN;
GRANT gpt02_store_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
SET ROLE gpt02_store_owner;
RESET ROLE;
REVOKE gpt02_store_owner FROM postgres GRANTED BY postgres;
SELECT COUNT(*) FROM pg_auth_members
 WHERE roleid='gpt02_store_owner'::regrole
 AND member='postgres'::regrole;
ROLLBACK;
""")
        counts=[s.strip() for s in historical.stdout.splitlines() if s.strip().isdigit()]
        if counts != ["1"]:
            raise AssertionError("OLD_REVOKE_DID_NOT_SHOW_SELF_GRANT_LOSS:"+repr(counts))
        assert_baseline(name,root_pw,expected)
        print("PASS_LEGACY_REVOKE_WOULD_DELETE_EXISTING_SELF_GRANT_ROLLBACK",flush=True)

        # Fault injection: ephemeral SET must roll back with failed command,
        # preserving BOTH original grantor entries and no enabled SET.
        failure=psql(name,"postgres","synthetic_does_not_leave_fixture","""
BEGIN;
GRANT gpt02_store_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
SET ROLE gpt02_store_owner;
SELECT 1/0;
COMMIT;
""",check=False)
        if failure.returncode==0:
            raise AssertionError("FAULT_INJECTION_UNEXPECTED_SUCCESS")
        assert_baseline(name,root_pw,expected)
        print("PASS_OWNER_SET_ERROR_AUTOMATIC_TRANSACTION_ROLLBACK",flush=True)

        # Safe SHAPE: modify only the EXISTING self-grant SET bit, restore
        # it to FALSE *in the same transaction*, and preserve provider row.
        approved=psql(name,"postgres","synthetic_does_not_leave_fixture","""
BEGIN;
GRANT gpt02_store_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
SET ROLE gpt02_store_owner;
DO $owner$
BEGIN
 IF current_user <> 'gpt02_store_owner' OR session_user <> 'postgres'
 THEN RAISE EXCEPTION 'OWNER_EFFECTIVE_IDENTITY_DRIFT'; END IF;
END $owner$;
CREATE FUNCTION gpt02_private.synthetic_owner_custody_readback()
RETURNS integer LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog AS $safe$ SELECT 1 $safe$;
REVOKE ALL ON FUNCTION
 gpt02_private.synthetic_owner_custody_readback() FROM PUBLIC;
RESET ROLE;
GRANT gpt02_store_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET FALSE;
COMMIT;
""")
        if approved.returncode!=0:
            raise AssertionError("TRANSIENT_OWNER_FUNCTION_FIXTURE_FAILED")
        assert_baseline(name,root_pw,expected)
        created=psql(name,"fixture_root",root_pw,"""
SELECT p.prosecdef
 AND p.proowner='gpt02_store_owner'::regrole
 AND NOT EXISTS(
 SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
 WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')
FROM pg_proc p
WHERE p.oid='gpt02_private.synthetic_owner_custody_readback()'::regprocedure;
""").stdout.strip()
        if created!="t":
            raise AssertionError("OWNER_HELD_ONLY_FUNCTION_NOT_PROVEN")
        print("PASS_SAME_TRANSACTION_RESTORE_SET_FALSE_BOTH_GRANTS_PRESERVED",flush=True)
        print("PASS_OWNER_HELD_FUNCTION_NO_PUBLIC_EXECUTE",flush=True)
        print("SOURCE_ONLY_DISPOSABLE_"+IMAGE.replace(":","_")+" NO_CST_DEV_CHANGE")
    finally:
        run(["docker","rm","-f",name],check=False)


if __name__=="__main__":
    main()
