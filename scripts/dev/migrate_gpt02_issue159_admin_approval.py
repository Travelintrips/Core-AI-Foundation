#!/usr/bin/env python3
"""One-time DEV SQLite schema migration for single-admin GPT02 approval.

Preserves every existing approval row and its exact binding. This migration
only broadens auth_method to accept a normal authenticated Super Admin session;
it grants no signing, authorization, or dispatch authority.
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import stat
import sys
from datetime import datetime, timezone

LIVE_DB = "/opt/ai-coding-standalone-dev/tasks.db"
TABLE = "gpt02_issue159_approval_intents"


def migrate(db_path: str, backup_path: str, *, operational: bool = True) -> dict:
    if operational:
        if db_path != LIVE_DB or os.geteuid() != 0:
            raise RuntimeError("ADMIN_APPROVAL_MIGRATION_TARGET_NOT_PINNED")
        st = os.lstat(db_path)
        if (stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode)
                or st.st_uid != 0 or st.st_gid != 0
                or stat.S_IMODE(st.st_mode) != 0o600):
            raise RuntimeError("ADMIN_APPROVAL_DB_SECURITY_INVALID")
    if os.path.exists(backup_path):
        raise RuntimeError("ADMIN_APPROVAL_BACKUP_ALREADY_EXISTS")

    check = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
    try:
        schema_row = check.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
            (TABLE,),
        ).fetchone()
        if not schema_row:
            raise RuntimeError("ADMIN_APPROVAL_TABLE_MISSING")
        if "supabase_admin_session" in schema_row[0]:
            rows = check.execute(f"SELECT count(*) FROM {TABLE}").fetchone()[0]
            return {"status": "already_migrated", "rows": rows, "backup": None}
    finally:
        check.close()

    src = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
    backup = sqlite3.connect(backup_path)
    try:
        src.backup(backup)
        backup.commit()
    finally:
        backup.close()
        src.close()
    os.chmod(backup_path, 0o600)

    con = sqlite3.connect(db_path, timeout=10)
    con.execute("PRAGMA busy_timeout=10000")
    try:
        con.execute("BEGIN IMMEDIATE")
        schema_row = con.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
            (TABLE,),
        ).fetchone()
        if not schema_row:
            raise RuntimeError("ADMIN_APPROVAL_TABLE_MISSING")
        if "supabase_admin_session" in schema_row[0]:
            con.rollback()
            return {"status": "already_migrated", "rows": con.execute(
                f"SELECT count(*) FROM {TABLE}"
            ).fetchone()[0], "backup": backup_path}

        before = con.execute(
            f"SELECT * FROM {TABLE} ORDER BY id"
        ).fetchall()
        allowed = {"supabase_aal2"}
        if any(row[7] not in allowed for row in before):
            raise RuntimeError("ADMIN_APPROVAL_EXISTING_AUTH_METHOD_UNEXPECTED")

        con.execute(f"""
            CREATE TABLE {TABLE}_new (
              id TEXT PRIMARY KEY,
              task_id INTEGER NOT NULL CHECK (task_id > 136),
              command_id TEXT NOT NULL,
              attempt_id TEXT NOT NULL,
              company_id TEXT NOT NULL CHECK (company_id = 'default'),
              claims_sha256 TEXT NOT NULL CHECK (
                length(claims_sha256) = 64 AND
                claims_sha256 NOT GLOB '*[^0-9a-f]*'
              ),
              actor_id TEXT NOT NULL CHECK (
                actor_id <> '' AND actor_id <> 'dev_approval_token'
              ),
              auth_method TEXT NOT NULL CHECK (
                auth_method IN ('supabase_admin_session','supabase_aal2')
              ),
              role_at_decision TEXT NOT NULL CHECK (role_at_decision = 'super_admin'),
              decision TEXT NOT NULL CHECK (decision = 'APPROVE'),
              recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms > 0),
              expires_at_ms INTEGER NOT NULL CHECK (
                expires_at_ms > recorded_at_ms AND
                expires_at_ms - recorded_at_ms <= 300000
              ),
              UNIQUE(task_id, command_id, attempt_id),
              UNIQUE(claims_sha256)
            )
        """)
        con.execute(
            f"INSERT INTO {TABLE}_new SELECT * FROM {TABLE}"
        )
        copied = con.execute(
            f"SELECT * FROM {TABLE}_new ORDER BY id"
        ).fetchall()
        if copied != before:
            raise RuntimeError("ADMIN_APPROVAL_MIGRATION_COPY_MISMATCH")
        con.execute(f"DROP TABLE {TABLE}")
        con.execute(f"ALTER TABLE {TABLE}_new RENAME TO {TABLE}")
        con.execute(f"""
            CREATE INDEX idx_gpt02_issue159_approval_intents_lookup
            ON {TABLE}(
              company_id, task_id, command_id, attempt_id, claims_sha256, actor_id
            )
        """)
        con.commit()
        after = con.execute(
            f"SELECT * FROM {TABLE} ORDER BY id"
        ).fetchall()
        if after != before:
            raise RuntimeError("ADMIN_APPROVAL_MIGRATION_READBACK_MISMATCH")
        return {"status": "migrated", "rows": len(after), "backup": backup_path}
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def main() -> int:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = LIVE_DB + ".pre-admin-approval-" + stamp
    result = migrate(LIVE_DB, backup, operational=True)
    print(result)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(2)
