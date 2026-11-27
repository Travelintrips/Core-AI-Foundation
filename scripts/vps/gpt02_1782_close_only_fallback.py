#!/usr/bin/env python3
"""GPT02-1782 CST-DEV: independently invocable CLOSE-ONLY fallback.

SOURCE CANDIDATE ONLY; not installed or armed. This tool can only reconcile the
already reviewed GPT02 Nginx 503 guard. It CANNOT open the gate, create a reader
lease, mint proof, stop or resume the shared DEV watcher, or claim Owner E2E PASS.
A separately Owner-authorized operator must install/review/arm its systemd unit.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

GUARD = Path("/usr/local/sbin/gpt02_owner_ledger_nginx_restore_guard.py")
GUARD_SHA = "c20a9fbd41e29b8976e9e759383673cc0ba7557457219ccf7fa5597de4b85b25"
ACTIVE = Path("/etc/nginx/sites-enabled/dev-ai-task.cstlogistic.co.id")
# IMPORTANT: sites-available and sites-enabled are DIFFERENT regular files in
# the actual DEV host. Always pass the explicit sites-enabled target.
BACKUP = Path("/etc/nginx/dev-ai-task.gpt02-1782-guard-backup.conf")
CLOSED_URL = (
    "https://dev-ai-task.cstlogistic.co.id/api/gpt02-owner-ledger/decision/"
    "00000000-0000-4000-8000-000000000000"
)
MAX_SITE = 200_000
MAX_GUARD = 20_000


class RecoveryBlocked(RuntimeError):
    """Public bounded code; protected subprocess stderr is never returned."""


def read_root_file(path: Path, mode: int, limit: int) -> bytes:
    fd = None
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or
            before.st_gid != 0 or before.st_nlink != 1 or
            stat.S_IMODE(before.st_mode) != mode or
            not 0 < before.st_size <= limit):
            raise RecoveryBlocked("UNTRUSTED_ROOT_FILE")
        data = os.read(fd, limit + 1)
        after = os.fstat(fd)
        keys = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid",
                "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
        if len(data) != before.st_size or any(
            getattr(before, k) != getattr(after, k) for k in keys
        ):
            raise RecoveryBlocked("FILE_CHANGED_DURING_READ")
        return data
    except OSError:
        raise RecoveryBlocked("FILE_UNAVAILABLE") from None
    finally:
        if fd is not None:
            os.close(fd)


def pinned_guard() -> dict:
    src = read_root_file(GUARD, 0o700, MAX_GUARD)
    if hashlib.sha256(src).hexdigest() != GUARD_SHA:
        raise RecoveryBlocked("PINNED_GUARD_MISMATCH")
    scope = {"__name__": "gpt02_inert_closeonly_verified_guard",
             "__file__": str(GUARD)}
    # The guard itself verifies/compiles the existing SHA-pinned boot checker.
    # __name__ is NOT __main__: its CLI is never invoked by loading the source.
    exec(compile(src, str(GUARD), "exec"), scope)
    if not all(callable(scope.get(name)) for name in
               ("checked", "permitted_open_to_closed")):
        raise RecoveryBlocked("GUARD_PURE_API_MISSING")
    return scope


def recovery_plan(guard: dict, active: bytes, backup: bytes | None) -> str:
    """Pure function using exact installed canonical guard, never weaker rules."""
    if guard["checked"](active):
        if backup is None:
            return "CLOSED_NO_BACKUP_VERIFY_EFFECTIVE_503"
        if not guard["checked"](backup) or backup != active:
            raise RecoveryBlocked("BACKUP_AND_CLOSED_SITE_MISMATCH")
        # Even if disk looks closed, running Nginx may still use opened config.
        return "CLOSED_WITH_BACKUP_RELOAD_AND_VERIFY"
    if backup is None:
        raise RecoveryBlocked("OPEN_SITE_WITHOUT_APPROVED_BACKUP")
    if not guard["checked"](backup):
        raise RecoveryBlocked("BACKUP_NOT_CANONICAL")
    try:
        exact_closed = guard["permitted_open_to_closed"](active)
    except Exception:
        raise RecoveryBlocked("OPEN_SITE_NOT_EXACTLY_RESTORABLE") from None
    if exact_closed != backup:
        raise RecoveryBlocked("BACKUP_DOES_NOT_MATCH_OPEN_SITE")
    return "OPEN_SITE_RESTORE_APPROVED_GUARD"


def capture_evidence() -> tuple[str, bytes]:
    guard = pinned_guard()
    # Mode 0644 on the currently active shared DEV vhost; never follow link.
    active = read_root_file(ACTIVE, 0o644, MAX_SITE)
    backup: bytes | None
    try:
        BACKUP.lstat()
    except FileNotFoundError:
        backup = None
    else:
        backup = read_root_file(BACKUP, 0o600, MAX_SITE)
    return recovery_plan(guard, active, backup), active


def verify_live_503() -> bool:
    """Authoritative local Nginx HTTPS response; no cookies/bearers/sessions."""
    result = subprocess.run([
        "curl", "--noproxy", "*", "-sS", "--http1.1",
        "--connect-timeout", "3", "--max-time", "5",
        "--resolve", "dev-ai-task.cstlogistic.co.id:443:127.0.0.1",
        "-i", CLOSED_URL,
    ], capture_output=True, timeout=8, check=False)
    if result.returncode or len(result.stdout) > 8192:
        return False
    wire = result.stdout.replace(b"\r\n", b"\n")
    if b"\n\n" not in wire:
        return False
    header, body = wire.split(b"\n\n", 1)
    lines = header.split(b"\n")
    return (
        bool(lines) and lines[0].startswith(b"HTTP/1.1 503 ")
        and any(line.lower().strip() == b"cache-control: no-store"
                for line in lines[1:])
        and any(line.lower().startswith(b"content-type: application/json")
                for line in lines[1:])
        and body.strip() == b'{"error":"GPT02_LEDGER_READER_NOT_PROVISIONED"}'
    )


def run_existing_restore() -> bool:
    """Delegate to the pinned guard CLI, which serializes on the sealed backup."""
    result = subprocess.run([
        "/usr/bin/python3", str(GUARD), "--restore",
        "--active", str(ACTIVE), "--backup", str(BACKUP),
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        timeout=60, check=False)
    return result.returncode == 0


def close_only() -> dict:
    plan, before = capture_evidence()
    should_restore = plan != "CLOSED_NO_BACKUP_VERIFY_EFFECTIVE_503"
    # The primary close-only guard leaves its sealed backup for audit. If it
    # already restored the exact closed file AND live HTTPS is 503/no-store,
    # the later independent fallback must NOT reload shared Nginx a second time.
    if plan == "CLOSED_WITH_BACKUP_RELOAD_AND_VERIFY" and verify_live_503():
        should_restore = False
    if should_restore and not run_existing_restore():
        raise RecoveryBlocked("EXISTING_RESTORE_GUARD_FAILED")
    after_plan, after = capture_evidence()
    if after_plan not in (
        "CLOSED_NO_BACKUP_VERIFY_EFFECTIVE_503",
        "CLOSED_WITH_BACKUP_RELOAD_AND_VERIFY",
    ):
        raise RecoveryBlocked("SITE_NOT_CLOSED_AFTER_RESTORE")
    if (plan == "CLOSED_NO_BACKUP_VERIFY_EFFECTIVE_503" and after != before):
        raise RecoveryBlocked("CLOSED_SITE_CHANGED_DURING_AUDIT")
    if not verify_live_503():
        raise RecoveryBlocked("EFFECTIVE_HTTPS_503_NOT_VERIFIED")
    return {
        "scope": "GPT02-1782-CST-DEV",
        "recovery": "EXACT_CLOSED_503_VERIFIED",
        "existing_guard_invoked": should_restore,
        "active_target": "sites-enabled",
        "nginx_http503_json_no_store": True,
        "source_approved_closed_sha256": hashlib.sha256(after).hexdigest(),
        "watcher_timer_resumed": False,
        "reader_sessions_verified": False,
        "owner_http404_e2e_verified": False,
        "owner_authorization_granted": False,
        "action": "KEEP_GATE_CLOSED",
    }


def main() -> int:
    if os.geteuid() != 0 or os.getegid() != 0:
        print('{"recovery":"BLOCKED","reason":"ROOT_REQUIRED"}')
        return 2
    if sys.argv[1:] not in (["--check"], ["--close-only"]):
        print('{"recovery":"BLOCKED","reason":"MODE_NOT_APPROVED"}')
        return 2
    if sys.argv[1:] == ["--close-only"] and (
        os.environ.get("INVOCATION_ID", "") == "" or
        os.environ.get("GPT02_CLOSE_ONLY_RECOVERY_ENABLED") != "true"
    ):
        print('{"recovery":"BLOCKED","reason":"SYSTEMD_APPROVAL_REQUIRED"}')
        return 2
    try:
        if sys.argv[1:] == ["--check"]:
            plan, _ = capture_evidence()
            print(json.dumps({
                "recovery": "SOURCE_CHECK_ONLY", "plan": plan,
                "live_503_verified_by_this_check": False,
                "restoration_executed": False,
                "watcher_timer_resumed": False,
                "ready_to_open": False,
            }, sort_keys=True, separators=(",", ":")))
            return 2
        print(json.dumps(close_only(), sort_keys=True, separators=(",", ":")))
        return 0
    except Exception as exc:
        reason = str(exc) if isinstance(exc, RecoveryBlocked) else "UNEXPECTED_ERROR"
        print(json.dumps({
            "recovery": "BLOCKED", "reason": reason[:90],
            "watcher_timer_resumed": False, "ready_to_open": False,
        }, sort_keys=True, separators=(",", ":")))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
