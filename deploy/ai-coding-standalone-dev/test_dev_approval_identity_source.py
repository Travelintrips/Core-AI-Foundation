import ast
import base64
import importlib
import json
import os
import sqlite3
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
EXPECTED_URL = "https://xssrfshdrtdfupgqwfdw.supabase.co"
SYNTHETIC_KEY = "sb_publishable_" + ("x" * 40)


def reload_identity_modules(env):
    for name in ("approval_api", "admin_identity", "supabase_identity"):
        sys.modules.pop(name, None)
    with patch.dict(os.environ, env, clear=False):
        import supabase_identity
        import admin_identity
        return (
            importlib.reload(supabase_identity),
            importlib.reload(admin_identity),
        )


def token(payload):
    def enc(value):
        return base64.urlsafe_b64encode(
            json.dumps(value, separators=(",", ":")).encode()
        ).decode().rstrip("=")

    return ".".join(
        (
            enc({"alg": "none", "typ": "JWT"}),
            enc(payload),
            "s" * 64,
        )
    )


class Response:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, *_):
        return self.body


class ApprovalIdentitySourceTests(unittest.TestCase):
    def test_missing_or_wrong_dev_config_fails_closed_before_network(self):
        for env in (
            {
                "AICODING_SUPABASE_URL": "",
                "AICODING_SUPABASE_PUBLISHABLE_KEY": "",
            },
            {
                "AICODING_SUPABASE_URL": "https://other.supabase.co",
                "AICODING_SUPABASE_PUBLISHABLE_KEY": SYNTHETIC_KEY,
            },
            {
                "AICODING_SUPABASE_URL": EXPECTED_URL,
                "AICODING_SUPABASE_PUBLISHABLE_KEY": "short",
            },
        ):
            supabase_identity, _ = reload_identity_modules(env)
            self.assertFalse(supabase_identity.configuration_ready())
            with patch.object(
                supabase_identity.urllib.request,
                "urlopen",
                side_effect=AssertionError("network must not be called"),
            ):
                self.assertIsNone(
                    supabase_identity.verified_identity("t" * 80)
                )

    def test_verified_identity_uses_exact_env_backed_dev_target(self):
        supabase_identity, _ = reload_identity_modules(
            {
                "AICODING_SUPABASE_URL": EXPECTED_URL + "/",
                "AICODING_SUPABASE_PUBLISHABLE_KEY": SYNTHETIC_KEY,
            }
        )
        self.assertTrue(supabase_identity.configuration_ready())
        seen = {}

        def fake_urlopen(req, timeout):
            seen["url"] = req.full_url
            seen["apikey"] = req.headers.get("Apikey")
            seen["authorization"] = req.headers.get("Authorization")
            seen["timeout"] = timeout
            return Response(
                {
                    "id": "google_fixture_super_admin",
                    "email": "admin@example.invalid",
                    "email_confirmed_at": "2026-11-11T00:00:00Z",
                }
            )

        with patch.object(
            supabase_identity.urllib.request, "urlopen", fake_urlopen
        ):
            result = supabase_identity.verified_identity("t" * 80)

        self.assertEqual(
            result,
            {
                "user_id": "google_fixture_super_admin",
                "email": "admin@example.invalid",
            },
        )
        self.assertEqual(seen["url"], EXPECTED_URL + "/auth/v1/user")
        self.assertEqual(seen["apikey"], SYNTHETIC_KEY)
        self.assertEqual(seen["authorization"], "Bearer " + ("t" * 80))
        self.assertEqual(seen["timeout"], 5)

    def test_admin_identity_requires_aal2_subject_and_enabled_role(self):
        supabase_identity, admin_identity = reload_identity_modules(
            {
                "AICODING_SUPABASE_URL": EXPECTED_URL,
                "AICODING_SUPABASE_PUBLISHABLE_KEY": SYNTHETIC_KEY,
            }
        )
        connection = sqlite3.connect(":memory:")
        connection.execute(
            "CREATE TABLE admin_identities "
            "(user_id TEXT PRIMARY KEY,role TEXT NOT NULL,enabled INTEGER NOT NULL)"
        )
        connection.execute(
            "INSERT INTO admin_identities VALUES (?,?,1)",
            ("google_fixture_super_admin", "super_admin"),
        )

        user = {
            "id": "google_fixture_super_admin",
            "email": "admin@example.invalid",
            "email_confirmed_at": "2026-11-11T00:00:00Z",
        }
        good = token(
            {
                "iss": EXPECTED_URL + "/auth/v1",
                "aud": "authenticated",
                "sub": user["id"],
                "aal": "aal2",
            }
        )
        bad = token(
            {
                "iss": EXPECTED_URL + "/auth/v1",
                "aud": "authenticated",
                "sub": user["id"],
                "aal": "aal1",
            }
        )
        with patch.object(
            supabase_identity.urllib.request,
            "urlopen",
            return_value=Response(user),
        ):
            self.assertEqual(
                admin_identity.admin_identity(good, connection),
                {
                    "user_id": user["id"],
                    "email": user["email"],
                    "role": "super_admin",
                    "auth_method": "supabase_aal2",
                },
            )
            self.assertIsNone(
                admin_identity.admin_identity(bad, connection)
            )

    def test_login_template_is_placeholder_only_and_rendered_from_env(self):
        template = (HERE / "admin_login.html").read_text()
        self.assertIn("__AICODING_SUPABASE_AUTH_BASE_JSON__", template)
        self.assertIn(
            "__AICODING_SUPABASE_PUBLISHABLE_KEY_JSON__", template
        )
        self.assertNotIn(EXPECTED_URL, template)
        self.assertNotIn(SYNTHETIC_KEY, template)

        for name in ("approval_api", "admin_identity", "supabase_identity"):
            sys.modules.pop(name, None)
        with patch.dict(
            os.environ,
            {
                "AICODING_SUPABASE_URL": EXPECTED_URL,
                "AICODING_SUPABASE_PUBLISHABLE_KEY": SYNTHETIC_KEY,
                "AICODING_APPROVAL_TOKEN": "z" * 40,
            },
            clear=False,
        ):
            import approval_api
            approval_api = importlib.reload(approval_api)
            body = approval_api.render_admin_login()
        self.assertIsNotNone(body)
        rendered = body.decode()
        self.assertNotIn("__AICODING_SUPABASE_", rendered)
        self.assertIn(
            json.dumps(EXPECTED_URL + "/auth/v1"), rendered
        )
        self.assertIn(json.dumps(SYNTHETIC_KEY), rendered)

    def test_login_rendering_fails_closed_without_runtime_config(self):
        for name in ("approval_api", "admin_identity", "supabase_identity"):
            sys.modules.pop(name, None)
        with patch.dict(
            os.environ,
            {
                "AICODING_SUPABASE_URL": "",
                "AICODING_SUPABASE_PUBLISHABLE_KEY": "",
                "AICODING_APPROVAL_TOKEN": "z" * 40,
            },
            clear=False,
        ):
            import approval_api
            approval_api = importlib.reload(approval_api)
            self.assertIsNone(approval_api.render_admin_login())

    def test_sources_do_not_embed_publishable_runtime_key(self):
        source = (HERE / "supabase_identity.py").read_text()
        tree = ast.parse(source)
        assignment = None
        for node in tree.body:
            if isinstance(node, ast.Assign):
                if any(
                    isinstance(target, ast.Name)
                    and target.id == "PUBLISHABLE_KEY"
                    for target in node.targets
                ):
                    assignment = node.value
        self.assertIsInstance(assignment, ast.Call)
        self.assertIn("AICODING_SUPABASE_PUBLISHABLE_KEY", source)

        approval = (HERE / "approval_api.py").read_text()
        self.assertNotIn(
            "https://xssrfshdrtdfupgqwfdw.supabase.co; base-uri", approval
        )
        self.assertIn("login_config_unavailable", approval)
        self.assertIn("render_admin_login", approval)


if __name__ == "__main__":
    unittest.main()
