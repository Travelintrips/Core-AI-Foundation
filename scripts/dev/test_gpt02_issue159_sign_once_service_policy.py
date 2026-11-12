"""Static, non-operational systemd checks for the existing one-shot signer.

The unit is checked as source only. Nothing signs, starts, connects to DB, or
touches a service in this test.
"""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
UNIT=ROOT/"deploy/ai-coding-standalone-dev/gpt02-issue159-sign-once-approval.service"
SIGNER=ROOT/"deploy/ai-coding-standalone-dev/gpt02_issue159_sign_once.py"
GATE=ROOT/"deploy/ai-coding-standalone-dev/gpt02_issue159_signer_approval_guard.py"


class OneShotApprovalSystemdPolicyTest(unittest.TestCase):
    def test_unit_reuses_existing_approval_signer_and_custody(self):
        unit=UNIT.read_text()
        for flag in (
            "Type=oneshot", "DynamicUser=yes",
            "SupplementaryGroups=gpt02-issue159-signers",
            "Environment=APP_ENV=development",
            "Environment=GPT02_ISSUE159_SIGNING_ENABLED=approved-once",
            "LoadCredentialEncrypted=private-key.pkcs8:",
            "LoadCredential=manifest.json:",
            "LoadCredential=approved-claims.json:",
            "ExecStart=/usr/bin/python3 -B /opt/ai-coding-standalone-dev/gpt02_issue159_sign_once.py --role approval ",
            "--claims /run/credentials/gpt02-issue159-sign-once-approval.service/approved-claims.json",
            "--output /run/gpt02-issue159-sign-once-approval/approval-signature.json",
            "ConditionPathExists=/run/gpt02-approval-reader/approval.sock",
            "BindReadOnlyPaths=/run/gpt02-approval-reader",
            "RuntimeDirectory=gpt02-issue159-sign-once-approval",
            "RuntimeDirectoryMode=0700", "RuntimeDirectoryPreserve=yes",
            "Restart=no", "PrivateNetwork=yes", "ProtectSystem=strict",
            "NoNewPrivileges=yes", "RestrictAddressFamilies=AF_UNIX",
            "CapabilityBoundingSet=", "AmbientCapabilities=",
            "UMask=0077", "ProtectHome=yes",
        ):
            with self.subTest(flag=flag):
                self.assertIn(flag,unit)

    def test_unit_has_no_autostart_no_other_role_no_dispatch(self):
        unit=UNIT.read_text()
        self.assertNotIn("[Install]",unit)
        self.assertNotIn("WantedBy=",unit)
        for flag in (
            "--role hub", "--role core", "--role issuer",
            "Restart=always", "Restart=on-failure",
            "Environment=AI_DISPATCHER_ENABLED=true",
            "Environment=GPT02_ISSUE159_SIGNING_ENABLED=true",
            "ExecStartPre=/bin/sh", "ExecStartPost=",
            "User=root", "SupplementaryGroups=postgres",
            "LoadCredential=service-role",
        ):
            with self.subTest(flag=flag):
                self.assertNotIn(flag,unit)

    def test_cli_requires_real_readback_and_no_test_switch(self):
        source=SIGNER.read_text()
        gate=GATE.read_text()
        self.assertIn('GPT02_ISSUE159_SIGNING_ENABLED") != "approved-once"',source)
        self.assertIn('if args.role != "approval"',source)
        self.assertIn('persisted_approval_fresh(claims, now_ms=now_ms)',source)
        self.assertIn('signed_digest != payload["claimsSha256"]',source)
        self.assertIn('MIN_VALIDITY_MS = 30_000',gate)
        self.assertIn('SO_PEERCRED',gate)
        self.assertIn('APPROVAL_READER_SOCKET = "/run/gpt02-approval-reader/approval.sock"',gate)
        self.assertNotIn('--skip-approval',source)
        self.assertNotIn('--test-mode',source)
        self.assertNotIn('psycopg',source.lower())
        self.assertNotIn('sqlite3',source.lower())


if __name__=="__main__":
    unittest.main()
