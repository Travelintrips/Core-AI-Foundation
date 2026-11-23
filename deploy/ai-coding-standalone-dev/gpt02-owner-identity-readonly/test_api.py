#!/usr/bin/env python3
"""Synthetic HTTP-boundary tests for the GET-only Owner identity service."""
import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

API = Path(__file__).with_name("api.py")
spec = spec_from_file_location("gpt02_owner_identity_api_test", API)
api = module_from_spec(spec)
spec.loader.exec_module(api)

ACTOR = {
    "id": "google_synthetic_owner",
    "role": "super_admin",
    "companyId": None,
    "email": "synthetic@example.invalid",
    "authSource": "supabase_google_identity",
    "authSupabaseId": "11111111-1111-4111-8111-111111111111",
    "authVerifiedAt": 1_800_000_000_000,
}
PROOF = {
    "eligible": True,
    "taskId": 183,
    "companyId": "default",
    "scope": "SUPERADMIN_OWNER_IDENTITY_READ_ONLY",
    "ownerSubject": "owner:google_synthetic_owner",
    "googleSessionVerified": True,
    "enabledOperatorLinkVerified": True,
    "approvalDecisionCreated": False,
    "cryptographicOwnerSignatureVerified": False,
    "issuerAuthorized": False,
    "dispatchPermitted": False,
    "readOnly": True,
}

class ServerCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        def owner(actor):
            if actor != ACTOR:
                raise api.AuthRejected("EXACT_OWNER_OPERATOR_LINK_REQUIRED")
            return dict(PROOF)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), api.make_handler(
            session_verifier=lambda token: ACTOR if token == "synthetic-signed-hub-token" else (_ for _ in ()).throw(api.AuthRejected("INVALID")),
            owner_verifier=owner,
        ))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def request(self, method="GET", path=api.OWNER_IDENTITY_PATH, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        h = {"Host": api.EXPECTED_HOST, **(headers or {})}
        conn.request(method, path, headers=h)
        response = conn.getresponse()
        body = response.read()
        result = (response.status, response.getheader("Cache-Control"), json.loads(body))
        conn.close()
        return result

    def test_unauthenticated_denied(self):
        status, cache, body = self.request()
        self.assertEqual(status, 401)
        self.assertEqual(cache, "no-store")
        self.assertIs(body["eligible"], False)

    def test_exact_signed_owner_link_accepted_read_only(self):
        status, cache, body = self.request(headers={"Authorization": "Bearer synthetic-signed-hub-token"})
        self.assertEqual(status, 200)
        self.assertEqual(cache, "no-store")
        self.assertEqual(body, PROOF)
        self.assertIs(body["approvalDecisionCreated"], False)
        self.assertIs(body["issuerAuthorized"], False)
        self.assertIs(body["dispatchPermitted"], False)

    def test_wrong_owner_link_denied(self):
        status, _, body = self.request(headers={"Authorization": "Bearer wrong-token"})
        self.assertEqual(status, 403)
        self.assertIs(body["eligible"], False)

    def test_wrong_host_denied(self):
        status, _, body = self.request(headers={"Host": "attacker.invalid", "Authorization": "Bearer synthetic-signed-hub-token"})
        self.assertEqual(status, 403)
        self.assertEqual(body["error"], "EXPECTED_DEV_HOST_REQUIRED")

    def test_unknown_path_not_exposed(self):
        status, _, body = self.request(path="/anything")
        self.assertEqual(status, 404)
        self.assertEqual(body["error"], "NOT_FOUND")

    def test_no_mutation_methods(self):
        for method in ("POST", "PUT", "PATCH", "DELETE", "OPTIONS"):
            with self.subTest(method=method):
                status, _, body = self.request(method=method)
                self.assertEqual(status, 405)
                self.assertIs(body["dispatchPermitted"], False)

if __name__ == "__main__":
    unittest.main(verbosity=2)
