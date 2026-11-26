#!/usr/bin/env python3
"""GPT02-1782 CST-DEV: SOURCE-ONLY review of existing Core DEV release lock.

The running DEV release already acquires an exclusive nonblocking flock on
/run/lock/cst-vps-dev-release.lock. This source provides a future supervisor
building block and tests: it NEVER stops a timer, opens Nginx, renews a role,
starts a hold, or grants a browser window. Actual time-bounded supervision
requires separately approved installation and recovery integration.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

RELEASE = Path("/usr/local/sbin/cst-vps-dev-release.py")
RELEASE_SHA256 = "ad0063421453184a7d3a66d1dffd2de3b7e74dced081e232315425e9aff1c2c8"
WATCHER = Path("/usr/local/sbin/cst-vps-dev-ci-watcher.py")
WATCHER_SHA256 = "5126bfd118e8352e979b5ab5c6929d8bf290dc6ef2e51c5076109d5f6f1b3dea"
LOCK = Path("/run/lock/cst-vps-dev-release.lock")
MAX_SCRIPT = 60_000


class UnsafeLock(RuntimeError):
    pass


def read_pinned_root_script(path: Path, expected: str, owner_uid: int = 0) -> bool:
    """Stable fd check; do not execute or import release/watcher source."""
    fd = None
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != owner_uid or
            before.st_gid != 0 and owner_uid == 0 or before.st_nlink != 1 or
            before.st_mode & 0o022 or not 0 < before.st_size <= MAX_SCRIPT):
            return False
        data = os.read(fd, MAX_SCRIPT + 1)
        after = os.fstat(fd)
        keys = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid",
                "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
        return (len(data) == before.st_size and
                all(getattr(before, k) == getattr(after, k) for k in keys) and
                hashlib.sha256(data).hexdigest() == expected)
    except OSError:
        return False
    finally:
        if fd is not None:
            os.close(fd)


def trusted_existing_lock(fd: int, path: Path, owner_uid: int = 0) -> bool:
    """Only a pre-existing root0600, single-link regular inode is accepted."""
    try:
        current = os.fstat(fd)
        at_path = path.lstat()
        return (
            stat.S_ISREG(current.st_mode)
            and current.st_uid == at_path.st_uid == owner_uid
            and (owner_uid != 0 or current.st_gid == at_path.st_gid == 0)
            and current.st_nlink == at_path.st_nlink == 1
            and stat.S_IMODE(current.st_mode) == stat.S_IMODE(at_path.st_mode) == 0o600
            and current.st_dev == at_path.st_dev
            and current.st_ino == at_path.st_ino
            and current.st_size == 0
        )
    except OSError:
        return False


def acquire_existing_lock(path: Path = LOCK, owner_uid: int = 0) -> int:
    """Building block for a future SEPARATELY AUTHORIZED supervisor.

    Returns an open fd HOLDING the exclusive kernel lock. Caller must keep fd
    open for the approved window and independently verify recovery before
    release. This function is never invoked from this file's CLI.
    """
    if os.geteuid() != owner_uid:
        raise UnsafeLock("UNAUTHORIZED_LOCK_OWNER")
    fd = None
    try:
        fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
        if not trusted_existing_lock(fd, path, owner_uid):
            raise UnsafeLock("UNTRUSTED_EXISTING_RELEASE_LOCK")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise UnsafeLock("DEV_RELEASE_ALREADY_HOLDS_LOCK") from None
        if not trusted_existing_lock(fd, path, owner_uid):
            raise UnsafeLock("LOCK_PATH_REPLACED")
        answer, fd = fd, None
        return answer
    except OSError:
        raise UnsafeLock("RELEASE_LOCK_UNAVAILABLE") from None
    finally:
        if fd is not None:
            os.close(fd)


def release_fd(fd: int) -> None:
    """Close to release only in a future authenticated supervisor's finally."""
    os.close(fd)


def audit_host_contract() -> dict:
    """NO lock acquisition, NO file write, NO systemd or DB interaction."""
    return {
        "scope": "GPT02-1782-CST-DEV",
        "release_script_sha_pinned": read_pinned_root_script(RELEASE, RELEASE_SHA256),
        "watcher_script_sha_pinned": read_pinned_root_script(WATCHER, WATCHER_SHA256),
        "existing_lock_metadata_trusted": inspect_lock_metadata(),
        "exclusive_lock_currently_acquired": False,
        "shared_dev_watcher_timer_modified": False,
        "nginx_modified": False,
        "reader_modified": False,
        "independent_crash_safe_supervisor_installed": False,
        "ready_to_open": False,
        "action": "RETAIN_NGINX_503",
    }


def inspect_lock_metadata(path: Path = LOCK, owner_uid: int = 0) -> bool:
    fd = None
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
        return trusted_existing_lock(fd, path, owner_uid)
    except OSError:
        return False
    finally:
        if fd is not None:
            os.close(fd)


def main() -> int:
    if os.geteuid() != 0 or os.getegid() != 0 or sys.argv[1:] != ["--check"]:
        print('{"action":"RETAIN_NGINX_503","ready_to_open":false,"readiness":"BLOCKED"}')
        return 2
    result = audit_host_contract()
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 2  # source-only preflight is NEVER authority for a live window


if __name__ == "__main__":
    raise SystemExit(main())
