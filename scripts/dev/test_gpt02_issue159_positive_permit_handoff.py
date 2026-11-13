#!/usr/bin/env python3
"""Read-only integration contract for existing Issue159 pinned four-signer verifier.

No network requests or live DEV operations. Uses the *existing* synthetic
signed packet fixtures from the canonical writer broker tests.
"""
from __future__ import annotations
import copy
import unittest
from pathlib import Path

from gpt02_issue159_positive_permit_handoff import (
    _pinned_verifier_socket, verify_readonly_envelope,
)
from gpt02_issue159_writer_broker_contract import (
    BrokerAdmissionError, verify_lifecycle_evidence_packet,
)
from test_gpt02_issue159_writer_broker_contract import WriterBrokerContractTest


class PositivePermitHandoffTest(unittest.TestCase):
    def setUp(self):
        fixture = WriterBrokerContractTest()
        fixture.setUp()
        self.packet = fixture.packet
        self.roots = fixture.roots
        self.now = fixture.now
        signed = verify_lifecycle_evidence_packet(
            self.packet, self.roots, self.now,
        )
        self.envelope = {
            "ok": True,
            "environment": "DEV",
            "result": {
                **signed,
                "stage": "POST_FENCE_TRUSTED_READBACK_VERIFICATION_ONLY",
                "persistedAdminApprovalReadBack": True,
                "fourSignaturesVerified": True,
                "persistedLineageMatched": True,
                "trustedAdapterAuthenticated": True,
                "lineageReaderReadOnly": True,
            },
            "writerEnabled": False,
            "databaseConnected": False,
            "signingPermitted": False,
            "authorizationGranted": False,
            "dispatchPermitted": False,
            "releaseDecision": "NO_GO",
        }

    def check(self, packet=None, response=None, now=None):
        return verify_readonly_envelope(
            self.packet if packet is None else packet,
            self.roots,
            self.envelope if response is None else response,
            self.now if now is None else now,
        )

    def reject(self, *, packet=None, response=None, now=None):
        with self.assertRaises(BrokerAdmissionError):
            self.check(packet=packet, response=response, now=now)

    def test_signed_packet_and_persisted_lineage_review_has_no_authority(self):
        outcome = self.check()
        self.assertEqual(outcome["stage"], "FOUR_SIGNATURE_PERSISTED_LINEAGE_REVIEWED")
        self.assertEqual(outcome["commandId"], self.packet["approval"]["claims"]["commandId"])
        self.assertEqual(outcome["attemptId"], self.packet["approval"]["claims"]["attemptId"])
        self.assertEqual(len(outcome["verifiedPacketSha256"]), 64)
        self.assertTrue(outcome["verifiedByExistingReader"])
        self.assertFalse(outcome["positivePermitCreated"])
        self.assertFalse(outcome["databaseWritePerformed"])
        self.assertFalse(outcome["signingPermitted"])
        self.assertFalse(outcome["authorizationGranted"])
        self.assertFalse(outcome["dispatchPermitted"])
        self.assertEqual(outcome["releaseDecision"], "NO_GO")

    def test_tampered_signed_approval_rejected_even_if_verifier_reply_claims_ok(self):
        packet = copy.deepcopy(self.packet)
        packet["approval"]["claims"]["taskId"] += 1
        self.reject(packet=packet)

    def test_tampered_issuer_command_rejected(self):
        packet = copy.deepcopy(self.packet)
        packet["issuerEvidence"]["claims"]["commandId"] = (
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        )
        self.reject(packet=packet)

    def test_expired_packet_rejected(self):
        self.reject(now=self.packet["issuerEvidence"]["claims"]["expiresAt"] + 1)

    def test_approval_readback_absent_rejected(self):
        e = copy.deepcopy(self.envelope)
        e["result"]["persistedAdminApprovalReadBack"] = False
        self.reject(response=e)

    def test_lineage_mismatch_rejected(self):
        e = copy.deepcopy(self.envelope)
        e["result"]["persistedLineageMatched"] = False
        self.reject(response=e)

    def test_reader_not_authenticated_rejected(self):
        e = copy.deepcopy(self.envelope)
        e["result"]["trustedAdapterAuthenticated"] = False
        self.reject(response=e)

    def test_wrong_approval_digest_rejected(self):
        e = copy.deepcopy(self.envelope)
        e["result"]["approvalDigest"] = "f" * 64
        self.reject(response=e)

    def test_wrong_hub_or_core_link_digest_rejected(self):
        for key in ("hubLinkDigest", "coreLinkDigest"):
            with self.subTest(key=key):
                e = copy.deepcopy(self.envelope)
                e["result"][key] = "0" * 64
                self.reject(response=e)

    def test_positive_flags_in_response_rejected(self):
        for key in ("writerEnabled", "databaseConnected",
                    "signingPermitted", "authorizationGranted",
                    "dispatchPermitted"):
            with self.subTest(key=key):
                e = copy.deepcopy(self.envelope)
                e[key] = True
                self.reject(response=e)

    def test_result_cannot_grant_authority(self):
        for key in ("signingPermitted", "authorizationGranted",
                    "dispatchPermitted", "databaseWritePerformed",
                    "nonceConsumed", "leaseConsumed"):
            with self.subTest(key=key):
                e = copy.deepcopy(self.envelope)
                e["result"][key] = True
                self.reject(response=e)

    def test_unexpected_result_stage_rejected(self):
        e = copy.deepcopy(self.envelope)
        e["result"]["stage"] = "DISPATCH_GRANTED"
        self.reject(response=e)

    def test_response_shape_exact(self):
        e = copy.deepcopy(self.envelope)
        e["trustedByCaller"] = True
        self.reject(response=e)

    def test_missing_four_signer_verification_rejected(self):
        e = copy.deepcopy(self.envelope)
        e["result"]["fourSignaturesVerified"] = False
        self.reject(response=e)

    def test_unpinned_socket_refused_before_filesystem_access(self):
        with self.assertRaises(BrokerAdmissionError) as ctx:
            _pinned_verifier_socket("/tmp/untrusted.sock")
        self.assertEqual(str(ctx.exception), "VERIFIER_SOCKET_PATH_NOT_PINNED")

    def test_no_writer_or_dispatch_path_in_handoff_source(self):
        source = (Path(__file__).resolve().parents[2]
                  / "deploy/ai-coding-standalone-dev"
                  / "gpt02_issue159_positive_permit_handoff.py").read_text()
        for forbidden in ("psycopg", "sqlite3", "Ed25519PrivateKey",
                          "INSERT INTO", "UPDATE gpt02_private",
                          "dispatch_worker(", "send_to_worker("):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
