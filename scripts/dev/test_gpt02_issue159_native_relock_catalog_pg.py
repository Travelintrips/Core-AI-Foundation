#!/usr/bin/env python3
"""Disposable real PostgreSQL proof for Issue159 native relock readback SQL.

Uses a completely independent postgres:16-alpine container --network none.
The bootstrap superuser seeds data but the catalog query runs AS a separate
NON-SUPERUSER CREATEROLE user 'postgres', with read-only pg_authid privilege.
No Supabase connection, operational secret, signer, dispatch, or deployment.
"""
from __future__ import annotations

import secrets
import subprocess
import time
import uuid

from gpt02_issue159_native_relock_attestation import READBACK_SQL, COLUMNS, _target
from test_gpt02_issue159_signed_scope_pg import (
    make_candidate, FIVE_TABLE_FIXTURE, quote,
)

TABLES = (
    "approvals", "operator_links", "receipts",
    "core_identity_receipts", "post_consumption_fences",
)


def run(args, *, stdin=None, check=True):
    r = subprocess.run(args, input=stdin, capture_output=True, text=True,
                       timeout=40)
    if check and r.returncode:
        raise RuntimeError("DISPOSABLE_POSTGRES_FAILED:" + r.stderr[-1400:])
    return r


def bootstrap(name, sql, *, check=True):
    return run([
        "docker", "exec", "-i", name, "psql", "-X", "-At",
        "-v", "ON_ERROR_STOP=1", "-U", "root_admin", "-d", "postgres",
    ], stdin=sql, check=check)


def audit(name, sql):
    return run([
        "docker", "exec", "-i", "-e", "PGPASSWORD=synthetic_admin_pw",
        name, "psql", "-X", "-w", "-At",
        "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1",
        "-U", "postgres", "-d", "postgres",
    ], stdin=sql)


def reader_login(name, role, password, sql):
    return [
        "docker", "exec", "-e", "PGPASSWORD=" + password,
        name, "psql", "-X", "-w", "-h", "127.0.0.1",
        "-U", role, "-d", "postgres", "-Atc", sql,
    ]


def catalog(name, role):
    # Exact static SQL is used without modifying predicates. This isolated
    # psql fixture inlines only the validated synthetic role argument;
    # real psycopg uses bound {'role': role} parameters in source module.
    q = READBACK_SQL.replace("%(role)s", quote(role))
    if "%(" in q:
        raise AssertionError("UNBOUND_CATALOG_SQL_PLACEHOLDER")
    result = audit(name, q)
    lines = [x.strip().split("|") for x in result.stdout.splitlines()
             if x.strip()]
    if len(lines) != 1 or len(lines[0]) != len(COLUMNS):
        raise AssertionError("CATALOG_ROW_SHAPE_INVALID:" + repr(lines))
    row = lines[0]
    return dict(zip(COLUMNS, [
        x == "t" if i >= 3 else x
        for i, x in enumerate(row)
    ]))


def main():
    candidate = make_candidate()
    role, digest = _target(candidate)
    if role != candidate["candidateRole"] or digest != candidate["scopeSha256"]:
        raise AssertionError("VERIFIED_ROLE_NOT_BOUND_TO_SCOPE")
    password = secrets.token_urlsafe(32)
    name = "issue159-native-audit-" + uuid.uuid4().hex[:10]
    sleeping = None
    try:
        run(["docker", "run", "--rm", "-d", "--network", "none",
             "--name", name, "-e", "POSTGRES_USER=root_admin",
             "-e", "POSTGRES_PASSWORD=fixture_only",
             "postgres:16-alpine"])
        for _ in range(120):
            ready = run([
                "docker", "exec", "-e", "PGPASSWORD=fixture_only", name,
                "psql", "-X", "-w", "-h", "127.0.0.1", "-U",
                "root_admin", "-d", "postgres", "-Atc", "SELECT 1",
            ], check=False)
            if ready.returncode == 0:
                break
            time.sleep(.25)
        else:
            raise RuntimeError("FINAL_POSTGRES_BOOT_NOT_READY")
        fixture = FIVE_TABLE_FIXTURE.replace("task170_reader", role)
        scope = candidate["scope"]
        for original, signed in (
            ("'n170'", quote(scope["approval_nonce"])),
            ("'d170'", quote(scope["approval_digest"])),
            ("'link170'", quote(scope["link_digest"])),
        ):
            if original not in fixture:
                raise AssertionError("SIGNED_RLS_FIXTURE_MISSING")
            fixture = fixture.replace(original, signed)
        seeded = bootstrap(name, fixture)
        if "PASS_FIVE_TABLE_DIRECT_ENUMERATION_SCOPED" not in seeded.stderr:
            raise AssertionError("CANONICAL_FIVE_TABLE_SCOPE_NOT_PROVEN")

        bootstrap(name, """
CREATE ROLE postgres LOGIN CREATEROLE NOINHERIT
 PASSWORD 'synthetic_admin_pw';
GRANT SELECT ON pg_catalog.pg_authid TO postgres;
""")
        normal_admin = bootstrap(name,
            "SELECT NOT rolsuper AND rolcreaterole FROM pg_roles "
            "WHERE rolname='postgres'")
        if normal_admin.stdout.strip() != "t":
            raise AssertionError("CATALOG_READER_MUST_NOT_BE_SUPERUSER")
        pre = catalog(name, role)
        if pre["no_login"] is not True or pre["five_table_read_revoked"] is not False:
            raise AssertionError("NATIVE_CATALOG_FAILED_TO_SEE_LINGERING_GRANTS")
        print("PASS_NATIVE_NON_SUPERUSER_READS_PG_AUTHID_AND_SEES_UNREVOKED_SELECT")

        bootstrap(name,
            "ALTER ROLE " + role +
            " LOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 1 PASSWORD "
            + quote(password) + ";")
        sleeping = subprocess.Popen(
            reader_login(name, role, password, "SELECT pg_sleep(20)"),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        for _ in range(75):
            state = bootstrap(name,
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE usename=" + quote(role) + " AND state='active'")
            if state.stdout.strip() == "1":
                break
            if sleeping.poll() is not None:
                raise AssertionError("READER_SESSION_EXITED_TOO_EARLY")
            time.sleep(.1)
        else:
            raise AssertionError("ACTIVE_READER_NOT_DETECTED")
        active = catalog(name, role)
        if active["no_login"] or active["password_null"] or active["zero_active_sessions"]:
            raise AssertionError("NATIVE_CATALOG_MISSED_ACTIVE_SESSION_OR_PASSWORD")
        print("PASS_NATIVE_AUDIT_DENIES_ACTIVE_READER_AND_PRESENT_PASSWORD")

        bootstrap(name,
            "BEGIN; "
            "REVOKE SELECT ON " + ", ".join(
                "gpt02_private." + t for t in TABLES
            ) + " FROM " + role + "; "
            "REVOKE USAGE ON SCHEMA gpt02_private FROM " + role + "; "
            "ALTER ROLE " + role +
            " NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL; "
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE usename=" + quote(role) + " AND pid<>pg_backend_pid(); "
            "COMMIT;")
        sleeping.communicate(timeout=8)
        if sleeping.returncode == 0:
            raise AssertionError("NATIVE_ACTIVE_READER_SURVIVED_RELOCK")
        locked = catalog(name, role)
        if (
            locked["observed_session_user"] != "postgres"
            or locked["observed_current_user"] != "postgres"
            or locked["observed_role"] != role
            or any(locked[key] is not True for key in COLUMNS[3:])
        ):
            raise AssertionError("NATIVE_CATALOG_DID_NOT_PROVE_FULL_RELOCK:"
                                 + repr(locked))
        print("PASS_NATIVE_CATALOG_FULL_RELOCK_PASSWORD_NULL_NO_SESSIONS_NO_GRANTS")

        if run(reader_login(name, role, password, "SELECT 1"),
               check=False).returncode == 0:
            raise AssertionError("NEW_LOGIN_AFTER_RELOCK_ACCEPTED")
        print("PASS_NEW_LOGIN_REJECTED_AFTER_NATIVE_VERIFIED_RELOCK")
        print("DISPOSABLE_ONLY_NOT_A_LIVE_CST_DEV_CREDENTIAL_ISSUER")
    finally:
        if sleeping is not None and sleeping.poll() is None:
            sleeping.kill()
            sleeping.communicate(timeout=5)
        run(["docker", "rm", "-f", name], check=False)


if __name__ == "__main__":
    main()
