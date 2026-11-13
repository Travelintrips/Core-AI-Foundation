import hashlib
import json
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "deploy/ai-coding-standalone-dev"))
import gpt02_issue159_issuer_signer_guard as guard


def fixtures(now: int):
    approved = {
        "v": 2, "environment": "DEV",
        "audience": "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
        "taskId": 200,
        "commandId": "11111111-1111-4111-8111-111111111111",
        "attemptId": "22222222-2222-4222-8222-222222222222",
        "nonce": "A" * 40,
        "operatorNamespace": "ai-task-hub.public.users",
        "superAdminId": "google_test_admin",
        "companyId": "default", "issuedAt": now - 1000,
        "expiresAt": now + 60_000,
    }
    digest = "d" * 64
    link = {
        "v": 1, "environment": "DEV",
        "audience": "GPT02_DUAL_ACCOUNT_COMMAND_LINK",
        "linkId": "33333333-3333-4333-8333-333333333333",
        "companyId": "default", "hubTaskId": 200,
        "hubExecutionId": "44444444-4444-4444-8444-444444444444",
        "coreTaskId": "55555555-5555-4555-8555-555555555555",
        "coreCommandId": approved["commandId"],
        "attemptId": approved["attemptId"], "attemptNumber": 1,
        "assigneeId": 5, "accountableOwnerId": "google_test_admin",
        "hubOperatorNamespace": "ai-task-hub.public.users",
        "hubOperatorId": "google_test_admin", "hubRole": "super_admin",
        "hubActive": True,
        "coreOperatorNamespace": "ai-core.ai_platform.internal_users",
        "coreOperatorUserId": 2, "coreRole": "admin", "coreActive": True,
        "corePasswordChanged": True,
        "workerId": "openclaw-dell-chatgpt-wake-dev",
        "approvalDigest": digest, "nonce": approved["nonce"],
        "issuedAt": now - 500, "expiresAt": now + 50_000,
    }
    claims = {
        "v": 1, "environment": "DEV",
        "audience": "GPT02_ISSUER_LEASE_EVIDENCE_V1",
        "companyId": "default", "hubTaskId": 200,
        "hubExecutionId": link["hubExecutionId"],
        "coreTaskId": link["coreTaskId"],
        "commandId": approved["commandId"], "attemptId": approved["attemptId"],
        "workerId": "openclaw-dell-chatgpt-wake-dev",
        "receiptId": "66666666-6666-4666-8666-666666666666",
        "linkId": link["linkId"],
        "fenceId": "77777777-7777-4777-8777-777777777777",
        "approvalDigest": digest,
        "nonceDigest": hashlib.sha256(approved["nonce"].encode()).hexdigest(),
        "issuerRole": "dev_gpt02_issuer_evidence", "leaseEpoch": 1,
        "issuedAt": now - 100, "expiresAt": now + 5_000,
    }
    return approved, link, claims, digest


def success_envelope():
    return {
        "ok": True, "environment": "DEV",
        "result": {
            "environment": "DEV",
            "reason": "ISSUER_LEDGER_LINEAGE_MATCHED_NO_AUTHORITY",
            "readOnlySessionVerified": True,
            "issuerLedgerMatched": True,
            "persistedTrustedReadProven": True,
            "cryptographicSignaturesVerified": False,
            "privateKeyLoaded": False,
            "signingPermitted": False, "authorizationGranted": False,
            "dispatchPermitted": False, "commandCreated": False,
            "releaseDecision": "NO_GO",
            "trustedReadProof": {
                "environment": "DEV",
                "source": "systemd-credential-backed-issuer-reader",
                "role": "gpt02_issuer_evidence_reader",
                "credentialSource": "systemd-credential-files",
                "credentialDirectory": "/run/credentials/gpt02-issue159-issuer-reader.service",
                "nativeRoleVerified": True, "clientTlsVerified": True,
                "readOnlySessionVerified": True, "signingPermitted": False,
                "authorizationGranted": False, "dispatchPermitted": False,
                "releaseDecision": "NO_GO",
            },
        },
        "signingPermitted": False, "authorizationGranted": False,
        "dispatchPermitted": False, "releaseDecision": "NO_GO",
    }


class IssuerSignerGuardTest(unittest.TestCase):
    def test_exact_reader_proof_allows_only_following_detached_signature(self):
        now = int(time.time() * 1000)
        approved, link, claims, digest = fixtures(now)
        with patch.object(guard, "persisted_approval_fresh", return_value=digest) as approval,              patch.object(guard, "require_hub_core_facts") as hubcore,              patch.object(guard, "_request_reader", return_value=success_envelope()) as reader:
            self.assertIsNone(guard.require_issuer_facts(
                claims, approved, link, now_ms=now,
                reader_socket="/tmp/test.sock", reader_uid=1234,
            ))
        approval.assert_called_once()
        hubcore.assert_called_once()
        reader.assert_called_once()

    def test_parent_binding_mismatch_stops_before_reader(self):
        now = int(time.time() * 1000)
        approved, link, claims, digest = fixtures(now)
        claims["linkId"] = "88888888-8888-4888-8888-888888888888"
        with patch.object(guard, "persisted_approval_fresh", return_value=digest),              patch.object(guard, "require_hub_core_facts"),              patch.object(guard, "_request_reader") as reader:
            with self.assertRaisesRegex(RuntimeError, "ISSUER_PARENT_BINDING_MISMATCH"):
                guard.require_issuer_facts(claims, approved, link, now_ms=now)
        reader.assert_not_called()

    def test_reader_must_prove_persisted_lineage_and_no_authority(self):
        now = int(time.time() * 1000)
        approved, link, claims, digest = fixtures(now)
        bad = success_envelope()
        bad["result"]["persistedTrustedReadProven"] = False
        with patch.object(guard, "persisted_approval_fresh", return_value=digest),              patch.object(guard, "require_hub_core_facts"),              patch.object(guard, "_request_reader", return_value=bad):
            with self.assertRaisesRegex(RuntimeError, "ISSUER_READER_TRUSTED_BINDING_REQUIRED"):
                guard.require_issuer_facts(claims, approved, link, now_ms=now)

    def test_source_has_peer_pin_and_no_writer_or_key_surface(self):
        source = (ROOT / "deploy/ai-coding-standalone-dev/gpt02_issue159_issuer_signer_guard.py").read_text()
        for required in (
            "SO_PEERCRED", "gpt02-issuer-reader", "/issuer-evidence",
            "persisted_approval_fresh", "require_hub_core_facts",
            "persistedTrustedReadProven", "issuerLedgerMatched",
            "dispatchPermitted", "NO_GO",
        ):
            self.assertIn(required, source)
        for forbidden in (
            "psycopg", "sqlite3", "private-key.pkcs8", ".sign(",
            "record_issuer_evidence", "consume_issuer_lease",
            'dispatchPermitted": true',
        ):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
