#!/usr/bin/env python3
"""Operational-signing dependency split: three-domain preissuer vs issuer custody.

No keys, credentials, service calls, database, or live signer are used.
The issuer startup MUST fail closed even if its instance-specific systemd
drop-in is missing and an operator accidentally starts the template directly.
"""
from __future__ import annotations

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
FILES = ROOT / "deploy/ai-coding-standalone-dev"
BASE = FILES / "gpt02-issue159-operational-signer@.service"
ISSUER = FILES / "gpt02-issue159-operational-signer@issuer.service.d/10-require-issuer-reader.conf"
SOURCE = FILES / "gpt02_issue159_operational_signer.py"
spec=spec_from_file_location("issue159_three_domain_signer",SOURCE)
assert spec is not None and spec.loader is not None
module=module_from_spec(spec)
spec.loader.exec_module(module)


class ThreeDomainBeforeIssuer(unittest.TestCase):
    def test_three_domain_base_never_requires_missing_issuer_reader(self):
        base=BASE.read_text()
        dropin=ISSUER.read_text()
        self.assertIn("Requires=gpt02-issue159-reader.service gpt02-issue159-approval-reader.service",base)
        self.assertIn("ConditionPathExists=/run/gpt02-reader/reader.sock",base)
        self.assertIn("ConditionPathExists=/run/gpt02-approval-reader/approval.sock",base)
        self.assertNotIn("Requires=gpt02-issue159-issuer-reader.service",base)
        self.assertNotIn("After=gpt02-issue159-issuer-reader.service",base)
        self.assertNotIn("ConditionPathExists=/run/gpt02-issuer-reader/reader.sock",base)
        self.assertNotIn("BindReadOnlyPaths=/run/gpt02-issuer-reader",base)
        self.assertIn("Requires=gpt02-issue159-issuer-reader.service",dropin)
        self.assertIn("After=gpt02-issue159-issuer-reader.service",dropin)
        self.assertIn("ConditionPathExists=/run/gpt02-issuer-reader/reader.sock",dropin)
        self.assertIn("BindReadOnlyPaths=/run/gpt02-issuer-reader",dropin)

    def test_four_roles_have_independent_root_owned_encrypted_key_markers(self):
        base=BASE.read_text()
        self.assertIn("LoadCredentialEncrypted=private-key.pkcs8:/etc/credstore.encrypted/gpt02-issue159-%i-private-key.pkcs8",base)
        self.assertIn("ConditionPathExists=/etc/gpt02-dev/issue159-operational-signer-%i-enabled.approved",base)
        self.assertIn("ConditionPathExists=/etc/credstore.encrypted/gpt02-issue159-%i-private-key.pkcs8",base)
        self.assertIn("NoNewPrivileges=yes",base)
        self.assertIn("PrivateNetwork=yes",base)
        self.assertIn("RestrictAddressFamilies=AF_UNIX",base)
        self.assertNotIn("LoadCredentialEncrypted=private-key.pkcs8:/etc/credstore.encrypted/gpt02-issue159-private-key.pkcs8",base)

    def test_approval_hub_core_can_bootstrap_without_issuer_socket(self):
        with patch.object(module,"_assert_socket") as asserted:
            for role in ("approval","hub","core"):
                module.require_bootstrap_reader_before_key(role)
            asserted.assert_not_called()

    def test_issuer_bootstrap_requires_native_issuer_reader_socket(self):
        with patch.object(module,"_assert_socket") as asserted:
            module.require_bootstrap_reader_before_key("issuer")
            asserted.assert_called_once_with(module.ISSUER_READER)

    def test_broken_issuer_reader_refuses_before_reading_any_private_key(self):
        with patch.object(module,"_assert_socket",side_effect=RuntimeError(
            "ISSUER_READER_MISSING"
        )),patch.object(module,"_read_private_key") as private_key:
            with self.assertRaisesRegex(RuntimeError,"ISSUER_READER_MISSING"):
                module.serve("issuer","/tmp/test-only-signer.sock")
            private_key.assert_not_called()

    def test_unknown_signer_role_is_not_accepted(self):
        with patch.object(module,"_assert_socket") as asserted:
            with self.assertRaisesRegex(RuntimeError,"SIGNER_ROLE_INVALID"):
                module.require_bootstrap_reader_before_key("another-role")
            asserted.assert_not_called()

    def test_original_issuer_signing_checks_independent_persisted_evidence(self):
        source=SOURCE.read_text()
        self.assertIn('status,res=_unix_json(ISSUER_READER,"/issuer-evidence"',source)
        self.assertIn('result.get("issuerLedgerMatched") is not True',source)
        self.assertIn('result.get("readOnlySessionVerified") is not True',source)
        self.assertIn('deny("PERSISTED_ISSUER_LINEAGE_REQUIRED")',source)
        self.assertIn("require_bootstrap_reader_before_key(role)",source)
        self.assertNotIn("psycopg",source)
        self.assertNotIn("subprocess",source)

if __name__=="__main__":
    unittest.main()
