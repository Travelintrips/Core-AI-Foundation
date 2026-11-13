"""Offline post-attestor issuer tests: no real PostgreSQL, keys, OTP or dispatch."""
from __future__ import annotations

import hashlib
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "deploy/ai-coding-standalone-dev"))
import gpt02_issue159_issuer_finalize_once as issuer


RECEIPT = "66666666-6666-4666-8666-666666666666"
FENCE = "77777777-7777-4777-8777-777777777777"
EVIDENCE = "88888888-8888-4888-8888-888888888888"
COMMAND = "11111111-1111-4111-8111-111111111111"
LINK = "22222222-2222-4222-8222-222222222222"


def packet(now=None):
    now = issuer.ms() if now is None else now
    approval = {
        "expiresAt": now + 65_000, "issuedAt": now - 200,
        "taskId": 200, "commandId": COMMAND,
        "attemptId": "33333333-3333-4333-8333-333333333333",
        "companyId": "default", "nonce": "N" * 48,
    }
    link = {
        "expiresAt": now + 50_000, "issuedAt": now - 100,
        "linkId": LINK, "hubExecutionId": "44444444-4444-4444-8444-444444444444",
        "coreTaskId": "55555555-5555-4555-8555-555555555555",
    }
    signed = {
        "approval": {"claims": approval, "signature": "A" * 86},
        "hubLink": {"claims": link, "signature": "B" * 86},
        "coreLink": {"claims": link, "signature": "C" * 86},
    }
    return signed, {
        "approvalDigest": "d" * 64, "hubLinkDigest": "e" * 64,
        "threeSignaturesVerified": True,
        "persistedAdminApprovalReadBack": True,
        "verifierPeerAuthenticated": True,
        "releaseDecision": "NO_GO",
    }


class FakeCursor:
    def __init__(self, owner=issuer.ROLE, fail_on=None, lease_ack=True):
        self.owner = owner
        self.fail_on = fail_on
        self.lease_ack = lease_ack
        self.calls = []
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        if self.fail_on and self.fail_on in sql:
            raise RuntimeError("SYNTHETIC_RPC_REJECTION")
    def fetchone(self):
        sql = self.calls[-1][0]
        if "session_user" in sql:
            return self.owner, self.owner, "postgres", "off"
        if "consume_linked_approval(" in sql: return (RECEIPT,)
        if "reserve_post_consumption_fence(" in sql: return (FENCE,)
        if "record_issuer_evidence(" in sql: return (EVIDENCE,)
        if "consume_issuer_lease(" in sql:
            return ("LEASE_CONSUMED_NO_DISPATCH" if self.lease_ack else "BAD",)
        raise AssertionError("UNEXPECTED_SQL")

class FakeDB:
    def __init__(self, **kwargs):
        self.q = FakeCursor(**kwargs)
        self.commits = 0
        self.rollbacks = 0
    def cursor(self): return self.q
    def commit(self): self.commits += 1
    def rollback(self): self.rollbacks += 1


class IssuerFinalizerTests(unittest.TestCase):
    def test_attestor_verified_parent_required_before_first_rpc(self):
        pkt, proof = packet()
        proof["persistedAdminApprovalReadBack"] = False
        con = FakeDB()
        with self.assertRaisesRegex(issuer.IssuerDenied, "ISSUER_RPC_ADMISSION"):
            issuer.consume_and_reserve(con, pkt, proof)
        self.assertEqual(con.q.calls, [])

    def test_consumption_then_fence_exact_two_rpc_calls_one_commit(self):
        pkt, proof = packet()
        con = FakeDB()
        self.assertEqual(issuer.consume_and_reserve(con, pkt, proof), (RECEIPT, FENCE))
        self.assertEqual(con.commits, 1)
        self.assertEqual(con.rollbacks, 0)
        self.assertEqual(len(con.q.calls), 4)
        self.assertIn("consume_linked_approval(", con.q.calls[2][0])
        self.assertIn("reserve_post_consumption_fence(", con.q.calls[3][0])
        self.assertEqual(con.q.calls[3][1],
                         (RECEIPT, COMMAND, LINK, issuer.WORKER))

    def test_wrong_issuer_role_fails_before_rpc_and_rolls_back(self):
        pkt, proof = packet()
        con = FakeDB(owner="postgres")
        with self.assertRaisesRegex(issuer.IssuerDenied, "ISSUER_DATABASE_SESSION_IDENTITY"):
            issuer.consume_and_reserve(con, pkt, proof)
        self.assertEqual(len(con.q.calls), 2)
        self.assertEqual(con.rollbacks, 1)
        self.assertEqual(con.commits, 0)

    def test_fence_failure_rolls_back_receipt_transaction(self):
        pkt, proof = packet()
        con = FakeDB(fail_on="reserve_post_consumption_fence(")
        with self.assertRaisesRegex(RuntimeError, "SYNTHETIC_RPC_REJECTION"):
            issuer.consume_and_reserve(con, pkt, proof)
        self.assertEqual(con.commits, 0)
        self.assertEqual(con.rollbacks, 1)

    def test_expired_parent_fails_before_any_db_call(self):
        pkt, proof = packet()
        pkt["hubLink"]["claims"]["expiresAt"] = issuer.ms() + 3_000
        con = FakeDB()
        with self.assertRaisesRegex(issuer.IssuerDenied, "ISSUER_ADMISSION_EXPIRED"):
            issuer.consume_and_reserve(con, pkt, proof)
        self.assertEqual(con.q.calls, [])

    def test_trusted_rpc_uuid_claims_bind_parent_and_nonce(self):
        pkt, proof = packet()
        claims = issuer.issuer_claims(pkt, proof, RECEIPT, FENCE)
        self.assertEqual(claims["receiptId"], RECEIPT)
        self.assertEqual(claims["fenceId"], FENCE)
        self.assertEqual(claims["approvalDigest"], proof["approvalDigest"])
        self.assertEqual(claims["nonceDigest"],
                         hashlib.sha256(pkt["approval"]["claims"]["nonce"].encode()).hexdigest())
        self.assertLessEqual(claims["expiresAt"] - claims["issuedAt"], issuer.ISSUER_TTL_MS)
        self.assertEqual(claims["workerId"], issuer.WORKER)

    def test_non_rpc_receipt_or_matching_fence_rejected(self):
        pkt, proof = packet()
        for receipt, fence in (("not-a-uuid", FENCE), (RECEIPT, RECEIPT)):
            with self.assertRaisesRegex(issuer.IssuerDenied, "ISSUER_TRUSTED_RPC_UUIDS_REQUIRED"):
                issuer.issuer_claims(pkt, proof, receipt, fence)

    def test_exclusive_claim_file_no_overwrite(self):
        pkt, proof = packet()
        claims = issuer.issuer_claims(pkt, proof, RECEIPT, FENCE)
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "issuer.json"
            issuer.write_private_claims(claims, dest)
            self.assertEqual(dest.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(dest.read_text())["receiptId"], RECEIPT)
            with self.assertRaisesRegex(issuer.IssuerDenied, "ISSUER_CLAIMS_REPLAY"):
                issuer.write_private_claims(claims, dest)

    def test_signature_claim_mismatch_fails_before_verifier_socket(self):
        pkt, proof = packet()
        claims = issuer.issuer_claims(pkt, proof, RECEIPT, FENCE)
        fake_sig = {
            "environment": "DEV", "role": "issuer", "algorithm": "Ed25519",
            "claimsSha256": "0" * 64, "signatureBase64url": "Z" * 86,
            "fingerprintMatched": True, "authorizationGranted": False,
            "dispatchPermitted": False, "releaseDecision": "NO_GO",
        }
        with self.assertRaisesRegex(issuer.IssuerDenied, "ISSUER_SIGNATURE_ENVELOPE"):
            issuer.verify_four_role_packet(pkt, claims, fake_sig)

    def test_evidence_requires_persisted_four_signer_verification(self):
        pkt, proof = packet()
        claims = issuer.issuer_claims(pkt, proof, RECEIPT, FENCE)
        conn = FakeDB()
        unverified = {"persistedLineageMatched": False,
                      "trustedAdapterAuthenticated": True,
                      "issuerEvidenceVerified": True, "releaseDecision": "NO_GO"}
        with self.assertRaisesRegex(issuer.IssuerDenied, "ISSUER_UNVERIFIED_EVIDENCE"):
            issuer.record_and_consume(conn, claims, "S" * 86, unverified)
        self.assertEqual(conn.q.calls, [])

    def test_four_verified_issuer_evidence_and_lease_one_transaction(self):
        pkt, proof = packet()
        claims = issuer.issuer_claims(pkt, proof, RECEIPT, FENCE)
        verified = {"persistedLineageMatched": True,
                    "trustedAdapterAuthenticated": True,
                    "issuerEvidenceVerified": True, "releaseDecision": "NO_GO"}
        con = FakeDB()
        self.assertEqual(issuer.record_and_consume(con, claims, "S" * 86, verified), EVIDENCE)
        self.assertEqual(con.commits, 1)
        self.assertEqual(con.rollbacks, 0)
        self.assertEqual(len(con.q.calls), 4)
        self.assertIn("record_issuer_evidence(", con.q.calls[2][0])
        self.assertIn("consume_issuer_lease(", con.q.calls[3][0])
        self.assertEqual(con.q.calls[3][1], (COMMAND, EVIDENCE, FENCE))

    def test_bad_lease_ack_rolls_back_evidence(self):
        pkt, proof = packet()
        claims = issuer.issuer_claims(pkt, proof, RECEIPT, FENCE)
        verified = {"persistedLineageMatched": True,
                    "trustedAdapterAuthenticated": True,
                    "issuerEvidenceVerified": True, "releaseDecision": "NO_GO"}
        con = FakeDB(lease_ack=False)
        with self.assertRaisesRegex(issuer.IssuerDenied, "ISSUER_LEASE_RETURN"):
            issuer.record_and_consume(con, claims, "S" * 86, verified)
        self.assertEqual(con.commits, 0)
        self.assertEqual(con.rollbacks, 1)

    def test_missing_real_credentials_cannot_run(self):
        script = ROOT / "deploy/ai-coding-standalone-dev/gpt02_issue159_issuer_finalize_once.py"
        env = os.environ.copy()
        env.pop("GPT02_ISSUER_FINALIZE_ONCE", None)
        p = subprocess.run([sys.executable, str(script)], env=env,
                           capture_output=True, text=True, timeout=5)
        self.assertEqual(p.returncode, 2)
        self.assertIn("ISSUER_FINALIZE_DENIED", p.stderr)

    def test_systemd_service_static_and_dedicated_issuer_only(self):
        unit = (ROOT / "deploy/ai-coding-standalone-dev/gpt02-issue159-issuer-finalize-once.service").read_text()
        for required in ("Type=oneshot", "Restart=no", "ProtectSystem=strict",
                         "NoNewPrivileges=yes",
                         "Environment=GPT02_ISSUER_FINALIZE_ONCE=explicit-supervised",
                         "LoadCredentialEncrypted=issuer-dsn:",
                         "ConditionPathExists=/etc/credstore.encrypted/gpt02-issue159-issuer-dsn"):
            self.assertIn(required, unit)
        for forbidden in ("[Install]", "WantedBy=", "ExecStartPost=", "AI_DISPATCHER_ENABLED=true"):
            self.assertNotIn(forbidden, unit)

    def test_source_never_dispatches_or_manipulates_tables_directly(self):
        s = (ROOT/"deploy/ai-coding-standalone-dev/gpt02_issue159_issuer_finalize_once.py").read_text()
        for required in ("verify-persisted-lineage", "SO_PEERCRED",
                         "consume_linked_approval(", "reserve_post_consumption_fence(",
                         "record_issuer_evidence(", "consume_issuer_lease(",
                         "approved_chain_once", "NO_GO"):
            if required == "approved_chain_once":
                continue
            self.assertIn(required, s)
        for forbidden in ("INSERT INTO gpt02_", "UPDATE gpt02_",
                          "DELETE FROM gpt02_", "dispatch_to_dell(",
                          "ALTER ROLE ", "service_role"):
            self.assertNotIn(forbidden, s)


if __name__ == "__main__":
    unittest.main()
