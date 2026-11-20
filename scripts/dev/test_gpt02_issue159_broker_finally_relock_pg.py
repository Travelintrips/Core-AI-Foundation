#!/usr/bin/env python3
"""Synthetic GPT02 DEV one-shot reader cleanup on success AND query failure.

This test exercises an isolated PostgreSQL 16 --network none container.
NO live database, OS credential, signer or dispatch. The synthetic broker
owns its disposable login, executes at most one bounded lineage query, and
ALWAYS revokes SELECT/USAGE, sets NOLOGIN/CONNECTION LIMIT 0/PASSWORD NULL,
and terminates reader sessions in a finally block. This is a broker contract
test, not a deployable authority issuer.
"""
from __future__ import annotations

import secrets
import subprocess
import time
import uuid

from test_gpt02_issue159_signed_scope_pg import (
    FIVE_TABLE_FIXTURE, make_candidate, bound_query, quote
)

TABLES = (
    "approvals", "operator_links", "receipts",
    "core_identity_receipts", "post_consumption_fences",
)


def run(args, *, stdin=None, check=True):
    result = subprocess.run(args, input=stdin, text=True,
                            capture_output=True, timeout=45)
    if check and result.returncode:
        raise RuntimeError("DISPOSABLE_TEST_COMMAND_ERROR:" +
                           result.stderr[-1300:])
    return result


def admin(container, sql):
    return run([
        "docker", "exec", "-i", container, "psql", "-X",
        "-v", "ON_ERROR_STOP=1", "-U", "postgres",
        "-d", "postgres", "-At",
    ], stdin=sql)


def native(container, role, password, query):
    return run([
        "docker", "exec", "-e", "PGPASSWORD=" + password,
        container, "psql", "-X", "-w", "-h", "127.0.0.1",
        "-U", role, "-d", "postgres", "-At",
        "-v", "ON_ERROR_STOP=1", "-c", query,
    ], check=False)


def setup(container, candidate, password):
    scope = candidate["scope"]
    role = candidate["candidateRole"]
    sql = FIVE_TABLE_FIXTURE.replace("task170_reader", role)
    for before, after in (
        ("'n170'", quote(scope["approval_nonce"])),
        ("'d170'", quote(scope["approval_digest"])),
        ("'link170'", quote(scope["link_digest"])),
    ):
        if before not in sql:
            raise AssertionError("SYNTHETIC_SCOPE_SEED_MISSING")
        sql = sql.replace(before, after)
    seeded = admin(container, sql)
    if "PASS_FIVE_TABLE_DIRECT_ENUMERATION_SCOPED" not in seeded.stderr:
        raise AssertionError("RLS_SETUP_NOT_VERIFIED")
    admin(container, "ALTER ROLE " + role +
          " LOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 1 PASSWORD " +
          quote(password) + ";")
    return role


def relock(container, role):
    sql = (
        "BEGIN; "
        "REVOKE SELECT ON " +
        ", ".join("gpt02_private." + t for t in TABLES) +
        " FROM " + role + "; "
        "REVOKE USAGE ON SCHEMA gpt02_private FROM " + role + "; "
        "ALTER ROLE " + role +
        " NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL; "
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
        "WHERE usename=" + quote(role) + " AND pid<>pg_backend_pid(); "
        "COMMIT;"
    )
    admin(container, sql)


def assert_locked(container, role, password):
    state = admin(
        container,
        "SELECT NOT r.rolcanlogin AND r.rolconnlimit=0 "
        "AND r.rolpassword IS NULL "
        "AND NOT r.rolinherit AND NOT r.rolbypassrls "
        "AND (SELECT count(*) FROM pg_stat_activity a "
        " WHERE a.usename=r.rolname)=0 "
        "FROM pg_authid r WHERE r.rolname=" + quote(role),
    )
    if state.stdout.strip() != "t":
        raise AssertionError("SYNTHETIC_RELOCK_OR_ZERO_SESSION_FAILED")
    retry = native(container, role, password, "SELECT 1")
    if retry.returncode == 0:
        raise AssertionError("READER_LOGIN_ALLOWED_AFTER_RELOCK")


def scenario(mode):
    candidate = make_candidate()
    if (
        candidate["releaseDecision"] != "NO_GO"
        or candidate["credentialIssuancePermitted"] is not False
        or candidate["databaseRoleProvisioned"] is not False
    ):
        raise AssertionError("INERT_CANDIDATE_REQUIRED")
    role = candidate["candidateRole"]
    password = secrets.token_urlsafe(32)
    container = "issue159-finally-" + uuid.uuid4().hex[:10]
    try:
        run([
            "docker", "run", "--rm", "-d", "--network", "none",
            "--name", container, "-e", "POSTGRES_PASSWORD=fixture_only",
            "postgres:16-alpine",
        ])
        for _ in range(120):
            ready = run([
                "docker", "exec", "-e", "PGPASSWORD=fixture_only",
                container, "psql", "-X", "-w", "-h", "127.0.0.1",
                "-U", "postgres", "-d", "postgres", "-Atc", "SELECT 1",
            ], check=False)
            if ready.returncode == 0:
                break
            time.sleep(.25)
        else:
            raise RuntimeError("DISPOSABLE_POSTGRES_NOT_READY")
        setup(container, candidate, password)
        query = "SELECT count(*) FROM (" + bound_query(candidate["scope"]) + ") AS lineage"
        # The synthetic broker uses the existing canonical query; the
        # statement timeout fault-injection wraps the same query with
        # pg_sleep(1), without altering any protected data.
        if mode == "query_timeout":
            query = "SELECT pg_sleep(1) FROM (" + bound_query(candidate["scope"]) + ") AS lineage"
        if mode not in ("success", "query_timeout"):
            raise AssertionError("UNKNOWN_TEST_SCENARIO")
        statement = (
            "BEGIN READ ONLY; "
            "SET LOCAL statement_timeout = '250ms'; " +
            query + "; ROLLBACK;"
        )
        read_result = None
        cleanup_count = 0
        try:
            read_result = native(container, role, password, statement)
            if mode == "success":
                if read_result.returncode != 0 or "1" not in read_result.stdout.splitlines():
                    raise AssertionError("CANONICAL_SINGLE_QUERY_DID_NOT_PASS")
            elif read_result.returncode == 0 or "statement timeout" not in read_result.stderr.lower():
                raise AssertionError("EXPECTED_DATABASE_QUERY_TIMEOUT_NOT_SEEN")
        finally:
            relock(container, role)
            cleanup_count += 1
        if cleanup_count != 1:
            raise AssertionError("CLEANUP_WAS_NOT_EXACTLY_ONCE")
        assert_locked(container, role, password)
        if mode == "success":
            print("PASS_SUCCESS_SINGLE_BOUND_READ_IMMEDIATE_RELOCK")
        else:
            print("PASS_TIMED_OUT_BOUND_READ_STILL_RELOCKS_AND_REJECTS_LOGIN")
    finally:
        run(["docker", "rm", "-f", container], check=False)


def main():
    scenario("success")
    scenario("query_timeout")
    print("PASS_BROKER_FINALLY_CLEANUP_IN_TWO_DISPOSABLE_DATABASES")
    print("NO_LIVE_ISSUANCE_NO_SIGNER_NO_DISPATCH")


if __name__ == "__main__":
    main()
