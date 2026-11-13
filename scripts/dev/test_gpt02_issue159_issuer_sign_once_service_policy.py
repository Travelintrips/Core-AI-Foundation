from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
UNIT=ROOT/"deploy/ai-coding-standalone-dev/gpt02-issue159-sign-once-issuer.service"
SIGNER=ROOT/"deploy/ai-coding-standalone-dev/gpt02_issue159_sign_once.py"
GUARD=ROOT/"deploy/ai-coding-standalone-dev/gpt02_issue159_issuer_signer_guard.py"


class IssuerOneShotServicePolicyTest(unittest.TestCase):
    def test_static_private_issuer_one_shot_only(self):
        unit=UNIT.read_text()
        for required in (
            "Type=oneshot","DynamicUser=yes",
            "SupplementaryGroups=gpt02-issue159-signers",
            "GPT02_ISSUE159_SIGNING_ENABLED=approved-once",
            "LoadCredentialEncrypted=private-key.pkcs8:/etc/credstore.encrypted/gpt02-issue159-issuer-private-key.pkcs8",
            "LoadCredential=approved-claims.json:",
            "LoadCredential=hub-core-link.json:",
            "LoadCredential=issuer-claims.json:",
            "--role issuer",
            "--claims /run/credentials/gpt02-issue159-sign-once-issuer.service/issuer-claims.json",
            "--output /run/gpt02-issue159-sign-once-issuer/issuer-signature.json",
            "BindReadOnlyPaths=/run/private/gpt02-reader:/run/gpt02-reader",
            "BindReadOnlyPaths=/run/gpt02-approval-reader",
            "BindReadOnlyPaths=/run/gpt02-issuer-reader",
            "PrivateNetwork=yes","RestrictAddressFamilies=AF_UNIX",
            "NoNewPrivileges=yes","ProtectSystem=strict",
            "RuntimeDirectoryMode=0700","Restart=no",
        ):
            with self.subTest(required=required):
                self.assertIn(required,unit)
        for forbidden in (
            "[Install]","WantedBy=","ExecStartPost=","User=root",
            "AI_DISPATCHER_ENABLED=true","SUPABASE_DATABASE_URL",
            "service-role","Restart=always","Restart=on-failure",
        ):
            self.assertNotIn(forbidden,unit)

    def test_signer_issuer_requires_all_three_existing_guards(self):
        source=SIGNER.read_text()
        self.assertIn("require_issuer_facts",source)
        self.assertIn('elif args.role == "issuer":',source)
        self.assertIn('"issuer-claims.json"',source)
        self.assertIn('"hub-core-link.json"',source)
        self.assertNotIn("ISSUER_SIGNER_PROOF_NOT_IMPLEMENTED",source)
        guard=GUARD.read_text()
        self.assertIn("persisted_approval_fresh",guard)
        self.assertIn("require_hub_core_facts",guard)
        self.assertIn("issuerLedgerMatched",guard)
        self.assertIn("persistedTrustedReadProven",guard)


if __name__=="__main__":
    unittest.main()
