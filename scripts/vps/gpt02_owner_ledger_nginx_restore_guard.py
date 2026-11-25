#!/usr/bin/env python3
"""Restore the GPT02-1782 DEV Nginx GET gate after a bounded owner-ledger test.

This tool NEVER opens the gate, accesses credentials, or changes PostgreSQL.
Use --arm to register an independent systemd transient rollback timer BEFORE any test.
Only the single exact, approved gate-line removal is accepted as a restore input.
"""
from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile

NGINX = Path("/etc/nginx/sites-available/dev-ai-task.cstlogistic.co.id")
BACKUP = Path("/etc/nginx/dev-ai-task.gpt02-1782-guard-backup.conf")
GATE = b"""return 503 '{"error":"GPT02_LEDGER_READER_NOT_PROVISIONED"}';"""
LOCATION = b"location ^~ /api/gpt02-owner-ledger/ {"
PROXY = b"proxy_pass http://127.0.0.1:18082;"
# Only this exact replacement is allowed when restoring.
COMMENT = b"# GPT02-1782 bounded Owner GET test: automatic rollback armed"


class GuardError(RuntimeError):
    pass


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def checked(data: bytes) -> bool:
    return data.count(GATE) == 1 and data.count(LOCATION) == 1 and data.count(PROXY) >= 1


def atomic_root_write(path: Path, data: bytes, mode: int) -> None:
    fd, temp = tempfile.mkstemp(prefix=".gpt02-gate-", dir=str(path.parent))
    try:
        os.fchmod(fd, mode)
        os.write(fd, data)
        os.fsync(fd)
        os.close(fd)
        fd = -1
        os.replace(temp, path)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if fd >= 0:
            os.close(fd)
        if os.path.exists(temp):
            os.unlink(temp)


def prepare(active: Path, backup: Path) -> str:
    if backup.exists() or backup.is_symlink():
        raise GuardError("BACKUP_EXISTS")
    if active.is_symlink() or not active.is_file():
        raise GuardError("ACTIVE_NOT_REGULAR")
    data = active.read_bytes()
    if not checked(data):
        raise GuardError("BASELINE_GATE_INVALID")
    if len(data) > 200_000:
        raise GuardError("ACTIVE_TOO_LARGE")
    # O_EXCL prevents silently replacing an operator's older guard backup.
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(fd, 0o600)
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)
    parent = os.open(backup.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)
    return digest(data)


def run_maintenance(test_cmd: list[str], reload_cmd: list[str]) -> None:
    for argv in (test_cmd, reload_cmd):
        proc = subprocess.run(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              timeout=20, check=False)
        if proc.returncode != 0:
            raise GuardError("NGINX_TEST_OR_RELOAD_FAILED")


def restore(active: Path, backup: Path, test_cmd: list[str],
            reload_cmd: list[str]) -> str:
    if active.is_symlink() or backup.is_symlink():
        raise GuardError("SYMLINK_REFUSED")
    if not active.is_file() or not backup.is_file():
        raise GuardError("MISSING_GUARD_FILES")
    old = backup.stat()
    if not stat.S_ISREG(old.st_mode) or old.st_size > 200_000:
        raise GuardError("INVALID_BACKUP")
    original = backup.read_bytes()
    current = active.read_bytes()
    if not checked(original):
        raise GuardError("UNTRUSTED_BACKUP_GATE")
    if current == original:
        return "ALREADY_CLOSED"
    # Restore only if this single exact gate removal took place.
    if current != original.replace(GATE, COMMENT, 1):
        raise GuardError("UNEXPECTED_NGINX_CHANGE_REFUSED")
    mode = stat.S_IMODE(active.stat().st_mode)
    atomic_root_write(active, original, mode)
    run_maintenance(test_cmd, reload_cmd)
    if active.read_bytes() != original:
        raise GuardError("RESTORE_READBACK_MISMATCH")
    return "RESTORED_GATE_CLOSED"


def trusted_script(executable: Path) -> bool:
    if not executable.is_absolute() or executable.is_symlink() or not executable.is_file():
        return False
    identity = executable.stat()
    return identity.st_uid == 0 and not (stat.S_IMODE(identity.st_mode) & 0o022)


def arm(active: Path, backup: Path, delay_seconds: int, executable: Path) -> str:
    """Create an independent transient timer BEFORE the operator removes the gate.

    The timer's command only restores. Timer execution is not a permanent
    boot-persistent guard; do not open the gate if arming/verification fails.
    """
    if delay_seconds < 30 or delay_seconds > 180:
        raise GuardError("WATCHDOG_DURATION_INVALID")
    if not trusted_script(executable):
        raise GuardError("UNTRUSTED_GUARD_PATH")
    fingerprint = prepare(active, backup)
    unit = "gpt02-1782-owner-ledger-restore"
    args = [
        "systemd-run", "--unit=" + unit, "--on-active=" +
        str(delay_seconds) + "s", "--collect",
        "/usr/bin/python3", str(executable), "--restore",
        "--active", str(active), "--backup", str(backup),
    ]
    scheduled = subprocess.run(args, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=15,
                               check=False)
    if scheduled.returncode != 0:
        raise GuardError("WATCHDOG_SCHEDULE_FAILED")
    confirmed = subprocess.run(["systemctl", "is-active", "--quiet",
                                unit + ".timer"], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=10,
                               check=False)
    if confirmed.returncode != 0:
        raise GuardError("WATCHDOG_NOT_ARMED")
    return "WATCHDOG_ARMED sha256=" + fingerprint


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--restore", action="store_true")
    parser.add_argument("--arm", action="store_true")
    parser.add_argument("--delay-seconds", type=int, default=90)
    parser.add_argument("--active", type=Path, default=NGINX)
    parser.add_argument("--backup", type=Path, default=BACKUP)
    args = parser.parse_args()
    if sum((args.prepare, args.restore, args.arm)) != 1:
        parser.error("Choose exactly one of --prepare, --restore or --arm")
    if os.geteuid() != 0:
        print("GPT02_GUARD=BLOCKED_ROOT_REQUIRED", file=sys.stderr)
        return 2
    try:
        if args.arm:
            print("GPT02_GUARD=" + arm(args.active, args.backup, args.delay_seconds,
                                      Path(__file__).resolve()))
        elif args.prepare:
            print("GPT02_GUARD=BACKUP_READY sha256=" + prepare(args.active, args.backup))
        else:
            outcome = restore(args.active, args.backup, ["nginx", "-t"],
                              ["systemctl", "reload", "nginx"])
            print("GPT02_GUARD=" + outcome)
        return 0
    except (GuardError, OSError, subprocess.SubprocessError) as exc:
        code = str(exc) if isinstance(exc, GuardError) else "SYSTEM_OPERATION_FAILED"
        print("GPT02_GUARD=BLOCKED " + code, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
