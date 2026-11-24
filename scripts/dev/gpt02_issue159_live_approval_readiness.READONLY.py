#!/usr/bin/env python3
"""Fail-closed read-only Issue159 approval readiness inventory (DEV only).

Reads only aggregate counts from the existing pinned SQLite approval store.
Never reads approval digests/identities, creates an approval or returns signing,
database credential issuance, dispatch, or release authorization.
This is an observation gate, not a replacement for the persisted-approval
reader, the signed packet verifier, the database RLS gate, or owner approval.

An unexpired row is NECESSARY but NOT SUFFICIENT to issue a reader credential:
the exact command/attempt, signed claim, role, actor, revocation and one-use
transaction must still be independently verified.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import stat
import time
from pathlib import Path

LIVE_DB = "/opt/ai-coding-standalone-dev/tasks.db"
LIVE_PENDING = "/opt/ai-coding-standalone-dev/gpt02_issue159_pending_claims.json"


def readiness(db_path: str, pending_path: str, *, now_ms: int, operational: bool) -> dict:
    outcome = {
        "environment": "DEV",
        "approvalStoreReadable": False,
        "unexpiredApprovalIntents": None,
        "pendingClaimsFilePresent": None,
        "sourceOnlyEvidence": True,
        "credentialIssuancePermitted": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }
    if type(now_ms) is not int or now_ms <= 0:
        return {**outcome, "reason": "SERVER_CLOCK_INVALID"}
    if operational and (db_path != LIVE_DB or pending_path != LIVE_PENDING):
        return {**outcome, "reason": "UNPINNED_LIVE_PATH"}
    try:
        st = os.lstat(db_path)
        if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode):
            return {**outcome, "reason": "INVALID_APPROVAL_STORE_FILE"}
        if operational and (st.st_uid != 0 or st.st_gid != 0
                or stat.S_IMODE(st.st_mode) != 0o600):
            return {**outcome, "reason": "APPROVAL_STORE_CUSTODY_INVALID"}
        con = sqlite3.connect("file:" + db_path + "?mode=ro",
                              uri=True, timeout=2)
        try:
            con.execute("PRAGMA query_only=ON")
            # Only aggregate metadata; no approved row, identity or secret.
            count, latest = con.execute(
                "SELECT count(*), max(task_id) "
                "FROM gpt02_issue159_approval_intents "
                "WHERE decision='APPROVE' AND recorded_at_ms<=? "
                "AND expires_at_ms>?", (now_ms, now_ms)
            ).fetchone()
        finally:
            con.close()
        if not isinstance(count, int) or count < 0:
            return {**outcome, "reason": "INVALID_APPROVAL_COUNT"}
        if count and (not isinstance(latest, int) or latest <= 139):
            return {**outcome, "reason": "INVALID_APPROVAL_TASK"}
        pending = os.path.lexists(pending_path)
        if pending:
            st = os.lstat(pending_path)
            if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode):
                return {**outcome, "reason": "INVALID_PENDING_FILE"}
            if operational and (st.st_uid != 0 or st.st_gid != 0
                    or stat.S_IMODE(st.st_mode) != 0o600):
                return {**outcome, "reason": "INVALID_PENDING_CUSTODY"}
        result = {**outcome, "approvalStoreReadable": True,
                  "unexpiredApprovalIntents": count,
                  "pendingClaimsFilePresent": pending}
        if count == 0:
            return {**result, "reason": "NO_UNEXPIRED_PERSISTED_APPROVAL"}
        # No approval row grants authority by itself, even when fresh.
        return {**result, "reason": "EXACT_SIGNED_SCOPE_AND_CONSUMPTION_UNPROVEN"}
    except (OSError, sqlite3.Error):
        return {**outcome, "reason": "APPROVAL_READBACK_UNAVAILABLE"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=LIVE_DB)
    parser.add_argument("--pending", default=LIVE_PENDING)
    parser.add_argument("--test-mode", action="store_true")
    args = parser.parse_args()
    result = readiness(args.db, args.pending, now_ms=int(time.time() * 1000),
                       operational=not args.test_mode)
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))
    # This inventory is deliberately a NO_GO gate until a reviewed,
    # independently trusted one-use credential issuance chain exists.
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
