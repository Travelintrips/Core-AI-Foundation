"""Fail-closed checks for interactive-only DEV reader secret provisioning."""
import ast
import subprocess
import sys
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[0] / "gpt02_issue159_provision_lineage_reader_interactive.py"


class ProvisionerSafetyTest(unittest.TestCase):
    def test_source_has_passwordless_output_and_scram_only_sql(self):
        body = SOURCE.read_text()
        ast.parse(body)
        for required in (
            "getpass.getpass(", "SCRAM-SHA-256$4096:",
            "sql.Literal(verifier)", "LINEAGE_FORCE_RLS_OR_READONLY_GRANT_DRIFT",
            "CREDENTIAL.unlink(missing_ok=True)",
            "INTERACTIVE_LOCAL_TERMINAL_REQUIRED",
            "sslmode", "verify-full", "secrets.token_urlsafe(64)",
        ):
            self.assertIn(required, body)
        for forbidden in (
            "print(password)", "print(admin_dsn)", "ALTER ROLE dev_gpt02_lineage_login LOGIN PASSWORD %s",
            "GPT02_ISSUE159_SIGNING_ENABLED=true", "service_role",
            "systemctl start", "systemctl enable",
        ):
            self.assertNotIn(forbidden, body)

    def test_noninteractive_execution_must_fail_before_secret_access(self):
        process = subprocess.run(
            [sys.executable, str(SOURCE)], input="", text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            check=False, timeout=5)
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("PROVISIONING_FAILED", process.stderr)
        self.assertNotIn("DEV_READER_LOGIN_ENABLED", process.stdout)


if __name__ == "__main__":
    unittest.main()
