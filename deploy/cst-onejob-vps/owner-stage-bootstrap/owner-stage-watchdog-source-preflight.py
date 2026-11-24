#!/usr/bin/env python3
"""Read-only, fail-closed CST-DEV Gate A pre-start watchdog source binding.

Never connects to the database, reads a secret, modifies systemd or grants
permission. Exit 0 only for matching public source pins AND an already
active independent watchdog; still not proof of release authority.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import subprocess
import sys

STAGE = Path("/etc/cst-onejob-dev/bootstrap-verified/owner-stage-public.env")
WATCHDOG = Path("/etc/cst-onejob-dev/gatea-authority/gatea-approved-public.env")
SHA = re.compile(r"[a-f0-9]{40}\Z")
IMAGE = "cst-onejob-stage-dev:"
STAGE_SOURCE = "CST_TEAM_DEV_APPROVED_SOURCE_SHA"
STAGE_IMAGE = "CST_ONEJOB_STAGE_IMAGE_REF"
WATCHDOG_SOURCE = "CST_GATEA_PINNED_SOURCE_SHA"
SERVICE = "cst-onejob-gatea-watchdog.service"


def _read_public(path: Path) -> dict[str, str]:
    st = path.lstat()
    if not path.is_file() or path.is_symlink() or st.st_uid != 0 or st.st_nlink != 1:
        raise ValueError("PUBLIC_FILE_IDENTITY_DENIED")
    if st.st_mode & 0o022 or st.st_size > 4096 or st.st_size < 30:
        raise ValueError("PUBLIC_FILE_METADATA_DENIED")
    data = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError("PUBLIC_ASSIGNMENT_INVALID")
        key, value = line.split("=", 1)
        if key in data or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            raise ValueError("PUBLIC_ASSIGNMENT_DUPLICATE_OR_INVALID")
        if not re.fullmatch(r"[a-zA-Z0-9_.:/@-]+", value):
            raise ValueError("PUBLIC_VALUE_INVALID")
        data[key] = value
    return data


def review(stage: dict[str, str], watchdog: dict[str, str], active: bool) -> tuple[bool, str]:
    source = stage.get(STAGE_SOURCE, "")
    image = stage.get(STAGE_IMAGE, "")
    watch_source = watchdog.get(WATCHDOG_SOURCE, "")
    if not SHA.fullmatch(source) or image != IMAGE + source:
        return False, "OWNER_STAGE_IMAGE_SOURCE_NOT_MATCHED"
    if not SHA.fullmatch(watch_source):
        return False, "WATCHDOG_PUBLIC_SOURCE_NOT_PINNED"
    if watch_source != source:
        return False, "WATCHDOG_STAGE_SOURCE_MISMATCH"
    if not active:
        return False, "WATCHDOG_NOT_ACTIVE"
    return True, "SOURCE_BINDING_MATCH_ONLY"


def main() -> int:
    if sys.argv[1:] != ["--read-only"]:
        print("OWNER_STAGE_WATCHDOG_PREFLIGHT_DENIED:INVALID_MODE")
        return 2
    try:
        stage = _read_public(STAGE)
        watchdog = _read_public(WATCHDOG)
        p = subprocess.run(
            ["/usr/bin/systemctl", "is-active", "--quiet", SERVICE],
            capture_output=True, timeout=3, check=False,
        )
        ok, code = review(stage, watchdog, p.returncode == 0)
    except Exception:
        print("OWNER_STAGE_WATCHDOG_PREFLIGHT_DENIED:HOST_READBACK_UNAVAILABLE")
        return 2
    if not ok:
        print("OWNER_STAGE_WATCHDOG_PREFLIGHT_DENIED:" + code)
        return 2
    print("OWNER_STAGE_WATCHDOG_SOURCE_BINDING_PASS_NOT_RELEASE_AUTHORITY")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
