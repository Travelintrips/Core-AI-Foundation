#!/usr/bin/env python3
"""Metadata-only GPT02 Owner reader/custody mount gate for CST-DEV.

Called by the DEV release wrapper. No CLI, plaintext credential reading,
decryption, signing, or process execution. This gate never replaces existing
issuer-reader mounts and never changes a database role or credential.
"""
from __future__ import annotations

import base64
import hashlib
import re
import stat
from pathlib import Path

READER_FLAG = "GPT02_OWNER_LEDGER_READER_ENABLED"
READER_DIR = Path("/run/credentials/gpt02-owner-ledger-reader")
READER_FILE = READER_DIR / "reader.json"
TRUST_CA = Path("/etc/gpt02-dev/supabase-root-ca-2021.crt")
READER_ROLE = "gpt02_owner_ledger_reader_dev"
CUSTODY_DIR = Path("/run/credentials/gpt02-reader-custody")
WORKER_PROOF = CUSTODY_DIR / "worker-attestation.json"
DBA_PROOF = CUSTODY_DIR / "issuer-receipt.json"
DEV_PROJECT = "xssrfshdrtdfupgqwfdw"


class ReaderMountDenied(RuntimeError):
    pass


def _root_parents(path: Path) -> bool:
    try:
        for parent in path.parents:
            meta = parent.lstat()
            if (
                not stat.S_ISDIR(meta.st_mode) or meta.st_uid != 0 or meta.st_gid != 0
                or stat.S_IMODE(meta.st_mode) & 0o022
            ):
                return False
    except OSError:
        return False
    return True


def _regular_root_file(path: Path, *, mode: int, max_bytes: int) -> bool:
    try:
        meta = path.lstat()
    except OSError:
        return False
    return (
        stat.S_ISREG(meta.st_mode) and not stat.S_ISLNK(meta.st_mode)
        and meta.st_uid == 0 and meta.st_gid == 0
        and meta.st_nlink == 1 and _root_parents(path)
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
        values.get("NODE_ENV") != "development" or values.get("APP_ENV") != "development"
    ):
        raise ReaderMountDenied("READER_MOUNT_DEV_ONLY")
    return flag == "true"


def validate_custody_configuration(values: dict[str, str]) -> None:
    """Check public trust configuration only; never confer issuer authority."""
    if not validate_release_environment(values):
        raise ReaderMountDenied("READER_FEATURE_DISABLED")
    if values.get("SUPABASE_URL_DEV") != f"https://{DEV_PROJECT}.supabase.co":
        raise ReaderMountDenied("READER_PROJECT_MISMATCH")
    if values.get("SUPABASE_URL") or values.get("SUPABASE_SERVICE_ROLE_KEY"):
        raise ReaderMountDenied("READER_PROJECT_MISMATCH")
    keys = []
    for name in ("ATTESTOR", "ISSUER"):
        prefix = f"GPT02_DEV_CUSTODY_{name}_PUBLIC_KEY_SPKI"
        encoded, fingerprint = values.get(prefix + "_B64"), values.get(prefix + "_SHA256")
        try:
            if not isinstance(encoded, str) or len(encoded) != 60 or not isinstance(fingerprint, str):
                raise ValueError()
            der = base64.b64decode(encoded, validate=True)
            if (
                len(der) != 44 or not der.startswith(bytes.fromhex("302a300506032b6570032100"))
                or base64.b64encode(der).decode("ascii") != encoded
                or not re.fullmatch(r"[a-f0-9]{64}", fingerprint)
                or hashlib.sha256(der).hexdigest() != fingerprint
            ):
                raise ValueError()
        except (ValueError, TypeError):
            raise ReaderMountDenied("READER_CUSTODY_TRUST_CONFIGURATION_INVALID") from None
        keys.append(der)
    if keys[0] == keys[1]:
        raise ReaderMountDenied("READER_CUSTODY_ISSUERS_MUST_DIFFER")


def get_custody_mounts() -> tuple[str, ...]:
    """Inspect fixed public-proof files without reading or accepting their claims.

    The application still verifies signatures, scope, expiry, current token
    generation and worker-to-DBA linkage on every authenticated custody request.
    """
    try:
        directory = CUSTODY_DIR.lstat()
    except OSError:
        raise ReaderMountDenied("READER_CUSTODY_PROOF_FILE_UNAVAILABLE") from None
    if (
        not stat.S_ISDIR(directory.st_mode) or directory.st_uid != 0
        or directory.st_gid != 0 or stat.S_IMODE(directory.st_mode) != 0o700
        or not _root_parents(CUSTODY_DIR)
    ):
        raise ReaderMountDenied("READER_CUSTODY_PROOF_FILE_UNAVAILABLE")
    for path in (WORKER_PROOF, DBA_PROOF):
        if not _regular_root_file(path, mode=0o600, max_bytes=8192):
            raise ReaderMountDenied("READER_CUSTODY_PROOF_FILE_UNAVAILABLE")
    if not _regular_root_file(TRUST_CA, mode=0o644, max_bytes=16_384):
        raise ReaderMountDenied("READER_PINNED_CA_CUSTODY_INVALID")
    # Bind the directory, not individual evidence inodes: an authorized host
    # removal/replacement of a receipt must be visible on the next request.
    return (
        "--mount", f"type=bind,source={CUSTODY_DIR},target={CUSTODY_DIR},readonly",
    )
