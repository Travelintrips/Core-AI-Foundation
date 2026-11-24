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
import ipaddress
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
from cst_onejob_stage_relock_controller import ROLE_QUERY, ACTIVE_QUERY
from cst_onejob_stage_watchdog_candidate import check_once
from cst_onejob_preapproval_stage_broker import PROJECT
from cst_onejob_gatea_stage_stop_bridge import (
    SOCKET_PATH as STAGE_STOP_SOCKET, notify_stage_stop,
)

HOST = "aws-1-ap-southeast-2.pooler.supabase.com"
ROLE = "cst_gatea_watchdog_relock"
ADMIN_USERNAME = ROLE + "." + PROJECT
CA_SHA256 = "807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA"
RELOCK_ONLY_SQL = (
    "SELECT role_login::int,remaining_sessions,scope_ok::int "
    "FROM cst_gatea_relock_private.relock_stage_now()"
)
ALLOWED_SQL = frozenset((
    CLOCK_SQL, LEASE_SQL, ROLE_QUERY, ACTIVE_QUERY, RELOCK_ONLY_SQL,
))
INTERVAL_SECONDS = 5

class WatchdogRunnerDenied(RuntimeError):
    pass

def validate_source_sha(value):
    if not isinstance(value,str) or re.fullmatch(r"[a-f0-9]{40}",value) is None:
        raise WatchdogRunnerDenied("RUNNER_SOURCE_PIN_REQUIRED")
    return value

def relock_exact(query):
    """Call only the zero-argument, scoped SECURITY DEFINER relock entrypoint.

    The DB role has NO CREATEROLE, cannot issue ALTER ROLE directly, and has
    no arbitrary terminate privilege. The function commits NOLOGIN before
    this callback can report success. Any residual session is a failure.
    """
    rows=query(RELOCK_ONLY_SQL)
    try:
        parsed=tuple(tuple(int(v) for v in row) for row in rows)
    except (ValueError,TypeError):
        raise WatchdogRunnerDenied("RELOCK_ONLY_READBACK_INVALID") from None
    if parsed!=((0,0,1),):
        raise WatchdogRunnerDenied("RELOCK_ONLY_READBACK_NOT_CLEAN")
    return {"status":"PASS","roleLogin":False,
            "residualRoleSessions":0,"operationalPermission":False}

def close_transport_before_relock(query, close_stage_transport):
    """Fail closed: request exact Stage-A transport closure BEFORE DB relock.

    A failed closure must NEVER prevent the database relock attempt.
    A closure can be considered confirmed only with an exact local stop
    readback; do not allow caller-provided stage role names or SQL.
    The injection point requires a separately approved stop-only bridge.
    """
    stop_ok = False
    try:
        receipt = close_stage_transport()
        stop_ok = (
            isinstance(receipt, dict) and
            receipt.get("service") == "cst-onejob-gatea-preapproval-broker.service" and
            receipt.get("active") is False and
            receipt.get("socketPresent") is False and
            set(receipt) == {"service", "active", "socketPresent"}
        )
    except Exception:
        stop_ok = False
    # Even if the stop bridge failed, still lock the stage role first.
    database_result = relock_exact(query)
    if not stop_ok:
        raise WatchdogRunnerDenied("FRONTEND_TRANSPORT_STOP_NOT_VERIFIED")
    return database_result


def run_watchdog_check(query, source_sha, *, close_stage_transport=None):
    """One independent tick; database UTC controls all time comparisons.

    The existing check_once performs atomic relock readback on unsafe state.
    No caller-provided wall clock, lease or SQL is accepted from a client.
    """
    validate_source_sha(source_sha)
    if not callable(query):
        raise WatchdogRunnerDenied("RUNNER_SQL_READER_REQUIRED")
    seen={"role":None,"sessions":None,"lease":None}
    def scoped_query(statement):
        if statement not in ALLOWED_SQL:
            raise WatchdogRunnerDenied("RUNNER_SQL_OUTSIDE_RELOCK_ALLOWLIST")
        rows=query(statement)
        if statement==ROLE_QUERY:
            seen["role"]=rows
        elif statement==ACTIVE_QUERY:
            seen["sessions"]=rows
        elif statement==LEASE_SQL:
            seen["lease"]=rows
        return rows
    def safely_relock(q):
        if close_stage_transport is None:
            return relock_exact(q)
        # Avoid stopping a newly prepared signed broker on every 5-second
        # idle polling tick, while role is already NOLOGIN, no sessions and
        # no lease. All other/drifted/unknown states require transport STOP
        # first. Existing DB role/session/lease reads are reused unchanged.
        try:
            role=seen["role"][0]
            remaining=seen["sessions"][0][0]
            already_closed=(len(role)==5 and int(role[0])==0 and
                            tuple(int(v) for v in role[1:])==(0,0,0,1) and
                            int(remaining)==0 and seen["lease"]==[])
        except (TypeError,KeyError,IndexError,ValueError):
            already_closed=False
        if already_closed:
            return relock_exact(q)
        return close_transport_before_relock(q,close_stage_transport)
    now = read_database_utc_clock(scoped_query)
    return check_once(
        scoped_query,
        lambda: read_project_lease(scoped_query),
        now=now, approved_source_sha=source_sha,
        relock=safely_relock,
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

def validate_reviewed_pooler_ipv4(value):
    """Use the reviewed numeric egress target, never DNS inside isolated netns.

    The hostname still comes from the scoped DSN for TLS verify-full/SNI.
    This value is NOT an authorization; missing/stale allowlist fails closed.
    """
    try:
        addr=ipaddress.ip_address(value)
    except (ValueError,TypeError):
        raise WatchdogRunnerDenied("RUNNER_REVIEWED_POOLER_IP_REQUIRED") from None
    if (not isinstance(addr,ipaddress.IPv4Address) or not addr.is_global
        or addr.is_multicast or addr.is_reserved or addr.is_unspecified):
        raise WatchdogRunnerDenied("RUNNER_REVIEWED_POOLER_IP_DENIED")
    return str(addr)

def _connect(dsn, ca_path):
    # A reviewed per-host, source-pinned PUBLIC env value selects the numeric
    # pooler address also permitted by cgroup + nftables on TCP port 6543.
    # libpq hostaddr avoids DNS in the isolated netns while retaining the DSN
    # hostname for TLS verify-full and SNI. No fallback to insecure DNS/SSL.
    hostaddr=validate_reviewed_pooler_ipv4(
        os.environ.get("CST_GATEA_POOLER_IPV4"))
    import psycopg
    return psycopg.connect(
        dsn, hostaddr=hostaddr, sslmode="verify-full", sslrootcert=ca_path,
        gssencmode="disable",
        connect_timeout=5, application_name="cst_gatea_watchdog_relock",
        autocommit=True,
    )

def query_with_connection(conn, statement):
    if statement not in ALLOWED_SQL:
        raise WatchdogRunnerDenied("RUNNER_SQL_OUTSIDE_RELOCK_ALLOWLIST")
    with conn.cursor() as cursor:
        cursor.execute(statement)
        return list(cursor.fetchall()) if cursor.description else []

def run_loop(source_sha, dsn, ca_path, *, connect=_connect, stop=None, close_stage_transport=None):
    """Continue across successful observations; DB errors cause systemd retry."""
    stop=stop if stop is not None else threading.Event()
    validate_source_sha(source_sha)
    try:
        while not stop.is_set():
            with connect(dsn, ca_path) as conn:
                run_watchdog_check(lambda statement: query_with_connection(conn,statement),
                                   source_sha, close_stage_transport=close_stage_transport)
            stop.wait(INTERVAL_SECONDS)
    finally:
        # A deliberate systemd stop is NOT allowed to strand an open stage
        # LOGIN. Attempt a fresh, fixed-query administrative relock even if
        # a previous observation or connection failed. Never hide failures.
        with connect(dsn, ca_path) as conn:
            relock_callback=(relock_exact if close_stage_transport is None else
                            lambda q: close_transport_before_relock(q,close_stage_transport))
            relock_callback(lambda statement: query_with_connection(conn,statement))

def main(argv=None):
    parser=argparse.ArgumentParser(description="CST-DEV relock-only watchdog")
    parser.add_argument("--credential-file",required=True)
    parser.add_argument("--ca-file",required=True)
    parser.add_argument("--expected-source-sha",required=True)
    parser.add_argument("--stage-stop-bridge-socket",default=None)
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
        stage_stop=None
        if args.stage_stop_bridge_socket is not None:
            if args.stage_stop_bridge_socket != STAGE_STOP_SOCKET:
                raise WatchdogRunnerDenied("STOP_BRIDGE_SOCKET_NOT_PINNED")
            stage_stop=notify_stage_stop
        run_loop(pin,dsn,args.ca_file,stop=stop,
                 close_stage_transport=stage_stop)
        return 0
    except Exception:
        # Do not expose URLs, usernames, auth, query results or SQL errors.
        print("CST_GATEA_WATCHDOG_FAILED_CLOSED",flush=True)
        return 2

if __name__=="__main__":
    raise SystemExit(main())