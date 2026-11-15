#!/usr/bin/env python3
"""Disposable PG16 active-session revocation test for Issue159.

This test NEVER connects to CST-DEV/PROD or reads systemd credentials.
Inside a network-isolated throwaway container, a synthetic reader starts
a long read-only transaction, then an administrator revokes privileges,
sets NOLOGIN, CONNECTION LIMIT 0, PASSWORD NULL, and terminates the session.
The test fails if the session survives or another login succeeds.
"""
from __future__ import annotations

import os
import subprocess
import time
import uuid

ROLE = "synthetic_issue159_reader"
PASS = "throwaway_test_value_not_a_real_credential"


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    r = subprocess.run(args, capture_output=True, text=True, timeout=30)
    if check and r.returncode:
        raise RuntimeError("COMMAND_FAILED: " + r.stderr[-700:])
    return r


def admin(name: str, query: str) -> str:
    r = run("docker", "exec", name, "psql", "-X", "-v", "ON_ERROR_STOP=1",
            "-U", "postgres", "-d", "postgres", "-At", "-c", query)
    return r.stdout.strip()


def reader_command(name: str, query: str) -> list[str]:
    return ["docker", "exec", "-e", "PGPASSWORD=" + PASS, name,
            "psql", "-X", "-w", "-h", "127.0.0.1", "-U", ROLE,
            "-d", "postgres", "-At", "-c", query]


def main() -> None:
    name = "issue159-session-" + uuid.uuid4().hex[:10]
    session = None
    try:
        run("docker", "run", "--rm", "-d", "--network", "none", "--name", name,
            "-e", "POSTGRES_PASSWORD=disposable_only", "postgres:16-alpine")
        # Official image starts and stops a bootstrap DB; require stable SQL.
        for _ in range(120):
            if run("docker", "exec", name, "psql", "-X", "-U", "postgres",
                   "-d", "postgres", "-Atc", "SELECT 1",
                   check=False).returncode == 0:
                break
            time.sleep(0.25)
        else:
            raise RuntimeError("DATABASE_NOT_READY")
        time.sleep(2)
        admin(name, "CREATE ROLE " + ROLE +
              " LOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 1 "
              "PASSWORD '" + PASS + "'")
        admin(name, "CREATE SCHEMA isolated")
        admin(name, "CREATE TABLE isolated.task_rows(task_id integer)")
        admin(name, "INSERT INTO isolated.task_rows VALUES (170),(172)")
        admin(name, "ALTER TABLE isolated.task_rows ENABLE ROW LEVEL SECURITY")
        admin(name, "ALTER TABLE isolated.task_rows FORCE ROW LEVEL SECURITY")
        admin(name, "CREATE POLICY task_scope ON isolated.task_rows FOR SELECT TO " +
              ROLE + " USING (task_id=170)")
        admin(name, "GRANT USAGE ON SCHEMA isolated TO " + ROLE)
        admin(name, "GRANT SELECT(task_id) ON isolated.task_rows TO " + ROLE)
        session = subprocess.Popen(reader_command(
            name, "BEGIN READ ONLY; SELECT count(*) FROM isolated.task_rows; "
                  "SELECT pg_sleep(30); ROLLBACK;"),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        for _ in range(80):
            active = admin(name, "SELECT count(*) FROM pg_stat_activity "
                           "WHERE usename='" + ROLE + "' AND state='active'")
            if active == "1":
                break
            if session.poll() is not None:
                raise AssertionError("READER_EXITED_BEFORE_RELOCK")
            time.sleep(0.15)
        else:
            raise AssertionError("READER_ACTIVE_SESSION_NOT_SEEN")
        print("PASS_ACTIVE_SYNTHETIC_READER_SESSION_SEEN")
        admin(name, "REVOKE SELECT(task_id) ON isolated.task_rows FROM " + ROLE)
        admin(name, "REVOKE USAGE ON SCHEMA isolated FROM " + ROLE)
        admin(name, "ALTER ROLE " + ROLE +
              " NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL")
        killed = admin(name, "SELECT count(*) FROM pg_stat_activity "
                       "WHERE usename='" + ROLE + "' AND "
                       "pg_terminate_backend(pid)")
        if killed != "1":
            raise AssertionError("ACTIVE_READER_NOT_TERMINATED:" + killed)
        session.communicate(timeout=12)
        if session.returncode == 0:
            raise AssertionError("ACTIVE_READER_UNEXPECTEDLY_COMPLETED")
        print("PASS_ACTIVE_SYNTHETIC_SESSION_TERMINATED")
        for _ in range(30):
            if admin(name, "SELECT count(*) FROM pg_stat_activity "
                     "WHERE usename='" + ROLE + "'") == "0":
                break
            time.sleep(0.1)
        else:
            raise AssertionError("READER_SESSION_PERSISTED")
        print("PASS_ZERO_SYNTHETIC_SESSIONS")
        locked = admin(name, "SELECT NOT rolcanlogin AND rolconnlimit=0 "
                       "AND rolpassword IS NULL FROM pg_authid "
                       "WHERE rolname='" + ROLE + "'")
        if locked != "t":
            raise AssertionError("ROLE_NOT_LOCKED")
        failure = run(*reader_command(name, "SELECT 1"), check=False)
        if failure.returncode == 0:
            raise AssertionError("NEW_LOGIN_SUCCEEDED_AFTER_RELOCK")
        print("PASS_NOLOGIN_LIMIT0_PASSWORD_NULL_AND_NEW_LOGIN_DENIED")
        print("SYNTHETIC_ONLY_NOT_A_LIVE_DEV_AUTHORIZATION")
    finally:
        if session and session.poll() is None:
            session.kill()
            session.communicate(timeout=5)
        run("docker", "rm", "-f", name, check=False)


if __name__ == "__main__":
    main()
