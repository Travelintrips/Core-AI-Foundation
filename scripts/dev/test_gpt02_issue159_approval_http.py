#!/usr/bin/env python3
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / "deploy/ai-coding-standalone-dev"
SCHEMA = DEPLOY / "gpt02_issue159_approval_intent_schema.sql"
ADAPTER = DEPLOY / "gpt02_issue159_approval_http.py"

sys.path.insert(0, str(DEPLOY))
spec = importlib.util.spec_from_file_location("issue159_http", ADAPTER)
http = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(http)

CLAIMS = {
    "v": 2,
    "environment": "DEV",
    "audience": "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
    "taskId": 140,
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

class ApprovalHttpAdapterTest(unittest.TestCase):
    def db(self):
        fd, path = tempfile.mkstemp(prefix="issue159-http-", suffix=".db")
        os.close(fd)
        con = sqlite3.connect(path)
        con.executescript(SCHEMA.read_text())
        con.commit()
        self.addCleanup(lambda: os.path.exists(path) and os.unlink(path))
        return con

    def verifier(self, identity=None):
        if identity is None:
            identity = {
                "userId": CLAIMS["superAdminId"],
                "role": "super_admin",
                "enabled": True,
                "authMethod": "supabase_admin_session",
            }
        return Mock(return_value=identity)

    def call(self, con, verifier=None, *, enabled=True, claims=None, now=2000,
             auth=None):
        if verifier is None:
            verifier = self.verifier()
        if claims is None:
            claims = CLAIMS
        if auth is None:
            auth = "Bearer " + TOKEN
        return http.handle_issue159_approval_intent(
            auth,
            json.dumps({"claims": claims}).encode(),
            con,
            verifier,
            enabled=enabled,
            now_ms=now,
        ), verifier

    def test_disabled_feature_is_not_found_before_identity_or_write(self):
        con = self.db()
        (status, body), verify = self.call(con, enabled=False)
        self.assertEqual(status, 404)
        self.assertEqual(body, {"error": "not_found"})
        verify.assert_not_called()
        self.assertEqual(
            con.execute("select count(*) from gpt02_issue159_approval_intents").fetchone()[0],
            0,
        )
        con.close()

    def test_admin_session_records_intent_but_response_stays_no_go(self):
        con = self.db()
        (status, body), verify = self.call(con)
        self.assertEqual(status, 201)
        verify.assert_called_once()
        self.assertEqual(body["actorId"], CLAIMS["superAdminId"])
        self.assertEqual(body["authMethod"], "supabase_admin_session")
        self.assertEqual(body["roleAtDecision"], "super_admin")
        self.assertFalse(body["signingPermitted"])
        self.assertFalse(body["authorizationGranted"])
        self.assertFalse(body["dispatchPermitted"])
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertEqual(
            con.execute("select count(*) from gpt02_issue159_approval_intents").fetchone()[0],
            1,
        )
        con.close()

    def test_static_fallback_non_super_admin_and_missing_bearer_are_rejected(self):
        con = self.db()
        for identity in (
            {"userId": "dev_approval_token", "role": "super_admin",
             "enabled": True, "authMethod": "static_dev_token"},
            {"userId": CLAIMS["superAdminId"], "role": "admin",
             "enabled": True, "authMethod": "supabase_admin_session"},
        ):
            (status, body), _ = self.call(con, verifier=self.verifier(identity))
            self.assertEqual(status, 403)
            self.assertEqual(body, {"error": "active_super_admin_required"})
        (status, body), verify = self.call(con, auth="")
        self.assertEqual(status, 401)
        verify.assert_not_called()
        con.close()

    def test_invalid_claims_fail_before_identity_and_replay_is_conflict(self):
        con = self.db()
        invalid = {**CLAIMS, "expiresAt": 2000}
        (status, body), verify = self.call(con, claims=invalid)
        self.assertEqual(status, 400)
        self.assertEqual(body, {"error": "invalid_claims"})
        verify.assert_not_called()

        (status, _), _ = self.call(con)
        self.assertEqual(status, 201)
        (status, body), _ = self.call(con, now=2100)
        self.assertEqual(status, 409)
        self.assertEqual(body, {"error": "approval_intent_conflict"})
        con.close()

    def test_strict_body_and_source_have_no_signing_dispatch_or_static_token(self):
        con = self.db()
        verify = self.verifier()
        for raw in (b"", b"{", json.dumps({"claims": CLAIMS, "authorized": True}).encode()):
            status, _ = http.handle_issue159_approval_intent(
                "Bearer " + TOKEN, raw, con, verify, enabled=True, now_ms=2000
            )
            self.assertIn(status, (400,))
        con.close()

        source = ADAPTER.read_text()
        for forbidden in (
            "createPrivateKey", "load_pem_private_key", "Ed25519PrivateKey",
            "sign(", "dispatch_worker", "create_command", "AICODING_APPROVAL_TOKEN",
        ):
            self.assertNotIn(forbidden, source)

if __name__ == "__main__":
    unittest.main()
