"""Offline tests: preparing reader credentials must never run in CI or in chat."""
from pathlib import Path
import ast
import importlib.util
import subprocess
import sys
import unittest

FILE = Path(__file__).resolve().parent / "gpt02_issue159_prepare_lineage_sql_editor.py"
spec = importlib.util.spec_from_file_location("lineage_sql_editor_prepare", FILE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LineageSqlEditorPrepareTests(unittest.TestCase):
    def test_scram_derived_password_is_not_in_sql(self):
        password = "synthetic-test-password_" * 4
        salt = bytes(range(16))
        verifier = module.scram_verifier(password, salt)
        self.assertTrue(verifier.startswith("SCRAM-SHA-256$4096:"))
        self.assertEqual(verifier.count("$"), 2)
        sql = module.sql_for_reader(verifier)
        self.assertNotIn(password, sql)
        self.assertIn("ALTER ROLE dev_gpt02_lineage_login LOGIN PASSWORD 'SCRAM-SHA-256", sql)
        self.assertIn("LINEAGE_READ_ONLY_OR_FORCE_RLS_INVALID", sql)
        self.assertIn("LINEAGE_RLS_POLICIES_INCOMPLETE", sql)
        self.assertNotIn("ALTER ROLE postgres", sql)
        self.assertNotIn("CREATE ROLE", sql)

    def test_malformed_scram_rejected(self):
        for value in ("plaintext-password", "SCRAM-SHA-256$4096:x'; DROP ROLE postgres; --",
                      "SCRAM-SHA-256$4096:\\n"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.sql_for_reader(value)

    def test_noninteractive_invocation_fails_before_writing(self):
        result = subprocess.run([sys.executable, str(FILE)], input="", text=True,
                                capture_output=True, timeout=5, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("PREPARATION_STOPPED", result.stderr)
        self.assertNotIn("SQL_EDITOR_PREPARATION_READY", result.stdout)

    def test_source_forbids_service_or_credential_reuse(self):
        body = FILE.read_text()
        ast.parse(body)
        for required in ("--with-key=host", "systemd-creds", "os.O_EXCL", "os.O_NOFOLLOW",
                         "CREDENTIAL.unlink(missing_ok=True)", "sys.stdin.isatty()",
                         "default_transaction_read_only=on", "sslmode=\"verify-full\""):
            self.assertIn(required, body)
        for forbidden in ("systemctl start", "systemctl enable", "GPT02_ISSUE159_SIGNING_ENABLED=true",
                          "service_role", "print(password)", "print(dsn)"):
            self.assertNotIn(forbidden, body)


if __name__ == "__main__":
    unittest.main()
