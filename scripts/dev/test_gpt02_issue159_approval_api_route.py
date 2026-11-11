#!/usr/bin/env python3
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import time
import threading
import types
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / "deploy/ai-coding-standalone-dev"
API_PATH = DEPLOY / "approval_api.py"
SCHEMA_PATH = DEPLOY / "gpt02_issue159_approval_intent_schema.sql"
sys.path.insert(0, str(DEPLOY))

fake_identity = types.ModuleType("admin_identity")
fake_identity.admin_identity = lambda token, connection: None
sys.modules["admin_identity"] = fake_identity

spec = importlib.util.spec_from_file_location("approval_api_issue159_test", API_PATH)
api = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(api)

BASE_NOW_MS = int(time.time() * 1000)

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
    "issuedAt": BASE_NOW_MS - 1000,
    "expiresAt": BASE_NOW_MS + 120000,
}
ADMIN_TOKEN = "a" * 64
STATIC_TOKEN = "s" * 64

class ApprovalApiIssue159RouteTest(unittest.TestCase):
    def setUp(self):
        fd, self.db = tempfile.mkstemp(prefix="issue159-route-", suffix=".db")
        os.close(fd)
        con = sqlite3.connect(self.db)
        con.executescript(SCHEMA_PATH.read_text())
        con.commit()
        con.close()
        os.chmod(self.db, 0o600)
        api.DB = self.db
        self.packet = self.db + ".approved.json"
        api.ISSUE159_APPROVED_PACKET = self.packet
        api.TOKEN = STATIC_TOKEN
        api.ISSUE159_APPROVAL_INTENT_ENABLED = False
        api.admin_identity = lambda token, connection: None
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), api.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:%d" % self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        if os.path.exists(self.db):
            os.unlink(self.db)
        if os.path.exists(self.packet):
            os.unlink(self.packet)

    def request(self, token=None, claims=None):
        data = json.dumps({"claims": CLAIMS if claims is None else claims}).encode()
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["Authorization"] = "Bearer " + token
        req = urllib.request.Request(
            self.base + "/api/gpt02/issue159/approval-intent",
            data=data, headers=headers, method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=3) as res:
                return res.status, json.load(res)
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode())

    def count(self):
        con = sqlite3.connect(self.db)
        value = con.execute(
            "select count(*) from gpt02_issue159_approval_intents"
        ).fetchone()[0]
        con.close()
        return value

    def test_feature_disabled_is_404_and_never_writes(self):
        status, body = self.request(ADMIN_TOKEN)
        self.assertEqual((status, body), (404, {"error": "not_found"}))
        self.assertEqual(self.count(), 0)
        self.assertFalse(os.path.exists(self.packet))

    def test_static_fallback_token_cannot_create_issue159_intent(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        status, body = self.request(STATIC_TOKEN)
        self.assertEqual(status, 403)
        self.assertEqual(body, {"error": "active_super_admin_required"})
        self.assertEqual(self.count(), 0)
        self.assertFalse(os.path.exists(self.packet))

    def test_verified_super_admin_records_intent_but_stays_no_go(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: (
            {"user_id": CLAIMS["superAdminId"], "email": "fixture@example.com",
             "role": "super_admin", "auth_level": "aal1"}
            if token == ADMIN_TOKEN else None
        )
        status, body = self.request(ADMIN_TOKEN)
        self.assertEqual(status, 201)
        self.assertEqual(body["actorId"], CLAIMS["superAdminId"])
        self.assertEqual(body["authMethod"], "supabase_admin_session")
        self.assertFalse(body["signingPermitted"])
        self.assertFalse(body["authorizationGranted"])
        self.assertFalse(body["dispatchPermitted"])
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertEqual(self.count(), 1)
        self.assertTrue(os.path.exists(self.packet))
        self.assertEqual(os.stat(self.packet).st_mode & 0o777, 0o600)
        packet = json.loads(Path(self.packet).read_text())
        self.assertEqual(packet["claims"], CLAIMS)
        self.assertEqual(packet["intentId"], body["intentId"])
        self.assertEqual(packet["claimsSha256"], body["claimsSha256"])
        self.assertEqual(packet["actorId"], CLAIMS["superAdminId"])
        self.assertFalse(packet["signingPermitted"])
        self.assertFalse(packet["authorizationGranted"])
        self.assertFalse(packet["dispatchPermitted"])
        self.assertEqual(packet["releaseDecision"], "NO_GO")

    def test_aal2_super_admin_is_also_accepted(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": CLAIMS["superAdminId"],
            "email": "fixture@example.com",
            "role": "super_admin",
            "auth_level": "aal2",
        }
        status, body = self.request(ADMIN_TOKEN)
        self.assertEqual(status, 201)
        self.assertEqual(body["authMethod"], "supabase_admin_session")
        self.assertFalse(body["signingPermitted"])
        self.assertFalse(body["authorizationGranted"])
        self.assertFalse(body["dispatchPermitted"])
        self.assertEqual(self.count(), 1)

    def test_admin_role_and_missing_bearer_are_rejected(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": CLAIMS["superAdminId"],
            "email": "fixture@example.com",
            "role": "admin",
        }
        status, _ = self.request(ADMIN_TOKEN)
        self.assertEqual(status, 403)
        status, _ = self.request(None)
        self.assertEqual(status, 401)
        self.assertEqual(self.count(), 0)

    def test_source_route_precedes_generic_static_token_authorization(self):
        source = API_PATH.read_text()
        route = source.index("if p=='/api/gpt02/issue159/approval-intent':")
        generic = source.index("if not self.authorized(): return self.send(401", route)
        self.assertLess(route, generic)
        self.assertIn("enabled=ISSUE159_APPROVAL_INTENT_ENABLED", source)
        self.assertIn("issue159_identity_verifier", source)

if __name__ == "__main__":
    unittest.main()
