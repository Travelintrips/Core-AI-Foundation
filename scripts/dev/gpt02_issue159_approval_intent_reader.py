#!/usr/bin/env python3
"""Read-only GPT02 Issue #159 approval intent evidence reader.

Operational mode is pinned to the root-owned 0600 DEV approval SQLite DB.
It never writes SQLite, never loads signer keys, and never permits signing.
"""
from __future__ import annotations
import argparse
import json
import os
import re
import sqlite3
import stat
import sys

LIVE_DB = "/opt/ai-coding-standalone-dev/tasks.db"
UUID = re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")
HEX = re.compile(r"^[0-9a-f]{64}$")
SUBJECT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$")

def denied(reason: str):
    return {
        "environment": "DEV",
        "reason": reason,
        "persistedTrustedReadProven": False,
        "approvalBindingMatched": False,
        "aal2SuperAdminMatched": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }

def _lookup_valid(x):
    return (
        isinstance(x, dict) and
        set(x) == {
            "claimsSha256", "taskId", "commandId", "attemptId",
            "companyId", "superAdminId",
        } and
        isinstance(x["claimsSha256"], str) and HEX.fullmatch(x["claimsSha256"]) and
        isinstance(x["taskId"], int) and x["taskId"] > 136 and
        isinstance(x["commandId"], str) and UUID.fullmatch(x["commandId"]) and
        isinstance(x["attemptId"], str) and UUID.fullmatch(x["attemptId"]) and
        x["commandId"] != x["attemptId"] and
        x["companyId"] == "default" and
        isinstance(x["superAdminId"], str) and SUBJECT.fullmatch(x["superAdminId"]) and
        x["superAdminId"] != "dev_approval_token"
    )

def _secure_file(path, operational):
    st = os.lstat(path)
    if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode):
        return False
    if operational:
        return st.st_uid == 0 and st.st_gid == 0 and stat.S_IMODE(st.st_mode) == 0o600
    return True

def read_approval_intent(db_path: str, lookup: dict, observed_at_ms: int,
                         operational: bool = True):
    if operational and db_path != LIVE_DB:
        return denied("OPERATIONAL_DB_PATH_NOT_PINNED")
    if not _lookup_valid(lookup) or not isinstance(observed_at_ms, int) or observed_at_ms <= 0:
        return denied("APPROVAL_INTENT_LOOKUP_INVALID")
    try:
        if not _secure_file(db_path, operational):
            return denied("APPROVAL_DB_FILE_SECURITY_NOT_VERIFIED")
    except OSError:
        return denied("APPROVAL_DB_NOT_FOUND")

    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA query_only=ON")
        rows = con.execute(
            """
            SELECT i.id AS intent_id,
                   i.source_decision_id,
                   i.task_id,i.command_id,i.attempt_id,i.company_id,
                   i.claims_sha256,i.actor_id,i.auth_method,
                   i.role_at_decision,i.decision,
                   i.recorded_at_ms,i.expires_at_ms,
                   d.decision AS source_decision,
                   d.actor AS source_actor,
                   a.role AS current_admin_role,
                   a.enabled AS current_admin_enabled
            FROM gpt02_issue159_approval_intents i
            JOIN approval_decisions d ON d.id=i.source_decision_id
            JOIN admin_identities a ON a.user_id=i.actor_id
            WHERE i.company_id=?
              AND i.task_id=?
              AND i.command_id=?
              AND i.attempt_id=?
              AND i.claims_sha256=?
              AND i.actor_id=?
            """,
            (
                lookup["companyId"], lookup["taskId"], lookup["commandId"],
                lookup["attemptId"], lookup["claimsSha256"],
                lookup["superAdminId"],
            ),
        ).fetchall()
        if len(rows) != 1:
            return denied("APPROVAL_INTENT_NOT_UNIQUE_OR_MISSING")
        r = rows[0]

        if (
            not UUID.fullmatch(str(r["intent_id"])) or
            not UUID.fullmatch(str(r["source_decision_id"])) or
            r["auth_method"] != "supabase_aal2" or
            r["role_at_decision"] != "super_admin" or
            r["decision"] != "APPROVE" or
            r["source_decision"] != "APPROVE" or
            r["source_actor"] != r["actor_id"] or
            r["actor_id"] == "dev_approval_token" or
            r["current_admin_role"] != "super_admin" or
            r["current_admin_enabled"] != 1
        ):
            return denied("APPROVAL_INTENT_PROVENANCE_MISMATCH")

        recorded = r["recorded_at_ms"]
        expires = r["expires_at_ms"]
        if (
            not isinstance(recorded, int) or not isinstance(expires, int) or
            recorded <= 0 or expires <= recorded or expires - recorded > 300000 or
            observed_at_ms < recorded or observed_at_ms > expires
        ):
            return denied("APPROVAL_INTENT_EXPIRED_OR_INVALID")

        return {
            "environment": "DEV",
            "reason": "TRUSTED_APPROVAL_INTENT_READ_NO_SIGNING_AUTHORITY",
            "decision": {
                "decisionId": r["source_decision_id"],
                "claimsSha256": r["claims_sha256"],
                "actorId": r["actor_id"],
                "authMethod": r["auth_method"],
                "roleAtDecision": r["role_at_decision"],
                "decision": r["decision"],
                "recordedAt": recorded,
            },
            "persistedTrustedReadProven": True,
            "approvalBindingMatched": True,
            "aal2SuperAdminMatched": True,
            "signingPermitted": False,
            "authorizationGranted": False,
            "dispatchPermitted": False,
            "releaseDecision": "NO_GO",
        }
    except sqlite3.Error:
        return denied("APPROVAL_INTENT_READ_FAILED")
    finally:
        try:
            con.close()
        except Exception:
            pass

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--db", default=LIVE_DB)
    p.add_argument("--test-mode", action="store_true")
    p.add_argument("--claims-sha256", required=True)
    p.add_argument("--task-id", required=True, type=int)
    p.add_argument("--command-id", required=True)
    p.add_argument("--attempt-id", required=True)
    p.add_argument("--company-id", default="default")
    p.add_argument("--super-admin-id", required=True)
    p.add_argument("--observed-at-ms", required=True, type=int)
    a = p.parse_args()
    out = read_approval_intent(
        a.db,
        {
            "claimsSha256": a.claims_sha256,
            "taskId": a.task_id,
            "commandId": a.command_id,
            "attemptId": a.attempt_id,
            "companyId": a.company_id,
            "superAdminId": a.super_admin_id,
        },
        a.observed_at_ms,
        operational=not a.test_mode,
    )
    print(json.dumps(out, sort_keys=True))
    return 0 if out.get("persistedTrustedReadProven") is True else 2

if __name__ == "__main__":
    sys.exit(main())
