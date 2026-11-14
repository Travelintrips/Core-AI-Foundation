#!/usr/bin/env python3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UNIT = ROOT / "deploy/ai-coding-standalone-dev/gpt02-issue159-issuer-reader.service"
SYSUSERS = ROOT / "deploy/ai-coding-standalone-dev/gpt02-issue159-issuer-reader.sysusers"
OPERATIONAL_UNIT = ROOT / "deploy/ai-coding-standalone-dev/gpt02-issue159-operational-signer@.service"


class IssuerReaderServiceIdentityTest(unittest.TestCase):
    def test_reader_uses_stable_unprivileged_static_identity(self):
        unit = UNIT.read_text(encoding="utf-8")
        self.assertIn("User=gpt02-issuer-reader", unit)
        self.assertIn("Group=gpt02-issue159-signers", unit)
        self.assertNotIn("DynamicUser=yes", unit)
        self.assertIn("RuntimeDirectory=gpt02-issuer-reader", unit)
        self.assertIn("RuntimeDirectoryMode=0750", unit)
        self.assertIn("RuntimeDirectoryPreserve=yes", unit)
        self.assertIn("NoNewPrivileges=yes", unit)
        self.assertIn("CapabilityBoundingSet=", unit)
        self.assertIn("ProtectSystem=strict", unit)
        self.assertIn("ProtectHome=yes", unit)
        self.assertIn("ReadWritePaths=/run/gpt02-issuer-reader", unit)

    def test_persistent_reader_requires_independent_approved_custody_marker(self):
        unit = UNIT.read_text(encoding="utf-8")
        self.assertIn(
            "ConditionPathExists=/etc/gpt02-dev/issue159-issuer-reader-persistent-start.approved",
            unit,
        )
        self.assertIn(
            "ConditionPathExists=/etc/credstore.encrypted/gpt02-issue159-issuer-reader-dsn",
            unit,
        )
        self.assertIn(
            "ConditionPathExists=/etc/gpt02-dev/supabase-root-ca-2021.crt",
            unit,
        )
        self.assertIn("Environment=APP_ENV=development", unit)
        self.assertIn("Restart=on-failure", unit)
        self.assertNotIn("Environment=GPT02_ISSUE159_OPERATIONAL_SIGNING_ENABLED=true", unit)

    def test_operational_signer_never_autostarts_from_reader_socket_and_key_alone(self):
        unit = OPERATIONAL_UNIT.read_text(encoding="utf-8")
        self.assertIn(
            "ConditionPathExists=/etc/gpt02-dev/issue159-operational-signer-%i-enabled.approved",
            unit,
        )
        self.assertIn("ConditionPathExists=/run/gpt02-issuer-reader/reader.sock", unit)
        self.assertIn(
            "ConditionPathExists=/etc/credstore.encrypted/gpt02-issue159-%i-private-key.pkcs8",
            unit,
        )
        self.assertIn("Requires=gpt02-issue159-reader.service", unit)
        self.assertIn("Requires=gpt02-issue159-reader.service gpt02-issue159-issuer-reader.service", unit)
        self.assertIn("NoNewPrivileges=yes", unit)
        self.assertIn("PrivateNetwork=yes", unit)
        # A role-independent shared marker would accidentally enable all
        # four signer services after only one consent. Require %i instead.
        self.assertNotIn("ConditionPathExists=/etc/gpt02-dev/issue159-operational-signing-enabled.approved", unit)

    def test_sysusers_provisions_non_login_account_with_pinned_uid(self):
        source = SYSUSERS.read_text(encoding="utf-8")
        self.assertIn(
            'u gpt02-issuer-reader 994 "GPT02 Issue159 issuer reader" '
            '/nonexistent /usr/sbin/nologin',
            source,
        )
        self.assertNotIn("gpt02-issuer-reader ALL=", source)


if __name__ == "__main__":
    unittest.main()
