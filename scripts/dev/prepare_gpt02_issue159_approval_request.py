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
import time
from pathlib import Path

from gpt02_issue159_approval_intent_contract import validate_approval_claims

LIVE_DB = "/opt/ai-coding-standalone-dev/tasks.db"
LIVE_OUTPUT = "/opt/ai-coding-standalone-dev/gpt02_issue159_pending_claims.json"
UUID = re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")


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
    if not isinstance(task_id, int) or task_id <= 136:
        raise RuntimeError("ISSUE159_TASK_ID_INVALID")
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
            "SELECT user_id FROM admin_identities "
            "WHERE role='super_admin' AND enabled=1 ORDER BY user_id"
        ).fetchall()
    except sqlite3.Error as exc:
        raise RuntimeError("ISSUE159_ACTIVE_SUPER_ADMIN_LOOKUP_FAILED") from exc
    finally:
        con.close()
    if len(admins) != 1:
        raise RuntimeError("ISSUE159_ACTIVE_SUPER_ADMIN_NOT_UNIQUE")
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

    target = Path(output_path)
    parent = target.parent
    parent_stat = os.stat(parent)
    if operational and (parent_stat.st_uid != 0 or parent_stat.st_gid != 0):
        raise RuntimeError("ISSUE159_PENDING_DIRECTORY_OWNER_INVALID")
    tmp = parent / ("." + target.name + ".tmp")
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        payload = (json.dumps({"claims": claims}, sort_keys=True,
                              separators=(",", ":")) + "\n").encode("utf-8")
        os.write(fd, payload)
        os.fsync(fd)
    finally:
        os.close(fd)
    os.chmod(tmp, 0o600)
    if operational:
        os.chown(tmp, 0, 0)
    try:
        os.link(tmp, target)
    except FileExistsError as exc:
        os.unlink(tmp)
        raise RuntimeError("ISSUE159_PENDING_REQUEST_ALREADY_EXISTS") from exc
    os.unlink(tmp)
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
