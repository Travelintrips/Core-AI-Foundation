#!/usr/bin/env python3
"""Integrated real Node supervisor + real PostgreSQL 17 backend, DISPOSABLE ONLY.

Never contacts CST-DEV/PROD, launches a systemd unit, accesses stored credentials,
signs, approves or dispatches. Docker publishes only to 127.0.0.1 on a random
port, has synthetic identities and is unconditionally removed on exit.
The actual supervisor source is copied and given an explicitly test-only
transport adapter that redirects its postgres client to loopback.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import time
import uuid
from datetime import datetime, timezone, timedelta

IMAGE = "mirror.gcr.io/library/postgres:17-alpine"
AUDITOR = "dev_gpt02_relock_catalog_auditor"
READER = "gpt02_issuer_evidence_reader"
OTHER = ("dev_gpt02_attestor_evidence", "dev_gpt02_issuer_evidence")
REF = "xssrfshdrtdfupgqwfdw"
PINNED_HOST = "db." + REF + ".supabase.co"
TASK_ID = 99982
TTL_SECONDS = 23

def run(argv, *, input_text=None, check=True, timeout=30, env=None):
    proc = subprocess.run(
        argv, input=input_text, text=True, capture_output=True,
        timeout=timeout, env=env,
    )
    if check and proc.returncode:
        # Do not echo argv, SQL, credentials or raw database error messages.
        raise RuntimeError("SYNTHETIC_COMMAND_FAILED")
    return proc

def psql(container, user, password, statement, *, check=True, timeout=25):
    return run(
        ["docker", "exec", "-i", "-e", "PGPASSWORD=" + password,
         container, "psql", "-X", "-w", "-v", "ON_ERROR_STOP=1",
         "-h", "127.0.0.1", "-U", user, "-d", "postgres", "-At"],
        input_text=statement, check=check, timeout=timeout,
    )

def one(container, user, password, statement):
    return psql(container, user, password, statement).stdout.strip()

def exact_copy(source, old, new):
    if source.count(old) != 1:
        raise AssertionError("PINNED_SUPERVISOR_SOURCE_DRIFT")
    return source.replace(old, new)

def prepare_supervisor(original_path, module_path, port, pg_driver, directory):
    content = original_path.read_text(encoding="utf8")
    if "connectedSessionTerminationProven: false" not in content:
        raise AssertionError("SUPERVISOR_MUST_REMAIN_NO_GO")
    directory.mkdir(mode=0o700)
    creds = directory / "credentials"
    unit = creds / "fixture.service"
    unit.mkdir(parents=True, mode=0o700)
    (directory / "synthetic-ca.pem").write_text("SYNTHETIC_NO_TLS_LOOPBACK_ONLY\n")
    # No source or credential is ever copied back to CST-DEV.
    content = exact_copy(
        content,
        "const CERT = '/etc/gpt02-dev/supabase-root-ca-2021.crt';",
        "const CERT = " + json.dumps(str(directory / "synthetic-ca.pem")) + ";",
    )
    content = exact_copy(
        content,
        "directory?.startsWith('/run/credentials/')",
        "directory?.startsWith(" + json.dumps(str(creds) + "/") + ")",
    )
    content = exact_copy(
        content,
        "require('/opt/gpt02-reader-runtime/node_modules/pg')",
        "require('./loopback-pg-adapter.cjs')",
    )
    (directory / "supervisor-isolated.mjs").write_text(content, encoding="utf8")
    adapter = (
        "'use strict';\n"
        "const { Client: RealClient }=require(" + json.dumps(str(pg_driver)) + ");\n"
        "module.exports={Client:class extends RealClient {\n"
        " constructor(config){ super({...config,host:'127.0.0.1',port:"
        + str(port) + ",ssl:false}); }\n"
        "}};\n"
    )
    (directory / "loopback-pg-adapter.cjs").write_text(adapter, encoding="utf8")
    return unit, directory / "supervisor-isolated.mjs"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sql", required=True)
    parser.add_argument("--supervisor", required=True)
    parser.add_argument("--pg", required=True)
    args = parser.parse_args()
    sql_source = Path(args.sql).resolve()
    supervisor = Path(args.supervisor).resolve()
    pg_driver = Path(args.pg).resolve()
    if not all(x.is_file() for x in (sql_source, supervisor)):
        raise RuntimeError("ISOLATED_SOURCE_NOT_PRESENT")
    if not (pg_driver / "package.json").is_file():
        raise RuntimeError("ISOLATED_PG_DRIVER_NOT_PRESENT")
    source_sql = sql_source.read_text(encoding="utf8")
    if "RELOCK_INDEPENDENT_CALLER_REQUIRED" not in source_sql:
        raise RuntimeError("ISOLATED_SQL_CONTRACT_DRIFT")

    container = "gpt02-node-relock-" + uuid.uuid4().hex[:10]
    root_pw = secrets.token_urlsafe(35)
    postgres_pw = secrets.token_urlsafe(35)
    auditor_pw = secrets.token_urlsafe(45)
    reader_pw = secrets.token_urlsafe(45)
    coordinator = None
    held = None
    try:
        with tempfile.TemporaryDirectory(prefix="gpt02-pg17-node-integrated-") as temp:
            workspace = Path(temp)
            # A random loopback-only published port never reaches CST Supabase.
            run(["docker", "run", "--rm", "-d", "--name", container,
                 "--publish", "127.0.0.1::5432",
                 "-e", "POSTGRES_USER=fixture_root",
                 "-e", "POSTGRES_PASSWORD=" + root_pw, IMAGE], timeout=55)
            ports = run(["docker", "port", container, "5432/tcp"]).stdout.strip()
            m = re.fullmatch(r"127\.0\.0\.1:(\d{2,5})", ports)
            if not m:
                raise RuntimeError("CONTAINER_NOT_LOOPBACK_ONLY")
            port = int(m.group(1))

            for _ in range(90):
                if psql(container,"fixture_root",root_pw,"SELECT 1",
                        check=False,timeout=6).returncode == 0:
                    break
                time.sleep(.25)
            else:
                raise RuntimeError("SYNTHETIC_POSTGRES_NOT_READY")
            psql(container,"fixture_root",root_pw,
                 "CREATE ROLE postgres LOGIN CREATEROLE INHERIT PASSWORD '"
                 + postgres_pw + "';"
                 "GRANT CREATE ON DATABASE postgres TO postgres;"
                 "GRANT SELECT ON pg_catalog.pg_authid TO postgres;"
                 "GRANT pg_signal_backend TO postgres;"
                 "CREATE ROLE " + AUDITOR +
                 " NOLOGIN NOINHERIT NOCREATEROLE NOCREATEDB NOSUPERUSER"
                 " NOBYPASSRLS CONNECTION LIMIT 0 PASSWORD NULL;")
            for role in (READER, *OTHER):
                psql(container,"postgres",postgres_pw,
                     "CREATE ROLE " + role +
                     " NOLOGIN NOINHERIT NOCREATEROLE NOCREATEDB NOSUPERUSER"
                     " NOBYPASSRLS CONNECTION LIMIT 0 PASSWORD NULL;")
            psql(container, "postgres", postgres_pw, source_sql)
            psql(container, "fixture_root", root_pw,
                 "ALTER ROLE " + AUDITOR +
                 " LOGIN CONNECTION LIMIT 1 PASSWORD '" + auditor_pw + "';")
            print("PASS_PG17_TEMPORARY_PRIVATE_FUNCTIONS_AND_AUDITOR_READY",flush=True)

            unit, copied_supervisor = prepare_supervisor(
                supervisor, sql_source, port, pg_driver, workspace,
            )
            # Use the same pinned identity in the original source; only the
            # adapter changes the actual transport to isolated 127.0.0.1.
            password_fixture = dict(
                database="postgres", host=PINNED_HOST, password=auditor_pw,
                port=5432, projectRef=REF, sslMode="verify-full", user=AUDITOR,
            )
            (unit / "relock-catalog-dsn").write_text(
                json.dumps(password_fixture), encoding="utf8",
            )
            (unit / "relock-catalog-dsn").chmod(0o600)
            print("PASS_SUPERVISOR_SOURCE_COPIED_WITH_LOOPBACK_ONLY_TRANSPORT",flush=True)

            expiry = (datetime.now(timezone.utc) +
                      timedelta(seconds=TTL_SECONDS)).isoformat()
            scope = secrets.token_hex(32)
            opening = (
                "BEGIN;"
                "INSERT INTO gpt02_relock_audit.writer_issuance_watchdog "
                "(role_name,task_id,scope_sha256,previous_valid_until,expires_at) "
                "SELECT '" + READER + "'," + str(TASK_ID) + ",'" + scope +
                "',rolvaliduntil,TIMESTAMPTZ '" + expiry +
                "' FROM pg_authid WHERE rolname='" + READER + "';"
                "ALTER ROLE " + READER +
                " LOGIN CONNECTION LIMIT 1 PASSWORD '" + reader_pw +
                "' VALID UNTIL '" + expiry + "';"
                "COMMIT;SELECT pg_sleep(75);"
            )
            coordinator = subprocess.Popen(
                ["docker","exec","-i","-e","PGPASSWORD="+postgres_pw,
                 container,"psql","-X","-w","-v","ON_ERROR_STOP=1",
                 "-h","127.0.0.1","-U","postgres","-d","postgres","-At",
                 "-c",opening],
                stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            for _ in range(70):
                count = one(container,"postgres",postgres_pw,
                            "SELECT count(*) FROM gpt02_relock_audit.writer_issuance_watchdog "
                            "WHERE task_id=" + str(TASK_ID) + " AND cleaned_at IS NULL")
                if count == "1":
                    break
                if coordinator.poll() is not None:
                    raise RuntimeError("SYNTHETIC_ISSUANCE_DID_NOT_COMMIT")
                time.sleep(.2)
            else:
                raise RuntimeError("SYNTHETIC_WATCHDOG_ISSUANCE_TIMEOUT")
            coordinator.kill()
            coordinator.wait(timeout=5)
            coordinator = None
            print("PASS_COORDINATOR_KILLED_AFTER_ATOMIC_ISSUANCE",flush=True)
            held = subprocess.Popen(
                ["docker","exec","-e","PGPASSWORD="+reader_pw,container,
                 "psql","-X","-w","-h","127.0.0.1","-U",READER,
                 "-d","postgres","-c","SELECT pg_sleep(80)"],
                stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            backend = None
            for _ in range(60):
                pid = one(container,"postgres",postgres_pw,
                          "SELECT pid FROM pg_stat_activity "
                          "WHERE usename='" + READER + "' LIMIT 1")
                if pid.isdigit():
                    backend=int(pid)
                    break
                if held.poll() is not None:
                    raise RuntimeError("SYNTHETIC_READER_SESSION_EXITED_EARLY")
                time.sleep(.2)
            if backend is None:
                raise RuntimeError("SYNTHETIC_READER_NOT_CONNECTED")
            print("PASS_REAL_POSTGRES17_READER_BACKEND_CONNECTED",flush=True)

            for _ in range(95):
                expired = one(container,"postgres",postgres_pw,
                              "SELECT clock_timestamp() >= expires_at "
                              "FROM gpt02_relock_audit.writer_issuance_watchdog "
                              "WHERE task_id=" + str(TASK_ID))
                if expired == "t":
                    break
                time.sleep(.25)
            else:
                raise RuntimeError("SYNTHETIC_TTL_NOT_REACHED")

            env = {**os.environ, "APP_ENV":"development",
                   "CREDENTIALS_DIRECTORY":str(unit)}
            runner = run(["node","--jitless","--no-experimental-fetch",
                          str(copied_supervisor)],
                         check=False,timeout=34,env=env)
            if runner.returncode != 0:
                raise RuntimeError("NATIVE_NODE_SUPERVISOR_DID_NOT_COMPLETE")
            result=json.loads(runner.stdout.strip())
            if (result.get("phaseAWindowCount")!=1 or
                result.get("phaseBCleanedWindowCount")!=1 or
                result.get("connectedSessionTerminationProven") is not False or
                result.get("releaseDecision")!="NO_GO" or
                result.get("signingPermitted") is not False or
                result.get("dispatchPermitted") is not False):
                raise RuntimeError("SYNTHETIC_SUPERVISOR_RESULT_UNTRUSTED")
            print("PASS_REAL_NODE_SUPERVISOR_PHASE_A_AND_B_COUNTS_1_1",flush=True)

            try:
                exit_code=held.wait(timeout=5)
            except subprocess.TimeoutExpired:
                raise RuntimeError("SYNTHETIC_CONNECTED_SESSION_NOT_TERMINATED")
            if exit_code==0:
                raise RuntimeError("SYNTHETIC_SESSION_CLOSED_NORMALLY_NOT_FORCED")
            held=None
            remaining=one(container,"postgres",postgres_pw,
                          "SELECT count(*) FROM pg_stat_activity "
                          "WHERE pid=" + str(backend) +
                          " AND usename='" + READER + "'")
            assert remaining=="0","SYNTHETIC_READER_BACKEND_STILL_PRESENT"
            state=one(container,"postgres",postgres_pw,
                      "SELECT (NOT r.rolcanlogin AND r.rolconnlimit=0 "
                      "AND r.rolpassword IS NULL AND "
                      "r.rolvaliduntil='infinity'::timestamptz) "
                      "FROM pg_authid r WHERE rolname='" + READER + "'")
            assert state=="t","SYNTHETIC_ROLE_RELOCK_OR_EXPIRY_RESTORE_FAILED"
            cleaned=one(container,"postgres",postgres_pw,
                        "SELECT count(*) FROM gpt02_relock_audit.writer_issuance_watchdog "
                        "WHERE task_id=" + str(TASK_ID) +
                        " AND cleaned_at>=expires_at")
            assert cleaned=="1","SYNTHETIC_CLEANED_TIMESTAMP_NOT_COMMITTED"
            print("PASS_REAL_PG17_CONNECTED_BACKEND_TERMINATED_BY_NODE_SUPERVISOR",flush=True)
            again=run(["node","--jitless","--no-experimental-fetch",
                       str(copied_supervisor)],check=False,timeout=15,env=env)
            assert again.returncode==0,"SYNTHETIC_RELOCK_IDEMPOTENCY_FAILED"
            rerun=json.loads(again.stdout.strip())
            assert (rerun["phaseAWindowCount"],
                    rerun["phaseBCleanedWindowCount"])==(0,0)
            print("PASS_NODE_SUPERVISOR_RELOCK_IDEMPOTENT_AFTER_REAL_TERMINATION",flush=True)
            print("DISPOSABLE_LOOPBACK_PG17_ONLY_NO_CST_DEV_OR_PROD_MUTATIONS",flush=True)
    finally:
        if held is not None and held.poll() is None:
            held.terminate()
            try:held.wait(timeout=3)
            except subprocess.TimeoutExpired:held.kill()
        if coordinator is not None and coordinator.poll() is None:
            coordinator.kill()
            coordinator.wait(timeout=3)
        run(["docker","rm","-f",container],check=False,timeout=15)

if __name__ == "__main__":
    main()
