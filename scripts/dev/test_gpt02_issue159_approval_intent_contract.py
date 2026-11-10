#!/usr/bin/env python3
import importlib.util
import hashlib
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = ROOT / "deploy/ai-coding-standalone-dev/gpt02_issue159_approval_intent_contract.py"

spec = importlib.util.spec_from_file_location("approval_intent_contract", CONTRACT_PATH)
contract = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(contract)

CLAIMS = {
    "v": 2,
    "environment": "DEV",
    "audience": "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
    "taskId": 137,
    "commandId": "11111111-1111-4111-8111-111111111111",
    "attemptId": "22222222-2222-4222-8222-222222222222",
    "nonce": "A" * 44,
    "operatorNamespace": "ai-task-hub.public.users",
    "superAdminId": "google_fixture_super_admin",
    "companyId": "default",
    "issuedAt": 1000,
    "expiresAt": 301000,
}
IDENTITY = {
    "userId": CLAIMS["superAdminId"],
    "role": "super_admin",
    "enabled": True,
    "authMethod": "supabase_aal2",
}
INTENT_ID = "33333333-3333-4333-8333-333333333333"
EXPECTED_CANONICAL = (
    '{"v":2,"environment":"DEV","audience":"GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",'
    '"taskId":137,"commandId":"11111111-1111-4111-8111-111111111111",'
    '"attemptId":"22222222-2222-4222-8222-222222222222",'
    '"nonce":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",'
    '"operatorNamespace":"ai-task-hub.public.users",'
    '"superAdminId":"google_fixture_super_admin","companyId":"default",'
    '"issuedAt":1000,"expiresAt":301000}'
)
EXPECTED_SHA = "de1557983512699d5e91a6d3989a1738ae43c004f290089a5f51620bfb833056"


class ApprovalIntentContractTest(unittest.TestCase):
    def test_exact_aal2_super_admin_builds_self_contained_row_but_no_authority(self):
        out = contract.build_approval_intent_record(
            CLAIMS, IDENTITY, INTENT_ID, 2000
        )
        self.assertEqual(out["canonicalClaims"], EXPECTED_CANONICAL)
        self.assertEqual(out["claimsSha256"], EXPECTED_SHA)
        self.assertEqual(
            hashlib.sha256(EXPECTED_CANONICAL.encode("utf-8")).hexdigest(),
            EXPECTED_SHA,
        )
        self.assertEqual(out["record"], {
            "id": INTENT_ID,
            "task_id": 137,
            "command_id": CLAIMS["commandId"],
            "attempt_id": CLAIMS["attemptId"],
            "company_id": "default",
            "claims_sha256": EXPECTED_SHA,
            "actor_id": CLAIMS["superAdminId"],
            "auth_method": "supabase_aal2",
            "role_at_decision": "super_admin",
            "decision": "APPROVE",
            "recorded_at_ms": 2000,
            "expires_at_ms": 301000,
        })
        self.assertFalse(out["trustedIdentityReadProven"])
        self.assertFalse(out["writePerformed"])
        self.assertFalse(out["writePermitted"])
        self.assertFalse(out["privateKeyLoaded"])
        self.assertFalse(out["signingPermitted"])
        self.assertFalse(out["authorizationGranted"])
        self.assertFalse(out["dispatchPermitted"])
        self.assertEqual(out["releaseDecision"], "NO_GO")

    def test_static_token_non_aal2_admin_or_disabled_identity_is_rejected(self):
        for patch in (
            {"userId": "dev_approval_token"},
            {"authMethod": "static_dev_token"},
            {"role": "admin"},
            {"enabled": False},
            {"userId": "another-user"},
        ):
            with self.assertRaisesRegex(
                contract.ApprovalIntentContractError,
                "GPT02_ISSUE159_AAL2_SUPER_ADMIN_REQUIRED",
            ):
                contract.build_approval_intent_record(
                    CLAIMS, {**IDENTITY, **patch}, INTENT_ID, 2000
                )

    def test_claim_scope_and_shape_drift_is_rejected(self):
        for patch in (
            {"taskId": 136},
            {"environment": "PROD"},
            {"audience": "ai-core-dev-checkpoint/v1"},
            {"operatorNamespace": "other"},
            {"companyId": "*"},
            {"nonce": "short"},
            {"commandId": CLAIMS["attemptId"]},
            {"expiresAt": 301001},
        ):
            with self.assertRaisesRegex(
                contract.ApprovalIntentContractError,
                "GPT02_ISSUE159_APPROVAL_CLAIMS_INVALID",
            ):
                contract.build_approval_intent_record(
                    {**CLAIMS, **patch}, IDENTITY, INTENT_ID, 2000
                )

        with self.assertRaisesRegex(
            contract.ApprovalIntentContractError,
            "GPT02_ISSUE159_APPROVAL_FIELDS_INVALID",
        ):
            contract.build_approval_intent_record(
                {**CLAIMS, "authorized": True}, IDENTITY, INTENT_ID, 2000
            )

    def test_intent_id_and_recorded_time_are_bound_to_claim_lifetime(self):
        for intent_id, recorded in (
            ("not-a-uuid", 2000),
            (INTENT_ID, 999),
            (INTENT_ID, 301001),
        ):
            with self.assertRaisesRegex(
                contract.ApprovalIntentContractError,
                "GPT02_ISSUE159_APPROVAL_INTENT_TIME_OR_ID_INVALID",
            ):
                contract.build_approval_intent_record(
                    CLAIMS, IDENTITY, intent_id, recorded
                )

    def test_source_has_no_sqlite_write_key_signing_or_network_surface(self):
        source = CONTRACT_PATH.read_text()
        for forbidden in (
            "sqlite3", "INSERT INTO", "UPDATE ", "DELETE FROM",
            "createPrivateKey", "sign(", "private_key", "process.env",
            "fetch(", "http://", "https://",
        ):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
