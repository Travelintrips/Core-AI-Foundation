#!/usr/bin/env python3
"""Issue159 DEV READ-ONLY independent relock-admin credential custody preflight.

The privilege-bearing PostgreSQL catalog connection MUST NOT be borrowed
from the existing attestor, signer, lineage, issuer, or verifier services.
This source ONLY inspects metadata of a dedicated, currently uninstalled
systemd unit and encrypted credential file. It NEVER opens the credential,
inspects its DSN, connects to PostgreSQL, writes any file, or starts a unit.

The check is not a service definition or approval to provision a new secret.
Even successful metadata preflight ALWAYS yields releaseDecision=NO_GO,
credentialIssuancePermitted=false. Independent owner/security review is
required before any live-DEV one-shot service and credential exist.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import stat

EXPECTED_UNIT = Path("/etc/systemd/system/gpt02-issue159-relock-catalog-auditor.service")
EXPECTED_CREDENTIAL = Path("/etc/credstore.encrypted/gpt02-issue159-relock-catalog-dsn")
EXPECTED_BIND = (
    "LoadCredentialEncrypted=relock-catalog-dsn:"
    "/etc/credstore.encrypted/gpt02-issue159-relock-catalog-dsn"
)
REQUIRED_LINES = frozenset((
    "User=gpt02-issue159-relock-catalog-auditor",
    "NoNewPrivileges=yes",
    "ProtectSystem=strict",
    "PrivateTmp=yes",
    "Environment=APP_ENV=development",
    EXPECTED_BIND,
))
FORBIDDEN_CREDENTIAL_NAMES = (
    "gpt02-issue159-attestor-dsn",
    "gpt02-issue159-lineage-reader-dsn",
    "gpt02-issue159-issuer-reader-dsn",
    "gpt02-issue159-issuer-dsn",
    "gpt02-issue159-core-prep-dsn",
)


def _fail(reason: str) -> dict:
    return {
        "environment": "DEV",
        "unitMetadataReady": False,
        "encryptedCredentialMetadataReady": False,
        "credentialContentsRead": False,
        "credentialIssuancePermitted": False,
        "authorizationGranted": False,
        "signingPermitted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
        "reason": reason,
    }


def _safe_regular(path: Path, *, unit: bool) -> bool:
    st = path.lstat()  # Never follow a symlink.
    if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode):
        return False
    if st.st_uid != 0 or st.st_gid != 0:
        return False
    mode = stat.S_IMODE(st.st_mode)
    if unit:
        return (mode & 0o022) == 0 and (mode & 0o444) != 0
    return mode == 0o600 and st.st_size > 0


def check_custody_metadata(unit: Path, encrypted_credential: Path) -> dict:
    """Inspectable metadata-only; NEVER returns authorization.

    Parameters are for unit tests and review. The CLI always uses the two
    immutable known paths, not caller arguments, environment or user input.
    """
    try:
        if not _safe_regular(unit, unit=True):
            return _fail("UNSAFE_AUDITOR_UNIT_METADATA")
        # Read the .service TEXT only; the encrypted DSN file is NEVER read.
        raw = unit.read_text(encoding="utf-8")
        if len(raw) > 16384:
            return _fail("AUDITOR_UNIT_OVERSIZED")
        effective_lines = [
            line.strip() for line in raw.splitlines()
            if line.strip() and not line.lstrip().startswith(("#", ";"))
        ]
        lines = set(effective_lines)
        if not REQUIRED_LINES.issubset(lines):
            return _fail("AUDITOR_UNIT_CUSTODY_CONFIGURATION_INVALID")
        # systemd uses the effective LAST assignment. A prior strict line
        # cannot authorize metadata when a later directive removes the sandbox.
        # Check the ordered source, not its de-duplicated set.
        singleton_lines = (
            "User=gpt02-issue159-relock-catalog-auditor",
            "Environment=APP_ENV=development",
            "NoNewPrivileges=yes",
            "ProtectSystem=strict",
            "PrivateTmp=yes",
        )
        for expected in singleton_lines:
            prefix = ("Environment=APP_ENV=" if expected.startswith("Environment=")
                      else expected.split("=", 1)[0] + "=")
            matches = [line for line in effective_lines if line.startswith(prefix)]
            if matches != [expected]:
                return _fail("AUDITOR_UNIT_OVERRIDE_OR_DUPLICATE_DENIED")
        # No secondary environment, pre/post commands, or mount namespace
        # overrides are reviewed for this independent credential boundary.
        for line in effective_lines:
            if (line.startswith(("Environment=", "EnvironmentFile=",
                                 "PassEnvironment=", "UnsetEnvironment="))
                    and line != "Environment=APP_ENV=development"):
                return _fail("AUDITOR_UNIT_UNREVIEWED_ENVIRONMENT_DENIED")
            if line.startswith((
                "ExecStartPre=", "ExecStartPost=", "ExecCondition=",
                "ExecReload=", "ExecStop=", "ExecStopPost=",
                "BindPaths=", "RootDirectory=", "RootImage=",
                "NetworkNamespacePath=",
            )):
                return _fail("AUDITOR_UNIT_UNREVIEWED_EXEC_OR_MOUNT_DENIED")
        # A .service.d drop-in can override file settings. No such override
        # is approved by this metadata-only source preflight.
        if os.path.lexists(str(unit) + ".d"):
            return _fail("AUDITOR_UNIT_DROPINS_UNREVIEWED")
        # Reject any extra credential bind, even if the correct bind exists.
        binds = [line for line in effective_lines
                 if line.startswith(("LoadCredential=", "LoadCredentialEncrypted="))]
        if binds != [EXPECTED_BIND]:
            return _fail("AUDITOR_CREDENTIAL_ALIAS_NOT_EXCLUSIVE")
        if any(name in raw for name in FORBIDDEN_CREDENTIAL_NAMES):
            return _fail("CROSS_ROLE_CREDENTIAL_REUSE_DENIED")
        if not _safe_regular(encrypted_credential, unit=False):
            return _fail("UNSAFE_AUDITOR_ENCRYPTED_CREDENTIAL_METADATA")
        return {
            **_fail("METADATA_ONLY_READY_REQUIRES_INDEPENDENT_APPROVAL"),
            "unitMetadataReady": True,
            "encryptedCredentialMetadataReady": True,
        }
    except FileNotFoundError:
        return _fail("DEDICATED_RELOCK_AUDITOR_NOT_PROVISIONED")
    except (PermissionError, OSError, UnicodeError):
        return _fail("RELOCK_AUDITOR_METADATA_UNAVAILABLE")


def main() -> int:
    status = check_custody_metadata(EXPECTED_UNIT, EXPECTED_CREDENTIAL)
    print(json.dumps(status, sort_keys=True, separators=(",", ":")))
    # This does not grant authority even when metadata is correct.
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
