#!/usr/bin/env python3
import hashlib
import importlib.util
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / "deploy/ai-coding-standalone-dev"
SCHEMA = DEPLOY / "gpt02_issue159_approval_intent_schema.sql"
WRITER = DEPLOY / "gpt02_issue159_approval_intent.py"

sys.path.insert(0, str(DEPLOY))
spec = importlib.util.spec_from_file_location("issue159_writer", WRITER)
writer = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(writer)

CLAIMS = {
    "v": 2,
    "environment": "DEV",
    "audience": "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
    "taskId": 137,
    "commandId": "11111111-1111-4111-8111-111111111111",
    "attemptId": "22222222-2222-4222-8222-222222222222",
    "nonce": "A" * 44,
    "operatorNamespace": "ai-task-hub.public.users",
    "superAdminId": "google_fixture_super_admin",
    "companyId": "default",
    "issuedAt": 1000,
    "expiresAt": 10000,
}
TOKEN = "x" * 64

class ApprovalIntentWriterTest(unittest.TestCase):
    def db(self):
        fd, path = tempfile.mkstemp(prefix="issue159-writer-", suffix=".db")
        os.close(fd)
        con = sqlite3.connect(path)
        con.execute("""CREATE TABLE admin_identities (
          user_id TEXT PRIMARY KEY, role TEXT NOT NULL, enabled INTEGER NOT NULL
        )""")
        con.executescript(SCHEMA.read_text())
        con.commit()
        self.addCleanup(lambda: os.path.exists(path) and os.unlink(path))
        return path, con

    def identity(self, user_id=CLAIMS["superAdminId"], role="super_admin"):
        return {"user_id": user_id, "email": "fixture@example.com", "role": role}

    def test_verified_aal2_super_admin_records_one_intent_but_never_authority(self):
        path, con = self.db()
        with patch.object(writer, "admin_identity", return_value=self.identity()) as verify:
            out = writer.record_issue159_approval_intent(TOKEN, con, dict(CLAIMS), now_ms=2000)
        verify.assert_called_once_with(TOKEN, con)
        self.assertTrue(out["ok"])
        self.assertTrue(out["intentRecorded"])
        self.assertFalse(out["signingPermitted"])
        self.assertFalse(out["authorizationGranted"])
        self.assertFalse(out["dispatchPermitted"])
        self.assertEqual(out["releaseDecision"], "NO_GO")

        row = con.execute(
            """SELECT claims_sha256,actor_id,auth_method,role_at_decision,
                      decision,recorded_at_ms,expires_at_ms
               FROM gpt02_issue159_approval_intents"""
        ).fetchone()
        canonical = writer.canonical_issue159_approval_claims(CLAIMS)
        self.assertEqual(row[0], hashlib.sha256(canonical.encode()).hexdigest())
        self.assertEqual(row[1:], (
            CLAIMS["superAdminId"], "supabase_aal2", "super_admin",
            "APPROVE", 2000, CLAIMS["expiresAt"],
        ))
        con.close()

    def test_replay_same_claims_is_rejected_by_unique_contract(self):
        path, con = self.db()
        with patch.object(writer, "admin_identity", return_value=self.identity()):
            first = writer.record_issue159_approval_intent(TOKEN, con, dict(CLAIMS), now_ms=2000)
            second = writer.record_issue159_approval_intent(TOKEN, con, dict(CLAIMS), now_ms=2100)
        self.assertTrue(first["ok"])
        self.assertFalse(second["ok"])
        self.assertEqual(second["reason"], "APPROVAL_INTENT_REPLAY_OR_CONFLICT")
        self.assertEqual(
            con.execute("select count(*) from gpt02_issue159_approval_intents").fetchone()[0], 1
        )
        con.close()

    def test_static_fallback_or_non_super_admin_cannot_record(self):
        for identity in (
            None,
            self.identity("dev_approval_token", "super_admin"),
            self.identity(CLAIMS["superAdminId"], "admin"),
            self.identity("another-user", "super_admin"),
        ):
            path, con = self.db()
            with patch.object(writer, "admin_identity", return_value=identity):
                out = writer.record_issue159_approval_intent(TOKEN, con, dict(CLAIMS), now_ms=2000)
            self.assertFalse(out["ok"])
            self.assertEqual(out["reason"], "AAL2_SUPER_ADMIN_IDENTITY_MISMATCH")
            self.assertEqual(
                con.execute("select count(*) from gpt02_issue159_approval_intents").fetchone()[0], 0
            )
            con.close()

    def test_invalid_or_expired_claims_fail_before_identity_lookup(self):
        cases = [
            {**CLAIMS, "taskId": 136},
            {**CLAIMS, "environment": "PROD"},
            {**CLAIMS, "audience": "other"},
            {**CLAIMS, "expiresAt": 2000},
            {**CLAIMS, "injected": True},
        ]
        for claims in cases:
            path, con = self.db()
            with patch.object(writer, "admin_identity") as verify:
                out = writer.record_issue159_approval_intent(TOKEN, con, claims, now_ms=2000)
            self.assertFalse(out["ok"])
            self.assertEqual(out["reason"], "APPROVAL_CLAIMS_INVALID")
            verify.assert_not_called()
            con.close()

    def test_source_has_no_signing_key_dispatch_or_production_surface(self):
        source = WRITER.read_text()
        self.assertIn("admin_identity(access_token, connection)", source)
        for forbidden in (
            "createPrivateKey", "load_pem_private_key", "Ed25519PrivateKey",
            "signature", "dispatch_worker", "create_command", "PROD",
            "dev_approval_token' :", "AICODING_APPROVAL_TOKEN",
        ):
            self.assertNotIn(forbidden, source)

if __name__ == "__main__":
    unittest.main()
