#!/usr/bin/env python3
"""GPT02-1782 CST-DEV: review exact GET gate open -> restore, WITHOUT doing it.

SOURCE-ONLY. This diagnostic never modifies the vhost, invokes Nginx,
runs systemd, renews the reader, reads credentials, or accepts --execute.
The installed, SHA-pinned PR1851 restore guard is compiled as an inert module
and supplies the SAME strict canonical closed-site & rollback transformations.
An all-green byte-level proof does not authorize a live 90-second window.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import stat
import sys

ACTIVE = Path("/etc/nginx/sites-enabled/dev-ai-task.cstlogistic.co.id")
ROOT_RESTORE = Path("/usr/local/sbin/gpt02_owner_ledger_nginx_restore_guard.py")
RESTORE_SHA256 = "e8e874d3d05de88f405d7584ede63a51539ad1e986aed2a2c620773ea2e92448"
MAX_ACTIVE = 200_000
MAX_RESTORE = 20_000


class NotApproved(RuntimeError):
    pass


def checked_file(path: Path, *, max_bytes: int, mode: int | None = None) -> bytes:
    """No symlinks, no mutation, stable root-only regular-file metadata."""
    fd = None
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != 0
            or before.st_gid != 0 or before.st_nlink != 1
            or before.st_mode & 0o022
            or not 0 < before.st_size <= max_bytes
            or (mode is not None and stat.S_IMODE(before.st_mode) != mode)):
            raise NotApproved("UNTRUSTED_ROOT_FILE")
        data = os.read(fd, max_bytes + 1)
        after = os.fstat(fd)
        fields = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid",
                  "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
        if len(data) != before.st_size or any(
            getattr(before, field) != getattr(after, field) for field in fields
        ):
            raise NotApproved("FILE_CHANGED_DURING_READ")
        return data
    except OSError:
        raise NotApproved("FILE_UNAVAILABLE") from None
    finally:
        if fd is not None:
            os.close(fd)


def pinned_guard_source(
    path: Path = ROOT_RESTORE, approved_sha: str = RESTORE_SHA256
) -> dict:
    """Compile EXACT SHA-verified root guard bytes but never call its CLI."""
    data = checked_file(path, max_bytes=MAX_RESTORE, mode=0o700)
    if hashlib.sha256(data).hexdigest() != approved_sha:
        raise NotApproved("ROLLBACK_GUARD_SHA_DRIFT")
    scope: dict = {
        "__name__": "gpt02_v10_inert_approved_restore_helper",
        "__file__": str(path),
    }
    # Existing guard in turn loads and verifies exact root boot source SHA
    # before exporting its pure strict canonical and rollback functions.
    exec(compile(data, str(path), "exec"), scope)
    if not callable(scope.get("checked")) or not callable(scope.get("permitted_open_to_closed")):
        raise NotApproved("ROLLBACK_HELPER_CONTRACT_INVALID")
    return scope


def examine_bytes(data: bytes, *, gate: bytes, comment: bytes,
                  is_closed, close_opened) -> dict:
    """Pure exact-byte reversible test; NEVER sends opened bytes to Nginx."""
    if is_closed(data) is not True:
        raise NotApproved("FULL_VHOST_NOT_APPROVED_CLOSED")
    if data.count(gate) != 1 or data.count(comment) != 0:
        raise NotApproved("GET_GATE_MISSING_OR_DUPLICATED")
    opened = data.replace(gate, comment, 1)
    if opened == data or opened.count(gate) != 0 or opened.count(comment) != 1:
        raise NotApproved("OPENING_NOT_EXACT_ONE_LINE")
    if close_opened(opened) != data:
        raise NotApproved("RESTORE_NOT_EXACT_OR_REJECTED")
    if is_closed(opened):
        raise NotApproved("OPENED_BYTES_STILL_CLASSIFIED_CLOSED")
    return {
        "canonical_closed_vhost": True,
        "single_exact_gate_substitution": True,
        "guard_restores_byte_identical": True,
        "approved_closed_sha256": hashlib.sha256(data).hexdigest(),
        "simulated_open_sha256": hashlib.sha256(opened).hexdigest(),
        "approved_closed_length": len(data),
        "simulated_open_length": len(opened),
        "nginx_config_written": False,
        "nginx_reloaded": False,
        "rollback_timer_armed": False,
        "reader_lease_extended": False,
        "owner_http404_observed": False,
        "live_e2e_ready": False,
        "ready_to_open": False,
        "action": "RETAIN_NGINX_503",
    }


def main() -> int:
    if os.geteuid() != 0 or os.getegid() != 0 or sys.argv[1:] != ["--check"]:
        print('{"action":"RETAIN_NGINX_503","ready_to_open":false,"readiness":"BLOCKED"}')
        return 2
    try:
        helper = pinned_guard_source()
        data = checked_file(ACTIVE, max_bytes=MAX_ACTIVE)
        evidence = examine_bytes(
            data, gate=helper["GATE"], comment=helper["COMMENT"],
            is_closed=helper["checked"],
            close_opened=helper["permitted_open_to_closed"],
        )
        evidence["byte_reversibility"] = "PASS"
        evidence["scope"] = "GPT02-1782-CST-DEV"
        evidence["readiness"] = "SOURCE_SIMULATION_ONLY"
        print(json.dumps(evidence, sort_keys=True, separators=(",", ":")))
    except Exception:
        # Never serialize a potentially sensitive internal exception or path.
        print('{"action":"RETAIN_NGINX_503","ready_to_open":false,"readiness":"BLOCKED"}')
    return 2  # ALWAYS NO-GO until separately approved real Owner E2E


if __name__ == "__main__":
    raise SystemExit(main())
