#!/usr/bin/env python3
import base64
import importlib.util
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / "deploy/ai-coding-standalone-dev"
sys.path.insert(0, str(DEPLOY))

fake = ModuleType("supabase_identity")
fake.SUPABASE_URL = "https://example.supabase.co"
fake.verified_identity = lambda token: {
    "user_id": "75a7c311-3f6e-4c95-8a66-9b98f6dd26ad",
    "email": "admcst001@gmail.com",
}
sys.modules["supabase_identity"] = fake

spec = importlib.util.spec_from_file_location("admin_identity_under_test", DEPLOY / "admin_identity.py")
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def token(*, aal="aal1", sub="75a7c311-3f6e-4c95-8a66-9b98f6dd26ad"):
    payload = {
        "iss": fake.SUPABASE_URL + "/auth/v1",
        "aud": "authenticated",
        "sub": sub,
        "aal": aal,
    }
    raw = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return "header." + raw + ".signature"


class AdminIdentityTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("CREATE TABLE admin_identities(user_id TEXT PRIMARY KEY, role TEXT, enabled INTEGER)")
        self.db.execute(
            "INSERT INTO admin_identities VALUES(?,?,1)",
            ("75a7c311-3f6e-4c95-8a66-9b98f6dd26ad", "super_admin"),
        )

    def tearDown(self):
        self.db.close()

    def test_aal1_admin_session_is_enough_for_one_admin_approval(self):
        result = module.admin_identity(token(aal="aal1"), self.db)
        self.assertEqual(result["user_id"], "75a7c311-3f6e-4c95-8a66-9b98f6dd26ad")
        self.assertEqual(result["role"], "super_admin")
        self.assertEqual(result["auth_level"], "aal1")

    def test_existing_aal2_session_remains_accepted(self):
        result = module.admin_identity(token(aal="aal2"), self.db)
        self.assertEqual(result["auth_level"], "aal2")

    def test_wrong_subject_or_unverified_level_is_rejected(self):
        self.assertIsNone(module.admin_identity(token(aal="aal1", sub="other-user"), self.db))
        self.assertIsNone(module.admin_identity(token(aal="aal3"), self.db))

    def test_disabled_or_non_super_admin_is_rejected(self):
        self.db.execute("UPDATE admin_identities SET enabled=0")
        self.assertIsNone(module.admin_identity(token(), self.db))
        self.db.execute("UPDATE admin_identities SET enabled=1,role='admin'")
        self.assertIsNone(module.admin_identity(token(), self.db))


if __name__ == "__main__":
    unittest.main()
