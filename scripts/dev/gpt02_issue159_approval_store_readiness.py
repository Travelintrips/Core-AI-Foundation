#!/usr/bin/env python3
"""Read-only DEV readiness probe for GPT02 Issue #159 approval intent storage.

Operational mode is pinned to /opt/ai-coding-standalone-dev/tasks.db.
Test mode may pass --db <path>. This script never mutates SQLite and never
prints actor IDs, tokens, claim payloads, or secrets.
"""
from __future__ import annotations
import argparse
import json
import os
import sqlite3
import stat
import sys

LIVE_DB = "/opt/ai-coding-standalone-dev/tasks.db"
TABLE = "gpt02_issue159_approval_intents"

EXPECTED_COLUMNS = [
    ("id", "TEXT", 0, 1),
    ("task_id", "INTEGER", 1, 0),
    ("command_id", "TEXT", 1, 0),
    ("attempt_id", "TEXT", 1, 0),
    ("company_id", "TEXT", 1, 0),
    ("claims_sha256", "TEXT", 1, 0),
    ("actor_id", "TEXT", 1, 0),
    ("auth_method", "TEXT", 1, 0),
    ("role_at_decision", "TEXT", 1, 0),
    ("decision", "TEXT", 1, 0),
    ("recorded_at_ms", "INTEGER", 1, 0),
    ("expires_at_ms", "INTEGER", 1, 0),
]

def result(reason: str, **extra):
    base = {
        "environment": "DEV",
        "databasePath": LIVE_DB,
        "fileOwnerUid": None,
        "fileOwnerGid": None,
        "fileMode": None,
        "fileSecurityVerified": False,
        "legacyDecisionTablePresent": False,
        "approvalIntentTablePresent": False,
        "approvalIntentSchemaExact": False,
        "approvalIntentSelfContainedDecision": False,
        "approvalIntentLookupIndexExact": False,
        "approvalIntentRows": 0,
        "fallbackActorRowsInIntentTable": 0,
        "operationalEvidenceAvailable": False,
        "trustedPersistedReadReady": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
        "reason": reason,
    }
    base.update(extra)
    return base

def inspect(db_path: str, operational: bool = True):
    if operational and db_path != LIVE_DB:
        return result("OPERATIONAL_DB_PATH_NOT_PINNED", databasePath=db_path)
    try:
        st = os.lstat(db_path)
    except OSError:
        return result("APPROVAL_DB_NOT_FOUND", databasePath=db_path)
    if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode):
        return result("APPROVAL_DB_FILE_INVALID", databasePath=db_path)

    mode = stat.S_IMODE(st.st_mode)
    file_secure = st.st_uid == 0 and st.st_gid == 0 and mode == 0o600
    common = {
        "databasePath": db_path,
        "fileOwnerUid": st.st_uid,
        "fileOwnerGid": st.st_gid,
        "fileMode": f"{mode:04o}",
        "fileSecurityVerified": file_secure,
    }
    if operational and not file_secure:
        return result("APPROVAL_DB_FILE_SECURITY_NOT_VERIFIED", **common)

    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2)
        con.execute("PRAGMA query_only=ON")
        tables = {
            r[0] for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        legacy = "approval_decisions" in tables
        if TABLE not in tables:
            return result("ISSUE159_APPROVAL_INTENT_TABLE_MISSING",
                          **common, legacyDecisionTablePresent=legacy)

        cols = [
            (r[1], str(r[2]).upper(), int(r[3]), int(r[5]))
            for r in con.execute(f"PRAGMA table_info({TABLE})")
        ]
        exact = cols == EXPECTED_COLUMNS
        if not exact:
            return result("ISSUE159_APPROVAL_INTENT_SCHEMA_DRIFT",
                          **common,
                          legacyDecisionTablePresent=legacy,
                          approvalIntentTablePresent=True)

        indexes = {}
        for row in con.execute(f"PRAGMA index_list({TABLE})"):
            name = row[1]
            indexes[name] = {
                "unique": bool(row[2]),
                "columns": [
                    r[2] for r in con.execute(f"PRAGMA index_info({name})")
                ],
            }
        lookup_exact = any(
            meta["columns"] == [
                "company_id", "task_id", "command_id", "attempt_id",
                "claims_sha256", "actor_id"
            ]
            for meta in indexes.values()
        )
        if not lookup_exact:
            return result(
                "ISSUE159_APPROVAL_INTENT_INDEX_DRIFT",
                **common,
                legacyDecisionTablePresent=legacy,
                approvalIntentTablePresent=True,
                approvalIntentSchemaExact=True,
                approvalIntentSelfContainedDecision=True,
                approvalIntentLookupIndexExact=False,
            )

        total = con.execute(f"SELECT COUNT(*) FROM {TABLE}").fetchone()[0]
        fallback = con.execute(
            f"SELECT COUNT(*) FROM {TABLE} "
            "WHERE actor_id='dev_approval_token' "
            "OR auth_method<>'supabase_aal2' "
            "OR role_at_decision<>'super_admin' "
            "OR decision<>'APPROVE'"
        ).fetchone()[0]
        if fallback:
            return result("ISSUE159_APPROVAL_INTENT_PROVENANCE_INVALID",
                          **common,
                          legacyDecisionTablePresent=legacy,
                          approvalIntentTablePresent=True,
                          approvalIntentSchemaExact=True,
                          approvalIntentSelfContainedDecision=True,
                          approvalIntentLookupIndexExact=True,
                          approvalIntentRows=total,
                          fallbackActorRowsInIntentTable=fallback)

        return result(
            "ISSUE159_APPROVAL_STORE_READY_NO_SIGNING_AUTHORITY",
            **common,
            legacyDecisionTablePresent=legacy,
            approvalIntentTablePresent=True,
            approvalIntentSchemaExact=True,
            approvalIntentSelfContainedDecision=True,
            approvalIntentLookupIndexExact=True,
            approvalIntentRows=total,
            fallbackActorRowsInIntentTable=0,
            operationalEvidenceAvailable=total > 0,
            # Capability and evidence are separate: a clean exact store can be
            # read safely even before the first real AAL2 approval row exists.
            trustedPersistedReadReady=True,
        )
    except sqlite3.Error:
        return result("APPROVAL_DB_READ_FAILED", **common)
    finally:
        try:
            con.close()
        except Exception:
            pass

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--db", default=LIVE_DB)
    p.add_argument("--test-mode", action="store_true")
    args = p.parse_args()
    out = inspect(args.db, operational=not args.test_mode)
    print(json.dumps(out, sort_keys=True))
    # Store-ready is evidence only; signing still remains false.
    return 0 if out["reason"] == "ISSUE159_APPROVAL_STORE_READY_NO_SIGNING_AUTHORITY" else 2

if __name__ == "__main__":
    sys.exit(main())
