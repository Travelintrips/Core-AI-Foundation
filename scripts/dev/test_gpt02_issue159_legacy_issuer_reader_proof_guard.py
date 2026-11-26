#!/usr/bin/env python3
"""Offline fail-closed guard for the preserved legacy issuer-reader proof.

No Docker, database, private credential, signer or network request is used:
the executable is run against PATH-local synthetic stubs only.
"""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).with_name("gpt02-issuer-native-reader-proof-once.sh")


class LegacyIssuerProofCatalogGuardTest(unittest.TestCase):
    def run_denied(self, state: str, *, docker_exit: int = 0):
        with tempfile.TemporaryDirectory(prefix="gpt02-issuer-proof-guard-") as temp:
            root = Path(temp)
            fake_bin = root / "fakebin"
            fake_bin.mkdir()
            fixture = root / "worktree"
            ca = fixture / "scripts" / "dev" / "fixtures" / "supabase-root-ca-2021.crt"
            ca.parent.mkdir(parents=True)
            ca.write_text("synthetic-fixture-only")
            env_file = root / "development.env"
            env_file.write_text("SYNTHETIC_ONLY=yes\n")
            calls = root / "calls.log"

            (fake_bin / "id").write_text(
                "#!/bin/sh\n"
                'if [ "$1" = "-u" ]; then echo 0; else /usr/bin/id "$@"; fi\n'
            )
            (fake_bin / "docker").write_text(
                "#!/bin/sh\n"
                'printf "docker\\n" >> "$FIXTURE_CALL_LOG"\n'
                'printf "%s\\n" "$FIXTURE_CATALOG_STATE"\n'
                'exit "$FIXTURE_DOCKER_EXIT"\n'
            )
            (fake_bin / "openssl").write_text(
                "#!/bin/sh\n"
                'printf "UNSAFE_SECRET_GENERATION_REACHED\\n" >> "$FIXTURE_CALL_LOG"\n'
                'exit 73\n'
            )
            for name in ("id", "docker", "openssl"):
                (fake_bin / name).chmod(0o755)

            env = {
                "PATH": str(fake_bin) + os.pathsep + "/usr/bin:/bin",
                "HOME": str(root),
                "GPT02_APP_ENV_FILE": str(env_file),
                "GPT02_PROOF_WORKTREE": str(fixture),
                "FIXTURE_CALL_LOG": str(calls),
                "FIXTURE_CATALOG_STATE": state,
                "FIXTURE_DOCKER_EXIT": str(docker_exit),
            }
            result = subprocess.run(
                ["/bin/bash", str(SOURCE)], env=env,
                capture_output=True, text=True, timeout=8,
            )
            return result, calls.read_text().splitlines() if calls.exists() else []

    def test_installed_catalog_denied_before_secret_or_role_open(self):
        result, calls = self.run_denied("INDEPENDENT_RELOCK_CATALOG_INSTALLED")
        self.assertEqual(result.returncode, 2)
        self.assertIn(
            "GPT02_ISSUER_READER_PROOF_FAIL:"
            "RELOCK_CATALOG_REQUIRES_SUPERVISED_WINDOW",
            result.stderr,
        )
        self.assertEqual(calls, ["docker"])
        self.assertNotIn("ISSUER_NATIVE_READER_PROOF=PASS", result.stdout)

    def test_unknown_identity_and_malformed_catalog_denied(self):
        for state in ("INVALID_DATABASE_IDENTITY", "", "something else"):
            with self.subTest(state=state):
                result, calls = self.run_denied(state)
                self.assertEqual(result.returncode, 2)
                self.assertIn("RELOCK_CATALOG_REQUIRES_SUPERVISED_WINDOW",
                              result.stderr)
                self.assertEqual(calls, ["docker"])

    def test_database_connection_failure_denied(self):
        result, calls = self.run_denied("", docker_exit=2)
        self.assertEqual(result.returncode, 2)
        self.assertIn("RELOCK_CATALOG_PREFLIGHT_UNAVAILABLE", result.stderr)
        self.assertEqual(calls, ["docker"])

    def test_guard_precedes_any_secret_generation_and_login(self):
        text = SOURCE.read_text()
        self.assertLess(text.index('RELOCK_CATALOG_STATE="$(docker run'),
                        text.index('PASS="$(openssl rand -hex 32)"'))
        self.assertLess(text.index('RELOCK_CATALOG_REQUIRES_SUPERVISED_WINDOW'),
                        text.index('ALTER ROLE gpt02_issuer_evidence_reader LOGIN'))
        self.assertIn("APP_ENV_FILE", text)
        self.assertIn("gpt02_relock_audit.writer_issuance_watchdog", text)
        # The catalog is rechecked atomically inside the transaction that
        # would otherwise unlock the role. A changed state fails closed.
        self.assertLess(text.index("DO $relock_guard$"),
                        text.index("ALTER ROLE gpt02_issuer_evidence_reader LOGIN"))
        self.assertIn("RELOCK_UNTRACKED_LEGACY_READER_WINDOW_DENIED", text)


if __name__ == "__main__":
    unittest.main()
