#!/usr/bin/env python3
"""Independent CST-DEV Gate-A watchdog runner: source candidate, NOT DEPLOYED.

Composes the already-tested lease reader and relock controller. It can only
observe or relock the exact CST-DEV stage role. It has no LOGIN/open path.
The real systemd service cannot start until separate authority, isolated
network namespace, pinned CA and narrowly authorized DB credential exist.

No credentials, network, DB writes, installation or service activation occur
by importing this module. Synthetic QA injects the fixed-query callback.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import signal
import stat
import threading
from urllib.parse import parse_qsl, unquote, urlsplit

from cst_onejob_gatea_lease_reader import (
    CLOCK_SQL, LEASE_SQL, read_database_utc_clock, read_project_lease,
)
from cst_onejob_stage_relock_controller import (
    ROLE_QUERY, ACTIVE_QUERY, NOLOGIN_QUERY, TERMINATE_QUERY, relock_once,
)
from cst_onejob_stage_watchdog_candidate import check_once
from cst_onejob_preapproval_stage_broker import PROJECT

HOST = "aws-1-ap-southeast-2.pooler.supabase.com"
ROLE = "cst_gatea_watchdog_relock"
ADMIN_USERNAME = ROLE + "." + PROJECT
CA_SHA256 = "807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA"
ALLOWED_SQL = frozenset((
    CLOCK_SQL, LEASE_SQL, ROLE_QUERY, ACTIVE_QUERY, NOLOGIN_QUERY, TERMINATE_QUERY,
))
INTERVAL_SECONDS = 5

class WatchdogRunnerDenied(RuntimeError):
    pass

def validate_source_sha(value):
    if not isinstance(value,str) or re.fullmatch(r"[a-f0-9]{40}",value) is None:
        raise WatchdogRunnerDenied("RUNNER_SOURCE_PIN_REQUIRED")
    return value

def run_watchdog_check(query, source_sha):
    """One independent tick; database UTC controls all time comparisons.

    The existing check_once performs atomic relock readback on unsafe state.
    No caller-provided wall clock, lease or SQL is accepted from a client.
    """
    validate_source_sha(source_sha)
    if not callable(query):
        raise WatchdogRunnerDenied("RUNNER_SQL_READER_REQUIRED")
    def scoped_query(statement):
        if statement not in ALLOWED_SQL:
            raise WatchdogRunnerDenied("RUNNER_SQL_OUTSIDE_RELOCK_ALLOWLIST")
        return query(statement)
    now = read_database_utc_clock(scoped_query)
    return check_once(
        scoped_query,
        lambda: read_project_lease(scoped_query),
        now=now, approved_source_sha=source_sha,
    )

def _read_regular(path, maximum, *, owner=None):
    """Reject symlinks and group/world-writable credential/CA files."""
    try:
        fd=os.open(path,os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except OSError:
        raise WatchdogRunnerDenied("RUNNER_REQUIRED_FILE_UNAVAILABLE") from None
    try:
        s=os.fstat(fd)
        if (not stat.S_ISREG(s.st_mode) or s.st_size<1 or s.st_size>maximum
            or s.st_mode & 0o022 or s.st_nlink!=1
            or (owner is not None and s.st_uid not in (0,owner))):
            raise WatchdogRunnerDenied("RUNNER_REQUIRED_FILE_UNTRUSTED")
        with os.fdopen(os.dup(fd),"rb") as f:
            data=f.read(maximum+1)
        if len(data)!=s.st_size:
            raise WatchdogRunnerDenied("RUNNER_REQUIRED_FILE_CHANGED")
        return data
    finally:
        os.close(fd)

def validate_credential(raw):
    """Only one narrow CST-DEV DB identity, TLS verify-full, fixed pooler."""
    try:
        value=json.loads(raw)
    except Exception:
        raise WatchdogRunnerDenied("RUNNER_CREDENTIAL_SHAPE_DENIED") from None
    if (not isinstance(value,dict) or set(value)!={"version","project","dsn"}
        or value["version"]!=1 or value["project"]!=PROJECT
        or not isinstance(value["dsn"],str)):
        raise WatchdogRunnerDenied("RUNNER_CREDENTIAL_SCOPE_DENIED")
    try:
        url=urlsplit(value["dsn"])
        pairs=parse_qsl(url.query,keep_blank_values=True,strict_parsing=True)
        username=unquote(url.username or "")
        password=unquote(url.password or "")
        proper=(url.scheme=="postgresql" and url.hostname==HOST
            and url.port==6543 and url.path=="/postgres"
            and username==ADMIN_USERNAME and len(password)>=16
            and pairs==[("sslmode","verify-full")]
            and not url.fragment)
    except (ValueError,TypeError):
        proper=False
    if not proper:
        raise WatchdogRunnerDenied("RUNNER_DATABASE_URL_DENIED")
    return value["dsn"]

def validate_pinned_ca(raw):
    if not (500<=len(raw)<=8192):
        raise WatchdogRunnerDenied("RUNNER_CA_INVALID_SIZE")
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes
        from cryptography.x509.oid import ExtensionOID
        cert=x509.load_pem_x509_certificate(raw)
        fingerprint=cert.fingerprint(hashes.SHA256()).hex().upper()
        basic=cert.extensions.get_extension_for_oid(
            ExtensionOID.BASIC_CONSTRAINTS).value
        if fingerprint!=CA_SHA256 or not basic.ca:
            raise ValueError("CA_NOT_PINNED")
    except Exception:
        raise WatchdogRunnerDenied("RUNNER_CA_NOT_PINNED") from None
    return raw

def _connect(dsn, ca_path):
    # Imported only after source/identity/pinning preflight. No fallback TLS
    # settings, no self-signed CA from an untrusted remote connection.
    import psycopg
    return psycopg.connect(
        dsn, sslmode="verify-full", sslrootcert=ca_path,
        connect_timeout=5, application_name="cst_gatea_watchdog_relock",
        autocommit=True,
    )

def query_with_connection(conn, statement):
    if statement not in ALLOWED_SQL:
        raise WatchdogRunnerDenied("RUNNER_SQL_OUTSIDE_RELOCK_ALLOWLIST")
    with conn.cursor() as cursor:
        cursor.execute(statement)
        return list(cursor.fetchall()) if cursor.description else []

def run_loop(source_sha, dsn, ca_path, *, connect=_connect, stop=None):
    """Continue across successful observations; DB errors cause systemd retry."""
    stop=stop if stop is not None else threading.Event()
    validate_source_sha(source_sha)
    try:
        while not stop.is_set():
            with connect(dsn, ca_path) as conn:
                run_watchdog_check(lambda statement: query_with_connection(conn,statement),
                                   source_sha)
            stop.wait(INTERVAL_SECONDS)
    finally:
        # A deliberate systemd stop is NOT allowed to strand an open stage
        # LOGIN. Attempt a fresh, fixed-query administrative relock even if
        # a previous observation or connection failed. Never hide failures.
        with connect(dsn, ca_path) as conn:
            relock_once(lambda statement: query_with_connection(conn,statement))

def main(argv=None):
    parser=argparse.ArgumentParser(description="CST-DEV relock-only watchdog")
    parser.add_argument("--credential-file",required=True)
    parser.add_argument("--ca-file",required=True)
    parser.add_argument("--expected-source-sha",required=True)
    args=parser.parse_args(argv)
    try:
        pin=validate_source_sha(args.expected_source_sha)
        # The credential is passed only by systemd LoadCredential, never env.
        directory=os.environ.get("CREDENTIALS_DIRECTORY","")
        if (not directory or
            os.path.realpath(args.credential_file)!=
               os.path.join(os.path.realpath(directory),"watchdog-db") or
            os.path.realpath(args.ca_file)!=
               os.path.join(os.path.realpath(directory),"watchdog-ca")):
            raise WatchdogRunnerDenied("RUNNER_SYSTEMD_CREDENTIAL_REQUIRED")
        dsn=validate_credential(_read_regular(
            args.credential_file,4096,owner=os.geteuid()))
        validate_pinned_ca(_read_regular(args.ca_file,8192,owner=os.geteuid()))
        stop=threading.Event()
        signal.signal(signal.SIGTERM,lambda *_:stop.set())
        signal.signal(signal.SIGINT,lambda *_:stop.set())
        run_loop(pin,dsn,args.ca_file,stop=stop)
        return 0
    except Exception:
        # Do not expose URLs, usernames, auth, query results or SQL errors.
        print("CST_GATEA_WATCHDOG_FAILED_CLOSED",flush=True)
        return 2

if __name__=="__main__":
    raise SystemExit(main())