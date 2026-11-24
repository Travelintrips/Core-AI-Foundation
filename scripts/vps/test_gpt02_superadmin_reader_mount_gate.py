#!/usr/bin/env python3
"""No-secret candidate Docker mount negative/positive tests."""
from __future__ import annotations

import importlib.util
import base64
import hashlib
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


def public_configuration():
    values = {
        gate.READER_FLAG: "true", "APP_ENV": "development", "NODE_ENV": "development",
        "SUPABASE_URL_DEV": "https://xssrfshdrtdfupgqwfdw.supabase.co",
    }
    # Public test vectors only. These fixtures are never deployed or pinned.
    for name, raw in (
        ("ATTESTOR", "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"),
        ("ISSUER", "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c"),
    ):
        der = bytes.fromhex("302a300506032b6570032100" + raw)
        prefix = "GPT02_DEV_CUSTODY_" + name + "_PUBLIC_KEY_SPKI"
        values[prefix + "_B64"] = base64.b64encode(der).decode("ascii")
        values[prefix + "_SHA256"] = hashlib.sha256(der).hexdigest()
    return values


class CustodyConfigurationTests(unittest.TestCase):
    def test_accepts_distinct_public_keys_with_matching_canonical_fingerprints(self):
        self.assertIsNone(gate.validate_custody_configuration(public_configuration()))

    def test_rejects_environment_project_and_public_pin_mismatches(self):
        prefix = "GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI"
        for change in (
            {"APP_ENV": "production"}, {"NODE_ENV": "test"},
            {"SUPABASE_URL_DEV": "https://other-project.supabase.co"},
            {"SUPABASE_SERVICE_ROLE_KEY": "synthetic-prod-field"},
            {prefix + "_B64": "not-base64"}, {prefix + "_SHA256": "0" * 64},
        ):
            with self.subTest(fields=list(change)):
                with self.assertRaises(gate.ReaderMountDenied) as caught:
                    gate.validate_custody_configuration({**public_configuration(), **change})
                self.assertRegex(str(caught.exception), r"^READER_[A-Z_]+$")
                self.assertNotIn("synthetic", str(caught.exception))

    def test_rejects_missing_public_pins_and_shared_issuer_keys(self):
        values = public_configuration()
        values.pop("GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256")
        with self.assertRaisesRegex(gate.ReaderMountDenied, "TRUST_CONFIGURATION_INVALID"):
            gate.validate_custody_configuration(values)
        values = public_configuration()
        for suffix in ("_B64", "_SHA256"):
            values["GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI" + suffix] = values[
                "GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI" + suffix]
        with self.assertRaisesRegex(gate.ReaderMountDenied, "ISSUERS_MUST_DIFFER"):
            gate.validate_custody_configuration(values)


class ProtectedCustodyMountTests(unittest.TestCase):
    def setUp(self):
        self.metadata = {}
        for file, mode, size in (
            (gate.READER_FILE, 0o600, 300), (gate.TRUST_CA, 0o644, 200),
            (gate.WORKER_PROOF, 0o600, 500), (gate.DBA_PROOF, 0o600, 500),
        ):
            self.metadata[file] = SimpleNamespace(st_mode=stat.S_IFREG | mode, st_uid=0, st_gid=0, st_nlink=1, st_size=size)
            for parent in file.parents:
                self.metadata.setdefault(parent, SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0, st_gid=0))
        for directory in (gate.READER_DIR, gate.CUSTODY_DIR):
            self.metadata[directory].st_mode = stat.S_IFDIR | 0o700
        self.patchers = [
            patch.object(Path, "lstat", autospec=True, side_effect=self.stat),
            patch.object(Path, "stat", autospec=True, side_effect=self.stat),
            patch.object(Path, "read_bytes", side_effect=AssertionError("mount gate must not read content")),
            patch.object(Path, "read_text", side_effect=AssertionError("mount gate must not read content")),
        ]
        for item in self.patchers: item.start()

    def tearDown(self):
        for item in reversed(self.patchers): item.stop()

    def stat(self, path, *args, **kwargs):
        if path not in self.metadata: raise FileNotFoundError()
        return self.metadata[path]

    def test_disabled_inspects_neither_reader_proof_nor_ca_paths(self):
        with patch.object(Path, "lstat", side_effect=AssertionError("disabled stat")), \
                patch.object(Path, "stat", side_effect=AssertionError("disabled stat")):
            self.assertEqual(gate.get_reader_mounts(enabled=False, environment="development", production=False), ())

    def test_mounts_the_custody_directory_so_receipt_removal_is_visible(self):
        mounts = gate.get_reader_mounts(enabled=True, environment="development", production=False) + gate.get_custody_mounts()
        self.assertEqual(mounts.count("--mount"), 3)
        self.assertIn(f"type=bind,source={gate.CUSTODY_DIR},target={gate.CUSTODY_DIR},readonly", mounts)
        self.assertFalse(any(str(path) in arg for path in (gate.WORKER_PROOF, gate.DBA_PROOF) for arg in mounts))
        self.assertTrue(all(mounts[index + 1].endswith(",readonly") for index, arg in enumerate(mounts) if arg == "--mount"))
        del self.metadata[gate.DBA_PROOF]
        with self.assertRaisesRegex(gate.ReaderMountDenied, "CUSTODY_PROOF_FILE_UNAVAILABLE"):
            gate.get_custody_mounts()

    def test_rejects_unsafe_proof_files_and_ancestors_without_reading_them(self):
        cases = (
            (gate.WORKER_PROOF, "st_nlink", 2), (gate.DBA_PROOF, "st_size", 8193),
            (gate.WORKER_PROOF, "st_mode", stat.S_IFLNK | 0o600),
            (gate.DBA_PROOF, "st_mode", stat.S_IFREG | 0o640),
            (gate.CUSTODY_DIR, "st_mode", stat.S_IFDIR | 0o755),
            (gate.CUSTODY_DIR.parent, "st_uid", 1000),
            (Path("/"), "st_mode", stat.S_IFDIR | 0o777),
        )
        for path, field, value in cases:
            previous = getattr(self.metadata[path], field)
            with self.subTest(path=str(path), field=field):
                setattr(self.metadata[path], field, value)
                with self.assertRaisesRegex(gate.ReaderMountDenied, "CUSTODY_PROOF_FILE_UNAVAILABLE"):
                    gate.get_custody_mounts()
            setattr(self.metadata[path], field, previous)

    def test_rejects_unsafe_ca_and_reader_hardlinks(self):
        self.metadata[gate.TRUST_CA].st_mode = stat.S_IFREG | 0o664
        with self.assertRaisesRegex(gate.ReaderMountDenied, "PINNED_CA_CUSTODY_INVALID"):
            gate.get_custody_mounts()
        self.metadata[gate.TRUST_CA].st_mode = stat.S_IFREG | 0o644
        self.metadata[gate.READER_FILE].st_nlink = 2
        with self.assertRaisesRegex(gate.ReaderMountDenied, "CREDENTIAL_CUSTODY_INVALID"):
            gate.get_reader_mounts(enabled=True, environment="development", production=False)


if __name__=="__main__":
    unittest.main()
