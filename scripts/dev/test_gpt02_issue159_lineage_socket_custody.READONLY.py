#!/usr/bin/env python3
"""Read-only custody preflight for existing GPT02 Issue159 lineage reader.

Run only on authorized CST-DEV VPS. No reads of credential contents, requests
to restricted sockets, DB writes, process restarts, signer, or dispatch.
"""
from __future__ import annotations

import grp
import os
import pwd
import socket
import stat
import subprocess
from pathlib import Path

SOCKET = Path("/run/gpt02-lineage-reader/reader.sock")
LINEAGE_DIR = SOCKET.parent
VERIFIER_UNIT = "gpt02-issue159-verifier.service"
LINEAGE_UNIT = "gpt02-issue159-lineage-reader.service"
ISSUER_UNIT = "gpt02-issue159-issuer-reader.service"
SIGNER_UNITS = [
    f"gpt02-issue159-operational-signer@{role}.service"
    for role in ("approval", "hub", "core", "issuer")
]


def systemctl(*args: str) -> str:
    result = subprocess.run(["systemctl", *args], capture_output=True,
                            text=True, timeout=8, check=True)
    return result.stdout.strip()


def unit_properties(unit: str) -> dict[str, str]:
    keys = ("ActiveState", "MainPID", "User", "Group", "NRestarts")
    entries = systemctl("show", unit, *[f"-p{k}" for k in keys]).splitlines()
    return dict(item.split("=", 1) for item in entries if "=" in item)


def require(value: bool, failure: str) -> None:
    if not value:
        raise RuntimeError(failure)


def main() -> None:
    reader = unit_properties(LINEAGE_UNIT)
    verifier = unit_properties(VERIFIER_UNIT)
    issuer = unit_properties(ISSUER_UNIT)
    require(reader.get("ActiveState") == "active", "LINEAGE_READER_INACTIVE")
    require(verifier.get("ActiveState") == "active", "VERIFIER_INACTIVE")
    require(issuer.get("ActiveState") != "active", "ISSUER_UNEXPECTEDLY_ACTIVE")
    for unit in SIGNER_UNITS:
        require(unit_properties(unit).get("ActiveState") != "active",
                "OPERATIONAL_SIGNER_UNEXPECTEDLY_ACTIVE")
    expected_uid = pwd.getpwnam("gpt02-issue159-verifier").pw_uid
    expected_gid = grp.getgrnam("gpt02-issue159-signers").gr_gid
    reader_uid = pwd.getpwnam("gpt02-lineage-reader").pw_uid
    require(verifier.get("User") == "gpt02-issue159-verifier",
            "VERIFIER_USER_MISMATCH")
    require(verifier.get("Group") == "gpt02-issue159-signers",
            "VERIFIER_GROUP_MISMATCH")
    pid = int(verifier.get("MainPID", "0"))
    require(pid > 1, "VERIFIER_PID_MISSING")
    status = Path(f"/proc/{pid}/status").read_text()
    line = {name: value for name, value in
            (part.split(":", 1) for part in status.splitlines() if ":" in part)}
    uid = [int(x) for x in line.get("Uid", "").split()]
    gid = [int(x) for x in line.get("Gid", "").split()]
    require(len(uid) == 4 and set(uid) == {expected_uid},
            "VERIFIER_EFFECTIVE_UID_MISMATCH")
    require(len(gid) == 4 and set(gid) == {expected_gid},
            "VERIFIER_EFFECTIVE_GID_MISMATCH")
    d, s = LINEAGE_DIR.lstat(), SOCKET.lstat()
    require(stat.S_ISDIR(d.st_mode) and not stat.S_ISLNK(d.st_mode)
            and d.st_uid == reader_uid and d.st_gid == expected_gid
            and stat.S_IMODE(d.st_mode) == 0o750, "PRIVATE_DIR_INVALID")
    require(stat.S_ISSOCK(s.st_mode) and not stat.S_ISLNK(s.st_mode)
            and s.st_uid == reader_uid and s.st_gid == expected_gid
            and stat.S_IMODE(s.st_mode) == 0o660, "PRIVATE_SOCKET_INVALID")
    print("PASS_LINEAGE_SERVICE_ACTIVE")
    print("PASS_VERIFIER_PROCESS_UID_GID_PINNED")
    print("PASS_PRIVATE_SOCKET_CUSTODY")
    print("PASS_ISSUER_AND_SIGNERS_INACTIVE")
    print("CUSTODY_ONLY_NO_DATABASE_READ_NO_AUTHORITY")


if __name__ == "__main__":
    main()
