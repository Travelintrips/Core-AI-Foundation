#!/usr/bin/env python3
"""CST-DEV GPT02-1782 negative Owner Ledger window v10: INERT safety preflight.

This tool has NO executor mode and NEVER opens Nginx, arms a timer, changes
database roles, authenticates a reader, invokes an issuer, or pauses deployment.
It reuses the merged public Ed25519 custody verifier and SHA-pinned Nginx
canonical checker; it also detects the active shared-DEV deploy watcher.
Even a fully green public report CANNOT certify a current signed Owner browser
or one-use Owner authorization. Always retain the existing HTTP503 gate.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

from gpt02_owner_ledger_fresh_readiness_readonly import inspect as public_inspect

HOST = "srv1792369"
PROJECT = "xssrfshdrtdfupgqwfdw"
RESTORE_GUARD = Path("/usr/local/sbin/gpt02_owner_ledger_nginx_restore_guard.py")
RESTORE_SHA256 = "64d22f49263fe44e80809b3ba61f4020bc8bd84509723e957065cb1fccabcf13"
WATCHER_TIMER = "cst-vps-dev-ci-watcher.timer"
WATCHER_SERVICE = "cst-vps-dev-ci-watcher.service"
ROLLBACK_TIMER = "gpt02-1782-owner-ledger-restore.timer"
ALLOWED_UNIT_STATES = frozenset(("active", "inactive", "failed", "activating", "deactivating", "not-found"))


class ReadonlyDenied(RuntimeError):
    pass


def root_guard_verified(path: Path = RESTORE_GUARD) -> bool:
    """Hash only the fixed root-owned PUBLIC script; never import/run its CLI."""
    try:
        if path.is_symlink():
            return False
        meta = path.lstat()
        if (not stat.S_ISREG(meta.st_mode) or meta.st_uid != 0 or
            meta.st_gid != 0 or meta.st_nlink != 1 or
            stat.S_IMODE(meta.st_mode) != 0o700 or
            not 0 < meta.st_size <= 20_000):
            return False
        data = path.read_bytes()
        if len(data) != meta.st_size:
            return False
        return hashlib.sha256(data).hexdigest() == RESTORE_SHA256
    except OSError:
        return False


def read_unit_state(name: str) -> str:
    """Only systemctl SHOW is allowed; never start, stop, reload or reset."""
    if name not in (WATCHER_TIMER, WATCHER_SERVICE, ROLLBACK_TIMER):
        raise ReadonlyDenied("UNKNOWN_UNIT")
    result = subprocess.run(
        ["systemctl", "show", name, "--property=ActiveState", "--value"],
        capture_output=True, timeout=6, check=False,
    )
    if result.returncode != 0:
        raise ReadonlyDenied("SYSTEMD_UNAVAILABLE")
    state = result.stdout.decode("ascii", errors="strict").strip()
    if state not in ALLOWED_UNIT_STATES:
        raise ReadonlyDenied("SYSTEMD_STATE_UNRECOGNIZED")
    return state


def evaluate(public: dict, guard_verified: bool, units: dict[str, str]) -> dict:
    """Pure fail-closed contract; fixture data cannot grant E2E authority."""
    watcher_timer_active = units.get(WATCHER_TIMER) == "active"
    watcher_service_idle = units.get(WATCHER_SERVICE) == "inactive"
    rollback_idle = units.get(ROLLBACK_TIMER) in ("inactive", "not-found")
    # A FAILed deployment service is not idle, even if it appears stopped.
    watcher_paused = units.get(WATCHER_TIMER) == "inactive" and watcher_service_idle
    public_current = (
        public.get("readiness") == "PUBLIC_EVIDENCE_CURRENT_ONLY"
        and public.get("public_custody_current") is True
        and public.get("worker_current_4min") is True
        and public.get("issuer_current_4min") is True
        and public.get("issuer_worker_binding_valid") is True
        and public.get("boot_guard_sha") is True
        and public.get("closed_vhost_sha") is True
        and public.get("exactly_one_closed_gate") is True
        and public.get("rollback_backup_absent") is True
        and public.get("dba_preparation_off") is True
        and public.get("live_e2e_ready") is False
        and public.get("action") == "RETAIN_NGINX_503"
    )
    outstanding = []
    if not guard_verified:
        outstanding.append("ROOT_RESTORE_GUARD_SHA_UNVERIFIED")
    if not public_current:
        outstanding.append("CUSTODY_OR_CLOSED_SITE_NOT_CURRENT")
    if watcher_timer_active or not watcher_paused:
        outstanding.append("DEV_CI_WATCHER_NOT_PAUSED")
    if not rollback_idle:
        outstanding.append("RESTORE_TIMER_NOT_IDLE")
    # These facts must come from independent live authorization, real DB and
    # the signed Owner browser, NEVER from public receipt metadata.
    outstanding.extend((
        "FRESH_ONE_USE_OWNER_AUTHORIZATION_NOT_VERIFIED",
        "LIVE_DEDICATED_READER_LEASE_AND_LOGIN_NOT_VERIFIED",
        "FRESH_SIGNED_OWNER_BROWSER_NOT_VERIFIED",
        "NEGATIVE_HTTP404_JSON_NOT_VERIFIED",
    ))
    return {
        "scope": "GPT02-1782-CST-DEV",
        "public_custody_current": public_current,
        "root_restore_guard_sha": guard_verified,
        "dev_ci_watcher_timer_active": watcher_timer_active,
        "dev_ci_watcher_paused": watcher_paused,
        "dev_ci_watcher_service_idle": watcher_service_idle,
        "rollback_timer_idle": rollback_idle,
        "live_reader_login_verified": False,
        "fresh_one_use_owner_authorization_verified": False,
        "signed_owner_browser_freshness_verified": False,
        "negative_http404_verified": False,
        "ready_to_arm": False,
        "live_e2e_ready": False,
        "readiness": "BLOCKED",
        "action": "RETAIN_NGINX_503",
        "unresolved": outstanding,
    }


def inspect() -> dict:
    if os.geteuid() != 0 or os.getegid() != 0 or sys.argv[1:]:
        return evaluate({}, False, {})
    try:
        # This imported public checker has fixed root-owned PUBLIC input paths
        # and never authenticates a database reader or opens the Nginx gate.
        public = public_inspect()
        guard = root_guard_verified()
        states = {name: read_unit_state(name) for name in
                  (WATCHER_TIMER, WATCHER_SERVICE, ROLLBACK_TIMER)}
        return evaluate(public, guard, states)
    except (OSError, ValueError, ReadonlyDenied, subprocess.SubprocessError):
        return evaluate({}, False, {})


def main() -> int:
    result = inspect()
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 2  # Inert preflight is NEVER the live authorization gate.


if __name__ == "__main__":
    raise SystemExit(main())
