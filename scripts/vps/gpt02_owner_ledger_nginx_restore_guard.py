#!/usr/bin/env python3
"""Restore the GPT02-1782 DEV Nginx GET gate after a bounded owner-ledger test.

This tool NEVER opens the gate, accesses credentials, or changes PostgreSQL.
Use --arm to register an independent systemd transient rollback timer BEFORE any test.
Only an exact gate-to-comment change and the four previously verified
unrelated upstream cutovers are accepted; unknown changes fail closed.
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

# The installed systemd ExecStartPre filename uses hyphens, not the module
# underscores used by the GitHub source tree. Load the PINNED bytes from that
# exact existing root-owned file in production; do NOT deploy a second copy.
LIVE_RESTORE = Path("/usr/local/sbin/gpt02_owner_ledger_nginx_restore_guard.py")
LIVE_BOOT = Path("/usr/local/sbin/gpt02-1782-failclosed-boot-precheck.py")
BOOT_SOURCE_SHA256 = "26ea880f87b4eed5dea9cda0bd907b03711262abe470cde65b6c2e8e4b4b0e32"
MAX_BOOT_SOURCE = 8192


def boot_source_path(restore_script: Path) -> tuple[Path, bool]:
    """Resolve exact installed hyphen filename vs source-tree sibling."""
    if restore_script.is_symlink():
        raise RuntimeError("RESTORE_SCRIPT_SYMLINK")
    resolved = restore_script.absolute()
    if resolved.name != "gpt02_owner_ledger_nginx_restore_guard.py":
        raise RuntimeError("RESTORE_SCRIPT_UNEXPECTED_PATH")
    if resolved == LIVE_RESTORE:
        return LIVE_BOOT, True
    return resolved.with_name("gpt02_1782_failclosed_boot_precheck.py"), False


def load_pinned_boot_canonical(source_path: Path, live: bool):
    """Verify file metadata and SHA BEFORE compiling the read bytes.

    Compiling the same byte buffer avoids hash-then-import filesystem races.
    The module's main block never runs; no service or Nginx is invoked.
    """
    fd = None
    try:
        fd = os.open(source_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or
            not 0 < before.st_size <= MAX_BOOT_SOURCE):
            raise RuntimeError("BOOT_MODULE_FILE_INVALID")
        if live and (before.st_uid != 0 or before.st_gid != 0 or
                     stat.S_IMODE(before.st_mode) != 0o700):
            raise RuntimeError("BOOT_MODULE_ROOT0700_REQUIRED")
        source_bytes = os.read(fd, MAX_BOOT_SOURCE + 1)
        after = os.fstat(fd)
        fields = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
        if len(source_bytes) != before.st_size or any(
            getattr(before, field) != getattr(after, field) for field in fields
        ):
            raise RuntimeError("BOOT_MODULE_CHANGED_DURING_READ")
        if hashlib.sha256(source_bytes).hexdigest() != BOOT_SOURCE_SHA256:
            raise RuntimeError("BOOT_MODULE_SHA_NOT_APPROVED")
        scope = {"__name__": "gpt02_verified_boot_from_pinned_bytes",
                 "__file__": str(source_path)}
        exec(compile(source_bytes, str(source_path), "exec"), scope)
        value = scope.get("canonical_closed")
        if not callable(value):
            raise RuntimeError("BOOT_MODULE_CONTRACT_UNAVAILABLE")
        return value
    except (OSError, ValueError) as exc:
        raise RuntimeError("BOOT_MODULE_UNAVAILABLE") from None
    finally:
        if fd is not None:
            os.close(fd)


_BOOT_SOURCE, _LIVE_RUNTIME = boot_source_path(Path(__file__))
canonical_closed = load_pinned_boot_canonical(_BOOT_SOURCE, _LIVE_RUNTIME)

NGINX = Path("/etc/nginx/sites-available/dev-ai-task.cstlogistic.co.id")
BACKUP = Path("/etc/nginx/dev-ai-task.gpt02-1782-guard-backup.conf")
GATE = b"""return 503 '{"error":"GPT02_LEDGER_READER_NOT_PROVISIONED"}';"""
LOCATION = b"location ^~ /api/gpt02-owner-ledger/ {"
PROXY = b"proxy_pass http://127.0.0.1:18082;"
# Only this exact replacement is allowed when restoring.
COMMENT = b"# GPT02-1782 bounded Owner GET test: automatic rollback armed"
PUBLIC_GATE_URL = "https://dev-ai-task.cstlogistic.co.id/api/gpt02-owner-ledger/decision/00000000-0000-4000-8000-000000000000"

# The observed systemd 255 default AccuracySec=1min makes a timer due at 90s
# unsuitable as a <=90-second closeout bound. Start MUCH earlier. Model only:
# 30s due + 1s Accuracy + 20s nginx -t + 20s reload + 7s HTTPS verify
# + 6s operational margin = 84s. Scheduling latency remains unbounded under
# host failure; this source change is NOT itself an E2E or hard real-time proof.
PRIMARY_RESTORE_DELAY_SECONDS = 30
PRIMARY_TIMER_ACCURACY = "1s"
PRIMARY_TIMER_RANDOMIZED_DELAY = "0"



class GuardError(RuntimeError):
    pass


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def checked(data: bytes) -> bool:
    # Reuse the full-vhost allowlist verifier from the sibling boot guard.
    return canonical_closed(data)

def permitted_open_to_closed(data: bytes) -> bytes:
    """Return closed bytes only for the exact allowed gate-to-comment opening."""
    if data.count(GATE) != 0 or data.count(COMMENT) != 1:
        raise GuardError("UNEXPECTED_NGINX_CHANGE_REFUSED")
    closed = data.replace(COMMENT, GATE, 1)
    if not checked(closed):
        raise GuardError("UNEXPECTED_NGINX_CHANGE_REFUSED")
    return closed


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


def verify_public_gate_closed() -> None:
    """Read-only local HTTPS confirmation after a successful Nginx reload.

    Never forwards credentials. The public 503 JSON and no-store header
    are mandatory; a saved file alone cannot prove active workers are closed.
    """
    args = [
        "curl", "--noproxy", "*", "-sS", "--http1.1", "--connect-timeout", "3",
        "--max-time", "5", "--resolve",
        "dev-ai-task.cstlogistic.co.id:443:127.0.0.1",
        "-i", PUBLIC_GATE_URL,
    ]
    response = subprocess.run(
        args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        timeout=7, check=False,
    )
    if response.returncode != 0 or len(response.stdout) > 8192:
        raise GuardError("PUBLIC_GATE_NOT_VERIFIED_503")
    raw = response.stdout.replace(b"\r\n", b"\n")
    if b"\n\n" not in raw:
        raise GuardError("PUBLIC_GATE_NOT_VERIFIED_503")
    headers, body = raw.split(b"\n\n", 1)
    lines = headers.split(b"\n")
    if (not lines or not lines[0].startswith(b"HTTP/1.1 503 ") or
        not any(x.lower().strip() == b"cache-control: no-store" for x in lines[1:]) or
        b"content-type: application/json" not in headers.lower() or
        body.strip() != b'{"error":"GPT02_LEDGER_READER_NOT_PROVISIONED"}'):
        raise GuardError("PUBLIC_GATE_NOT_VERIFIED_503")

def restore(active: Path, backup: Path, test_cmd: list[str],
            reload_cmd: list[str]) -> str:
    if active.is_symlink() or backup.is_symlink():
        raise GuardError("SYMLINK_REFUSED")
    if not active.is_file() or not backup.is_file():
        raise GuardError("MISSING_GUARD_FILES")
    old = backup.stat()
    if (not stat.S_ISREG(old.st_mode) or old.st_uid != 0 or
        old.st_gid != 0 or stat.S_IMODE(old.st_mode) != 0o600 or
        old.st_nlink != 1 or not 0 < old.st_size <= 200_000):
        raise GuardError("INVALID_BACKUP")
    original = backup.read_bytes()
    current = active.read_bytes()
    if not checked(original):
        raise GuardError("UNTRUSTED_BACKUP_GATE")
    if checked(current):
        # File may already be closed while the running Nginx worker still serves
        # the old open configuration (e.g. earlier reload failed). Reconcile.
        run_maintenance(test_cmd, reload_cmd)
        if active.read_bytes() != current:
            raise GuardError("RESTORE_READBACK_MISMATCH")
        verify_public_gate_closed()
        return "ALREADY_CLOSED_RELOADED_VERIFIED"
    closed = permitted_open_to_closed(current)
    # Conservative re-read before replace. A separately coordinated short
    # Nginx deployment freeze is still required; not an atomic filesystem CAS.
    if active.read_bytes() != current:
        raise GuardError("ACTIVE_CHANGED_BEFORE_RESTORE")
    mode = stat.S_IMODE(active.stat().st_mode)
    atomic_root_write(active, closed, mode)
    run_maintenance(test_cmd, reload_cmd)
    if active.read_bytes() != closed:
        raise GuardError("RESTORE_READBACK_MISMATCH")
    verify_public_gate_closed()
    return "RESTORED_GATE_CLOSED_VERIFIED"

def trusted_script(executable: Path) -> bool:
    if not executable.is_absolute() or executable.is_symlink() or not executable.is_file():
        return False
    identity = executable.stat()
    return identity.st_uid == 0 and not (stat.S_IMODE(identity.st_mode) & 0o022)


def verify_armed_timer_properties(unit: str) -> None:
    """Read actual PID1 timer properties, not just an `is-active` boolean.

    In systemd 255, an unpinned timer inherits AccuracySec=1min. Reject that
    (and randomized delay) before the operator may change the Nginx gate.
    """
    timer = unit + ".timer"
    command = [
        "systemctl", "show", timer,
        "--property=ActiveState", "--property=AccuracyUSec",
        "--property=RandomizedDelayUSec", "--property=Unit", "--no-pager",
    ]
    state = subprocess.run(command, stdout=subprocess.PIPE,
                           stderr=subprocess.DEVNULL, timeout=10,
                           check=False)
    if state.returncode != 0 or len(state.stdout) > 4096:
        raise GuardError("WATCHDOG_PROPERTIES_UNVERIFIED")
    try:
        fields = {}
        for item in state.stdout.decode("ascii", errors="strict").splitlines():
            if "=" not in item:
                raise ValueError()
            key, value = item.split("=", 1)
            if key in fields:
                raise ValueError()
            fields[key] = value
    except (UnicodeError, ValueError):
        raise GuardError("WATCHDOG_PROPERTIES_UNVERIFIED") from None
    expected = {
        "ActiveState": "active",
        "AccuracyUSec": PRIMARY_TIMER_ACCURACY,
        "RandomizedDelayUSec": PRIMARY_TIMER_RANDOMIZED_DELAY,
        "Unit": unit + ".service",
    }
    if fields != expected:
        raise GuardError("WATCHDOG_PROPERTIES_UNVERIFIED")


def arm(active: Path, backup: Path, delay_seconds: int, executable: Path) -> str:
    """Arm an EARLY precisely scheduled independent close-only timer.

    Not a real-time guarantee: even with a 30s due time, a failed host or
    delayed Nginx reload can violate 90s. No GET opening is performed here.
    """
    if delay_seconds != PRIMARY_RESTORE_DELAY_SECONDS:
        raise GuardError("WATCHDOG_DURATION_INVALID")
    if not trusted_script(executable):
        raise GuardError("UNTRUSTED_GUARD_PATH")
    fingerprint = prepare(active, backup)
    unit = "gpt02-1782-owner-ledger-restore"
    args = [
        "systemd-run", "--unit=" + unit, "--on-active=" +
        str(delay_seconds) + "s",
        "--timer-property=AccuracySec=" + PRIMARY_TIMER_ACCURACY,
        "--timer-property=RandomizedDelaySec=" + PRIMARY_TIMER_RANDOMIZED_DELAY,
        "--collect", "/usr/bin/python3", str(executable), "--restore",
        "--active", str(active), "--backup", str(backup),
    ]
    scheduled = subprocess.run(args, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=15,
                               check=False)
    if scheduled.returncode != 0:
        raise GuardError("WATCHDOG_SCHEDULE_FAILED")
    verify_armed_timer_properties(unit)
    return "WATCHDOG_ARMED_EARLY_WITH_VERIFIED_ACCURACY sha256=" + fingerprint


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--restore", action="store_true")
    parser.add_argument("--arm", action="store_true")
    parser.add_argument("--delay-seconds", type=int, default=PRIMARY_RESTORE_DELAY_SECONDS)
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
