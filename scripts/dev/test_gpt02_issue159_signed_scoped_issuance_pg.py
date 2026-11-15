#!/usr/bin/env python3
"""Disposable Issue159 one-use scoped-reader issuance lifecycle proof.

Reuses signed fixture -> inert reader candidate -> canonical five-table RLS.
Runs ONLY in a new Docker PostgreSQL 16 container with --network none.
An isolated synthetic PostgreSQL superuser models the (NOT IMPLEMENTED)
trusted DB administrator, using a throwaway in-memory random password.

Demonstrates an atomic issuance ledger, duplicate/replay denial, native
one-connection read-only login, cross-task denial, explicit relock and
active-backend termination. It deliberately does NOT implement a production
credential broker, grant signing authority, use live Supabase, inspect
operational credentials, change systemd, or dispatch a worker.
"""
from __future__ import annotations

import re
import secrets
import subprocess
import time
import uuid
from test_gpt02_issue159_signed_scope_pg import (
    make_candidate, FIVE_TABLE_FIXTURE, quote, bound_query,
)

TABLES = (
    "approvals", "operator_links", "receipts",
    "core_identity_receipts", "post_consumption_fences",
)


def run(args, *, input=None, check=True):
    result = subprocess.run(
        args, input=input, text=True, capture_output=True, timeout=40,
    )
    if check and result.returncode:
        raise RuntimeError("DISPOSABLE_SQL_FAILED: " + result.stderr[-1300:])
    return result


def admin(name, text, *, check=True):
    return run([
        "docker", "exec", "-i", name, "psql", "-X", "-v",
        "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At",
    ], input=text, check=check)


def login_cmd(name, role, password, sql):
    return [
        "docker", "exec", "-e", "PGPASSWORD=" + password, name,
        "psql", "-X", "-w", "-h", "127.0.0.1", "-U", role,
        "-d", "postgres", "-Atc", sql,
    ]


def assert_count(name, text, expected):
    result = admin(name, text)
    values = [v.strip() for v in result.stdout.splitlines() if v.strip()]
    if values[-1:] != [str(expected)]:
        raise AssertionError("ADMIN_COUNT_MISMATCH: " + repr(values))


def main():
    candidate = make_candidate()
    scope = candidate["scope"]
    role = candidate["candidateRole"]
    if (
        not re.fullmatch(r"dev_gpt02_task_170_[0-9a-f]{12}", role)
        or not re.fullmatch(r"[0-9a-f]{64}", candidate["scopeSha256"])
        or not re.fullmatch(r"[0-9a-f]{64}", candidate["verifiedPacketSha256"])
        or candidate["databaseRoleProvisioned"] is not False
        or candidate["credentialIssuancePermitted"] is not False
        or candidate["releaseDecision"] != "NO_GO"
    ):
        raise AssertionError("SOURCE_READER_CANDIDATE_INVALID")
    # This models privileged issuance strictly IN THE DISPOSABLE DB,
    # not an operational authorization to do so.
    password = secrets.token_urlsafe(32)
    name = "issue159-issue-once-" + uuid.uuid4().hex[:10]
    held_session = None
    try:
        run([
            "docker", "run", "--rm", "-d", "--network", "none",
            "--name", name, "-e", "POSTGRES_PASSWORD=fixture_only",
            "postgres:16-alpine",
        ])
        # Wait for FINAL TCP server; bootstrap Unix server comes and goes.
        for _ in range(120):
            check = run([
                "docker", "exec", "-e", "PGPASSWORD=fixture_only",
                name, "psql", "-X", "-w", "-h", "127.0.0.1",
                "-U", "postgres", "-d", "postgres", "-Atc", "SELECT 1",
            ], check=False)
            if check.returncode == 0:
                break
            time.sleep(.25)
        else:
            raise RuntimeError("DISPOSABLE_POSTGRES_FINAL_SERVER_NOT_READY")

        fixture = FIVE_TABLE_FIXTURE.replace("task170_reader", role)
        for old, new in (
            ("'n170'", quote(scope["approval_nonce"])),
            ("'d170'", quote(scope["approval_digest"])),
            ("'link170'", quote(scope["link_digest"])),
        ):
            if old not in fixture:
                raise AssertionError("SYNTHETIC_FIXTURE_BINDING_MISSING")
            fixture = fixture.replace(old, new)
        admin(name, fixture)
        print("PASS_SIGNED_SCOPE_FIVE_TABLE_RLS_PREPROVISIONED_NOLOGIN")

        # An independent, privileged synthetic actor can record only
        # one issuance for a signed packet and exact command. The real
        # operational trust/credential custody is deliberately NOT here.
        admin(name, """
CREATE TABLE gpt02_private.reader_issuance_audit (
 scope_sha text NOT NULL UNIQUE,
 packet_sha text NOT NULL UNIQUE,
 command_id uuid NOT NULL UNIQUE,
 attempt_id uuid NOT NULL UNIQUE,
 role_name text PRIMARY KEY,
 task_id integer NOT NULL,
 expires_at timestamptz NOT NULL,
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (expires_at > issued_at)
);
ALTER TABLE gpt02_private.reader_issuance_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.reader_issuance_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gpt02_private.reader_issuance_audit FROM PUBLIC;
""")
        issuance = (
            "BEGIN;\n"
            "SELECT pg_advisory_xact_lock(hashtextextended("
            + quote(candidate["scopeSha256"]) + ",0));\n"
            "INSERT INTO gpt02_private.reader_issuance_audit "
            "(scope_sha,packet_sha,command_id,attempt_id,role_name,task_id,expires_at) "
            "VALUES (" + ",".join((
                quote(candidate["scopeSha256"]),
                quote(candidate["verifiedPacketSha256"]),
                quote(scope["command_id"]) + "::uuid",
                quote(scope["attempt_id"]) + "::uuid",
                quote(role), str(scope["task_id"]),
                "to_timestamp(" + str(candidate["expiresAt"]) + "/1000.0)",
            )) + ");\n"
            "SELECT pg_sleep(0.2);\n"
            "ALTER ROLE " + role +
            " LOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 1 PASSWORD "
            + quote(password) + ";\nCOMMIT;\n"
        )
        # Two concurrent requests for the *same signed packet*.
        first = subprocess.Popen(
            ["docker", "exec", "-i", name, "psql", "-X", "-v",
             "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True,
        )
        second = subprocess.Popen(
            ["docker", "exec", "-i", name, "psql", "-X", "-v",
             "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True,
        )
        # communicate uses no shell and never prints the secret.
        first.communicate(issuance, timeout=15)
        second.communicate(issuance, timeout=15)
        if sorted((first.returncode, second.returncode)) != [0, 3]:
            # psql with ON_ERROR_STOP uses exit code 3 on SQL errors.
            raise AssertionError(
                "DUPLICATE_ISSUANCE_WRONGLY_ACCEPTED: "
                + repr((first.returncode, second.returncode))
            )
        assert_count(
            name, "SELECT count(*) FROM gpt02_private.reader_issuance_audit", 1,
        )
        print("PASS_ATOMIC_ONCE_ONLY_ISSUANCE_LEDGER_CONCURRENT_DUPLICATE_DENIED")

        # Attempt to issue a second scope with same command: UNIQUE command
        # prevents it even when packet/scope digests are different.
        forged = admin(name,
            "INSERT INTO gpt02_private.reader_issuance_audit "
            "(scope_sha,packet_sha,command_id,attempt_id,role_name,task_id,expires_at) "
            "VALUES (" + ",".join((
                quote("f" * 64), quote("e" * 64),
                quote(scope["command_id"]) + "::uuid",
                quote("88888888-8888-4888-8888-888888888888") + "::uuid",
                quote("synthetic_other_role"), "172",
                "clock_timestamp()+interval '1 minute'",
            )) + ")", check=False)
        if forged.returncode == 0:
            raise AssertionError("SAME_COMMAND_SECOND_SCOPE_ISSUED")
        print("PASS_SAME_COMMAND_WRONG_SCOPE_ISSUANCE_DENIED")

        # A separate immutable CONSUMPTION fence is mandatory BEFORE a
        # broker attempts even one canonical SELECT. Issuance uniqueness
        # alone is insufficient because an issued LOGIN can be replayed.
        # This is a disposable DB model, NOT an operational issuance API.
        admin(name, """
CREATE TABLE gpt02_private.reader_read_consumptions (
 scope_sha text PRIMARY KEY
   REFERENCES gpt02_private.reader_issuance_audit(scope_sha),
 packet_sha text NOT NULL UNIQUE,
 command_id uuid NOT NULL UNIQUE,
 attempt_id uuid NOT NULL UNIQUE,
 consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 consumption_state text NOT NULL DEFAULT 'CLAIMED_FOR_SINGLE_READ'
   CHECK (consumption_state = 'CLAIMED_FOR_SINGLE_READ')
);
ALTER TABLE gpt02_private.reader_read_consumptions
 ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.reader_read_consumptions
 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gpt02_private.reader_read_consumptions FROM PUBLIC;
""")
        consume_once = (
            "BEGIN;\n"
            "SELECT pg_advisory_xact_lock(hashtextextended("
            + quote(candidate["scopeSha256"]) + ",0));\n"
            "DO $one_read$ DECLARE inserted_count int; BEGIN\n"
            "INSERT INTO gpt02_private.reader_read_consumptions"
            " (scope_sha,packet_sha,command_id,attempt_id)"
            " SELECT i.scope_sha,i.packet_sha,i.command_id,i.attempt_id"
            " FROM gpt02_private.reader_issuance_audit i"
            " WHERE i.scope_sha=" + quote(candidate["scopeSha256"])
            + " AND i.packet_sha=" + quote(candidate["verifiedPacketSha256"])
            + " AND i.command_id=" + quote(scope["command_id"]) + "::uuid"
            + " AND i.attempt_id=" + quote(scope["attempt_id"]) + "::uuid"
            + " AND i.expires_at > clock_timestamp() + interval '1 second';\n"
            "GET DIAGNOSTICS inserted_count = ROW_COUNT;\n"
            "IF inserted_count<>1 THEN"
            " RAISE EXCEPTION 'ONE_READ_ISSUANCE_NOT_FRESH_OR_BOUND';"
            " END IF;\nEND $one_read$;\n"
            "SELECT pg_sleep(0.15);\nCOMMIT;\n"
        )
        read_claims = []
        for _ in range(2):
            read_claims.append(subprocess.Popen(
                ["docker", "exec", "-i", name, "psql", "-X", "-v",
                 "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At"],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True,
            ))
        for proc in read_claims:
            proc.communicate(consume_once, timeout=15)
        if sorted(p.returncode for p in read_claims) != [0, 3]:
            raise AssertionError("ATOMIC_CONSUMPTION_DID_NOT_REJECT_DUPLICATE")
        assert_count(
            name,
            "SELECT count(*) FROM gpt02_private.reader_read_consumptions", 1,
        )
        print("PASS_ATOMIC_ONE_READ_CONSUMPTION_TWO_CONCURRENT_CLAIMS")

        # Same command with altered scope/attempt is NOT another read.
        wrong_claim = admin(
            name,
            "INSERT INTO gpt02_private.reader_read_consumptions"
            " (scope_sha,packet_sha,command_id,attempt_id) VALUES ("
            + quote("f"*64) + "," + quote("e"*64) + ","
            + quote(scope["command_id"]) + "::uuid,"
            + quote("88888888-8888-4888-8888-888888888888")
            + "::uuid)", check=False,
        )
        if wrong_claim.returncode == 0:
            raise AssertionError("WRONG_SCOPE_SECOND_READ_CLAIM_ACCEPTED")
        print("PASS_WRONG_SCOPE_OR_COMMAND_CANNOT_CLAIM_SECOND_READ")

        # Failure AFTER a committed claim (before a successful read) must
        # NOT restore the read budget. The eventual broker must relock even
        # on this uncertain outcome and a watchdog handles broker crashes.
        failed_read = run(login_cmd(
            name, role, password,
            "BEGIN READ ONLY; SELECT * FROM gpt02_private.nonexistent;"
        ), check=False)
        if failed_read.returncode == 0:
            raise AssertionError("SYNTHETIC_READ_FAILURE_NOT_OBSERVED")
        replay = admin(name, consume_once, check=False)
        if replay.returncode == 0:
            raise AssertionError("CONSUMED_CLAIM_REPLAY_AFTER_QUERY_FAILURE")
        assert_count(
            name,
            "SELECT count(*) FROM gpt02_private.reader_read_consumptions", 1,
        )
        print("PASS_FAILED_READ_CONSUMES_BUDGET_REPLAY_DENIED")
        # The scoped role cannot see either issuance or consumption audit.
        if run(login_cmd(
            name, role, password,
            "SELECT count(*) FROM gpt02_private.reader_read_consumptions",
        ), check=False).returncode == 0:
            raise AssertionError("ROLE_READ_CONSUMPTION_LEDGER")
        if run(login_cmd(
            name, role, password,
            "INSERT INTO gpt02_private.reader_read_consumptions"
            " (scope_sha,packet_sha,command_id,attempt_id) VALUES ("
            + quote("f"*64) + "," + quote("e"*64) + ","
            + quote(scope["command_id"]) + "::uuid,"
            + quote(scope["attempt_id"]) + "::uuid)",
        ), check=False).returncode == 0:
            raise AssertionError("ROLE_WRITE_CONSUMPTION_LEDGER")
        print("PASS_SCOPED_LOGIN_CANNOT_READ_OR_WRITE_CONSUMPTION_LEDGER")

        # Verify native DB identity and one-connection read-only SELECT,
        # not merely SET ROLE under an administrator session.
        read = run(login_cmd(name, role, password, (
            "BEGIN READ ONLY; "
            "SELECT count(*) FROM gpt02_private.approvals; "
            "SELECT count(*) FROM gpt02_private.receipts; "
            "SELECT count(*) FROM gpt02_private.approvals WHERE task_id=172; "
            "ROLLBACK;"
        )))
        observed = [s.strip() for s in read.stdout.splitlines()
                    if s.strip() in ("0", "1")]
        if observed != ["1", "1", "0"]:
            raise AssertionError("NATIVE_ROLE_CROSS_TASK_READ: " + repr(observed))
        canonical = run(login_cmd(name, role, password,
                          "SELECT count(*) FROM (" + bound_query(scope)
                          + ") AS canonical"))
        if canonical.stdout.strip() != "1":
            raise AssertionError("NATIVE_ROLE_CANONICAL_LINEAGE_MISSING")
        # Exact limitation: the database read-consumption ledger does NOT
        # prevent a holder of the unrevoked reader password from opening
        # another connection before relock. The credential MUST stay private
        # to the audited one-query supervisor and be revoked immediately.
        replay_via_direct_password = run(login_cmd(
            name, role, password, "SELECT count(*) FROM (" +
            bound_query(scope) + ") AS canonical",
        ))
        if replay_via_direct_password.stdout.strip() != "1":
            raise AssertionError("TEST_DID_NOT_REPRODUCE_STOLEN_PASSWORD_RISK")
        print("EXPECTED_RISK_DIRECT_PASSWORD_CAN_REQUERY_BEFORE_RELOCK_NO_GO")
        print("PASS_NATIVE_ONE_TASK_LOGIN_READONLY_CANONICAL_SQL")

        # The login must not be able to inspect issuance ledger or write
        # to any lineage table, even while LOGIN is temporarily enabled.
        if run(login_cmd(
                name, role, password,
                "SELECT count(*) FROM gpt02_private.reader_issuance_audit",
            ), check=False).returncode == 0:
            raise AssertionError("ROLE_READ_ISSUANCE_LEDGER")
        if run(login_cmd(
                name, role, password,
                "INSERT INTO gpt02_private.approvals(task_id) VALUES (172)",
            ), check=False).returncode == 0:
            raise AssertionError("ROLE_WRITTEN_LEDGER")
        print("PASS_READER_DENIED_ISSUANCE_LEDGER_AND_WRITES")

        # Maintain an ACTIVE reader query, then verify connection limit=1,
        # revoke/lock and terminate it. Never touch any real role/session.
        held_session = subprocess.Popen(
            login_cmd(name, role, password, "SELECT pg_sleep(20)"),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        for _ in range(90):
            running = admin(name, "SELECT count(*) FROM pg_stat_activity "
                            "WHERE usename=" + quote(role) + " AND state='active'")
            if running.stdout.strip().splitlines()[-1] == "1":
                break
            if held_session.poll() is not None:
                raise AssertionError("SYNTHETIC_SESSION_EXITED_EARLY")
            time.sleep(.1)
        else:
            raise AssertionError("SYNTHETIC_SESSION_NOT_ACTIVE")
        second_login = run(login_cmd(name, role, password, "SELECT 1"),
                           check=False)
        if second_login.returncode == 0:
            raise AssertionError("CONNECTION_LIMIT_ONE_BYPASSED")
        print("PASS_ONE_CONNECTION_LIMIT_WHILE_SESSION_ACTIVE")

        role_lock_sql = (
            "BEGIN;\n"
            "REVOKE SELECT ON " + ",".join(
                "gpt02_private." + table for table in TABLES
            ) + " FROM " + role + ";\n"
            "REVOKE USAGE ON SCHEMA gpt02_private FROM " + role + ";\n"
            "ALTER ROLE " + role + " NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL;\n"
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE usename=" + quote(role) +
            " AND pid <> pg_backend_pid();\n"
            "COMMIT;\n"
        )
        admin(name, role_lock_sql)
        held_session.communicate(timeout=8)
        if held_session.returncode == 0:
            raise AssertionError("ACTIVE_SESSION_SURVIVED_RELOCK")
        count = admin(name, "SELECT count(*) FROM pg_stat_activity "
                           "WHERE usename=" + quote(role))
        if count.stdout.strip().splitlines()[-1] != "0":
            raise AssertionError("ACTIVE_SESSION_REMAINED_AFTER_RELOCK")
        locked = admin(name,
            "SELECT NOT rolcanlogin AND rolconnlimit=0 "
            "AND rolpassword IS NULL AND NOT rolinherit AND NOT rolbypassrls "
            "FROM pg_authid WHERE rolname=" + quote(role))
        if locked.stdout.strip().splitlines()[-1] != "t":
            raise AssertionError("ROLE_NOT_FULLY_LOCKED")
        retry_login = run(login_cmd(name, role, password, "SELECT 1"), check=False)
        if retry_login.returncode == 0:
            raise AssertionError("RELOCKED_LOGIN_ACCEPTED")
        assert_count(name,
            "SELECT count(*) FROM gpt02_private.reader_issuance_audit", 1)
        print("PASS_ACTIVE_SESSION_TERMINATED_AND_PASSWORD_NULL_NOLOGIN")
        print("PASS_DISPOSABLE_COMPLETE_NO_DEV_DATABASE_OR_CREDENTIALS")
    finally:
        if held_session is not None and held_session.poll() is None:
            held_session.kill()
            held_session.communicate(timeout=5)
        run(["docker", "rm", "-f", name], check=False)


if __name__ == "__main__":
    main()
