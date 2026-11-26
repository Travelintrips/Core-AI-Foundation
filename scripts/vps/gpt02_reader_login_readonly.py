#!/usr/bin/env python3
"""Source-controlled replacement for the EXISTING GPT02-1782 root-only login checker.

No provisioning, receipt issuance, grants, credential output, Nginx changes,
reader lease changes, or mutation queries. Run only in an authorized DEV check.
A pooler TLS handshake is insufficient: backend pg_stat_ssl.ssl MUST be true.
"""
from __future__ import annotations

from datetime import datetime
import json
import os
from pathlib import Path
import stat
import sys

PROJECT = "xssrfshdrtdfupgqwfdw"
ROLE = "gpt02_owner_ledger_reader_1782_dev"
DIRECT_HOST = "db.xssrfshdrtdfupgqwfdw.supabase.co"
SESSION_HOST = "aws-0-ap-southeast-2.pooler.supabase.com"
CREDENTIAL = Path("/run/credentials/gpt02-owner-ledger-reader/reader.json")
CA = Path("/etc/gpt02-dev/supabase-root-ca-2021.crt")
EXPECTED_FIELDS = frozenset(("database", "host", "password", "port", "projectId", "sslMode", "user"))
MIN_LEASE_SECONDS = 180

class ReaderDenied(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)

def deny(code: str):
    raise ReaderDenied(code)

def unique_json_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            deny("CREDENTIAL_INVALID")
        result[key] = value
    return result

def reject_constant(_value):
    deny("CREDENTIAL_INVALID")

def parse_credential(data: bytes) -> dict:
    try:
        cfg = json.loads(data.decode("utf-8", "strict"), object_pairs_hook=unique_json_pairs,
                         parse_constant=reject_constant)
        if type(cfg) is not dict or set(cfg) != EXPECTED_FIELDS:
            deny("CREDENTIAL_INVALID")
        if type(cfg["projectId"]) is not str or cfg["projectId"] != PROJECT:
            deny("PROJECT_MISMATCH")
        if type(cfg["user"]) is not str or cfg["user"] != ROLE:
            deny("ROLE_MISMATCH")
        if cfg["sslMode"] != "verify-full" or cfg["database"] != "postgres" or type(cfg["port"]) is not int or cfg["port"] != 5432:
            deny("TRANSPORT_UNAPPROVED")
        if type(cfg["host"]) is not str or cfg["host"] not in (DIRECT_HOST, SESSION_HOST):
            deny("TRANSPORT_UNAPPROVED")
        password = cfg["password"]
        if type(password) is not str or not 32 <= len(password.encode("utf-16-le", "surrogatepass")) // 2 <= 256:
            deny("CREDENTIAL_INVALID")
        return cfg
    except ReaderDenied:
        raise
    except (TypeError, ValueError, UnicodeError, RecursionError, KeyError):
        deny("CREDENTIAL_INVALID")

def wire_user(cfg: dict) -> str:
    return ROLE if cfg["host"] == DIRECT_HOST else ROLE + "." + PROJECT

def check_row(row) -> int:
    # Actor/effective role are PostgreSQL roles, never the Supavisor wire login.
    if row is None or len(row) != 15:
        deny("IDENTITY_UNVERIFIED")
    (actor, effective, database, tx_readonly, default_readonly, backend_ssl,
     valid_until, connlimit, superuser, bypass, canlogin,
     create_db, create_role, replication, db_now) = row
    if actor != ROLE or effective != ROLE or database != "postgres":
        deny("IDENTITY_UNVERIFIED")
    if tx_readonly != "on" or default_readonly != "on":
        deny("READONLY_UNVERIFIED")
    if backend_ssl is not True:
        deny("BACKEND_TLS_UNVERIFIED")
    if connlimit != 1 or superuser is not False or bypass is not False or canlogin is not True or create_db is not False or create_role is not False or replication is not False:
        deny("ROLE_SCOPE_UNVERIFIED")
    if not isinstance(valid_until, datetime) or not isinstance(db_now, datetime):
        deny("LEASE_UNVERIFIED")
    remaining = int((valid_until - db_now).total_seconds())
    if remaining < MIN_LEASE_SECONDS:
        deny("LEASE_EXPIRED_OR_SHORT")
    return remaining

def read_root_file(path: Path, *, credential: bool) -> bytes:
    # Descriptor no-follow and strict metadata on the protected runtime file.
    parent = path.parent
    if parent.is_symlink() or not parent.is_dir():
        deny("PROTECTED_FILE_UNAVAILABLE")
    parent_meta = parent.stat()
    if parent_meta.st_uid != 0 or parent_meta.st_gid != 0 or stat.S_IMODE(parent_meta.st_mode) & 0o022:
        deny("PROTECTED_FILE_UNAVAILABLE")
    fd = None
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        meta = os.fstat(fd)
        mode = stat.S_IMODE(meta.st_mode)
        limit = 4096 if credential else 16384
        if (not stat.S_ISREG(meta.st_mode) or meta.st_uid != 0 or meta.st_gid != 0 or
            meta.st_nlink != 1 or meta.st_size < 1 or meta.st_size > limit or
            (mode != 0o600 if credential else bool(mode & 0o022))):
            deny("PROTECTED_FILE_UNAVAILABLE")
        data = os.read(fd, limit + 1)
        if len(data) != meta.st_size:
            deny("PROTECTED_FILE_UNAVAILABLE")
        return data
    except ReaderDenied:
        raise
    except OSError:
        deny("PROTECTED_FILE_UNAVAILABLE")
    finally:
        if fd is not None:
            os.close(fd)

def read_only_probe(cfg: dict, ca_file: Path, connect) -> int:
    # This script never passes '-c default_transaction_read_only=on': the
    # role's PostgreSQL default must independently be ON before we PASS.
    with connect(
        host=cfg["host"], port=5432, dbname="postgres", user=wire_user(cfg),
        password=cfg["password"], sslmode="verify-full", sslrootcert=str(ca_file),
        connect_timeout=5, autocommit=True, application_name="gpt02-reader-check-dev",
        options="-c statement_timeout=3000"
    ) as conn:
        with conn.cursor() as cur:
            cur.execute("BEGIN TRANSACTION READ ONLY")
            try:
                cur.execute(
                    """SELECT session_user::text, current_user::text, current_database()::text,
                              current_setting('transaction_read_only'),
                              current_setting('default_transaction_read_only'),
                              (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()),
                              r.rolvaliduntil, r.rolconnlimit, r.rolsuper, r.rolbypassrls,
                              r.rolcanlogin, r.rolcreatedb, r.rolcreaterole, r.rolreplication,
                              clock_timestamp()
                         FROM pg_roles r WHERE r.rolname = session_user"""
                )
                row = cur.fetchone()
                return check_row(row)
            finally:
                cur.execute("ROLLBACK")

def run():
    if os.geteuid() != 0:
        deny("ROOT_REQUIRED")
    cfg = parse_credential(read_root_file(CREDENTIAL, credential=True))
    ca = read_root_file(CA, credential=False)
    if not ca.startswith(b"-----BEGIN CERTIFICATE-----"):
        deny("CA_UNAVAILABLE")
    import psycopg
    remaining = read_only_probe(cfg, CA, psycopg.connect)
    print("READER_AUTHENTICATED=PASS")
    print("READER_ROLE_SCOPE=PASS")
    print("READER_BACKEND_TLS=PASS")
    print("READER_LEASE_REMAINING_SECONDS=" + str(remaining))
    return 0

if __name__ == "__main__":
    try:
        sys.exit(run())
    except ReaderDenied as exc:
        print("READER_AUTHENTICATED=BLOCKED")
        print("READER_LEASE=NOT_VERIFIED")
        print("FAILURE_CLASS=" + exc.code)
        sys.exit(2)
    except Exception:
        # Do not log server error messages, passwords, hostnames or private paths.
        print("READER_AUTHENTICATED=BLOCKED")
        print("READER_LEASE=NOT_VERIFIED")
        print("FAILURE_CLASS=DATABASE_CONNECTION_UNVERIFIED")
        sys.exit(2)
