#!/usr/bin/env python3
"""Call the real DEV start() boundary with synthetic config and fake processes."""
from __future__ import annotations

import contextlib
import importlib.util
import io
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import gpt02_superadmin_reader_mount_gate as gate
from test_gpt02_superadmin_reader_mount_gate import public_configuration

SCRIPT = Path(__file__).with_name("deploy_dev_release.py")
SPEC = importlib.util.spec_from_file_location("tested_owner_reader_release", SCRIPT)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)

SHA = "a" * 40
LOADER = ("systemctl", "start", "gpt02-owner-ledger-credential-loader.service")


class ReaderReleaseIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.values = public_configuration()
        self.values["SESSION_SECRET"] = "SYNTHETIC_NEVER_PRINT_OR_PASS_AS_ARG"
        self.environment = self.stack.enter_context(patch.object(release, "env_guard", return_value=self.values))
        self.command = self.stack.enter_context(patch.object(release, "command"))
        self.stack.enter_context(patch.object(release.subprocess, "run", side_effect=AssertionError("real process forbidden")))
        self.stack.enter_context(patch.object(release, "urlopen", side_effect=AssertionError("network forbidden")))
        self.stack.enter_context(patch.object(gate, "_root_parents", return_value=True))
        self.files = self.stack.enter_context(patch.object(gate, "_regular_root_file", return_value=True))
        self.directory = SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0, st_gid=0)
        self.lstat = self.stack.enter_context(patch.object(Path, "lstat", return_value=self.directory))
        self.stat = self.stack.enter_context(patch.object(Path, "stat", return_value=self.directory))
        self.stack.enter_context(patch.object(Path, "read_text", side_effect=AssertionError("real config read forbidden")))
        self.stack.enter_context(patch.object(Path, "read_bytes", side_effect=AssertionError("credential read forbidden")))

    def tearDown(self):
        self.stack.close()

    def start(self, live=False):
        release.start("core-ai-dev" if live else "cst-dev-canary-" + SHA[:12], 18082 if live else 18084, "synthetic-test-image", SHA)

    def test_disabled_actual_start_has_no_protected_file_io_unit_start_or_reader_mounts(self):
        self.values[gate.READER_FLAG] = "false"
        self.files.side_effect = AssertionError("disabled file inspection")
        self.lstat.side_effect = AssertionError("disabled lstat")
        self.stat.side_effect = AssertionError("disabled stat")
        self.start()
        self.assertEqual(self.command.call_count, 1)
        argv = self.command.call_args.args
        self.assertEqual(argv[:2], ("docker", "run"))
        for path in (gate.READER_FILE, gate.TRUST_CA, gate.CUSTODY_DIR):
            self.assertNotIn(str(path), " ".join(map(str, argv)))
        self.files.assert_not_called()
        self.lstat.assert_not_called()
        self.stat.assert_not_called()

    def test_enabled_actual_start_loads_then_mounts_for_both_canary_and_live(self):
        self.start()
        self.start(live=True)
        commands = [call.args for call in self.command.call_args_list]
        self.assertEqual(commands[0], LOADER)
        self.assertEqual(commands[2], LOADER)
        self.assertEqual(self.environment.call_count, 2)
        expected = {
            f"type=bind,source={path},target={path},readonly"
            for path in (gate.READER_FILE, gate.TRUST_CA, gate.CUSTODY_DIR)
        }
        for argv in (commands[1], commands[3]):
            self.assertEqual(argv[:2], ("docker", "run"))
            mounts = {argv[index + 1] for index, value in enumerate(argv) if value == "--mount"}
            self.assertTrue(expected.issubset(mounts))
            self.assertFalse(any(str(proof) in mount for proof in (gate.WORKER_PROOF, gate.DBA_PROOF) for mount in mounts))
            self.assertIn("cst.dev.commit=" + SHA, argv)
            self.assertIn("APP_ENV=development", argv)
            self.assertIn("NODE_ENV=development", argv)
            self.assertNotIn(self.values["SESSION_SECRET"], " ".join(map(str, argv)))
            self.assertFalse(any(value in argv for value in ("psql", "systemd-creds", "--privileged")))

    def test_environment_project_or_pin_mismatch_prevents_unit_and_docker(self):
        cases = (
            {"APP_ENV": "production"}, {"NODE_ENV": "test"},
            {"SUPABASE_URL_DEV": "https://other-project.supabase.co"},
            {"GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256": "0" * 64},
        )
        for changed in cases:
            self.environment.return_value = {**self.values, **changed}
            with self.subTest(fields=list(changed)), self.assertRaises(gate.ReaderMountDenied) as caught:
                self.start()
            self.assertRegex(str(caught.exception), r"^READER_[A-Z_]+$")
            self.command.assert_not_called()
        self.files.assert_not_called()

    def test_missing_proof_is_rejected_before_loading_a_credential(self):
        self.files.side_effect = lambda path, **kwargs: path != gate.WORKER_PROOF
        with self.assertRaisesRegex(gate.ReaderMountDenied, "CUSTODY_PROOF_FILE_UNAVAILABLE"):
            self.start()
        self.command.assert_not_called()

    def test_loader_startup_failure_never_starts_docker(self):
        self.command.side_effect = subprocess.CalledProcessError(1, LOADER)
        with self.assertRaises(subprocess.CalledProcessError):
            self.start()
        self.assertEqual([call.args for call in self.command.call_args_list], [LOADER])

    def test_successful_unit_without_a_valid_reader_mount_never_starts_docker(self):
        self.files.side_effect = lambda path, **kwargs: path != gate.READER_FILE
        with self.assertRaisesRegex(gate.ReaderMountDenied, "CREDENTIAL_CUSTODY_INVALID"):
            self.start()
        self.assertEqual([call.args for call in self.command.call_args_list], [LOADER])


class SyntheticEnvironmentTests(unittest.TestCase):
    def test_real_environment_guard_returns_the_feature_values_without_printing_them(self):
        # A synthetic env file only; never touch the deployment's real env file.
        values = {
            **public_configuration(), "SUPABASE_DATABASE_URL_DEV": "synthetic-database-reference",
            "SUPABASE_SERVICE_ROLE_KEY_DEV": "synthetic-service-value", "SESSION_SECRET": "synthetic-session-value",
        }
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / "synthetic.env"
            env.write_text("\n".join(key + "=" + value for key, value in values.items()))
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch.object(release, "ENV", env), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                self.assertEqual(release.env_guard(), values)
            self.assertEqual(stdout.getvalue() + stderr.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
