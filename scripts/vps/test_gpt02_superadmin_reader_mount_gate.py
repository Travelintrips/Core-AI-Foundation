#!/usr/bin/env python3
"""No-secret candidate Docker mount negative/positive tests."""
from __future__ import annotations

import importlib.util
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

script=Path(__file__).with_name("gpt02_superadmin_reader_mount_gate.py")
spec=importlib.util.spec_from_file_location("gpt02_reader_mount_gate",script)
gate=importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class ReaderMountGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.directory=self.root/"reader"
        self.directory.mkdir(mode=0o700)
        self.secret=self.directory/"reader.json"
        self.secret.write_text('{"dummy":"not-a-real-credential"}')
        self.secret.chmod(0o600)
        self.ca=self.root/"ca.crt"
        self.ca.write_text("CA dummy")
        self.ca.chmod(0o644)
        self.patch1=patch.object(gate,"READER_DIR",self.directory)
        self.patch2=patch.object(gate,"READER_FILE",self.secret)
        self.patch3=patch.object(gate,"TRUST_CA",self.ca)
        for obj in (self.patch1,self.patch2,self.patch3):obj.start()
    def tearDown(self):
        for obj in (self.patch3,self.patch2,self.patch1):obj.stop()
        self.tmp.cleanup()

    def test_disabled_never_reads_credential_and_returns_no_mounts(self):
        with patch.object(gate,"_regular_root_file",side_effect=AssertionError("must not inspect")):
            self.assertEqual(gate.get_reader_mounts(enabled=False,environment="development",production=False),())

    def test_malformed_flag_fails_closed(self):
        with self.assertRaises(gate.ReaderMountDenied):
            gate.get_reader_mounts(enabled="true",environment="development",production=False)

    def test_production_denied_before_file_inspection(self):
        with self.assertRaisesRegex(gate.ReaderMountDenied,"DEV_ONLY"):
            gate.get_reader_mounts(enabled=True,environment="production",production=True)

    def test_missing_credential_denied(self):
        self.secret.unlink()
        with self.assertRaises(gate.ReaderMountDenied):
            gate.get_reader_mounts(enabled=True,environment="development",production=False)

    def test_symlink_credential_denied(self):
        orig=self.root/"orig"
        orig.write_text("fake")
        orig.chmod(0o600)
        self.secret.unlink()
        self.secret.symlink_to(orig)
        with self.assertRaises(gate.ReaderMountDenied):
            gate.get_reader_mounts(enabled=True,environment="development",production=False)

    def test_untrusted_permission_denied(self):
        self.secret.chmod(0o644)
        with self.assertRaises(gate.ReaderMountDenied):
            gate.get_reader_mounts(enabled=True,environment="development",production=False)

    def test_missing_ca_denied(self):
        self.ca.unlink()
        with self.assertRaises(gate.ReaderMountDenied):
            gate.get_reader_mounts(enabled=True,environment="development",production=False)

    def test_disabled_flag_value_invalid(self):
        with self.assertRaises(gate.ReaderMountDenied):
            gate.validate_release_environment({gate.READER_FLAG:"1"})

    def test_no_secret_values_are_returned(self):
        # Synthetic test runs under a non-root user; stub only metadata custody.
        root_dir=SimpleNamespace(
            exists=lambda: True, is_symlink=lambda: False,
            lstat=lambda: SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0, st_gid=0),
        )
        with patch.object(gate,"READER_DIR",root_dir), patch.object(gate,"_regular_root_file",return_value=True):
            flags=gate.get_reader_mounts(enabled=True,environment="development",production=False)
        self.assertEqual(flags.count("--mount"),2)
        self.assertTrue(all("readonly" in flags[i+1] for i,x in enumerate(flags) if x=="--mount"))
        self.assertNotIn("dummy",repr(flags))
        self.assertNotIn("PASSWORD",repr(flags).upper())

    def test_unprovisioned_credential_directory_fails_closed(self):
        # Use a guaranteed absent fixture; the test must stay valid even after
        # authorized custody later provisions the real runtime credential.
        with patch.object(gate,"READER_DIR",self.root/"missing-reader-directory"):
            with self.assertRaises(gate.ReaderMountDenied):
                gate.get_reader_mounts(enabled=True,environment="development",production=False)


if __name__=="__main__":
    unittest.main()
