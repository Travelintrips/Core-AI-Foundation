#!/usr/bin/env python3
"""Source-only GPT02 Super Admin ledger credential mount gate for CST-DEV.

No CLI, credential reading or secret provisioning. Intended for an authorized
release wrapper after the host-sealed reader credential is securely loaded.
This gate must NEVER replace the existing issuer-reader mounts or PROD deploy.
"""
from __future__ import annotations

import os
import stat
from pathlib import Path

READER_FLAG = "GPT02_OWNER_LEDGER_READER_ENABLED"
READER_DIR = Path("/run/credentials/gpt02-owner-ledger-reader")
READER_FILE = READER_DIR / "reader.json"
TRUST_CA = Path("/etc/gpt02-dev/supabase-root-ca-2021.crt")
READER_ROLE = "gpt02_owner_ledger_reader_dev"


class ReaderMountDenied(RuntimeError):
    pass


def _regular_root_file(path: Path, *, mode: int, max_bytes: int) -> bool:
    try:
        meta = path.lstat()
    except OSError:
        return False
    return (
        stat.S_ISREG(meta.st_mode) and not stat.S_ISLNK(meta.st_mode)
        and meta.st_uid == 0 and meta.st_gid == 0
        and stat.S_IMODE(meta.st_mode) == mode
        and 0 < meta.st_size <= max_bytes
    )


def get_reader_mounts(*, enabled: bool, environment: str, production: bool) -> tuple[str, ...]:
    """Return *only* bounded readonly bind flags; never credential contents.

    Return no flags when disabled. If enabled, refuse starting a candidate
    unless the separate, securely provisioned runtime credential is present.
    """
    if type(enabled) is not bool:
        raise ReaderMountDenied("READER_FEATURE_FLAG_INVALID")
    if not enabled:
        return ()
    if environment != "development" or production:
        raise ReaderMountDenied("READER_MOUNT_DEV_ONLY")
    if not READER_DIR.exists() or READER_DIR.is_symlink():
        raise ReaderMountDenied("READER_CREDENTIAL_DIRECTORY_MISSING")
    try:
        directory = READER_DIR.lstat()
    except OSError:
        raise ReaderMountDenied("READER_CREDENTIAL_DIRECTORY_MISSING") from None
    if (
        not stat.S_ISDIR(directory.st_mode) or directory.st_uid != 0
        or directory.st_gid != 0 or stat.S_IMODE(directory.st_mode) != 0o700
    ):
        raise ReaderMountDenied("READER_CREDENTIAL_DIRECTORY_CUSTODY_INVALID")
    if not _regular_root_file(READER_FILE, mode=0o600, max_bytes=4096):
        raise ReaderMountDenied("READER_CREDENTIAL_CUSTODY_INVALID")
    if not _regular_root_file(TRUST_CA, mode=0o644, max_bytes=16_384):
        raise ReaderMountDenied("READER_PINNED_CA_CUSTODY_INVALID")
    # These paths are constants, not derived from user-controlled input.
    return (
        "--mount", f"type=bind,source={READER_FILE},target={READER_FILE},readonly",
        "--mount", f"type=bind,source={TRUST_CA},target={TRUST_CA},readonly",
    )


def validate_release_environment(values: dict[str, str]) -> bool:
    """Explicitly preserve independent legacy issuer mounts and key names.

    This is a proof of configuration only, not a credential or execution grant.
    """
    if not isinstance(values, dict):
        raise ReaderMountDenied("READER_RELEASE_ENV_INVALID")
    flag = values.get(READER_FLAG, "false")
    if flag not in ("true", "false"):
        raise ReaderMountDenied("READER_FEATURE_FLAG_INVALID")
    if flag == "true" and (
        values.get("NODE_ENV") == "production" or values.get("APP_ENV") != "development"
    ):
        raise ReaderMountDenied("READER_MOUNT_DEV_ONLY")
    return flag == "true"
