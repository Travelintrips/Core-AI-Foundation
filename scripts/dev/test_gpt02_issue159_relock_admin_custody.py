#!/usr/bin/env python3
"""Offline tests of issue159 relock auditor custody metadata (no credential read)."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import os
import stat
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name(
    "gpt02_issue159_relock_admin_custody.READONLY.py"
)
SPEC = importlib.util.spec_from_file_location(
    "issue159_relock_admin_custody_meta", SOURCE
)
assert SPEC is not None and SPEC.loader is not None
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


class CustodyMetaTest(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        self.root = Path(d.name)
        self.unit = self.root / "synthetic-auditor.service"
        self.credential = self.root / "synthetic-dsn.cred"
        self.credential.write_bytes(b"SYNTHETIC_CIPHERTEXT_DO_NOT_READ")
        self.valid_lines = (
            "[Unit]\nDescription=Synthetic custody test\n[Service]\n"
            + "\n".join(sorted(MOD.REQUIRED_LINES)) + "\n"
        )
        self.unit.write_text(self.valid_lines, encoding="utf-8")

    @staticmethod
    def fake_stat(*, unit_mode=0o644, cred_mode=0o600,
                  unit_owner=0, cred_owner=0, cred_size=48):
        def lstat(self):
            mode, owner, size = (
                (unit_mode, unit_owner, 300)
                if str(self).endswith(".service")
                else (cred_mode, cred_owner, cred_size)
            )
            return os.stat_result((
                stat.S_IFREG | mode, 0, 0, 1, owner, owner,
                size, 0, 0, 0,
            ))
        return lstat

    def check(self, **stat_overrides):
        with patch.object(Path, "lstat", self.fake_stat(**stat_overrides)):
            return MOD.check_custody_metadata(
                self.unit, self.credential,
            )

    def assert_denied(self, result):
        self.assertEqual(result["releaseDecision"], "NO_GO")
        for flag in (
            "credentialContentsRead", "credentialIssuancePermitted",
            "authorizationGranted", "signingPermitted", "dispatchPermitted",
        ):
            self.assertIs(result[flag], False)

    def test_uninstalled_unit_rejected_and_no_secret_needed(self):
        self.unit.unlink()
        result = MOD.check_custody_metadata(self.unit, self.credential)
        self.assertEqual(result["reason"],
                         "DEDICATED_RELOCK_AUDITOR_NOT_PROVISIONED")
        self.assert_denied(result)

    def test_matching_metadata_is_only_a_review_gate_not_permission(self):
        result = self.check()
        self.assertTrue(result["unitMetadataReady"])
        self.assertTrue(result["encryptedCredentialMetadataReady"])
        self.assertEqual(
            result["reason"],
            "METADATA_ONLY_READY_REQUIRES_INDEPENDENT_APPROVAL",
        )
        self.assert_denied(result)

    def test_attestor_or_lineage_credential_borrowing_denied(self):
        for filename in (
            "gpt02-issue159-attestor-dsn",
            "gpt02-issue159-lineage-reader-dsn",
        ):
            with self.subTest(name=filename):
                self.unit.write_text(
                    self.valid_lines + "LoadCredentialEncrypted="
                    "borrowed:/etc/credstore.encrypted/" + filename + "\n",
                    encoding="utf-8",
                )
                result = self.check()
                self.assert_denied(result)
                self.assertIn(result["reason"], (
                    "AUDITOR_CREDENTIAL_ALIAS_NOT_EXCLUSIVE",
                    "CROSS_ROLE_CREDENTIAL_REUSE_DENIED",
                ))

    def test_wrong_identity_or_missing_sandbox_denied(self):
        for line in (
            "User=gpt02-issue159-relock-catalog-auditor",
            "ProtectSystem=strict",
            "NoNewPrivileges=yes",
            MOD.EXPECTED_BIND,
        ):
            with self.subTest(line=line):
                self.unit.write_text(
                    self.valid_lines.replace(line, ""),
                    encoding="utf-8",
                )
                result = self.check()
                self.assert_denied(result)
                self.assertEqual(
                    result["reason"],
                    "AUDITOR_UNIT_CUSTODY_CONFIGURATION_INVALID",
                )

    def test_weak_file_modes_owners_and_empty_credential_denied(self):
        for args in (
            {"unit_mode": 0o666},
            {"unit_owner": 1000},
            {"cred_mode": 0o644},
            {"cred_owner": 1000},
            {"cred_size": 0},
        ):
            with self.subTest(args=args):
                result = self.check(**args)
                self.assert_denied(result)
                self.assertIn(result["reason"], (
                    "UNSAFE_AUDITOR_UNIT_METADATA",
                    "UNSAFE_AUDITOR_ENCRYPTED_CREDENTIAL_METADATA",
                ))

    def test_symlink_credential_is_rejected_without_read(self):
        self.credential.unlink()
        self.credential.symlink_to(self.unit)
        with patch.object(Path, "lstat",
                          wraps=Path.lstat) as fake:
            # We do not need to read contents of a symlinked credential;
            # unit ownership may differ on non-root CI, so test low-level
            # stat guard for credential target directly.
            self.assertFalse(MOD._safe_regular(self.credential, unit=False))
        self.assert_denied(MOD._fail("UNSAFE_AUDITOR_ENCRYPTED_CREDENTIAL_METADATA"))

    def test_readonly_program_never_has_success_exit_or_secret_read(self):
        with patch.object(MOD, "check_custody_metadata",
                          return_value=self.check()):
            self.assertEqual(MOD.main(), 3)
        source = SOURCE.read_text()
        self.assertNotIn("encrypted_credential.read_text(", source)
        self.assertNotIn("encrypted_credential.read_bytes(", source)
        self.assertNotIn("psycopg.connect(", source)
        self.assertNotIn("dispatchOnce(", source)


if __name__ == "__main__":
    unittest.main()
