#!/usr/bin/env python3
"""Disposable PG16 proof: auditor sees only a boolean, not pg_authid hashes.

Executes the source-only, minimal SECURITY DEFINER proposal in a completely
networkless temporary PostgreSQL 16 container with a non-superuser CREATEROLE
migrator. Existing live CST-DEV and all systemd credentials stay untouched.
The ordinary auditor gains EXECUTE on ONE read-only, role-restricted function
but cannot directly inspect pg_authid, issue a credential, read a task row,
alter a role, or dispatch a worker. The existing issuer stays unmodified.
"""
from __future__ import annotations

import secrets
import subprocess
import time
import uuid
from pathlib import Path

from test_gpt02_issue159_signed_scope_pg import (
    FIVE_TABLE_FIXTURE, make_candidate, quote,
)

ROOT = Path(__file__).resolve().parents[2]
PROPOSAL = (ROOT / "docs/dev" /
            "gpt02-issue159-minimal-catalog-relock-auditor.PROPOSED.sql")
AUDITOR = "dev_gpt02_relock_catalog_auditor"
AUDIT_FN = "gpt02_relock_audit.scoped_reader_fully_locked"
TABLES = (
    "approvals", "operator_links", "receipts",
    "core_identity_receipts", "post_consumption_fences",
)


def run(*args, stdin=None, check=True):
    result = subprocess.run(
        args, text=True, input=stdin, capture_output=True, timeout=45,
    )
    if check and result.returncode:
        raise RuntimeError("DISPOSABLE_PG16_COMMAND_FAILED:" +
                           result.stderr[-1300:])
    return result


def admin(name, sql, *, check=True):
    return run("docker", "exec", "-i", name, "psql", "-X", "-At",
               "-v", "ON_ERROR_STOP=1", "-U", "root_admin",
               "-d", "postgres", stdin=sql, check=check)


def login(name, role, password, sql, *, check=True):
    return run(
        "docker", "exec", "-e", "PGPASSWORD=" + password,
        name, "psql", "-X", "-At", "-w", "-h", "127.0.0.1",
        "-v", "ON_ERROR_STOP=1", "-U", role,
        "-d", "postgres", "-c", sql, check=check,
    )


def probe(name, role, password, target, *, check=True):
    # The SQL function receives a literal role name in this TEST ONLY.
    # It does not construct arbitrary SQL identifiers or return secrets.
    return login(name, role, password, "SELECT " + AUDIT_FN +
                 "(" + quote(target) + "::name)", check=check)


def main():
    proposal = PROPOSAL.read_text(encoding="utf-8")
    commands = "\n".join(
        line for line in proposal.splitlines()
        if not line.lstrip().startswith("--")
    )
    if (
        "SECURITY DEFINER" not in commands
        or "SET search_path = pg_catalog, pg_temp" not in commands
        or "REVOKE ALL ON FUNCTION" not in commands
        or "NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0" not in commands
        or "ALTER ROLE" in commands
        or "PASSWORD " in commands
        or "GRANT SELECT ON pg_catalog.pg_authid" in commands
        or "GRANT EXECUTE" not in commands
    ):
        raise AssertionError("MINIMAL_AUDITOR_PROPOSAL_SECURITY_CONTRACT_BROKEN")

    candidate = make_candidate()
    role = candidate["candidateRole"]
    if candidate["credentialIssuancePermitted"] is not False:
        raise AssertionError("SOURCE_SIGNED_SCOPE_MUST_STAY_INERT")

    name = "issue159-minimal-audit-" + uuid.uuid4().hex[:10]
    reader_password = secrets.token_urlsafe(28)
    audit_password = secrets.token_urlsafe(28)
    held = None
    try:
        run("docker", "run", "--rm", "-d", "--network", "none",
            "--name", name, "-e", "POSTGRES_USER=root_admin",
            "-e", "POSTGRES_PASSWORD=fixture_only", "postgres:16-alpine")
        # Final TCP server only (not bootstrap socket).
        for _ in range(120):
            check = run("docker", "exec", "-e",
                        "PGPASSWORD=fixture_only", name, "psql",
                        "-X", "-w", "-h", "127.0.0.1", "-U", "root_admin",
                        "-d", "postgres", "-Atc", "SELECT 1", check=False)
            if check.returncode == 0:
                break
            time.sleep(.25)
        else:
            raise RuntimeError("DISPOSABLE_PG_NOT_READY")
        sql = FIVE_TABLE_FIXTURE.replace("task170_reader", role)
        for old, new in (
            ("'n170'", quote(candidate["scope"]["approval_nonce"])),
            ("'d170'", quote(candidate["scope"]["approval_digest"])),
            ("'link170'", quote(candidate["scope"]["link_digest"])),
        ):
            if old not in sql:
                raise AssertionError("SIGNED_SCOPE_SEED_MISSING")
            sql = sql.replace(old, new)
        seed = admin(name, sql)
        if "PASS_FIVE_TABLE_DIRECT_ENUMERATION_SCOPED" not in seed.stderr:
            raise AssertionError("RLS_NOT_INITIALIZED")
        # Separate non-superuser postgres actor. The actual CST-DEV postgres
        # has database CREATE and pg_authid SELECT as observed read-only.
        admin(name, """
CREATE ROLE postgres LOGIN CREATEROLE NOINHERIT
 PASSWORD 'synthetic_postgres_admin';
GRANT CREATE ON DATABASE postgres TO postgres;
GRANT SELECT ON pg_catalog.pg_authid TO postgres;
GRANT pg_read_all_stats TO postgres;
CREATE ROLE unrelated_test LOGIN PASSWORD 'synthetic_unrelated';
""")
        limited = admin(name,
            "SELECT NOT rolsuper AND rolcreaterole FROM pg_roles "
            "WHERE rolname='postgres'")
        if limited.stdout.strip() != "t":
            raise AssertionError("MIGRATOR_NOT_NON_SUPERUSER")
        migration = login(
            name, "postgres", "synthetic_postgres_admin", proposal,
        )
        if migration.returncode:
            raise AssertionError("MINIMAL_AUDITOR_MIGRATION_FAILED")
        print("PASS_PRIVATE_SCHEMA_AND_FUNCTION_CREATED_BY_NON_SUPERUSER")
        custody = admin(name,
            "SELECT NOT rolcanlogin AND NOT rolinherit "
            "AND NOT rolcreaterole AND NOT rolbypassrls "
            "AND rolconnlimit=0 FROM pg_roles WHERE rolname=" +
            quote(AUDITOR))
        if custody.stdout.strip() != "t":
            raise AssertionError("AUDITOR_NOT_DORMANT")
        role_privs = admin(name,
            "SELECT has_table_privilege(" + quote(AUDITOR) +
            ",'pg_catalog.pg_authid','SELECT'), "
            "has_schema_privilege(" + quote(AUDITOR) +
            ",'gpt02_private','USAGE'), "
            "has_function_privilege(" + quote(AUDITOR) +
            "," + quote(AUDIT_FN + "(name)") + ",'EXECUTE')")
        if role_privs.stdout.strip() != "f|f|t":
            raise AssertionError("AUDITOR_EXPOSES_CATALOG_OR_PRIVATE_SCHEMA")
        unauthorized = admin(name,
            "SELECT has_function_privilege('unrelated_test'," +
            quote(AUDIT_FN + "(name)") + ",'EXECUTE')")
        if unauthorized.stdout.strip() != "f":
            raise AssertionError("PUBLIC_FUNCTION_EXECUTE_LEAK")
        owner = admin(name,
            "SELECT p.prosecdef,pg_get_userbyid(p.proowner) "
            "FROM pg_proc p WHERE p.oid=" +
            quote(AUDIT_FN + "(name)") + "::regprocedure")
        if owner.stdout.strip() != "t|postgres":
            raise AssertionError("AUDITOR_FUNCTION_OWNER_NOT_PINNED")
        print("PASS_AUDITOR_HAS_ONLY_ONE_EXECUTE_NO_AUTHID_OR_LINEAGE_ACCESS")

        # Temporarily enable only the synthetic low-privilege auditor LOGIN
        # inside this disposable container; proposed SQL never enables it.
        admin(name, "ALTER ROLE " + AUDITOR +
              " LOGIN CONNECTION LIMIT 1 PASSWORD " +
              quote(audit_password) + ";")
        before = probe(name, AUDITOR, audit_password, role)
        if before.stdout.strip() != "f":
            raise AssertionError("OLD_SELECT_GRANTS_NOT_DETECTED")
        nonexisting = probe(
            name, AUDITOR, audit_password,
            "dev_gpt02_task_174_ffffffffffff",
        )
        if nonexisting.stdout.strip() != "f":
            raise AssertionError("MISSING_ROLE_SHOULD_NOT_APPEAR_LOCKED")
        bad_target = probe(name, AUDITOR, audit_password,
                           "postgres", check=False)
        if bad_target.returncode == 0:
            raise AssertionError("ARBITRARY_ROLE_AUDIT_ALLOWED")
        direct = login(name, AUDITOR, audit_password,
                       "SELECT rolpassword FROM pg_catalog.pg_authid",
                       check=False)
        if direct.returncode == 0:
            raise AssertionError("AUDITOR_CAN_READ_PASSWORD_HASHES")
        private = login(name, AUDITOR, audit_password,
                        "SELECT count(*) FROM gpt02_private.approvals",
                        check=False)
        if private.returncode == 0:
            raise AssertionError("AUDITOR_CAN_READ_LINEAGE_ROWS")
        write = login(name, AUDITOR, audit_password,
                      "ALTER ROLE " + role + " LOGIN", check=False)
        if write.returncode == 0:
            raise AssertionError("AUDITOR_CAN_ALTER_ROLES")
        print("PASS_ONLY_BOOLEAN_RESULT_NO_HASHES_NO_PRIVATE_ROWS_NO_ROLE_WRITES")

        admin(name, "ALTER ROLE " + role +
              " LOGIN CONNECTION LIMIT 1 PASSWORD " +
              quote(reader_password) + ";")
        held = subprocess.Popen([
            "docker", "exec", "-e", "PGPASSWORD=" + reader_password,
            name, "psql", "-X", "-w", "-h", "127.0.0.1",
            "-U", role, "-d", "postgres", "-Atc", "SELECT pg_sleep(16)",
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        for _ in range(75):
            state = admin(name,
                "SELECT count(*) FROM pg_stat_activity WHERE usename=" +
                quote(role) + " AND state='active'")
            if state.stdout.strip() == "1":
                break
            if held.poll() is not None:
                raise AssertionError("READER_SESSION_EXITED_EARLY")
            time.sleep(.1)
        else:
            raise AssertionError("READER_SESSION_NOT_OBSERVED")
        active = probe(name, AUDITOR, audit_password, role)
        if active.stdout.strip() != "f":
            raise AssertionError("ACTIVE_READER_UNCORRECTLY_LOCKED")
        print("PASS_ACTIVE_READER_AND_PASSWORD_AUDIT_FAIL_CLOSED")

        admin(name,
            "BEGIN; REVOKE SELECT ON " +
            ", ".join("gpt02_private." + t for t in TABLES) +
            " FROM " + role + "; "
            "REVOKE USAGE ON SCHEMA gpt02_private FROM " + role + "; "
            "ALTER ROLE " + role +
            " NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL; "
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE usename=" + quote(role) + " "
            "AND pid <> pg_backend_pid(); COMMIT;")
        held.communicate(timeout=8)
        if held.returncode == 0:
            raise AssertionError("ACTIVE_READER_SURVIVED_RELOCK")
        after = probe(name, AUDITOR, audit_password, role)
        if after.stdout.strip() != "t":
            raise AssertionError("MINIMAL_AUDITOR_FALSE_NEGATIVE_AFTER_RELOCK")
        print("PASS_BOOLEAN_ONLY_AUDIT_NATIVE_PG16_RELOCK_TRUE_AFTER_CLEANUP")

        # SECURITY REVIEW: A role with NO private table SELECT can still
        # invoke a separately granted SECURITY DEFINER routine in public
        # that is owned by a privileged account and reads private rows.
        # The relock auditor must NOT claim 'fully cleaned' in that case.
        # This test creates only synthetic tables/functions in the
        # networkless disposable container, NEVER in live Supabase.
        admin(name, """
CREATE FUNCTION public.issue159_synthetic_privileged_read()
RETURNS bigint LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $leak$
 SELECT count(*) FROM gpt02_private.approvals;
$leak$;
REVOKE ALL ON FUNCTION
 public.issue159_synthetic_privileged_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 public.issue159_synthetic_privileged_read() TO """ + role + ";")
        leaked = admin(name,
            "SET ROLE " + role + "; "
            "SELECT public.issue159_synthetic_privileged_read(); "
            "RESET ROLE;")
        if [line.strip() for line in leaked.stdout.splitlines() if line.strip() == "2"] != ["2"]:
            raise AssertionError("SYNTHETIC_PRIVILEGED_FUNCTION_BYPASS_NOT_REPRODUCED")
        revoked_role_but_definer = probe(name, AUDITOR, audit_password, role)
        if revoked_role_but_definer.stdout.strip() != "f":
            raise AssertionError("DEF_CHECK_MISSED_ACCESSIBLE_SECURITY_DEFINER")
        print("PASS_PRIVILEGED_ROUTINE_BYPASS_DETECTED_WITH_PRIVATE_SELECT_REVOKED")

        admin(name, "REVOKE EXECUTE ON FUNCTION "
              "public.issue159_synthetic_privileged_read() FROM " + role + ";")
        restored = probe(name, AUDITOR, audit_password, role)
        if restored.stdout.strip() != "t":
            raise AssertionError("CLEAN_AUDIT_DID_NOT_RECOVER_AFTER_RPC_REVOKE")
        print("PASS_PRIVILEGED_ROUTINE_EXECUTE_REVOCATION_RESTORES_CLEAN_ATTESTATION")

        # Both signed reader and dedicated auditor remain locked after the
        # demo and their temporary passwords are NULL.
        admin(name, "ALTER ROLE " + AUDITOR +
              " NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL;")
        attest_final = admin(name,
            "SELECT NOT rolcanlogin AND rolpassword IS NULL "
            "FROM pg_authid WHERE rolname=" + quote(AUDITOR))
        if attest_final.stdout.strip() != "t":
            raise AssertionError("AUDITOR_NOT_LOCKED_AFTER_TEST")
        print("SYNTHETIC_ONLY_NO_CST_DEV_ROLE_OR_CREDENTIAL_MUTATION")
    finally:
        if held is not None and held.poll() is None:
            held.kill()
            held.communicate(timeout=5)
        run("docker", "rm", "-f", name, check=False)


if __name__ == "__main__":
    main()
