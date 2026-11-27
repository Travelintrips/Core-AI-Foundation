#!/usr/bin/env python3
"""No DEV mutations: isolated Linux flock and immutable-source contract tests."""
from contextlib import redirect_stdout
import fcntl
import hashlib
import importlib.util
from io import StringIO
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name("gpt02_1782_release_lock_contract.py")
spec = importlib.util.spec_from_file_location("tested_gpt02_release_lock", SOURCE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ReleaseLockContractTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "release.lock"
        self.path.touch(mode=0o600)
        self.path.chmod(0o600)
        self.owner = os.geteuid()

    def test_preexisting_root_style_lock_metadata_without_reading_contents(self):
        self.assertTrue(m.inspect_lock_metadata(self.path, self.owner))
        self.assertEqual(self.path.stat().st_size, 0)

    def test_exclusive_flock_blocks_second_actor_and_releases_cleanly(self):
        owner = m.acquire_existing_lock(self.path, self.owner)
        try:
            with self.assertRaisesRegex(m.UnsafeLock, "ALREADY_HOLDS_LOCK"):
                m.acquire_existing_lock(self.path, self.owner)
            other = os.open(self.path, os.O_RDWR | os.O_CLOEXEC)
            try:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                os.close(other)
            self.assertEqual(self.path.stat().st_size, 0)
        finally:
            m.release_fd(owner)
        holder = m.acquire_existing_lock(self.path, self.owner)
        m.release_fd(holder)
        self.assertEqual(self.path.stat().st_size, 0)

    def test_other_os_process_is_blocked_not_just_same_python_fd(self):
        holder = m.acquire_existing_lock(self.path, self.owner)
        try:
            code = ("import fcntl,sys; "
                    "f=open(sys.argv[1],'r+'); "
                    "fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)")
            probe = subprocess.run([sys.executable, "-B", "-c", code, str(self.path)],
                                   capture_output=True, text=True, timeout=6)
            self.assertNotEqual(probe.returncode, 0)
            self.assertIn("BlockingIOError", probe.stderr)
        finally:
            m.release_fd(holder)
        probe = subprocess.run([sys.executable, "-B", "-c", code, str(self.path)],
                               capture_output=True, timeout=6)
        self.assertEqual(probe.returncode, 0)

    def test_symlink_fails_without_following(self):
        link = Path(self.directory.name) / "symlink"
        link.symlink_to(self.path)
        self.assertFalse(m.inspect_lock_metadata(link, self.owner))
        with self.assertRaises(m.UnsafeLock):
            m.acquire_existing_lock(link, self.owner)

    def test_non0600_lock_refused(self):
        self.path.chmod(0o644)
        self.assertFalse(m.inspect_lock_metadata(self.path, self.owner))
        with self.assertRaisesRegex(m.UnsafeLock, "UNTRUSTED_EXISTING_RELEASE_LOCK"):
            m.acquire_existing_lock(self.path, self.owner)

    def test_nonempty_lock_file_refused(self):
        self.path.write_bytes(b"stale content")
        self.assertFalse(m.inspect_lock_metadata(self.path, self.owner))
        with self.assertRaisesRegex(m.UnsafeLock, "UNTRUSTED"):
            m.acquire_existing_lock(self.path, self.owner)

    def test_multiple_hardlinks_refused(self):
        os.link(self.path, Path(self.directory.name) / "extra-hardlink")
        self.assertFalse(m.inspect_lock_metadata(self.path, self.owner))
        with self.assertRaisesRegex(m.UnsafeLock, "UNTRUSTED"):
            m.acquire_existing_lock(self.path, self.owner)

    def test_inode_replacement_refused_even_if_original_fd_holds_lock(self):
        fd = m.acquire_existing_lock(self.path, self.owner)
        try:
            new = Path(self.directory.name) / "new"
            new.touch(mode=0o600)
            new.chmod(0o600)
            os.replace(new, self.path)
            self.assertFalse(m.trusted_existing_lock(fd, self.path, self.owner))
        finally:
            m.release_fd(fd)

    def test_untrusted_euid_cannot_acquire(self):
        with patch.object(m.os, "geteuid", return_value=self.owner + 100):
            with self.assertRaisesRegex(m.UnsafeLock, "UNAUTHORIZED_LOCK_OWNER"):
                m.acquire_existing_lock(self.path, self.owner)

    def test_fixed_release_script_hash_and_tamper_detection(self):
        script = Path(self.directory.name) / "script.py"
        script.write_bytes(b"print('synthetic')\n")
        approved = hashlib.sha256(script.read_bytes()).hexdigest()
        self.assertTrue(m.read_pinned_root_script(script, approved, self.owner))
        self.assertFalse(m.read_pinned_root_script(script, "0" * 64, self.owner))
        script.write_bytes(b"print('tamper')\n")
        self.assertFalse(m.read_pinned_root_script(script, approved, self.owner))

    def test_source_only_main_never_acquires_or_holds_lock(self):
        fake = dict(scope="GPT02-1782-CST-DEV", ready_to_open=False,
                    action="RETAIN_NGINX_503")
        with patch.object(m.os, "geteuid", return_value=0), \
             patch.object(m.os, "getegid", return_value=0), \
             patch.object(m.sys, "argv", ["audit.py", "--check"]), \
             patch.object(m, "audit_host_contract", return_value=fake), \
             patch.object(m, "acquire_existing_lock",
                          side_effect=AssertionError("MUST_NOT_ACQUIRE")):
            output = StringIO()
            with redirect_stdout(output):
                code = m.main()
        self.assertEqual(code, 2)
        self.assertFalse(json.loads(output.getvalue())["ready_to_open"])

    def test_cli_hold_attempt_is_not_supported(self):
        with patch.object(m.os, "geteuid", return_value=0), \
             patch.object(m.os, "getegid", return_value=0), \
             patch.object(m.sys, "argv", ["audit.py", "--hold"]), \
             patch.object(m, "acquire_existing_lock",
                          side_effect=AssertionError("FORBIDDEN")):
            with redirect_stdout(StringIO()):
                self.assertEqual(m.main(), 2)

    def test_live_release_and_watcher_sha_pins_are_explicit(self):
        self.assertEqual(m.RELEASE_SHA256,
                         "ad0063421453184a7d3a66d1dffd2de3b7e74dced081e232315425e9aff1c2c8")
        self.assertEqual(m.WATCHER_SHA256,
                         "5126bfd118e8352e979b5ab5c6929d8bf290dc6ef2e51c5076109d5f6f1b3dea")
        self.assertEqual(str(m.LOCK), "/run/lock/cst-vps-dev-release.lock")

    def test_no_timer_mutation_or_operator_mode_in_source(self):
        source = SOURCE.read_text()
        for forbidden in ("systemctl stop", "systemctl start", "systemd-run",
                          "nginx -s reload", "ALTER ROLE", "psycopg.connect(",
                          "os.replace(", "subprocess.run("):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)
        self.assertIn("independent_crash_safe_supervisor_installed", source)
        self.assertIn("return 2  # source-only preflight", source)


if __name__ == "__main__":
    unittest.main()
