#!/usr/bin/env python3
"""Synthetic worker-key loading and real release-callsite tests; no live keys."""
from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import gpt02_superadmin_reader_mount_gate as gate
import test_gpt02_owner_reader_credential_loader as reader_fixture
from test_gpt02_superadmin_reader_mount_gate import public_configuration

loader = reader_fixture.loader
PREFIX = bytes.fromhex("302e020100300506032b657004220420")
# Public, deterministic format fixture. Never trusted, generated, or installed.
SYNTHETIC_KEY = PREFIX + bytes(32)
SCRIPT = Path(__file__).with_name("deploy_dev_release.py")
SPEC = importlib.util.spec_from_file_location("tested_worker_key_release", SCRIPT)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
SHA = "a" * 40
WORKER_UNIT = ("systemctl", "start", "gpt02-reader-custody-worker-attestor-key-loader.service")
READER_UNIT = ("systemctl", "start", "gpt02-owner-ledger-credential-loader.service")


def worker_configuration():
    values = public_configuration()
    values[gate.READER_FLAG] = "false"
    values[gate.WORKER_ISSUER_FLAG] = "true"
    for key in list(values):
        if key.startswith("GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI"):
            del values[key]
    return values


class WorkerKeyLoaderTests(unittest.TestCase):
    def setUp(self):
        # Reuse the exercised descriptor/metadata fixture, not its test methods.
        self.fixture = reader_fixture.ReaderCredentialLoaderTests(
            "test_publishes_exact_valid_bytes_as_private_file_and_closes_descriptors",
        )
        self.fixture.setUp()
        self.fixture.source.unlink()
        self.fixture.source = self.fixture.source_dir / "private-key.pkcs8"
        self.fixture.target = self.fixture.reader_dir / "private-key.pkcs8"
        self.fixture.source.write_bytes(SYNTHETIC_KEY)
        self.fixture.source.chmod(0o400)
        for name, value in (
            ("WORKER_SOURCE_FILE", self.fixture.source),
            ("WORKER_KEY_DIR", self.fixture.reader_dir),
            ("WORKER_KEY_FILE", self.fixture.target),
        ):
            self.fixture.stack.enter_context(patch.object(loader, name, value))
        self.fixture.stack.enter_context(patch.dict(os.environ, {loader.WORKER_ISSUER_FLAG: "true"}))

    def tearDown(self):
        self.fixture.tearDown()

    def denied(self, code):
        with self.assertRaises(loader.LoaderDenied) as caught:
            loader.load_worker_attestor_key()
        self.assertEqual(caught.exception.code, code)
        self.assertEqual(self.fixture.open_fds, set())
        self.assertFalse(self.fixture.target.exists())
        self.assertEqual(list(self.fixture.reader_dir.glob(".private-key.pkcs8-*")), [])

    def test_fixed_worker_profile_publishes_only_the_exact_private_file_without_output(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            loader.load_worker_attestor_key()
        self.assertEqual(self.fixture.target.read_bytes(), SYNTHETIC_KEY)
        self.assertEqual(stat.S_IMODE(self.fixture.target.stat().st_mode), 0o600)
        self.assertEqual(self.fixture.target.stat().st_nlink, 1)
        self.assertFalse((self.fixture.reader_dir / "reader.json").exists())
        self.assertEqual(stdout.getvalue() + stderr.getvalue(), "")
        names = [str(path) for path, _, _ in self.fixture.open_calls]
        self.assertIn("private-key.pkcs8", names)
        self.assertNotIn("reader.json", names)

    def test_disabled_or_malformed_flag_performs_no_file_io(self):
        for value in (None, "false", "1", "TRUE"):
            with self.subTest(value=value), patch.dict(os.environ):
                if value is None:
                    os.environ.pop(loader.WORKER_ISSUER_FLAG, None)
                else:
                    os.environ[loader.WORKER_ISSUER_FLAG] = value
                with patch.object(loader.os, "open") as opened:
                    self.denied("WORKER_ATTESTOR_KEY_DISABLED")
                    opened.assert_not_called()

    def test_non_dev_or_non_root_denied_before_key_read(self):
        for name in ("APP_ENV", "NODE_ENV"):
            with self.subTest(name=name), patch.dict(os.environ, {name: "production"}), \
                    patch.object(loader.os, "open") as opened:
                self.denied("READER_LOADER_ENV_INVALID")
                opened.assert_not_called()
        with patch.object(loader.os, "geteuid", return_value=1000), \
                patch.object(loader.os, "open") as opened:
            self.denied("READER_LOADER_ROOT_REQUIRED")
            opened.assert_not_called()

    def test_only_canonical_48_byte_pkcs8_is_accepted(self):
        cases = (
            (PREFIX + bytes(31), "WORKER_ATTESTOR_KEY_INVALID"),
            (PREFIX + bytes(33), "READER_SOURCE_UNSAFE"),
            (bytes(48), "WORKER_ATTESTOR_KEY_INVALID"),
            (bytes.fromhex("302e020100300506032b657104220420") + bytes(32), "WORKER_ATTESTOR_KEY_INVALID"),
            (b"-----BEGIN PRIVATE KEY-----", "WORKER_ATTESTOR_KEY_INVALID"),
            (reader_fixture.PAYLOAD, "READER_SOURCE_UNSAFE"),
        )
        for index, (payload, code) in enumerate(cases):
            with self.subTest(case=index):
                self.fixture.set_source(payload)
                self.denied(code)

    def test_worker_read_growth_is_bounded_to_49_bytes(self):
        total = 0

        def read(fd, size):
            nonlocal total
            self.fixture.set_source(SYNTHETIC_KEY + bytes(500))
            result = self.fixture.real_read(fd, size)
            total += len(result)
            return result

        with patch.object(loader.os, "read", side_effect=read):
            self.denied("READER_SOURCE_TOO_LARGE")
        self.assertEqual(total, 49)

    def test_worker_hardlink_or_symlink_is_not_accepted(self):
        other = self.fixture.root / "not-a-live-key"
        os.link(self.fixture.source, other)
        self.denied("READER_SOURCE_UNSAFE")
        self.fixture.source.unlink()
        self.fixture.source.symlink_to(other)
        self.denied("READER_SOURCE_UNAVAILABLE")

    def test_worker_write_failure_leaves_no_partial_publication(self):
        with patch.object(loader.os, "write", side_effect=OSError("synthetic-private-material")):
            self.denied("READER_PUBLICATION_FAILED")

    def test_explicit_profile_cli_has_only_fixed_diagnostics(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr), \
                patch.object(loader, "load_worker_attestor_key", side_effect=RuntimeError("synthetic-private-material")), \
                patch.object(loader, "load_reader_credential") as reader:
            self.assertEqual(loader.main(["--worker-attestor-key"]), 1)
            reader.assert_not_called()
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(stderr.getvalue(), "GPT02_WORKER_ATTESTOR_KEY_LOAD=BLOCKED code=READER_LOADER_FAILED\n")
        with contextlib.redirect_stderr(io.StringIO()), \
                patch.object(loader, "load_worker_attestor_key") as worker:
            self.assertEqual(loader.main(["--worker-attestor-key", "/arbitrary/path"]), 1)
            worker.assert_not_called()


class WorkerKeyUnitTests(unittest.TestCase):
    def test_unit_consumes_exact_named_encrypted_input_without_default_activation(self):
        unit = SCRIPT.parents[2] / "deploy/ai-coding-standalone-dev/gpt02-reader-custody-worker-attestor-key-loader.service"
        lines = [line.strip() for line in unit.read_text().splitlines() if line.strip() and not line.lstrip().startswith("#")]
        settings = {}
        for line in lines:
            if "=" in line:
                name, value = line.split("=", 1)
                settings.setdefault(name, []).append(value)
        self.assertNotIn("[Install]", lines)
        self.assertNotIn("EnvironmentFile", settings)
        self.assertEqual(settings["LoadCredentialEncrypted"], [
            "private-key.pkcs8:/etc/credstore.encrypted/gpt02-reader-custody-worker-attestor.pkcs8",
        ])
        self.assertEqual(settings["ExecStart"], [
            "/usr/bin/python3 /usr/local/libexec/cst-dev/gpt02_owner_reader_credential_loader.py --worker-attestor-key",
        ])
        self.assertEqual(settings["RuntimeDirectory"], ["credentials/gpt02-reader-custody-worker-attestor"])
        self.assertEqual(settings["RuntimeDirectoryMode"], ["0700"])
        self.assertEqual(settings["RuntimeDirectoryPreserve"], ["no"])
        self.assertEqual(settings["ReadWritePaths"], [str(gate.WORKER_KEY_DIR)])
        self.assertEqual(settings["PrivateNetwork"], ["yes"])
        self.assertEqual(settings["ProtectSystem"], ["strict"])
        self.assertEqual(settings["User"], ["root"])
        self.assertEqual(settings["Group"], ["root"])
        self.assertEqual(settings["CapabilityBoundingSet"], [""])
        self.assertIn(gate.WORKER_ISSUER_FLAG + "=true", settings["Environment"])


class WorkerKeyReleaseTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.values = worker_configuration()
        self.environment = self.stack.enter_context(patch.object(release, "env_guard", return_value=self.values))
        self.command = self.stack.enter_context(patch.object(release, "command"))
        self.stack.enter_context(patch.object(release.subprocess, "run", side_effect=AssertionError("process forbidden")))
        self.stack.enter_context(patch.object(Path, "read_bytes", side_effect=AssertionError("private key read forbidden")))
        self.stack.enter_context(patch.object(Path, "read_text", side_effect=AssertionError("credential read forbidden")))
        self.override = {}
        self.lstat = self.stack.enter_context(patch.object(Path, "lstat", autospec=True, side_effect=self.metadata))

    def tearDown(self):
        self.stack.close()

    def metadata(self, path):
        if path == gate.WORKER_KEY_FILE:
            values = dict(st_mode=stat.S_IFREG | 0o600, st_uid=0, st_gid=0, st_nlink=1, st_size=48)
            values.update(self.override)
            return SimpleNamespace(**values)
        if path == gate.WORKER_KEY_DIR:
            return SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0, st_gid=0)
        if path in gate.WORKER_KEY_DIR.parents:
            return SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0, st_gid=0)
        raise AssertionError("worker-only mode inspected an unrelated credential/proof/CA")

    def start(self, live=False):
        release.start("core-ai-dev" if live else "test-canary", 18082 if live else 18084, "synthetic-image", SHA)

    def test_disabled_worker_and_reader_start_no_unit_and_inspect_no_paths(self):
        self.values[gate.WORKER_ISSUER_FLAG] = "false"
        self.lstat.side_effect = AssertionError("disabled metadata access")
        self.start()
        self.assertEqual(self.command.call_count, 1)
        self.assertEqual(self.command.call_args.args[:2], ("docker", "run"))
        self.assertNotIn("--mount", self.command.call_args.args)
        self.lstat.assert_not_called()

    def test_worker_bootstrap_needs_no_dba_key_proof_ca_or_reader_credential(self):
        self.start()
        self.start(live=True)
        calls = [item.args for item in self.command.call_args_list]
        self.assertEqual(calls[0], WORKER_UNIT)
        self.assertEqual(calls[2], WORKER_UNIT)
        expected = f"type=bind,source={gate.WORKER_KEY_FILE},target={gate.WORKER_KEY_FILE},readonly"
        for args in (calls[1], calls[3]):
            self.assertEqual(args[:2], ("docker", "run"))
            self.assertEqual([args[i + 1] for i, part in enumerate(args) if part == "--mount"], [expected])
            self.assertIn("cst.dev.commit=" + SHA, args)
            self.assertNotIn(READER_UNIT, calls)

    def test_flag_env_project_and_public_pin_errors_prevent_unit_and_metadata_io(self):
        cases = (
            {gate.WORKER_ISSUER_FLAG: "1"}, {"APP_ENV": "production"}, {"NODE_ENV": "test"},
            {"SUPABASE_URL_DEV": "https://other.supabase.co"}, {"SUPABASE_URL": "https://prod.invalid"},
            {"GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64": ""},
            {"GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256": "0" * 64},
        )
        for changed in cases:
            self.environment.return_value = {**self.values, **changed}
            with self.subTest(fields=list(changed)), self.assertRaises(gate.ReaderMountDenied):
                self.start()
            self.command.assert_not_called()
            self.lstat.assert_not_called()

    def test_configured_dba_key_must_be_complete_valid_and_distinct(self):
        prefix = "GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI"
        attestor = "GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI"
        self.values[prefix + "_B64"] = self.values[attestor + "_B64"]
        with self.assertRaisesRegex(gate.ReaderMountDenied, "TRUST_CONFIGURATION_INVALID"):
            self.start()
        self.values[prefix + "_SHA256"] = self.values[attestor + "_SHA256"]
        with self.assertRaisesRegex(gate.ReaderMountDenied, "KEYS_MUST_DIFFER"):
            self.start()
        self.command.assert_not_called()
        self.lstat.assert_not_called()

    def test_present_but_empty_dba_pin_is_not_treated_as_unconfigured(self):
        prefix = "GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI"
        for fields in (
            {prefix + "_B64": ""}, {prefix + "_SHA256": ""},
            {prefix + "_B64": "", prefix + "_SHA256": ""},
        ):
            self.environment.return_value = {**self.values, **fields}
            with self.subTest(fields=list(fields)), self.assertRaisesRegex(gate.ReaderMountDenied, "TRUST_CONFIGURATION_INVALID"):
                self.start()
            self.command.assert_not_called()
            self.lstat.assert_not_called()

    def test_unsafe_private_key_metadata_rejects_docker_after_loader(self):
        for change in (
            {"st_uid": 1}, {"st_gid": 1}, {"st_nlink": 2}, {"st_mode": stat.S_IFLNK | 0o600},
            {"st_mode": stat.S_IFREG | 0o644}, {"st_size": 47}, {"st_size": 49},
        ):
            self.override = change
            self.command.reset_mock()
            with self.subTest(change=change), self.assertRaisesRegex(gate.ReaderMountDenied, "KEY_CUSTODY_UNAVAILABLE"):
                self.start()
            self.assertEqual([item.args for item in self.command.call_args_list], [WORKER_UNIT])

    def test_worker_loader_failure_never_starts_container(self):
        self.command.side_effect = subprocess.CalledProcessError(1, WORKER_UNIT)
        with self.assertRaises(subprocess.CalledProcessError):
            self.start()
        self.assertEqual([item.args for item in self.command.call_args_list], [WORKER_UNIT])
        self.lstat.assert_not_called()

    def test_existing_reader_and_custody_mounts_compose_with_worker_key_mount(self):
        self.values.update(public_configuration())
        directory = SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0, st_gid=0)
        self.lstat.side_effect = None
        self.lstat.return_value = directory
        with patch.object(gate, "_regular_root_file", return_value=True), \
                patch.object(gate, "_root_parents", return_value=True):
            self.start()
        calls = [item.args for item in self.command.call_args_list]
        self.assertEqual(calls[:2], [WORKER_UNIT, READER_UNIT])
        args = calls[2]
        mounts = {args[i + 1] for i, part in enumerate(args) if part == "--mount"}
        self.assertEqual(mounts, {
            f"type=bind,source={path},target={path},readonly"
            for path in (gate.WORKER_KEY_FILE, gate.READER_FILE, gate.TRUST_CA, gate.CUSTODY_DIR)
        })


class WorkerFlagEnvironmentTests(unittest.TestCase):
    def test_actual_release_rejects_quoted_or_whitespace_worker_flag_before_loading(self):
        values = {
            **worker_configuration(),
            "SUPABASE_DATABASE_URL_DEV": "synthetic-database-reference",
            "SUPABASE_SERVICE_ROLE_KEY_DEV": "synthetic-service-value",
            "SESSION_SECRET": "synthetic-session-value",
        }
        with tempfile.TemporaryDirectory() as directory:
            environment = Path(directory) / "synthetic.env"
            for raw in ('"true"', "'true'", " true", "true ", '"false"'):
                values[gate.WORKER_ISSUER_FLAG] = raw
                environment.write_text("\n".join(key + "=" + value for key, value in values.items()))
                with self.subTest(raw=raw), patch.object(release, "ENV", environment), \
                        patch.object(release, "command") as command, \
                        patch.object(Path, "lstat", side_effect=AssertionError("protected metadata IO")) as metadata:
                    self.assertEqual(release.env_guard()[gate.WORKER_ISSUER_FLAG], raw)
                    with self.assertRaisesRegex(gate.ReaderMountDenied, "WORKER_ISSUER_FEATURE_FLAG_INVALID"):
                        release.start("synthetic-canary", 18084, "synthetic-image", SHA)
                    command.assert_not_called()
                    metadata.assert_not_called()


if __name__ == "__main__":
    unittest.main()
