"""Offline-only safety tests for GPT02 restricted Core-preparation credential staging."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest

SOURCE = Path(__file__).resolve().parent / "gpt02_issue159_stage_core_prep_sql_editor.py"
spec = importlib.util.spec_from_file_location("core_prep_stager", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CorePrepCredentialStagingTest(unittest.TestCase):
    def test_scram_sql_is_scoped_to_only_existing_core_prep_role(self):
        password = "fixture-password-not-a-real-secret-" * 3
        verifier = module.scram_verifier(password, bytes(range(16)))
        sql = module.activation_sql(verifier)
        self.assertTrue(verifier.startswith("SCRAM-SHA-256$4096:"))
        self.assertNotIn(password, sql)
        self.assertIn("ALTER ROLE gpt02_core_prep_login LOGIN PASSWORD 'SCRAM-SHA-256", sql)
        self.assertIn("CORE_PREP_NOLOGIN_ROLE_DRIFT", sql)
        self.assertIn("CORE_PREP_DIRECT_DML_DENIED", sql)
        self.assertIn("CORE_PREP_EXECUTE_GRANT_REQUIRED", sql)
        self.assertIn("session_user <> 'postgres'", sql)
        self.assertNotIn("ALTER ROLE postgres", sql)
        self.assertNotIn("CREATE ROLE", sql)
        self.assertNotIn("SECURITY DEFINER", sql)

    def test_bad_verifier_input_denied(self):
        for payload in ("plaintext", "SCRAM-SHA-256$4096:x'; DROP ROLE postgres; --",
                        "SCRAM-SHA-256$4096:__\\n"):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                module.activation_sql(payload)

    def test_noninteractive_cannot_stage_any_secret(self):
        proc = subprocess.run([sys.executable, str(SOURCE)],
                              input="", capture_output=True, text=True,
                              timeout=5, check=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("CORE_PREP_STAGING_STOPPED", proc.stderr)
        self.assertNotIn("CORE_PREP_SQL_EDITOR_READY", proc.stdout)

    def test_no_direct_database_or_dispatch_actions(self):
        body = SOURCE.read_text()
        for expected in ("ROOT_INTERACTIVE_TERMINAL_REQUIRED",
                         "systemd-creds", "--with-key=host",
                         "os.O_EXCL", "os.O_NOFOLLOW",
                         "sslmode=\"verify-full\"",
                         "gpt02_core_prep_login.xssrfshdrtdfupgqwfdw"):
            if expected.endswith(".xssrfshdrtdfupgqwfdw"):
                self.assertIn("user=f\"{ROLE}.{PROJECT_REF}\"", body)
            else:
                self.assertIn(expected, body)
        for forbidden in ("psycopg.connect(", "systemctl start", "systemctl enable",
                          "GPT02_ISSUE159_SIGNING_ENABLED=true",
                          "prepare_core_task(%s", "print(password)", "print(dsn)"):
            self.assertNotIn(forbidden, body)


if __name__ == "__main__":
    unittest.main()
