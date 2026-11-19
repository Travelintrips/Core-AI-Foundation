#!/usr/bin/env python3
"""Disposable PostgreSQL catalogue smoke for the existing Issue159 one-task supervisor.

Never contacts a hosted DB. The tested SQL is read-only and never gives release
authority even if future catalogue objects are installed. Network isolated
postgres:16-alpine container, synthetic fixture only.
"""
from __future__ import annotations
from pathlib import Path
import subprocess
import time
import uuid

SQL_FILE = Path(__file__).with_name(
    "gpt02_issue159_supervisor_catalog_gate.READONLY.sql"
)


def run(args, *, sql=None, check=True):
    proc = subprocess.run(
        args, input=sql, text=True, capture_output=True, timeout=45,
    )
    if check and proc.returncode:
        raise RuntimeError("DISPOSABLE_CATALOG_QUERY_FAILED:" + proc.stderr[-500:])
    return proc


def main():
    sql = SQL_FILE.read_text(encoding="utf-8")
    # This is a *review* guard, not SQL injection protection. Operations
    # remain solely against the disposable PostgreSQL container below.
    stripped = "\n".join(
        line for line in sql.splitlines()
        if not line.lstrip().startswith("--")
    ).strip()
    if (
        not stripped.startswith("BEGIN READ ONLY;\nWITH\n")
        or not stripped.endswith("ROLLBACK;")
        or stripped.count("NO_GO_NEVER_AUTHORIZES") != 1
        or "pg_terminate_backend(" in stripped
        or "pg_read_file(" in stripped
    ):
        raise AssertionError("EXPECTED_READ_ONLY_SUPERVISOR_CATALOG_GATE")

    name = "gpt02-catalog-" + uuid.uuid4().hex[:10]
    try:
        run([
            "docker", "run", "--rm", "-d", "--network", "none",
            "--name", name, "-e", "POSTGRES_PASSWORD=fixture_only",
            "postgres:16-alpine",
        ])
        for _ in range(120):
            ready = run([
                "docker", "exec", name,
                "psql", "-X", "-h", "127.0.0.1", "-U", "postgres",
                "-d", "postgres", "-Atc", "SELECT 1",
            ], check=False)
            if ready.returncode == 0:
                break
            time.sleep(0.25)
        else:
            raise AssertionError("DISPOSABLE_CATALOG_DATABASE_NOT_READY")
        result = run([
            "docker", "exec", "-i", name,
            "psql", "-X", "-v", "ON_ERROR_STOP=1",
            "-U", "postgres", "-d", "postgres", "-At",
            "-F", "|",
        ], sql=sql)
        lines = [line for line in result.stdout.splitlines() if "NO_GO_NEVER_AUTHORIZES" in line]
        if len(lines) != 1:
            raise AssertionError("ONE_EXPLICIT_NO_GO_RESULT_REQUIRED")
        parts = lines[0].split("|")
        if (
            parts[1] != "NO_GO_NEVER_AUTHORIZES"
            or parts[-1] != "NOT_CHECKED: live signed Owner decision, systemd, CA/credential custody, native one-read broker, signer, DELL"
            or "NO_OWNER_SET_AUTHORITY_FOR_CONNECTED_POSTGRES" not in parts
        ):
            raise AssertionError("SOURCE_GATE_NEVER_AUTHORIZES_AND_HANDLES_ABSENT_OWNER")
        print("PASS_DISPOSABLE_CATALOG_READONLY_EMPTY_SCHEMA")
        print("PASS_DISPOSABLE_ABSENT_OWNER_NO_PRIVILEGE_ESCALATION")
        print("PASS_DISPOSABLE_SUPERVISOR_RELEASE_ALWAYS_NO_GO")
        print("NO_LIVE_SUPABASE_NO_ROLE_OR_CREDENTIAL_OPERATION")
    finally:
        run(["docker", "rm", "-f", name], check=False)


if __name__ == "__main__":
    main()
