#!/usr/bin/env python3
"""Issue159 SYNTHETIC database-enforced signed-reader scope expiry.

Demonstrates that a temporary DB LOGIN which remains enabled after a broker
crash cannot read the five protected lineage tables after its fixed RLS
expiry. The test uses a new networkless disposable postgres:16-alpine only.
No live database, operational credentials, scheduler, service or dispatch.

Expiry stops NEW statements; a pre-existing running statement still needs
statement_timeout, backend termination and an independent cleanup watchdog.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re
import secrets
import subprocess
import time
import uuid

from test_gpt02_issue159_signed_scope_pg import (
    make_candidate, FIVE_TABLE_FIXTURE, bound_query, quote,
)


TABLES = ("approvals", "operator_links", "receipts",
          "core_identity_receipts", "post_consumption_fences")


def call(*args, check=True, stdin=None):
    r = subprocess.run(args, text=True, input=stdin, capture_output=True,
                       timeout=45)
    if check and r.returncode:
        raise RuntimeError("SYNTHETIC_COMMAND_FAILED:" + r.stderr[-1250:])
    return r


def admin(name, sql):
    return call("docker", "exec", "-i", name, "psql", "-X",
                "-v", "ON_ERROR_STOP=1", "-U", "postgres",
                "-d", "postgres", "-At", stdin=sql)


def reader(name, role, password, sql, *, check=True):
    return call("docker", "exec", "-e", "PGPASSWORD=" + password, name,
                "psql", "-X", "-w", "-h", "127.0.0.1",
                "-U", role, "-d", "postgres", "-Atc", sql, check=check)


def scoped_fixture(candidate, expiry: datetime):
    """Test-only transformation of EXISTING five-table fixed-role RLS fixture.

    All changes are statically limited to its five CREATE POLICY statements;
    no runtime parameters or GUC can change the fixed expiry after issuance.
    """
    scope = candidate["scope"]
    role = candidate["candidateRole"]
    fixture = FIVE_TABLE_FIXTURE.replace("task170_reader", role)
    for original, signed in (
        ("'n170'", quote(scope["approval_nonce"])),
        ("'d170'", quote(scope["approval_digest"])),
        ("'link170'", quote(scope["link_digest"])),
    ):
        if original not in fixture:
            raise AssertionError("SIGNED_FIXTURE_SLOT_MISSING")
        fixture = fixture.replace(original, signed)
    literal = quote(expiry.isoformat())
    for table in TABLES:
        patt = ("CREATE POLICY task_scope ON gpt02_private."
                + table + " FOR SELECT TO " + role)
        start = fixture.find(patt)
        if start < 0 or fixture.find(patt, start + 1) >= 0:
            raise AssertionError("EXACT_POLICY_MISSING_OR_DUPLICATE:" + table)
        end = fixture.find(";", start)
        segment = fixture[start:end + 1]
        index = segment.rfind(");")
        if index < 0:
            raise AssertionError("POLICY_END_INVALID:" + table)
        replacement = (segment[:index] +
                       " AND clock_timestamp() < " + literal +
                       "::timestamptz" + segment[index:])
        fixture = fixture[:start] + replacement + fixture[end + 1:]
    if fixture.count("AND clock_timestamp() < ") != len(TABLES):
        raise AssertionError("EXACT_EXPIRY_NOT_APPLIED_TO_ALL_FIVE")
    return fixture


def main():
    candidate = make_candidate()
    if (candidate["credentialIssuancePermitted"] is not False or
            candidate["releaseDecision"] != "NO_GO"):
        raise AssertionError("CANDIDATE_MUST_REMAIN_INERT")
    role = candidate["candidateRole"]
    if not re.fullmatch(r"dev_gpt02_task_170_[a-f0-9]{12}", role):
        raise AssertionError("SIGNED_SCOPE_ROLE_INVALID")
    scope = candidate["scope"]
    password = secrets.token_urlsafe(32)
    name = "issue159-expiring-role-" + uuid.uuid4().hex[:10]
    try:
        call("docker", "run", "--rm", "-d", "--network", "none",
             "--name", name, "-e", "POSTGRES_PASSWORD=fixture_only",
             "postgres:16-alpine")
        for _ in range(120):
            ok = call("docker", "exec", "-e",
                      "PGPASSWORD=fixture_only", name, "psql", "-X", "-w",
                      "-h", "127.0.0.1", "-U", "postgres",
                      "-d", "postgres", "-Atc", "SELECT 1", check=False)
            if ok.returncode == 0:
                break
            time.sleep(.25)
        else:
            raise RuntimeError("FINAL_POSTGRES_SERVER_NOT_READY")
        # Fixed expiry applies to each table, independent of session variables
        # or source reader/broker health. Keep the synthetic window short.
        expiry = datetime.now(timezone.utc) + timedelta(seconds=5)
        fixture = scoped_fixture(candidate, expiry)
        result = admin(name, fixture)
        if "PASS_FIVE_TABLE_DIRECT_ENUMERATION_SCOPED" not in result.stderr:
            raise AssertionError("INITIAL_FIVE_TABLE_SCOPE_NOT_VERIFIED")
        admin(name, "ALTER ROLE " + role +
              " LOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 1 PASSWORD "
              + quote(password) + ";")
        read = reader(name, role, password,
            "SELECT count(*) FROM gpt02_private.approvals; "
            "SELECT count(*) FROM gpt02_private.operator_links; "
            "SELECT count(*) FROM gpt02_private.receipts; "
            "SELECT count(*) FROM gpt02_private.core_identity_receipts; "
            "SELECT count(*) FROM gpt02_private.post_consumption_fences")
        values = [x.strip() for x in read.stdout.splitlines() if x.strip()]
        if values != ["1"] * len(TABLES):
            raise AssertionError("INITIAL_SCOPE_NOT_READABLE:" + repr(values))
        print("PASS_NATIVE_LOGIN_FIVE_TABLES_BEFORE_FIXED_EXPIRY")
        canonical = reader(name, role, password, "SELECT count(*) FROM (" +
                           bound_query(scope) + ") AS scoped")
        if canonical.stdout.strip() != "1":
            raise AssertionError("CANONICAL_SQL_NOT_READABLE_BEFORE_EXPIRY")
        print("PASS_CANONICAL_SIGNED_SCOPE_BEFORE_EXPIRY")

        # Model broker crash by deliberately leaving synthetic LOGIN enabled.
        # The DB's own fixed policy expiry must deny ALL new SELECT statements.
        time.sleep(max(0, expiry.timestamp() - time.time() + .3))
        still_enabled = admin(name,
            "SELECT rolcanlogin FROM pg_roles WHERE rolname=" + quote(role))
        if still_enabled.stdout.strip() != "t":
            raise AssertionError("CRASH_SCENARIO_LOGIN_WAS_NOT_ENABLED")
        expired = reader(name, role, password,
            "SELECT count(*) FROM gpt02_private.approvals; "
            "SELECT count(*) FROM gpt02_private.operator_links; "
            "SELECT count(*) FROM gpt02_private.receipts; "
            "SELECT count(*) FROM gpt02_private.core_identity_receipts; "
            "SELECT count(*) FROM gpt02_private.post_consumption_fences")
        values = [x.strip() for x in expired.stdout.splitlines() if x.strip()]
        if values != ["0"] * len(TABLES):
            raise AssertionError("EXPIRED_DB_SCOPE_EXPOSED_DATA:" + repr(values))
        print("PASS_BROKER_CRASH_LOGIN_STILL_ENABLED_BUT_FIVE_TABLES_INVISIBLE")
        canonical = reader(name, role, password, "SELECT count(*) FROM (" +
                           bound_query(scope) + ") AS scoped")
        if canonical.stdout.strip() != "0":
            raise AssertionError("CANONICAL_QUERY_READ_AFTER_FIXED_EXPIRY")
        print("PASS_CANONICAL_QUERY_DENIED_AFTER_FIXED_EXPIRY")

        # Recover the synthetic role: revoke old grants, lock all credentials,
        # terminate backends and prove new logins fail. No live instance used.
        admin(name,
              "REVOKE SELECT ON " + ", ".join(
                  "gpt02_private." + t for t in TABLES) + " FROM " + role +
              "; REVOKE USAGE ON SCHEMA gpt02_private FROM " + role +
              "; ALTER ROLE " + role +
              " NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL; "
              "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
              "WHERE usename=" + quote(role) +
              " AND pid<>pg_backend_pid();")
        status = admin(name,
            "SELECT NOT rolcanlogin AND rolconnlimit=0 AND "
            "rolpassword IS NULL AND NOT rolinherit AND NOT rolbypassrls "
            "FROM pg_authid WHERE rolname=" + quote(role))
        if status.stdout.strip() != "t":
            raise AssertionError("SYNTHETIC_ROLE_RELOCK_FAILED")
        if reader(name, role, password, "SELECT 1", check=False).returncode == 0:
            raise AssertionError("NEW_LOGIN_AFTER_RELOCK_ACCEPTED")
        print("PASS_RECOVERY_RELOCK_PASSWORD_NULL_AND_NEW_LOGIN_DENIED")
        print("DISPOSABLE_SCOPE_TTL_ONLY_NOT_LIVE_ISSUANCE_AUTHORIZATION")
    finally:
        call("docker", "rm", "-f", name, check=False)


if __name__ == "__main__":
    main()
