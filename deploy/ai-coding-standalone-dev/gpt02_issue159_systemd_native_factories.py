#!/usr/bin/env python3
"""Strict systemd-encrypted credential reader for Issue159 native one-shot.

Uses an existing systemd CREDENTIALS_DIRECTORY; no password, DSN or private
key is accepted from a command, browser, chat, callback, or normal environment
variable. No decrypted credential is persisted or printed.

This is an INERT library with NO CLI/service/credential issuer. It does not
provision roles, enable LOGIN, synthesize approvals, authorize dispatch or
connect to PostgreSQL when imported. A separately authorized DBA/custodian
must first stage task-bound credentials via systemd's encrypted credential
facility, migrate reviewed database gates, and prove crash-safe relock.
"""
from __future__ import annotations

import importlib
import json
import os
from pathlib import Path
import re
import stat

from gpt02_issue159_native_one_shot_supervisor import (
    TrustedConnectionFactories, _identity, RELOCK_DIRECT_HOST,
    RELOCK_NATIVE_ROLE,
)
from gpt02_issue159_native_relock_attestation import (
    _target, AUDITOR_DB_USER,
)
from gpt02_issue159_one_shot_reader_broker import (
    POOLER_HOST, POOLER_USER_SUFFIX,
)
from gpt02_issue159_pinned_tls_ca import PINNED_CA_PATH
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError

SYSTEMD_BASE = "/run/credentials"
SERVICE_NAME = re.compile(r"gpt02-issue159-one-shot-[a-z0-9][a-z0-9._@-]{0,90}\.service\Z")
FIELDS = frozenset((
    "database","host","password","port","projectRef","sslMode","user",
))
PROJECT="xssrfshdrtdfupgqwfdw"
MAX_JSON_BYTES=8192
# Files are already decrypted/mounted by systemd for one short-lived task
# instance; they are never read from /etc/credstore.encrypted directly.
FILES = {
    "consumer":"reader-claim-consumer.json",
    "guard":"reader-current-guard.json",
    "scoped_reader":"reader-scoped-once.json",
    "auditor":"reader-independent-auditor.json",
    "relock":"relock-catalog-dsn",
}

def _deny(code: str) -> None:
    raise BrokerAdmissionError(code)


def _credential_directory() -> Path:
    raw=os.environ.get("CREDENTIALS_DIRECTORY","")
    base=Path(SYSTEMD_BASE)
    candidate=Path(raw)
    if (
        not isinstance(raw,str)
        or candidate.parent != base
        or SERVICE_NAME.fullmatch(candidate.name) is None
        or ".." in candidate.parts
    ):
        _deny("ONE_SHOT_SYSTEMD_CREDENTIAL_SCOPE_REQUIRED")
    try:
        meta=os.lstat(candidate)
        if (
            not stat.S_ISDIR(meta.st_mode) or stat.S_ISLNK(meta.st_mode)
            or meta.st_uid not in (0,os.geteuid())
            or (stat.S_IMODE(meta.st_mode)&0o022)!=0
        ):
            _deny("ONE_SHOT_SYSTEMD_CREDENTIAL_DIRECTORY_UNTRUSTED")
    except OSError:
        _deny("ONE_SHOT_SYSTEMD_CREDENTIAL_DIRECTORY_MISSING")
    return candidate


def _read_encrypted_systemd_credential(directory: Path, name: str) -> dict:
    if name not in FILES:
        _deny("ONE_SHOT_SYSTEMD_CREDENTIAL_NAME_NOT_ALLOWED")
    full=directory/FILES[name]
    try:
        flags=os.O_RDONLY | getattr(os,"O_NOFOLLOW",0) | getattr(os,"O_CLOEXEC",0)
        fd=os.open(full,flags)
        try:
            meta=os.fstat(fd)
            if (
                not stat.S_ISREG(meta.st_mode) or meta.st_nlink!=1
                or meta.st_uid not in (0,os.geteuid())
                or (stat.S_IMODE(meta.st_mode)&0o077)!=0
                or not 0<meta.st_size<=MAX_JSON_BYTES
            ):
                _deny("ONE_SHOT_SYSTEMD_CREDENTIAL_FILE_UNTRUSTED")
            blob=os.read(fd,MAX_JSON_BYTES+1)
            if not blob or len(blob)>MAX_JSON_BYTES:
                _deny("ONE_SHOT_SYSTEMD_CREDENTIAL_SIZE_INVALID")
        finally: os.close(fd)
        data=json.loads(blob.decode("utf-8"))
        if not isinstance(data,dict) or set(data)!=FIELDS:
            _deny("ONE_SHOT_SYSTEMD_CREDENTIAL_FIELDS_INVALID")
        return data
    except (OSError,UnicodeError,json.JSONDecodeError):
        # Never log path, credential bytes, DSN, password or DB error.
        _deny("ONE_SHOT_SYSTEMD_CREDENTIAL_UNAVAILABLE")


def _connection_params(candidate: dict,*, user: str,host: str) -> dict:
    # Files themselves cannot change the exact host, project, user or TLS.
    if (
        candidate.get("database")!="postgres"
        or candidate.get("host")!=host
        or candidate.get("user")!=user
        or candidate.get("projectRef")!=PROJECT
        or candidate.get("sslMode")!="verify-full"
        or type(candidate.get("port")) is not int
        or candidate["port"]!=5432
        or type(candidate.get("password")) is not str
        or not 45<=len(candidate["password"])<=256
    ):
        _deny("ONE_SHOT_SYSTEMD_CREDENTIAL_NATIVE_SCOPE_INVALID")
    return {
        "dbname":"postgres","host":host,"port":5432,"user":user,
        "password":candidate["password"],
        "sslmode":"verify-full","sslrootcert":PINNED_CA_PATH,
        "connect_timeout":4,"autocommit":False,
        "application_name":"gpt02-issue159-one-task-native-dev",
    }


def factories_from_systemd(candidate: dict) -> TrustedConnectionFactories:
    """Bind exact signed candidate role, then return lazy five-session openers.

    Only the existing reviewed native broker may use these closures.
    No role creation, SQL mutation or network is performed by this function.
    """
    role,_scope=_target(candidate)
    directory=_credential_directory()
    expected={
        "consumer":("dev_gpt02_reader_claim_consumer"+POOLER_USER_SUFFIX,POOLER_HOST),
        "guard":("dev_gpt02_reader_admission_guard"+POOLER_USER_SUFFIX,POOLER_HOST),
        "scoped_reader":(role+POOLER_USER_SUFFIX,POOLER_HOST),
        "auditor":(AUDITOR_DB_USER,POOLER_HOST),
        # Reuse original existing encrypted relock identity, direct host.
        "relock":(RELOCK_NATIVE_ROLE,RELOCK_DIRECT_HOST),
    }

    def opener(name: str):
        user,host=expected[name]
        def connect():
            secret=_read_encrypted_systemd_credential(directory,name)
            kwargs=_connection_params(secret,user=user,host=host)
            # Lazy import: this module does not depend on psycopg until a
            # legitimate systemd credential instance actually opens a session.
            try:
                driver=importlib.import_module("psycopg")
                conn=driver.connect(**kwargs)
            except Exception:
                _deny("ONE_SHOT_NATIVE_POSTGRES_CONNECTION_DENIED")
            try:
                _identity(conn,user,autocommit=False,expected_host=host)
            except Exception:
                try: conn.close()
                except Exception:pass
                raise
            return conn
        return connect
    return TrustedConnectionFactories(**{
        name:opener(name) for name in FILES
    })


if __name__=="__main__":
    raise SystemExit("NO_CLI_ONE_SHOT_SYSTEMD_CUSTODY_NOT_PROVISIONED")
