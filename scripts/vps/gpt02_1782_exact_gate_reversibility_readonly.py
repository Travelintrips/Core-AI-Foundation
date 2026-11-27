#!/usr/bin/env python3
"""GPT02-1782 CST-DEV: review exact GET gate open -> restore, WITHOUT doing it.

SOURCE-ONLY. This diagnostic never modifies the vhost, invokes Nginx,
runs systemd, renews the reader, reads credentials, or accepts --execute.
The installed, SHA-pinned PR1858 restore guard is compiled as an inert module
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
RESTORE_SHA256 = "3851912fcb62423b3f54630e901b6ffda8824009f8e4460a0fdb1ecbf5b486e9"
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


def inspect_deploy_quiescence() -> dict:
    """Reuse the merged, inert v10 policy to check the watcher and proof status.

    No systemd change and no lock acquisition. Even an idle snapshot cannot
    grant a freeze lasting through a future shared-DEV test.
    """
    import gpt02_1782_negative_window_v10_readonly as v10
    public = v10.public_inspect()
    states = {name: v10.read_unit_state(name) for name in
              (v10.WATCHER_TIMER, v10.WATCHER_SERVICE, v10.ROLLBACK_TIMER)}
    result = v10.evaluate(public, v10.root_guard_verified(), states)
    if (result.get("action") != "RETAIN_NGINX_503"
        or result.get("ready_to_arm") is not False
        or result.get("live_e2e_ready") is not False
        or not isinstance(result.get("unresolved"), list)):
        raise NotApproved("V10_DEPLOY_POLICY_UNEXPECTED")
    return result


def add_quiescence_snapshot(evidence: dict, v10: dict) -> dict:
    """Expose only bounded public booleans and static fail-closed blockers."""
    if (not isinstance(v10, dict) or
        v10.get("action") != "RETAIN_NGINX_503"
        or v10.get("ready_to_arm") is not False
        or v10.get("live_e2e_ready") is not False):
        raise NotApproved("V10_SAFETY_AUTHORITY_INVALID")
    blockers = v10.get("unresolved")
    if (not isinstance(blockers, list)
        or len(blockers) > 12
        or any(not isinstance(v, str) or
               len(v) > 80 or not v.isupper() or
               any(ch not in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_" for ch in v)
               for v in blockers)):
        raise NotApproved("V10_BLOCKER_REPORT_INVALID")
    return {
        **evidence,
        "dev_ci_watcher_paused_snapshot": v10.get("dev_ci_watcher_paused") is True,
        "dev_ci_watcher_service_idle_snapshot": v10.get("dev_ci_watcher_service_idle") is True,
        "public_custody_current_snapshot": v10.get("public_custody_current") is True,
        "rollback_timer_idle_snapshot": v10.get("rollback_timer_idle") is True,
        "v10_unresolved": blockers,
        "ready_to_open": False,
        "live_e2e_ready": False,
        "action": "RETAIN_NGINX_503",
    }


RECOVERY_REVIEW_TRUE_FIELDS = (
    "nginx_config_exact_restored",
    "nginx_syntax_pass",
    "loopback_http503_json_no_store",
    "guard_rollback_timer_inactive",
    "guard_backup_cleaned_after_verification",
    "dedicated_reader_expired",
    "shared_dev_release_service_idle",
    "watcher_timer_currently_inactive",
    "watcher_timer_was_active_before_test",
    "no_unknown_shared_nginx_edits",
)


def assess_watcher_recovery_contract(observed: dict) -> dict:
    """Pure proposed post-window recovery acceptance, never control systemd.

    The evidence must eventually be gathered independently by an authorized
    operator; arbitrary provided booleans are NOT live attestation.
    This reviewer cannot re-enable the watcher itself, even if all flags pass.
    """
    if not isinstance(observed, dict):
        observed = {}
    missing = [
        name for name in RECOVERY_REVIEW_TRUE_FIELDS
        if observed.get(name) is not True
    ]
    sessions = observed.get("dedicated_reader_active_sessions")
    if type(sessions) is not int or sessions != 0:
        missing.append("dedicated_reader_active_sessions_zero")
    return {
        "recovery_review": "CANDIDATE_ONLY" if not missing else "BLOCKED",
        "missing": missing,
        "review_is_live_attestation": False,
        "watcher_resumed": False,
        "nginx_reloaded": False,
        "reader_lease_modified": False,
        "action": "NO_HOST_OPERATION",
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
        evidence = add_quiescence_snapshot(evidence, inspect_deploy_quiescence())
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
