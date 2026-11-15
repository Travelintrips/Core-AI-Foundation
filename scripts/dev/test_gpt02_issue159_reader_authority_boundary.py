#!/usr/bin/env python3
"""Issue159: verify existing presign + Super Admin approval contracts in tandem.

Offline, synthetic only. No DB connection, token mint, credential or role
change. These existing proof-producing functions must never be interpreted as
authorization to issue a temporary PostgreSQL reader credential.
"""
from __future__ import annotations

import copy
import unittest

from gpt02_issue159_approval_request_refresh import _verify_pre_sign_facts, RefreshDenied
from gpt02_issue159_approval_intent_contract import (
    build_approval_intent_record, ApprovalIntentContractError,
)

NOW = 1_800_000_500_000
TASK = 170
COMMAND = "11111111-1111-4111-8111-111111111111"
ATTEMPT = "22222222-2222-4222-8222-222222222222"
CORE = "33333333-3333-4333-8333-333333333333"
ADMIN = "fixture-gpt02-admin"
INTENT = "44444444-4444-4444-8444-444444444444"

def claims():
    return {
        "v": 2, "environment": "DEV",
        "audience": "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
        "taskId": TASK, "commandId": COMMAND, "attemptId": ATTEMPT,
        "nonce": "a" * 44, "operatorNamespace": "ai-task-hub.public.users",
        "superAdminId": ADMIN, "companyId": "default",
        "issuedAt": NOW, "expiresAt": NOW + 240_000,
    }

def facts():
    return {
        "prepared": {
            "companyId": "default", "hubTaskId": TASK,
            "commandCandidateId": COMMAND, "attemptId": ATTEMPT,
            "operatorSubject": ADMIN, "coreTaskId": CORE,
            "expiresAt": NOW + 800_000,
        },
        "job": {
            "taskId": TASK, "status": "prepared",
            "dispatchStarted": False, "commandId": None,
            "workerCommandCount": 0,
        },
        "core": {
            "status": "PENDING", "commandCount": 0, "runCount": 0,
            "commandCandidateId": COMMAND, "attemptId": ATTEMPT, "taskId": CORE,
        },
        "hubOperator": {"subject": ADMIN, "role": "super_admin", "active": True},
        "hubAssignment": {"actorId": ADMIN, "actorRole": "super_admin", "actorActive": True},
        "trustedReadProof": {
            "source": "gpt02-issue159-presign-reader",
            "environment": "DEV", "hubRole": "gpt02_hub_evidence_reader",
            "coreRole": "gpt02_core_evidence_reader", "separateBackends": True,
            "clientTlsVerified": True, "readOnly": True,
            "signingPermitted": False, "authorizationGranted": False,
            "dispatchPermitted": False, "releaseDecision": "NO_GO",
        },
        "observedAt": NOW,
    }

def identity():
    return {
        "userId": ADMIN, "role": "super_admin", "enabled": True,
        "authMethod": "supabase_admin_session",
    }

class ExistingReaderAuthorityBoundaryTest(unittest.TestCase):
    def test_valid_two_contracts_do_not_grant_database_reader(self):
        claim = claims()
        expiry = _verify_pre_sign_facts(facts(), claim, NOW)
        self.assertGreater(expiry, NOW)
        result = build_approval_intent_record(claim, identity(), INTENT, NOW + 1)
        record = result["record"]
        self.assertEqual(record["task_id"], TASK)
        self.assertEqual(record["command_id"], COMMAND)
        self.assertEqual(record["attempt_id"], ATTEMPT)
        self.assertEqual(record["actor_id"], ADMIN)
        self.assertEqual(record["decision"], "APPROVE")
        for name in ("trustedIdentityReadProven", "writePerformed",
                     "writePermitted", "signingPermitted",
                     "authorizationGranted", "dispatchPermitted"):
            self.assertIs(result[name], False)
        self.assertEqual(result["releaseDecision"], "NO_GO")

    def test_presign_wrong_command_attempt_task_or_actor_denied(self):
        for section, key, new in (
            ("prepared", "hubTaskId", 172),
            ("prepared", "commandCandidateId", INTENT),
            ("prepared", "attemptId", INTENT),
            ("prepared", "operatorSubject", "other"),
            ("job", "dispatchStarted", True),
            ("core", "runCount", 1),
            ("core", "status", "COMPLETED"),
            ("hubOperator", "active", False),
            ("hubAssignment", "actorRole", "member"),
            ("trustedReadProof", "clientTlsVerified", False),
            ("trustedReadProof", "authorizationGranted", True),
        ):
            with self.subTest(section=section, field=key):
                item = facts()
                item[section][key] = new
                with self.assertRaises(RefreshDenied):
                    _verify_pre_sign_facts(item, claims(), NOW)

    def test_stale_or_expiring_presign_denied(self):
        stale = facts()
        stale["observedAt"] = NOW - 10000
        with self.assertRaises(RefreshDenied):
            _verify_pre_sign_facts(stale, claims(), NOW)
        expiring = facts()
        expiring["prepared"]["expiresAt"] = NOW + 1000
        with self.assertRaises(RefreshDenied):
            _verify_pre_sign_facts(expiring, claims(), NOW)

    def test_admin_approval_identity_mismatch_denied(self):
        for change in (
            {"userId": "other"},
            {"role": "member"},
            {"enabled": False},
            {"authMethod": "untrusted_bearer"},
        ):
            with self.subTest(change=change):
                ident = identity()
                ident.update(change)
                with self.assertRaises(ApprovalIntentContractError):
                    build_approval_intent_record(claims(), ident, INTENT, NOW + 1)

    def test_expired_or_wrong_claims_denied(self):
        for change in ({"taskId": 139}, {"companyId": "other"},
                       {"environment": "PROD"}, {"attemptId": COMMAND}):
            with self.subTest(change=change):
                c = claims()
                c.update(change)
                with self.assertRaises(ApprovalIntentContractError):
                    build_approval_intent_record(c, identity(), INTENT, NOW + 1)
        with self.assertRaises(ApprovalIntentContractError):
            build_approval_intent_record(claims(), identity(), INTENT, NOW + 240_000)

if __name__ == "__main__":
    unittest.main()
