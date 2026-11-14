#!/usr/bin/env python3
"""Prepare a short-lived DEV Issue159 approval request for an existing task.

This script does NOT create a task, command, attempt, signature, or dispatch.
The supplied identifiers must belong to an already-created real DEV task.
Only one currently active Super Admin may be bound to the request.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import sqlite3
import stat
import sys
import tempfile
import time
from pathlib import Path

try:
    from gpt02_issue159_approval_intent_contract import validate_approval_claims
except ModuleNotFoundError:
    sys.path.insert(
        0, str(Path(__file__).resolve().parents[2] /
               "deploy/ai-coding-standalone-dev")
    )
    from gpt02_issue159_approval_intent_contract import validate_approval_claims

LIVE_DB = "/opt/ai-coding-standalone-dev/tasks.db"
LIVE_OUTPUT = "/opt/ai-coding-standalone-dev/gpt02_issue159_pending_claims.json"
UUID = re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")


def _reject_reused_approval_intent(db_path: str, task_id: int,
                                   command_id: str, attempt_id: str) -> None:
    """A prior approval decision, even expired, cannot be rotated by CLI."""
    try:
        con = sqlite3.connect("file:" + db_path + "?mode=ro",
                              uri=True, timeout=2)
        try:
            con.execute("PRAGMA query_only=ON")
            prior = con.execute(
                "SELECT count(*) FROM gpt02_issue159_approval_intents "
                "WHERE task_id=? OR command_id=? OR attempt_id=?",
                (task_id, command_id, attempt_id),
            ).fetchone()
        finally:
            con.close()
        if prior is None or len(prior) != 1:
            raise RuntimeError("ISSUE159_APPROVAL_REPLAY_READBACK_INVALID")
    except sqlite3.Error as exc:
        raise RuntimeError("ISSUE159_APPROVAL_REPLAY_READBACK_UNAVAILABLE") from exc
    if prior[0] != 0:
        raise RuntimeError("ISSUE159_APPROVAL_INTENT_ALREADY_CONSUMED")


def _require_operational_pre_sign(claims: dict, now_ms: int) -> None:
    """Authenticate independent read-only Hub/Core facts, never caller JSON.

    Import lazily because the refresh module reuses this preparer. Neither
    this helper nor a missing reader can authorize signing or dispatch.
    """
    try:
        from gpt02_issue159_approval_request_refresh import (
            _socket_fact_reader, _verify_pre_sign_facts,
        )
        query = {
            "companyId": claims["companyId"],
            "hubTaskId": claims["taskId"],
            "commandCandidateId": claims["commandId"],
            "attemptId": claims["attemptId"],
        }
        facts = _socket_fact_reader(query)
        preparation_expiry_ms = _verify_pre_sign_facts(facts, claims, now_ms)
        if preparation_expiry_ms < claims["expiresAt"] + 1000:
            raise RuntimeError("ISSUE159_APPROVAL_BEYOND_PREPARATION_EXPIRY")
    except Exception as exc:
        raise RuntimeError("ISSUE159_FRESH_TRUSTED_PRESIGN_REQUIRED") from exc


def prepare(db_path: str, output_path: str, task_id: int,
            command_id: str, attempt_id: str, *, now_ms: int | None = None,
            operational: bool = True) -> dict:
    if operational:
        if db_path != LIVE_DB or output_path != LIVE_OUTPUT or os.geteuid() != 0:
            raise RuntimeError("ISSUE159_PREPARE_TARGET_NOT_PINNED")
        db_stat = os.lstat(db_path)
        if (stat.S_ISLNK(db_stat.st_mode) or not stat.S_ISREG(db_stat.st_mode)
                or db_stat.st_uid != 0 or db_stat.st_gid != 0
                or stat.S_IMODE(db_stat.st_mode) != 0o600):
            raise RuntimeError("ISSUE159_TASK_DB_SECURITY_INVALID")
    else:
        # --test-mode must never emit a real pending approval packet or read
        # the live approval SQLite database, even if invoked as root.
        live_dir = str(Path(LIVE_OUTPUT).parent.resolve())
        db_resolved = str(Path(db_path).resolve())
        output_resolved = str(Path(output_path).resolve())
        if (db_resolved == str(Path(LIVE_DB).resolve())
                or output_resolved == str(Path(LIVE_OUTPUT).resolve())
                or output_resolved.startswith(live_dir + os.sep)):
            raise RuntimeError("ISSUE159_TEST_MODE_LIVE_TARGET_FORBIDDEN")
    if not isinstance(task_id, int) or task_id <= 139:
        raise RuntimeError("ISSUE159_FRESH_TASK_AFTER_139_REQUIRED")
    if (not isinstance(command_id, str) or not UUID.fullmatch(command_id)
            or not isinstance(attempt_id, str) or not UUID.fullmatch(attempt_id)
            or command_id == attempt_id):
        raise RuntimeError("ISSUE159_COMMAND_ATTEMPT_ID_INVALID")
    if os.path.lexists(output_path):
        raise RuntimeError("ISSUE159_PENDING_REQUEST_ALREADY_EXISTS")

    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2)
    try:
        con.execute("PRAGMA query_only=ON")
        admins = con.execute(
            """SELECT l.hub_operator_id
               FROM gpt02_issue159_admin_operator_links l
               JOIN admin_identities a ON a.user_id=l.auth_user_id
               WHERE l.enabled=1 AND a.role='super_admin' AND a.enabled=1
               ORDER BY l.hub_operator_id"""
        ).fetchall()
    except sqlite3.Error as exc:
        raise RuntimeError("ISSUE159_ADMIN_OPERATOR_MAPPING_LOOKUP_FAILED") from exc
    finally:
        con.close()
    if len(admins) != 1:
        raise RuntimeError("ISSUE159_ACTIVE_ADMIN_OPERATOR_MAPPING_NOT_UNIQUE")
    actor_id = admins[0][0]

    if now_ms is None:
        now_ms = int(time.time() * 1000)
    if not isinstance(now_ms, int) or now_ms <= 0:
        raise RuntimeError("ISSUE159_APPROVAL_TIME_INVALID")
    claims = {
        "v": 2,
        "environment": "DEV",
        "audience": "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
        "taskId": task_id,
        "commandId": command_id,
        "attemptId": attempt_id,
        "nonce": secrets.token_urlsafe(33),
        "operatorNamespace": "ai-task-hub.public.users",
        "superAdminId": actor_id,
        "companyId": "default",
        "issuedAt": now_ms,
        "expiresAt": now_ms + 240_000,
    }
    validate_approval_claims(claims)
    if operational:
        # Even an expired persisted approval is one-use: never prepare another
        # packet for its task/command/attempt through the direct CLI.
        _reject_reused_approval_intent(db_path, task_id, command_id, attempt_id)
        # The direct preparer CLI is NOT a substitute for trusted Hub/Core
        # proof. Read the same pinned independent pre-sign-facts socket used
        # by the already-deployed refresh path and bind exact immutable IDs,
        # PIC audit, owner, Core PENDING, zero commands and freshness.
        _require_operational_pre_sign(claims, now_ms)

    target = Path(output_path)
    parent = target.parent
    parent_stat = os.lstat(parent)
    if (not stat.S_ISDIR(parent_stat.st_mode)
            or stat.S_ISLNK(parent_stat.st_mode)
            or (operational and
                (parent_stat.st_uid != 0 or parent_stat.st_gid != 0))):
        raise RuntimeError("ISSUE159_PENDING_DIRECTORY_OWNER_INVALID")
    # A deterministic .tmp name can strand an orphan after a crash and block
    # all later fresh requests. A unique O_EXCL file isolates concurrent
    # preparers, while hard-link publication still refuses to replace a
    # pending request from another process.
    fd, temporary_path = tempfile.mkstemp(
        prefix="." + target.name + ".tmp.", dir=str(parent)
    )
    tmp = Path(temporary_path)
    try:
        try:
            payload = (json.dumps({"claims": claims}, sort_keys=True,
                                  separators=(",", ":")) + "\n").encode("utf-8")
            remaining = memoryview(payload)
            while remaining:
                count = os.write(fd, remaining)
                if count <= 0:
                    raise RuntimeError("ISSUE159_PENDING_FILE_WRITE_INCOMPLETE")
                remaining = remaining[count:]
            os.fsync(fd)
        finally:
            os.close(fd)
        os.chmod(tmp, 0o600)
        if operational:
            os.chown(tmp, 0, 0)
        try:
            os.link(tmp, target)
        except FileExistsError as exc:
            raise RuntimeError("ISSUE159_PENDING_REQUEST_ALREADY_EXISTS") from exc
    finally:
        # This also covers chmod/chown/fsync/link exceptions. Never remove
        # the published target here: its existence is the replay barrier.
        tmp.unlink(missing_ok=True)
    return {
        "environment": "DEV",
        "taskId": task_id,
        "expiresAt": claims["expiresAt"],
        "pendingRequestCreated": True,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-id", required=True, type=int,
                        help="Existing DEV task ID; this command does not create it")
    parser.add_argument("--command-id", required=True)
    parser.add_argument("--attempt-id", required=True)
    parser.add_argument("--test-mode", action="store_true")
    parser.add_argument("--db", default=LIVE_DB)
    parser.add_argument("--output", default=LIVE_OUTPUT)
    args = parser.parse_args()
    result = prepare(
        args.db, args.output, args.task_id, args.command_id, args.attempt_id,
        operational=not args.test_mode,
    )
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(2)
