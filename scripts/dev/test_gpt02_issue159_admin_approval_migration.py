#!/usr/bin/env python3
import importlib.util
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/dev/migrate_gpt02_issue159_admin_approval.py"
spec = importlib.util.spec_from_file_location("admin_approval_migration", SCRIPT)
migration = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(migration)


OLD_SCHEMA = """
CREATE TABLE gpt02_issue159_approval_intents (
 id TEXT PRIMARY KEY,
 task_id INTEGER NOT NULL CHECK (task_id > 136),
 command_id TEXT NOT NULL,
 attempt_id TEXT NOT NULL,
 company_id TEXT NOT NULL CHECK (company_id = 'default'),
 claims_sha256 TEXT NOT NULL CHECK (length(claims_sha256)=64 AND claims_sha256 NOT GLOB '*[^0-9a-f]*'),
 actor_id TEXT NOT NULL CHECK (actor_id <> '' AND actor_id <> 'dev_approval_token'),
 auth_method TEXT NOT NULL CHECK (auth_method = 'supabase_aal2'),
 role_at_decision TEXT NOT NULL CHECK (role_at_decision = 'super_admin'),
 decision TEXT NOT NULL CHECK (decision = 'APPROVE'),
 recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms > 0),
 expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > recorded_at_ms AND expires_at_ms-recorded_at_ms<=300000),
 UNIQUE(task_id,command_id,attempt_id),
 UNIQUE(claims_sha256)
);
CREATE INDEX idx_gpt02_issue159_approval_intents_lookup
 ON gpt02_issue159_approval_intents(company_id,task_id,command_id,attempt_id,claims_sha256,actor_id);
"""


class AdminApprovalMigrationTest(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp(prefix="issue159-admin-migration-")
        self.db = os.path.join(d, "tasks.db")
        self.backup = os.path.join(d, "tasks.db.backup")
        self.addCleanup(lambda: __import__("shutil").rmtree(d, ignore_errors=True))
        con = sqlite3.connect(self.db)
        con.executescript(OLD_SCHEMA)
        con.execute(
            "INSERT INTO gpt02_issue159_approval_intents VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            ("44444444-4444-4444-8444-444444444444", 139,
             "11111111-1111-4111-8111-111111111111",
             "22222222-2222-4222-8222-222222222222", "default", "a"*64,
             "admin-subject", "supabase_aal2", "super_admin", "APPROVE", 1000, 2000),
        )
        con.commit()
        con.close()

    def test_migration_preserves_existing_rows_and_adds_admin_session(self):
        before = sqlite3.connect(self.db).execute(
            "select * from gpt02_issue159_approval_intents"
        ).fetchall()
        out = migration.migrate(self.db, self.backup, operational=False)
        self.assertEqual(out["status"], "migrated")
        self.assertEqual(out["rows"], 1)
        self.assertTrue(os.path.exists(self.backup))
        con = sqlite3.connect(self.db)
        schema = con.execute(
            "select sql from sqlite_master where name='gpt02_issue159_approval_intents'"
        ).fetchone()[0]
        after = con.execute(
            "select * from gpt02_issue159_approval_intents"
        ).fetchall()
        con.execute(
            "insert into gpt02_issue159_approval_intents values (?,?,?,?,?,?,?,?,?,?,?,?)",
            ("55555555-5555-4555-8555-555555555555", 140,
             "33333333-3333-4333-8333-333333333333",
             "66666666-6666-4666-8666-666666666666", "default", "b"*64,
             "admin-subject", "supabase_admin_session", "super_admin", "APPROVE", 3000, 4000),
        )
        con.commit()
        self.assertEqual(before, after)
        self.assertIn("supabase_admin_session", schema)
        self.assertEqual(con.execute("select count(*) from gpt02_issue159_approval_intents").fetchone()[0], 2)
        con.close()

    def test_migration_is_idempotent_after_schema_upgrade(self):
        migration.migrate(self.db, self.backup, operational=False)
        second_backup = self.backup + ".second"
        out = migration.migrate(self.db, second_backup, operational=False)
        self.assertEqual(out["status"], "already_migrated")
        self.assertEqual(out["rows"], 1)
        self.assertFalse(os.path.exists(second_backup))


if __name__ == "__main__":
    unittest.main()
