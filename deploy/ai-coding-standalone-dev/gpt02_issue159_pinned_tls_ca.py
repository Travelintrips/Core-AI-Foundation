#!/usr/bin/env python3
"""CST-DEV public TLS root pin for the uninstalled Issue159 reader broker.

Only checks libpq's verify-full configuration and the root-owned PUBLIC CA.
Never reads a password, DSN, private key, SQL row, socket or service state.
A matching certificate cannot issue an auth token, reader role or dispatch.
"""
from __future__ import annotations

from collections.abc import Mapping
import hashlib
import os
from pathlib import Path
import ssl
import stat

from gpt02_issue159_writer_broker_contract import BrokerAdmissionError

PINNED_CA_PATH = "/etc/gpt02-dev/supabase-root-ca-2021.crt"
PINNED_CA_SHA256 = (
    "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa"
)
MAX_PUBLIC_CA_BYTES = 8192


def _public_ca_fingerprint_matches() -> bool:
    """Pin the exact public certificate, not merely a filename or CA flag."""
    try:
        meta = os.lstat(PINNED_CA_PATH)
        if (
            not stat.S_ISREG(meta.st_mode)
            or stat.S_ISLNK(meta.st_mode)
            or meta.st_uid != 0 or meta.st_gid != 0
            or meta.st_nlink != 1
            or (stat.S_IMODE(meta.st_mode) & 0o022) != 0
            or not 0 < meta.st_size <= MAX_PUBLIC_CA_BYTES
        ):
            return False
        data = Path(PINNED_CA_PATH).read_bytes()
        if not 0 < len(data) <= MAX_PUBLIC_CA_BYTES:
            return False
        content = data.decode("ascii")
        if (
            content.count("-----BEGIN CERTIFICATE-----") != 1
            or content.count("-----END CERTIFICATE-----") != 1
            or not content.lstrip().startswith("-----BEGIN CERTIFICATE-----")
            or not content.rstrip().endswith("-----END CERTIFICATE-----")
        ):
            return False
        der = ssl.PEM_cert_to_DER_cert(content)
        return hashlib.sha256(der).hexdigest() == PINNED_CA_SHA256
    except Exception:
        # Do not expose public path errors or attempt to trust another CA.
        return False


def require_pinned_cst_dev_tls(parameters: object, refusal_code: str) -> None:
    """Fail closed on any caller-selected CA, hostname-check downgrade or drift.

    sslmode=verify-full is validated by libpq at connection time; this
    independent static check binds sslrootcert to CST-DEV's reviewed public CA.
    The caller must also check exact native DB role, hostname, port and tenant.
    """
    if (
        not isinstance(parameters, Mapping)
        or parameters.get("sslmode") != "verify-full"
        or parameters.get("sslrootcert") != PINNED_CA_PATH
        or not _public_ca_fingerprint_matches()
    ):
        raise BrokerAdmissionError(refusal_code)
