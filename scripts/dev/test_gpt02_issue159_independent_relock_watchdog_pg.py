#!/usr/bin/env python3
"""Synthetic independent relock watchdog for GPT02 Issue159.

Only network-isolated, disposable PostgreSQL 16. Reuses the already verified
signed-scope fixture and five-table fixed-expiry RLS fixture. A second,
independent PostgreSQL administrator connection locks the role on TTL expiry,
even while a prior synthetic reader query is running. No live DB, credential
provider, role grant, systemd, signer, dispatch, DELL or PROD access.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re
import secrets
import subprocess
import time
import uuid

from test_gpt02_issue159_signed_scope_pg import make_candidate, quote, bound_query
from test_gpt02_issue159_signed_scope_expiry_pg import scoped_fixture

TABLES = ("approvals", "operator_links", "receipts",
          "core_identity_receipts", "post_consumption_fences")


def call(cmd, *, stdin=None, check=True, timeout=40):
    res = subprocess.run(cmd, input=stdin, text=True, capture_output=True,
                         timeout=timeout)
    if check and res.returncode:
        raise RuntimeError("SYNTHETIC_COMMAND_FAILED:" + res.stderr[-1500:])
    return res


def psql(name, sql):
    return call(["docker", "exec", "-i", name, "psql", "-X",
                 "-v", "ON_ERROR_STOP=1", "-U", "postgres",
                 "-d", "postgres", "-At"], stdin=sql)


def login(name, role, password, query):
    return ["docker", "exec", "-e", "PGPASSWORD=" + password, name,
            "psql", "-X", "-w", "-h", "127.0.0.1",
            "-U", role, "-d", "postgres", "-Atc", query]


def main(*, simulate_crash=False):
    candidate = make_candidate()
    if (candidate["credentialIssuancePermitted"] is not False or
            candidate["databaseRoleProvisioned"] is not False or
            candidate["releaseDecision"] != "NO_GO"):
        raise AssertionError("INERT_SIGNED_SCOPE_REQUIRED")
    role = candidate["candidateRole"]
    if not re.fullmatch(r"dev_gpt02_task_170_[a-f0-9]{12}", role):
        raise AssertionError("UNEXPECTED_TEST_ROLE")
    db_name = "issue159-watchdog-" + uuid.uuid4().hex[:10]
    disposable_password = secrets.token_urlsafe(32)
    held = watchdog = None
    try:
        call(["docker", "run", "--rm", "-d", "--network", "none",
              "--name", db_name, "-e", "POSTGRES_PASSWORD=fixture_only",
              "postgres:16-alpine"])
        for _ in range(120):
            ready = call([
                "docker", "exec", "-e", "PGPASSWORD=fixture_only",
                db_name, "psql", "-X", "-w", "-h", "127.0.0.1",
                "-U", "postgres", "-d", "postgres", "-Atc", "SELECT 1",
            ], check=False)
            if ready.returncode == 0:
                break
            time.sleep(.25)
        else:
            raise RuntimeError("PG_FINAL_TCP_NOT_READY")

        signed_max = datetime.fromtimestamp(
            candidate["expiresAt"] / 1000, timezone.utc,
        )
        expiry = min(
            datetime.now(timezone.utc) + timedelta(seconds=4), signed_max,
        )
        if expiry <= datetime.now(timezone.utc) + timedelta(seconds=2):
            raise RuntimeError("FIXTURE_LEASE_EXPIRED")
        seeded = psql(db_name, scoped_fixture(candidate, expiry))
        if "PASS_FIVE_TABLE_DIRECT_ENUMERATION_SCOPED" not in seeded.stderr:
            raise AssertionError("FIVE_TABLE_RLS_NOT_READY")
        print("PASS_SIGNED_SCOPE_FIVE_TABLE_FIXED_EXPIRY_POLICY")

        # The watchdog ledger and privileged cleanup are independent of
        # the reader LOGIN and cannot be queried by it. All the admin SQL
        # below is confined to this disposable, networkless container.
        psql(db_name, (
            "CREATE TABLE gpt02_private.reader_issuance_watchdog("
            "role_name text PRIMARY KEY, scope_sha text UNIQUE NOT NULL, "
            "expires_at timestamptz NOT NULL, cleaned_at timestamptz);"
            "REVOKE ALL ON gpt02_private.reader_issuance_watchdog FROM PUBLIC;"
            "INSERT INTO gpt02_private.reader_issuance_watchdog "
            "(role_name,scope_sha,expires_at) VALUES (" +
            quote(role) + "," + quote(candidate["scopeSha256"]) +
            "," + quote(expiry.isoformat()) + "::timestamptz);"
            "ALTER ROLE " + role +
            " LOGIN CONNECTION LIMIT 1 PASSWORD " +
            quote(disposable_password) + ";"
        ))
        normal = call(login(
            db_name, role, disposable_password,
            "SELECT count(*) FROM (" +
            bound_query(candidate["scope"]) + ") AS exact_lineage",
        ))
        if normal.stdout.strip() != "1":
            raise AssertionError("NATIVE_SIGNED_SCOPED_READ_NOT_PROVEN")
        print("PASS_BEFORE_EXPIRY_NATIVE_ONE_TASK_QUERY")

        # Start a reader query that outlives the TTL. It models the
        # broker having crashed and not performing its own cleanup.
        held = subprocess.Popen(
            login(
                db_name, role, disposable_password,
                "SELECT pg_sleep(18) FROM (" +
                bound_query(candidate["scope"]) + ") AS locked_lineage",
            ),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        for _ in range(80):
            out = psql(db_name,
                "SELECT count(*) FROM pg_stat_activity WHERE usename=" +
                quote(role) + " AND state='active'")
            if out.stdout.strip() == "1":
                break
            if held.poll() is not None:
                raise AssertionError("SYNTHETIC_HELD_SESSION_EARLY_EXIT")
            time.sleep(.1)
        else:
            raise AssertionError("HELD_READER_SESSION_NOT_ACTIVE")
        print("PASS_SIMULATED_BROKER_CRASH_WITH_ACTIVE_READER")
        locked = psql(
            db_name,
            "SELECT count(DISTINCT c.relname) FROM pg_locks l "
            "JOIN pg_class c ON c.oid=l.relation "
            "JOIN pg_namespace n ON n.oid=c.relnamespace "
            "JOIN pg_stat_activity a ON a.pid=l.pid "
            "WHERE a.usename=" + quote(role) +
            " AND l.mode='AccessShareLock' AND l.granted "
            "AND n.nspname='gpt02_private' "
            "AND c.relname IN (" +
            ",".join(quote(table) for table in TABLES) + ")"
        )
        if locked.stdout.strip() != str(len(TABLES)):
            raise AssertionError("REAL_FIVE_TABLE_READER_LOCKS_NOT_PROVEN")
        print("PASS_ACTIVE_READER_HOLDS_ALL_FIVE_TABLE_SHARE_LOCKS")


        # Independent process + DB connection: does not call the broker
        # and is still able to run if the broker is gone.
        # Whitelist the EXACT predetermined role, not caller-controlled
        # SQL identifiers or a regex that might match other tasks.
        safe_role = role.replace("'", "''")
        # Durable phase A commits NOLOGIN/PASSWORD NULL BEFORE any active
        # reader is killed. A post-terminate login cannot race a still-
        # uncommitted ALTER ROLE. A crash after phase A remains recoverable
        # because cleaned_at is committed ONLY in phase B.
        phase_a = (
            "SET application_name='issue159-relock-phase-a';\n"
            "SELECT pg_sleep(5);\n"
            "BEGIN;\n"
            "DO $relock$\n"
            "DECLARE rec record;\n"
            "BEGIN\n"
            " FOR rec IN SELECT role_name FROM "
            "gpt02_private.reader_issuance_watchdog "
            "WHERE expires_at <= clock_timestamp() AND cleaned_at IS NULL "
            "FOR UPDATE LOOP\n"
            " IF rec.role_name <> " + quote(role) +
            " THEN RAISE EXCEPTION 'UNEXPECTED_WATCHDOG_ROLE'; END IF;\n"
            " EXECUTE format('ALTER ROLE %I NOLOGIN CONNECTION LIMIT 0 "
            "PASSWORD NULL', rec.role_name);\n"
            " END LOOP;\n"
            "END $relock$;\n"
            "COMMIT;\n"
        )
        phase_b = (
            "BEGIN;\n"
            "DO $cleanup$\n"
            "DECLARE rec record; victim record;\n"
            "BEGIN\n"
            " FOR rec IN SELECT role_name FROM "
            "gpt02_private.reader_issuance_watchdog "
            "WHERE expires_at <= clock_timestamp() AND cleaned_at IS NULL "
            "FOR UPDATE LOOP\n"
            " IF rec.role_name <> " + quote(role) +
            " THEN RAISE EXCEPTION 'UNEXPECTED_WATCHDOG_ROLE'; END IF;\n"
            " IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=rec.role_name "
            "AND (rolcanlogin OR rolconnlimit<>0)) THEN "
            "RAISE EXCEPTION 'WATCHDOG_RELOCK_NOT_COMMITTED'; END IF;\n"
            " FOR victim IN SELECT pid FROM pg_stat_activity "
            "WHERE usename=rec.role_name AND pid<>pg_backend_pid() LOOP\n"
            " IF pg_terminate_backend(victim.pid,3000) IS NOT TRUE "
            "THEN RAISE EXCEPTION 'WATCHDOG_BACKEND_TERMINATION_UNCONFIRMED'; "
            "END IF;\n"
            " END LOOP;\n"
            " EXECUTE format('REVOKE SELECT ON " +
            ", ".join("gpt02_private." + t for t in TABLES) +
            " FROM %I', rec.role_name);\n"
            " EXECUTE format('REVOKE USAGE ON SCHEMA gpt02_private "
            "FROM %I', rec.role_name);\n"
            " UPDATE gpt02_private.reader_issuance_watchdog "
            "SET cleaned_at=clock_timestamp() WHERE role_name=rec.role_name;\n"
            " END LOOP;\n"
            "END $cleanup$;\n"
            "COMMIT;\n"
        )
        # The first admin process is intentionally stopped after durable
        # phase A in the crash branch. A SECOND process must finish phase B
        # from the same uncleaned issuance ledger without reopening login.
        watchdog_query = (
            phase_a +
            ("SELECT pg_sleep(20);\n" if simulate_crash
             else "SELECT pg_sleep(3);\n" + phase_b)
        )
        watchdog = subprocess.Popen(
            ["docker", "exec", "-i", db_name, "psql", "-X",
             "-v", "ON_ERROR_STOP=1", "-U", "postgres",
             "-d", "postgres", "-Atc", watchdog_query],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True,
        )
        # Observe phase A DURABLY committed while the original five-table
        # reader still holds its active session; cleanup has not yet begun.
        locked_before_terminate = False
        for _ in range(115):
            meta = psql(db_name,
                "SELECT NOT r.rolcanlogin AND r.rolconnlimit=0 "
                "AND r.rolpassword IS NULL FROM pg_authid r WHERE r.rolname=" +
                quote(role))
            if meta.stdout.strip() == "t":
                active = psql(db_name,
                    "SELECT count(*) FROM pg_stat_activity WHERE usename=" +
                    quote(role)).stdout.strip()
                pending = psql(db_name,
                    "SELECT count(*) FROM gpt02_private.reader_issuance_watchdog "
                    "WHERE role_name=" + quote(role) +
                    " AND cleaned_at IS NULL").stdout.strip()
                if active != "1" or pending != "1":
                    raise AssertionError("DURABLE_RELOCK_PHASE_A_ORDER_INVALID")
                locked_before_terminate = True
                break
            if watchdog.poll() is not None:
                break
            time.sleep(.05)
        if not locked_before_terminate:
            raise AssertionError("DURABLE_NOLOGIN_NOT_OBSERVED_BEFORE_TERMINATE")
        assert call(login(db_name, role, disposable_password,
                          "SELECT 1"), check=False).returncode != 0, (
            "LATE_LOGIN_STILL_ACCEPTED_AFTER_COMMITTED_NOLOGIN")
        print("PASS_DURABLE_NOLOGIN_BEFORE_READER_TERMINATION_NO_LATE_LOGIN")
        print("PASS_PENDING_CLEANUP_RETRYABLE_AFTER_PHASE_A_COMMIT")
        if simulate_crash:
            # Terminate the *admin watchdog* connection, NOT the reader.
            # It has committed NOLOGIN but has not started phase B.
            before = psql(db_name,
                "SELECT count(*) FROM pg_stat_activity WHERE "
                "application_name='issue159-relock-phase-a' AND state='active'")
            assert before.stdout.strip() == "1", (
                "NO_ACTIVE_PHASE_A_WATCHDOG_FOR_CRASH_INJECTION")
            stopped = psql(db_name,
                "SELECT pg_terminate_backend(pid,3000) "
                "FROM pg_stat_activity WHERE "
                "application_name='issue159-relock-phase-a' "
                "AND pid<>pg_backend_pid()")
            assert stopped.stdout.strip() == "t", (
                "PHASE_A_WATCHDOG_CRASH_NOT_CONFIRMED")
            out, err = watchdog.communicate(timeout=8)
            assert watchdog.returncode != 0, (
                "WATCHDOG_SURVIVED_INJECTED_CRASH")
            watchdog = None
            original_still_active = psql(db_name,
                "SELECT count(*) FROM pg_stat_activity WHERE usename=" +
                quote(role))
            assert original_still_active.stdout.strip() == "1", (
                "CRASH_TEST_READER_ENDED_BEFORE_RESTART")
            assert call(login(db_name, role, disposable_password,
                               "SELECT 1"), check=False).returncode != 0, (
                "CRASH_AFTER_PHASE_A_REOPENED_OLD_PASSWORD")
            uncleaned = psql(db_name,
                "SELECT count(*) FROM gpt02_private.reader_issuance_watchdog "
                "WHERE role_name=" + quote(role) +
                " AND cleaned_at IS NULL")
            assert uncleaned.stdout.strip() == "1", (
                "CRASH_INCORRECTLY_MARKED_CLEAN")
            print("PASS_FORCED_WATCHDOG_CRASH_LEAVES_DURABLE_LOCK_AND_PENDING_LEDGER")
            # No reuse of the first process or session: a new independent
            # administrator connection starts from phase B only.
            watchdog = subprocess.Popen(
                ["docker", "exec", "-i", db_name, "psql", "-X",
                 "-v", "ON_ERROR_STOP=1", "-U", "postgres",
                 "-d", "postgres", "-Atc", phase_b],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True,
            )
        out, err = watchdog.communicate(timeout=18)
        if watchdog.returncode:
            raise RuntimeError("DISPOSABLE_WATCHDOG_FAILED:" + err[-1300:])
        if simulate_crash:
            print("PASS_FRESH_WATCHDOG_PROCESS_RECOVERS_AFTER_PHASE_A_CRASH")
        held.communicate(timeout=8)
        if held.returncode == 0:
            raise AssertionError("ACTIVE_READER_SURVIVED_INDEPENDENT_WATCHDOG")
        print("PASS_INDEPENDENT_WATCHDOG_TERMINATED_ACTIVE_READER")

        state = psql(db_name,
            "SELECT NOT r.rolcanlogin AND r.rolconnlimit=0 "
            "AND r.rolpassword IS NULL "
            "AND NOT r.rolinherit AND NOT r.rolbypassrls "
            "AND (SELECT count(*) FROM pg_stat_activity a "
            "WHERE a.usename=r.rolname)=0 "
            "FROM pg_authid r WHERE r.rolname=" + quote(role))
        if state.stdout.strip() != "t":
            raise AssertionError("RELOCK_OR_ZERO_SESSIONS_NOT_PROVEN")
        psql_result = psql(db_name,
            "SELECT count(*) FROM gpt02_private.reader_issuance_watchdog "
            "WHERE role_name=" + quote(role) + " AND cleaned_at IS NOT NULL")
        if psql_result.stdout.strip() != "1":
            raise AssertionError("INDEPENDENT_CLEANUP_NOT_DURABLE")
        if call(login(db_name, role, disposable_password,
                      "SELECT 1"), check=False).returncode == 0:
            raise AssertionError("NEW_LOGIN_AFTER_WATCHDOG_NOT_BLOCKED")
        print("PASS_RELOCK_PASSWORD_NULL_ZERO_SESSIONS_CLEANUP_DURABLE")
        # A second restart after completed cleanup is a no-op, not another
        # issuance or a fresh clean timestamp. The scoped login remains off.
        first_cleaned_at = psql(db_name,
            "SELECT cleaned_at::text FROM "
            "gpt02_private.reader_issuance_watchdog WHERE role_name=" +
            quote(role)).stdout.strip()
        repeat = psql(db_name, phase_b)
        last_cleaned_at = psql(db_name,
            "SELECT cleaned_at::text FROM "
            "gpt02_private.reader_issuance_watchdog WHERE role_name=" +
            quote(role)).stdout.strip()
        assert first_cleaned_at and last_cleaned_at == first_cleaned_at, (
            "REPEATED_CLEANUP_REWROTE_DURABLE_LEDGER")
        assert call(login(db_name, role, disposable_password,
                           "SELECT 1"), check=False).returncode != 0, (
            "REPEAT_CLEANUP_REOPENED_OLD_READER")
        print("PASS_RESTART_AFTER_COMPLETED_CLEANUP_IS_IDEMPOTENT")
        print("DISPOSABLE_ONLY_NO_LIVE_ISSUER_CREDENTIAL_OR_DISPATCH")
    finally:
        for proc in (watchdog, held):
            if proc is not None and proc.poll() is None:
                proc.kill()
                proc.communicate(timeout=5)
        call(["docker", "rm", "-f", db_name], check=False)


if __name__ == "__main__":
    main()
    main(simulate_crash=True)
