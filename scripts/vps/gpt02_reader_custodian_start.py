#!/usr/bin/env python3
"""Supported no-argument entry for separately authorized DEV custody preparation.

Validate public opt-in before asking systemd to load either sealed input. Never
source shell configuration, enable a unit, provision a secret, or read a key.
"""
from __future__ import annotations

import os
import stat
import subprocess
import sys
from pathlib import Path

from gpt02_superadmin_reader_mount_gate import _public_key, _regular_root_file

CONFIG_FILE = Path("/etc/gpt02-dev/reader-custodian.env")
PREPARATION_FLAG = "GPT02_DEV_CUSTODY_DBA_PREPARATION_ENABLED"
READER_LOADER_UNIT = "gpt02-owner-ledger-credential-loader.service"
CUSTODIAN_UNIT = "gpt02-reader-custodian.service"
CUSTODY_DIR = Path("/run/credentials/gpt02-reader-custody")
WORKER_PROOF = CUSTODY_DIR / "worker-attestation.json"
TRUST_CA = Path("/etc/gpt02-dev/supabase-root-ca-2021.crt")
MAX_CONFIG_BYTES = 8192
ALLOWED_KEYS = frozenset({
    "APP_ENV", "NODE_ENV", "SUPABASE_URL_DEV", PREPARATION_FLAG,
    "GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64",
    "GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256",
    "GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64",
    "GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256",
})
_CODES = frozenset({
    "CUSTODIAN_PREPARATION_ROOT_REQUIRED", "CUSTODIAN_PREPARATION_CONFIG_INVALID",
    "CUSTODIAN_PREPARATION_CONFIG_CHANGED",
    "CUSTODIAN_PREPARATION_DISABLED", "CUSTODIAN_PREPARATION_DEV_REQUIRED",
    "CUSTODIAN_PREPARATION_TRUST_INVALID", "CUSTODIAN_PREPARATION_PROOF_UNAVAILABLE",
    "CUSTODIAN_PREPARATION_CA_UNAVAILABLE", "CUSTODIAN_PREPARATION_START_FAILED",
    "CUSTODIAN_PREPARATION_ARGUMENTS_INVALID", "CUSTODIAN_PREPARATION_FAILED",
})


class LauncherDenied(RuntimeError):
    def __init__(self, code: str):
        self.code = code if code in _CODES else "CUSTODIAN_PREPARATION_FAILED"
        super().__init__(self.code)


def _directory(meta):
    if not stat.S_ISDIR(meta.st_mode) or meta.st_uid != 0 or meta.st_gid != 0 or stat.S_IMODE(meta.st_mode) & 0o022:
        raise LauncherDenied("CUSTODIAN_PREPARATION_CONFIG_INVALID")


def _read_configuration() -> dict[str, str]:
    parent = None
    descriptor = None
    try:
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
        parent = os.open("/", flags)
        _directory(os.fstat(parent))
        for name in CONFIG_FILE.parent.parts[1:]:
            child = os.open(name, flags, dir_fd=parent)
            try:
                _directory(os.fstat(child))
            except BaseException:
                os.close(child)
                raise
            os.close(parent)
            parent = child
        descriptor = os.open(CONFIG_FILE.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=parent)
        before = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_gid != 0
            or before.st_nlink != 1 or stat.S_IMODE(before.st_mode) != 0o600
            or not 0 < before.st_size <= MAX_CONFIG_BYTES
        ):
            raise ValueError()
        chunks, total = [], 0
        while total <= MAX_CONFIG_BYTES:
            chunk = os.read(descriptor, MAX_CONFIG_BYTES + 1 - total)
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > MAX_CONFIG_BYTES:
                raise ValueError()
        after = os.fstat(descriptor)
        fields = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
        if total != before.st_size or any(getattr(before, field) != getattr(after, field) for field in fields):
            raise ValueError()
        values = {}
        for line in b"".join(chunks).decode("utf-8", errors="strict").splitlines():
            if not line or line.startswith("#"):
                continue
            if "=" not in line or line != line.strip():
                raise ValueError()
            name, value = line.split("=", 1)
            if name not in ALLOWED_KEYS or name in values or value != value.strip() or any(char in value for char in "\"'\\\x00"):
                raise ValueError()
            values[name] = value
        return values
    except (OSError, ValueError, UnicodeError):
        raise LauncherDenied("CUSTODIAN_PREPARATION_CONFIG_INVALID") from None
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if parent is not None:
            os.close(parent)


def _validate_configuration(values: dict[str, str]) -> None:
    flag = values.get(PREPARATION_FLAG, "false")
    if flag not in ("true", "false"):
        raise LauncherDenied("CUSTODIAN_PREPARATION_CONFIG_INVALID")
    if flag != "true":
        raise LauncherDenied("CUSTODIAN_PREPARATION_DISABLED")
    if (
        set(values) != ALLOWED_KEYS or values.get("APP_ENV") != "development"
        or values.get("NODE_ENV") != "development"
        or values.get("SUPABASE_URL_DEV") != "https://xssrfshdrtdfupgqwfdw.supabase.co"
    ):
        raise LauncherDenied("CUSTODIAN_PREPARATION_DEV_REQUIRED")
    try:
        worker = _public_key(values, "ATTESTOR", "INVALID")
        dba = _public_key(values, "ISSUER", "INVALID")
        if worker == dba:
            raise ValueError()
    except Exception:
        raise LauncherDenied("CUSTODIAN_PREPARATION_TRUST_INVALID") from None


def _validate_public_inputs() -> None:
    try:
        directory = CUSTODY_DIR.lstat()
        if (
            not stat.S_ISDIR(directory.st_mode) or directory.st_uid != 0 or directory.st_gid != 0
            or stat.S_IMODE(directory.st_mode) != 0o700
            or not _regular_root_file(WORKER_PROOF, mode=0o600, max_bytes=8192)
        ):
            raise ValueError()
    except (OSError, ValueError):
        raise LauncherDenied("CUSTODIAN_PREPARATION_PROOF_UNAVAILABLE") from None
    if not _regular_root_file(TRUST_CA, mode=0o644, max_bytes=16_384):
        raise LauncherDenied("CUSTODIAN_PREPARATION_CA_UNAVAILABLE")


def prepare_custodian() -> None:
    if os.geteuid() != 0 or os.getegid() != 0:
        raise LauncherDenied("CUSTODIAN_PREPARATION_ROOT_REQUIRED")
    configuration = _read_configuration()
    _validate_configuration(configuration)
    # Metadata only here; the isolated issuer verifies the worker signature
    # before reading the reader credential or performing the native DB probe.
    _validate_public_inputs()
    try:
        subprocess.run(
            ["systemctl", "start", READER_LOADER_UNIT], check=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30,
        )
        # Loading may take time. Re-check opt-in and the exact public pins
        # before PID1 is asked to decrypt the independent DBA key.
        current = _read_configuration()
        _validate_configuration(current)
        if current != configuration:
            raise LauncherDenied("CUSTODIAN_PREPARATION_CONFIG_CHANGED")
        _validate_public_inputs()
        subprocess.run(
            ["systemctl", "start", CUSTODIAN_UNIT], check=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45,
        )
    except (OSError, subprocess.SubprocessError):
        # A timeout does not imply the systemd job stopped. Reconcile its state
        # before another authorized attempt; never retry or terminate it here.
        raise LauncherDenied("CUSTODIAN_PREPARATION_START_FAILED") from None


def main(argv: list[str] | None = None) -> int:
    if sys.argv[1:] if argv is None else argv:
        print("GPT02_DBA_PREPARATION=BLOCKED code=CUSTODIAN_PREPARATION_ARGUMENTS_INVALID", file=sys.stderr)
        return 1
    try:
        prepare_custodian()
    except LauncherDenied as error:
        print("GPT02_DBA_PREPARATION=BLOCKED code=" + error.code, file=sys.stderr)
        return 1
    except Exception:
        print("GPT02_DBA_PREPARATION=BLOCKED code=CUSTODIAN_PREPARATION_FAILED", file=sys.stderr)
        return 1
    print("GPT02_DBA_PREPARATION=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
