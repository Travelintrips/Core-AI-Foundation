#!/usr/bin/env python3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UNIT = ROOT / "deploy/ai-coding-standalone-dev/gpt02-issue159-issuer-reader.service"
SYSUSERS = ROOT / "deploy/ai-coding-standalone-dev/gpt02-issue159-issuer-reader.sysusers"


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
