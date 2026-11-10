#!/usr/bin/env python3
import importlib.util
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
READER_PATH = ROOT / "scripts/dev/gpt02_issue159_approval_intent_reader.py"
SCHEMA_PATH = ROOT / "deploy/ai-coding-standalone-dev/gpt02_issue159_approval_intent_schema.sql"

spec = importlib.util.spec_from_file_location("approval_intent_reader", READER_PATH)
reader = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(reader)

LEGACY = """
CREATE TABLE admin_identities (
 user_id TEXT PRIMARY KEY,
 role TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0
);
"""

LOOKUP = {
    "claimsSha256": "a" * 64,
    "taskId": 137,
    "commandId": "11111111-1111-4111-8111-111111111111",
    "attemptId": "22222222-2222-4222-8222-222222222222",
    "companyId": "default",
    "superAdminId": "google_fixture_super_admin",
}

class ApprovalIntentReaderTest(unittest.TestCase):
    def db(self):
        fd, path = tempfile.mkstemp(prefix="issue159-intent-reader-", suffix=".db")
        os.close(fd)
        con = sqlite3.connect(path)
        con.executescript(LEGACY)
        con.executescript(SCHEMA_PATH.read_text())
        con.commit()
        con.close()
        os.chmod(path, 0o600)
        self.addCleanup(lambda: os.path.exists(path) and os.unlink(path))
        return path

    def seed(self, path, *, actor=LOOKUP["superAdminId"],
             recorded=1000, expires=2000):
        con = sqlite3.connect(path)
        con.execute(
            "INSERT INTO admin_identities(user_id,role,enabled) VALUES (?,?,?)",
            (actor,"super_admin",1),
        )
        con.execute(
            """INSERT INTO gpt02_issue159_approval_intents
            (id,task_id,command_id,attempt_id,company_id,
             claims_sha256,actor_id,auth_method,role_at_decision,decision,
             recorded_at_ms,expires_at_ms)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("44444444-4444-4444-8444-444444444444",
             LOOKUP["taskId"],LOOKUP["commandId"],LOOKUP["attemptId"],
             LOOKUP["companyId"],LOOKUP["claimsSha256"],actor,
             "supabase_aal2","super_admin","APPROVE",recorded,expires),
        )
        con.commit()
        con.close()

    def test_exact_row_is_trusted_read_but_never_signing_authority(self):
        path = self.db()
        self.seed(path)
        con = sqlite3.connect(path)
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        con.close()
        self.assertNotIn("approval_decisions", tables)
        out = reader.read_approval_intent(path, LOOKUP, 1500, operational=False)
        self.assertTrue(out["persistedTrustedReadProven"])
        self.assertTrue(out["approvalBindingMatched"])
        self.assertTrue(out["aal2SuperAdminMatched"])
        self.assertFalse(out["signingPermitted"])
        self.assertFalse(out["authorizationGranted"])
        self.assertFalse(out["dispatchPermitted"])
        self.assertEqual(out["releaseDecision"], "NO_GO")
        self.assertEqual(out["decision"]["actorId"], LOOKUP["superAdminId"])
        self.assertEqual(out["decision"]["claimsSha256"], LOOKUP["claimsSha256"])

    def test_missing_or_wrong_lookup_fails_closed(self):
        path = self.db()
        self.seed(path)
        wrong = dict(LOOKUP)
        wrong["claimsSha256"] = "b" * 64
        out = reader.read_approval_intent(path, wrong, 1500, operational=False)
        self.assertEqual(out["reason"], "APPROVAL_INTENT_NOT_UNIQUE_OR_MISSING")
        self.assertFalse(out["persistedTrustedReadProven"])

        invalid = dict(LOOKUP)
        invalid["superAdminId"] = "dev_approval_token"
        out = reader.read_approval_intent(path, invalid, 1500, operational=False)
        self.assertEqual(out["reason"], "APPROVAL_INTENT_LOOKUP_INVALID")


    def test_current_super_admin_revocation_fails_closed(self):
        for role, enabled in (("admin", 1), ("super_admin", 0)):
            path = self.db()
            self.seed(path)
            con = sqlite3.connect(path)
            con.execute(
                "UPDATE admin_identities SET role=?,enabled=? WHERE user_id=?",
                (role, enabled, LOOKUP["superAdminId"]),
            )
            con.commit()
            con.close()
            out = reader.read_approval_intent(
                path, LOOKUP, 1500, operational=False
            )
            self.assertEqual(
                out["reason"], "APPROVAL_INTENT_PROVENANCE_MISMATCH"
            )
            self.assertFalse(out["persistedTrustedReadProven"])

    def test_expired_or_future_observation_fails_closed(self):
        path = self.db()
        self.seed(path, recorded=1000, expires=2000)
        for observed in (999, 2001):
            out = reader.read_approval_intent(path, LOOKUP, observed, operational=False)
            self.assertEqual(out["reason"], "APPROVAL_INTENT_EXPIRED_OR_INVALID")

    def test_operational_path_pinned_and_source_contains_no_write_surface(self):
        path = self.db()
        self.seed(path)
        out = reader.read_approval_intent(path, LOOKUP, 1500, operational=True)
        self.assertEqual(out["reason"], "OPERATIONAL_DB_PATH_NOT_PINNED")

        source = READER_PATH.read_text()
        self.assertIn("mode=ro", source)
        self.assertIn("PRAGMA query_only=ON", source)
        for forbidden in (
            "INSERT INTO", "UPDATE ", "DELETE FROM", "DROP TABLE",
            "ALTER TABLE", "CREATE TABLE", "createPrivateKey", "sign(",
        ):
            self.assertNotIn(forbidden, source)

if __name__ == "__main__":
    unittest.main()
