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
AAL2_TOKEN = "a" * 64
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
        self.pending = self.db + ".pending.json"
        api.ISSUE159_APPROVED_PACKET = self.packet
        api.ISSUE159_PENDING_CLAIMS = self.pending
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
        if os.path.exists(self.pending):
            os.unlink(self.pending)

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

    def pending_request(self, token=AAL2_TOKEN):
        req = urllib.request.Request(
            self.base + "/api/gpt02/issue159/approval-intent/pending",
            headers={"Authorization": "Bearer " + token},
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=3) as res:
                return res.status, json.load(res)
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode())

    def test_pending_route_requires_real_active_super_admin_session(self):
        api.admin_identity = lambda token, connection: None
        status, body = self.pending_request()
        self.assertEqual(status, 403)
        self.assertEqual(body, {"error": "active_super_admin_required"})
        status, body = self.pending_request(token=None) if False else (None, None)
        req = urllib.request.Request(
            self.base + "/api/gpt02/issue159/approval-intent/pending", method="GET"
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req, timeout=3)
        self.assertEqual(ctx.exception.code, 401)

    def test_pending_route_returns_only_current_bound_request(self):
        api.admin_identity = lambda token, connection: {
            "user_id": CLAIMS["superAdminId"], "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        Path(self.pending).write_text(json.dumps({"claims": CLAIMS}))
        os.chmod(self.pending, 0o600)
        status, body = self.pending_request()
        self.assertEqual(status, 200)
        self.assertTrue(body["pending"])
        self.assertEqual(body["taskId"], CLAIMS["taskId"])
        self.assertEqual(body["claims"], CLAIMS)
        self.assertFalse(body["signingPermitted"])
        self.assertFalse(body["authorizationGranted"])
        self.assertFalse(body["dispatchPermitted"])
        self.assertEqual(body["releaseDecision"], "NO_GO")

    def test_pending_route_rejects_wrong_actor_expired_and_insecure_file(self):
        api.admin_identity = lambda token, connection: {
            "user_id": CLAIMS["superAdminId"], "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        wrong = {**CLAIMS, "superAdminId": "another-super-admin"}
        Path(self.pending).write_text(json.dumps({"claims": wrong}))
        os.chmod(self.pending, 0o600)
        status, body = self.pending_request()
        self.assertEqual(status, 200)
        self.assertFalse(body["pending"])
        self.assertEqual(body["reason"], "PENDING_REQUEST_ACTOR_MISMATCH")

        expired = {**CLAIMS, "issuedAt": BASE_NOW_MS - 300000,
                   "expiresAt": BASE_NOW_MS - 1}
        Path(self.pending).write_text(json.dumps({"claims": expired}))
        os.chmod(self.pending, 0o600)
        status, body = self.pending_request()
        self.assertEqual(status, 200)
        self.assertEqual(body["reason"], "PENDING_REQUEST_EXPIRED")

        Path(self.pending).write_text(json.dumps({"claims": CLAIMS}))
        os.chmod(self.pending, 0o644)
        status, body = self.pending_request()
        self.assertEqual(status, 200)
        self.assertEqual(body["reason"], "PENDING_REQUEST_FILE_SECURITY_INVALID")

    def test_pending_route_detects_already_approved_binding(self):
        api.admin_identity = lambda token, connection: {
            "user_id": CLAIMS["superAdminId"], "email": "fixture@example.com",
            "role": "super_admin", "auth_level": "aal1",
        }
        Path(self.pending).write_text(json.dumps({"claims": CLAIMS}))
        os.chmod(self.pending, 0o600)
        digest = api.validate_approval_claims(CLAIMS)["claimsSha256"]
        con = sqlite3.connect(self.db)
        con.execute(
            """INSERT INTO gpt02_issue159_approval_intents
            (id,task_id,command_id,attempt_id,company_id,claims_sha256,
             actor_id,auth_method,role_at_decision,decision,recorded_at_ms,expires_at_ms)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("33333333-3333-4333-8333-333333333333", CLAIMS["taskId"],
             CLAIMS["commandId"], CLAIMS["attemptId"], CLAIMS["companyId"],
             digest, CLAIMS["superAdminId"], "supabase_admin_session",
             "super_admin", "APPROVE", BASE_NOW_MS, CLAIMS["expiresAt"]),
        )
        con.commit()
        con.close()
        status, body = self.pending_request()
        self.assertEqual(status, 200)
        self.assertFalse(body["pending"])
        self.assertEqual(body["reason"], "PENDING_REQUEST_ALREADY_APPROVED")

    def test_feature_disabled_is_404_and_never_writes(self):
        status, body = self.request(AAL2_TOKEN)
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

    def test_verified_aal2_super_admin_records_intent_but_stays_no_go(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: (
            {"user_id": CLAIMS["superAdminId"], "email": "fixture@example.com",
             "role": "super_admin", "auth_level": "aal2"}
            if token == AAL2_TOKEN else None
        )
        status, body = self.request(AAL2_TOKEN)
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

    def test_aal1_super_admin_records_intent_without_aal2_requirement(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": CLAIMS["superAdminId"],
            "email": "fixture@example.com",
            "role": "super_admin",
            "auth_level": "aal1",
        }
        status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 201)
        self.assertEqual(body["actorId"], CLAIMS["superAdminId"])
        self.assertEqual(body["authMethod"], "supabase_admin_session")
        self.assertFalse(body["signingPermitted"])
        self.assertFalse(body["authorizationGranted"])
        self.assertFalse(body["dispatchPermitted"])
        self.assertEqual(body["releaseDecision"], "NO_GO")
        self.assertEqual(self.count(), 1)
        self.assertTrue(os.path.exists(self.packet))

    def test_missing_auth_level_is_rejected_before_intent_write(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": CLAIMS["superAdminId"],
            "email": "fixture@example.com",
            "role": "super_admin",
        }
        status, body = self.request(AAL2_TOKEN)
        self.assertEqual(status, 403)
        self.assertEqual(body, {"error": "active_super_admin_required"})
        self.assertEqual(self.count(), 0)

    def test_admin_role_and_missing_bearer_are_rejected(self):
        api.ISSUE159_APPROVAL_INTENT_ENABLED = True
        api.admin_identity = lambda token, connection: {
            "user_id": CLAIMS["superAdminId"],
            "email": "fixture@example.com",
            "role": "admin",
        }
        status, _ = self.request(AAL2_TOKEN)
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
