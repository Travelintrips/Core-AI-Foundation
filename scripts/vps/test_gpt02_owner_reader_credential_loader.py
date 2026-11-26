#!/usr/bin/env python3
"""Exercise the real loader on synthetic files; no systemd, DB, or real secrets."""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("gpt02_owner_reader_credential_loader.py")
SPEC = importlib.util.spec_from_file_location("tested_owner_reader_loader", SCRIPT)
loader = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(loader)

SYNTHETIC_PASSWORD = "SYNTHETIC_ONLY_NEVER_A_REAL_PASSWORD_123456789"
CONFIG = {
    "database": "postgres", "host": "db.xssrfshdrtdfupgqwfdw.supabase.co",
    "password": SYNTHETIC_PASSWORD, "port": 5432,
    "projectId": "xssrfshdrtdfupgqwfdw", "sslMode": "verify-full",
    "user": "gpt02_owner_ledger_reader_1782_dev",
}
PAYLOAD = json.dumps(CONFIG, separators=(",", ":")).encode()


class ReaderCredentialLoaderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.source_dir = self.root / "systemd-credential"
        self.reader_dir = self.root / "published"
        self.source_dir.mkdir(mode=0o700)
        self.reader_dir.mkdir(mode=0o700)
        self.source = self.source_dir / "reader.json"
        self.target = self.reader_dir / "reader.json"
        self.source.write_bytes(PAYLOAD)
        self.source.chmod(0o400)

        self.real_open, self.real_close = os.open, os.close
        self.real_fstat, self.real_stat = os.fstat, os.stat
        self.real_read, self.real_write = os.read, os.write
        self.real_fsync, self.real_replace = os.fsync, os.replace
        self.open_fds: set[int] = set()
        self.open_calls = []
        self.overrides = {}
        # /tmp is normally writable. Model the trusted /run ancestors without
        # changing host metadata; keep actual fixture inode/type/link/mode data.
        self.external_ancestors = {
            self.identity(self.real_stat(path)) for path in self.root.parents
        }
        self.stack = contextlib.ExitStack()
        self.stack.enter_context(patch.dict(os.environ, {
            "APP_ENV": "development", "NODE_ENV": "development",
        }, clear=True))
        for name, value in (("SOURCE_FILE", self.source), ("READER_DIR", self.reader_dir), ("READER_FILE", self.target)):
            self.stack.enter_context(patch.object(loader, name, value))
        self.stack.enter_context(patch.object(loader.os, "geteuid", return_value=0))
        self.stack.enter_context(patch.object(loader.os, "getegid", return_value=0))
        self.stack.enter_context(patch.object(loader.os, "fstat", side_effect=lambda fd: self.metadata(self.real_fstat(fd))))
        self.stack.enter_context(patch.object(loader.os, "stat", side_effect=lambda *a, **kw: self.metadata(self.real_stat(*a, **kw))))
        self.stack.enter_context(patch.object(loader.os, "open", side_effect=self.open_descriptor))
        self.stack.enter_context(patch.object(loader.os, "close", side_effect=self.close_descriptor))

    @staticmethod
    def identity(meta):
        return meta.st_dev, meta.st_ino

    def metadata(self, meta):
        values = {name: getattr(meta, name) for name in dir(meta) if name.startswith("st_")}
        values.update(st_uid=0, st_gid=0)
        if self.identity(meta) in self.external_ancestors:
            values["st_mode"] &= ~0o022
        values.update(self.overrides.get(self.identity(meta), {}))
        return SimpleNamespace(**values)

    def open_descriptor(self, path, flags, *args, **kwargs):
        self.open_calls.append((path, flags, kwargs))
        descriptor = self.real_open(path, flags, *args, **kwargs)
        self.open_fds.add(descriptor)
        return descriptor

    def close_descriptor(self, descriptor):
        try:
            return self.real_close(descriptor)
        finally:
            self.open_fds.discard(descriptor)

    def tearDown(self):
        leaked = set(self.open_fds)
        self.stack.close()
        for descriptor in leaked:
            self.real_close(descriptor)
        self.tmp.cleanup()
        self.assertEqual(leaked, set(), "loader leaked file descriptors")

    def set_source(self, payload):
        self.source.chmod(0o600)
        self.source.write_bytes(payload)
        self.source.chmod(0o400)

    def set_metadata(self, path, **values):
        self.overrides[self.identity(self.real_stat(path, follow_symlinks=False))] = values

    def assert_denied(self, code=None):
        with self.assertRaises(loader.LoaderDenied) as caught:
            loader.load_reader_credential()
        if code is not None:
            self.assertEqual(caught.exception.code, code)
        self.assertEqual(str(caught.exception), caught.exception.code)
        self.assertRegex(str(caught.exception), r"^READER_[A-Z_]+$")
        self.assertNotIn(SYNTHETIC_PASSWORD, str(caught.exception))
        self.assertNotIn(str(self.source), str(caught.exception))
        self.assertEqual(self.open_fds, set())

    def assert_no_temporary_files(self):
        self.assertEqual(list(self.reader_dir.glob(".reader.json-*")), [])

    def test_publishes_exact_valid_bytes_as_private_file_and_closes_descriptors(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            loader.load_reader_credential()
        self.assertEqual(self.target.read_bytes(), PAYLOAD)
        self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o600)
        self.assertEqual(self.target.stat().st_nlink, 1)
        self.assertEqual(stdout.getvalue() + stderr.getvalue(), "")
        source_opens = [flags for path, flags, _ in self.open_calls if path == "reader.json"]
        self.assertEqual(len(source_opens), 1)
        self.assertTrue(source_opens[0] & os.O_NOFOLLOW)
        self.assertTrue(source_opens[0] & os.O_NONBLOCK)
        self.assert_no_temporary_files()
        self.assertEqual(self.open_fds, set())

    def test_partial_writes_are_completed_before_atomic_replacement(self):
        original = b"synthetic-previous-publication"
        self.target.write_bytes(original)
        self.target.chmod(0o600)
        events = []

        def short_write(fd, data):
            self.assertEqual(self.target.read_bytes(), original)
            events.append("write")
            return self.real_write(fd, data[:7])

        def sync(fd):
            events.append("sync-dir" if stat.S_ISDIR(self.real_fstat(fd).st_mode) else "sync-file")
            return self.real_fsync(fd)

        def replace(source, target, **kwargs):
            self.assertEqual(self.target.read_bytes(), original)
            self.assertEqual(kwargs["src_dir_fd"], kwargs["dst_dir_fd"])
            self.assertIn("sync-file", events)
            events.append("replace")
            return self.real_replace(source, target, **kwargs)

        with patch.object(loader.os, "write", side_effect=short_write), \
                patch.object(loader.os, "fsync", side_effect=sync), \
                patch.object(loader.os, "replace", side_effect=replace):
            loader.load_reader_credential()
        self.assertGreater(events.count("write"), 1)
        self.assertEqual(events[-2:], ["replace", "sync-dir"])
        self.assertEqual(self.target.read_bytes(), PAYLOAD)
        self.assert_no_temporary_files()

    def test_environment_and_uid_mismatches_do_no_file_io(self):
        for values in ({"APP_ENV": "production"}, {"NODE_ENV": "production"}, {"NODE_ENV": ""}):
            with self.subTest(values=values), patch.dict(os.environ, values), \
                    patch.object(loader.os, "open") as opened:
                self.assert_denied("READER_LOADER_ENV_INVALID")
                opened.assert_not_called()
        for name in ("geteuid", "getegid"):
            with self.subTest(identity=name), patch.object(loader.os, name, return_value=1000), \
                    patch.object(loader.os, "open") as opened:
                self.assert_denied("READER_LOADER_ROOT_REQUIRED")
                opened.assert_not_called()

    def test_missing_source_fails_without_a_publication(self):
        self.source.unlink()
        self.assert_denied("READER_SOURCE_UNAVAILABLE")
        self.assertFalse(self.target.exists())

    def test_source_symlink_is_never_followed(self):
        other = self.root / "other-source"
        self.source.rename(other)
        self.source.symlink_to(other)
        self.assert_denied("READER_SOURCE_UNAVAILABLE")
        self.assertFalse(self.target.exists())

    def test_symlink_ancestor_is_never_followed(self):
        moved = self.root / "moved-source"
        self.source_dir.rename(moved)
        self.source_dir.symlink_to(moved, target_is_directory=True)
        self.assert_denied("READER_DIRECTORY_UNSAFE")
        self.assertFalse(self.target.exists())

    def test_hard_linked_source_is_rejected_before_reading(self):
        os.link(self.source, self.root / "extra-source-link")
        with patch.object(loader.os, "read") as read:
            self.assert_denied("READER_SOURCE_UNSAFE")
            read.assert_not_called()
        self.assertFalse(self.target.exists())

    def test_source_owner_group_permissions_type_and_size_are_checked_before_read(self):
        cases = [
            {"st_uid": 1000}, {"st_gid": 999}, {"st_mode": stat.S_IFREG | 0o640},
            {"st_mode": stat.S_IFIFO | 0o600}, {"st_size": 0}, {"st_size": loader.MAX_BYTES + 1},
        ]
        for metadata in cases:
            with self.subTest(metadata=metadata), patch.object(loader.os, "read") as read:
                self.set_metadata(self.source, **metadata)
                self.assert_denied("READER_SOURCE_UNSAFE")
                read.assert_not_called()
                self.assertFalse(self.target.exists())
        self.overrides.clear()

    def test_ancestor_owner_group_and_write_permissions_are_enforced(self):
        for metadata in ({"st_uid": 1000}, {"st_gid": 999}, {"st_mode": stat.S_IFDIR | 0o777}):
            with self.subTest(metadata=metadata):
                self.set_metadata(self.source_dir, **metadata)
                self.assert_denied("READER_DIRECTORY_UNSAFE")
                self.assertFalse(self.target.exists())
        self.overrides.clear()

    def test_growth_after_stat_is_bounded_to_limit_plus_one(self):
        total, sizes, grown = 0, [], False

        def read(fd, size):
            nonlocal total, grown
            sizes.append(size)
            if not grown:
                grown = True
                self.set_source(PAYLOAD + b" " * (loader.MAX_BYTES * 2))
            chunk = self.real_read(fd, size)
            total += len(chunk)
            return chunk

        with patch.object(loader.os, "read", side_effect=read):
            self.assert_denied("READER_SOURCE_TOO_LARGE")
        self.assertEqual(total, loader.MAX_BYTES + 1)
        self.assertTrue(all(size <= loader.MAX_BYTES + 1 for size in sizes))
        self.assertFalse(self.target.exists())

    def test_same_size_source_metadata_change_during_read_is_rejected(self):
        original = self.real_stat(self.source)

        def read(fd, size):
            data = self.real_read(fd, size)
            self.set_metadata(self.source, st_ctime_ns=original.st_ctime_ns + 1)
            return data

        with patch.object(loader.os, "read", side_effect=read):
            self.assert_denied("READER_SOURCE_CHANGED")
        self.assertFalse(self.target.exists())

    def test_invalid_utf8_duplicate_json_and_target_mismatches_do_not_publish(self):
        invalid = [b"\xff\xfe", b"{", b"[]", b"null", b'{"password":NaN}',
                   PAYLOAD[:-1] + b',"user":"gpt02_owner_ledger_reader_1782_dev"}']
        for patch_values in (
            {"host": "db.other.example.invalid"}, {"projectId": "other-project"},
            {"user": "aicore_dev_runtime"}, {"database": "other"}, {"port": "5432"},
            {"sslMode": "disable"}, {"password": "short"}, {"extra": "not-allowed"},
        ):
            invalid.append(json.dumps({**CONFIG, **patch_values}).encode())
        for payload in invalid:
            with self.subTest(case=invalid.index(payload)):
                self.set_source(payload)
                self.assert_denied("READER_PAYLOAD_INVALID")
                self.assertFalse(self.target.exists())
                self.assert_no_temporary_files()

    def test_task190_shared_reader_role_is_rejected_without_publication(self):
        self.set_source(json.dumps({**CONFIG, "user": "gpt02_owner_ledger_reader_dev"}).encode())
        self.assert_denied("READER_PAYLOAD_INVALID")
        self.assertFalse(self.target.exists())
        self.assert_no_temporary_files()

    def test_untrusted_or_missing_destination_directory_is_not_created(self):
        self.reader_dir.chmod(0o750)
        self.assert_denied("READER_DIRECTORY_UNSAFE")
        self.reader_dir.rmdir()
        self.assert_denied("READER_DIRECTORY_UNSAFE")
        self.assertFalse(self.reader_dir.exists())

    def test_destination_symlink_or_hardlink_cannot_redirect_publication(self):
        other = self.root / "unrelated-file"
        other.write_bytes(b"synthetic-unrelated-contents")
        other.chmod(0o600)
        self.target.symlink_to(other)
        self.assert_denied("READER_DESTINATION_UNSAFE")
        self.target.unlink()
        os.link(other, self.target)
        self.assert_denied("READER_DESTINATION_UNSAFE")
        self.assertEqual(other.read_bytes(), b"synthetic-unrelated-contents")
        self.assert_no_temporary_files()

    def test_write_and_replace_failures_preserve_previous_file_and_clean_temporary_files(self):
        original = b"synthetic-previous-publication"
        self.target.write_bytes(original)
        self.target.chmod(0o600)
        for operation in ("write", "replace"):
            with self.subTest(operation=operation), patch.object(
                loader.os, operation, side_effect=OSError(SYNTHETIC_PASSWORD),
            ):
                self.assert_denied("READER_PUBLICATION_FAILED")
            self.assertEqual(self.target.read_bytes(), original)
            self.assert_no_temporary_files()

    def test_exclusive_creation_collision_does_not_remove_an_unowned_file(self):
        collision = self.reader_dir / (".reader.json-" + "a" * 32)
        collision.write_bytes(b"synthetic-unowned-temp")
        collision.chmod(0o600)
        with patch.object(loader.secrets, "token_hex", return_value="a" * 32):
            self.assert_denied("READER_PUBLICATION_FAILED")
        self.assertEqual(collision.read_bytes(), b"synthetic-unowned-temp")
        self.assertFalse(self.target.exists())

    def test_main_emits_only_fixed_diagnostics_and_rejects_path_arguments(self):
        for error, code in (
            (loader.LoaderDenied("READER_PAYLOAD_INVALID"), "READER_PAYLOAD_INVALID"),
            (RuntimeError(SYNTHETIC_PASSWORD + str(self.source)), "READER_LOADER_FAILED"),
            (loader.LoaderDenied(SYNTHETIC_PASSWORD), "READER_LOADER_FAILED"),
        ):
            stdout, stderr = io.StringIO(), io.StringIO()
            with self.subTest(code=code), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr), \
                    patch.object(loader, "load_reader_credential", side_effect=error):
                self.assertEqual(loader.main([]), 1)
            self.assertEqual(stdout.getvalue(), "")
            self.assertEqual(stderr.getvalue(), "GPT02_READER_LOAD=BLOCKED code=" + code + "\n")
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr), patch.object(loader, "load_reader_credential") as load:
            self.assertEqual(loader.main(["--source", "/untrusted/path"]), 1)
            load.assert_not_called()
        self.assertEqual(stderr.getvalue(), "GPT02_READER_LOAD=BLOCKED code=READER_LOADER_ARGUMENTS_INVALID\n")


class LoaderUnitContractTests(unittest.TestCase):
    def test_fixed_encrypted_input_runtime_directory_and_dormant_hardened_unit(self):
        unit = SCRIPT.parents[2] / "deploy/ai-coding-standalone-dev/gpt02-owner-ledger-credential-loader.service"
        lines = [line.strip() for line in unit.read_text().splitlines() if line.strip() and not line.lstrip().startswith("#")]
        values = {}
        for line in lines:
            if "=" in line:
                key, value = line.split("=", 1)
                values.setdefault(key, []).append(value)
        self.assertNotIn("[Install]", lines)
        self.assertEqual(values["LoadCredentialEncrypted"], [
            "reader.json:/etc/credstore.encrypted/gpt02-owner-ledger-reader.json",
        ])
        self.assertEqual(values["ExecStart"], [
            "/usr/bin/python3 /usr/local/libexec/cst-dev/gpt02_owner_reader_credential_loader.py",
        ])
        self.assertEqual(values["RuntimeDirectory"], ["credentials/gpt02-owner-ledger-reader"])
        self.assertEqual(values["RuntimeDirectoryMode"], ["0700"])
        self.assertEqual(values["RemainAfterExit"], ["yes"])
        self.assertEqual(values["RuntimeDirectoryPreserve"], ["no"])
        self.assertEqual(values["Environment"], ["APP_ENV=development", "NODE_ENV=development"])
        for name in ("PrivateNetwork", "NoNewPrivileges"):
            self.assertEqual(values[name], ["yes"])
        self.assertEqual(values["ProtectSystem"], ["strict"])
        self.assertEqual(values["CapabilityBoundingSet"], [""])
        self.assertEqual(values["ReadWritePaths"], ["/run/credentials/gpt02-owner-ledger-reader"])
        self.assertEqual(str(loader.SOURCE_FILE), "/run/credentials/gpt02-owner-ledger-credential-loader.service/reader.json")
        self.assertEqual(str(loader.READER_FILE), "/run/credentials/gpt02-owner-ledger-reader/reader.json")


if __name__ == "__main__":
    unittest.main()
