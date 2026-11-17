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

    def test_require_security_directives_in_service_section(self):
        # Meta-only preflight must not believe a directive placed into
        # [Unit] or [Install] applies to [Service] sandbox custody.
        for missing in (
            "User=gpt02-issue159-relock-catalog-auditor",
            "ProtectSystem=strict",
            "NoNewPrivileges=yes",
            "PrivateTmp=yes",
            "Environment=APP_ENV=development",
            MOD.EXPECTED_BIND,
        ):
            with self.subTest(missing=missing):
                # Keep same effective text in the file but move the line
                # outside [Service] where systemd will ignore its semantics.
                source = self.valid_lines.replace(missing + "\n", "")
                source = source.replace(
                    "[Unit]\n",
                    "[Unit]\n" + missing + "\n",
                    1,
                )
                self.unit.write_text(source)
                out = self.check()
                self.assert_denied(out)
                self.assertFalse(out["unitMetadataReady"])

    def test_malformed_extra_or_duplicate_systemd_sections_denied(self):
        scenarios = (
            (
                self.valid_lines + "[Service]\nUser=root\n",
                "AUDITOR_UNIT_DUPLICATE_SERVICE_SECTION_DENIED",
            ),
            (
                self.valid_lines + "[DropIn]\n",
                "AUDITOR_UNIT_UNKNOWN_SECTION_DENIED",
            ),
            (
                self.valid_lines.replace("[Service]\n", "[Unit]\n"),
                "AUDITOR_UNIT_SECURITY_DIRECTIVE_OUTSIDE_SERVICE",
            ),
            (
                self.valid_lines + "[Install]\nProtectSystem=strict\n",
                "AUDITOR_UNIT_SECURITY_DIRECTIVE_OUTSIDE_SERVICE",
            ),
            (
                self.valid_lines + "Description=long line" + chr(92) +
                "\ncontinued\n",
                "AUDITOR_UNIT_MULTILINE_DIRECTIVE_DENIED",
            ),
        )
        for text, expected_reason in scenarios:
            with self.subTest(expected_reason=expected_reason):
                self.unit.write_text(text, encoding="utf-8")
                out = self.check()
                self.assert_denied(out)
                self.assertIs(out["unitMetadataReady"], False)
                self.assertEqual(out["reason"], expected_reason)

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

    def test_duplicate_user_or_environment_directive_denied(self):
        for extra in (
            "User=root",
            "Environment=APP_ENV=production",
        ):
            with self.subTest(extra=extra):
                self.unit.write_text(
                    self.valid_lines + extra + "\n",
                    encoding="utf-8",
                )
                result = self.check()
                self.assert_denied(result)
                self.assertEqual(result["reason"],
                                 "AUDITOR_UNIT_OVERRIDE_OR_DUPLICATE_DENIED")

    def test_sandbox_override_and_unreviewed_commands_fail_closed(self):
        # These additions used to make metadataReady=True because the
        # old check compared a de-duplicated set of required directives.
        scenarios = (
            ("ProtectSystem=off", "AUDITOR_UNIT_OVERRIDE_OR_DUPLICATE_DENIED"),
            ("NoNewPrivileges=no", "AUDITOR_UNIT_OVERRIDE_OR_DUPLICATE_DENIED"),
            ("PrivateTmp=no", "AUDITOR_UNIT_OVERRIDE_OR_DUPLICATE_DENIED"),
            ("ProtectSystem=strict", "AUDITOR_UNIT_OVERRIDE_OR_DUPLICATE_DENIED"),
            ("Environment=APP_ENV=development",
             "AUDITOR_UNIT_OVERRIDE_OR_DUPLICATE_DENIED"),
            ("Environment=PGPASSWORD=not-a-real-secret",
             "AUDITOR_UNIT_UNREVIEWED_ENVIRONMENT_DENIED"),
            ("EnvironmentFile=/tmp/unreviewed-file",
             "AUDITOR_UNIT_UNREVIEWED_ENVIRONMENT_DENIED"),
            ("PassEnvironment=PGPASSWORD",
             "AUDITOR_UNIT_UNREVIEWED_ENVIRONMENT_DENIED"),
            ("UnsetEnvironment=APP_ENV",
             "AUDITOR_UNIT_UNREVIEWED_ENVIRONMENT_DENIED"),
            ("ExecStart=/bin/sh",
             "AUDITOR_UNIT_UNREVIEWED_EXEC_OR_MOUNT_DENIED"),
            ("ExecStartPre=/bin/true",
             "AUDITOR_UNIT_UNREVIEWED_EXEC_OR_MOUNT_DENIED"),
            ("RootDirectory=/tmp",
             "AUDITOR_UNIT_UNREVIEWED_EXEC_OR_MOUNT_DENIED"),
            ("NetworkNamespacePath=/tmp/unreviewed",
             "AUDITOR_UNIT_UNREVIEWED_EXEC_OR_MOUNT_DENIED"),
            (MOD.EXPECTED_BIND, "AUDITOR_CREDENTIAL_ALIAS_NOT_EXCLUSIVE"),
        )
        for injected, reason in scenarios:
            with self.subTest(injected=injected):
                self.unit.write_text(
                    self.valid_lines + injected + "\n", encoding="utf-8",
                )
                result = self.check()
                self.assert_denied(result)
                self.assertIs(result["unitMetadataReady"], False)
                self.assertEqual(result["reason"], reason)

    def test_systemd_dropin_directory_denied(self):
        dropin = self.unit.parent / (self.unit.name + ".d")
        dropin.mkdir()
        result = self.check()
        self.assert_denied(result)
        self.assertEqual(result["reason"], "AUDITOR_UNIT_DROPINS_UNREVIEWED")

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
        # Real pathlib lstat does not follow the symlink. No mock needed.
        self.assertFalse(MOD._safe_regular(self.credential, unit=False))
        self.assert_denied(MOD._fail("UNSAFE_AUDITOR_ENCRYPTED_CREDENTIAL_METADATA"))

    def test_readonly_program_never_has_success_exit_or_secret_read(self):
        with patch.object(MOD, "check_custody_metadata",
                          return_value=self.check()):
            with patch("builtins.print") as output:
                self.assertEqual(MOD.main(), 3)
                output.assert_called_once()
        source = SOURCE.read_text()
        self.assertNotIn("encrypted_credential.read_text(", source)
        self.assertNotIn("encrypted_credential.read_bytes(", source)
        self.assertNotIn("psycopg.connect(", source)
        self.assertNotIn("dispatchOnce(", source)


if __name__ == "__main__":
    unittest.main()
