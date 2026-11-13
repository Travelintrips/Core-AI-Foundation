"""Negative tests for staged GPT02 verification. All identities and keys synthetic."""
import copy
import unittest

from test_gpt02_issue159_writer_broker_contract import WriterBrokerContractTest, sign
from gpt02_issue159_writer_broker_contract import (
    APPROVAL_FIELDS, LINK_FIELDS, BrokerAdmissionError,
)
from gpt02_issue159_staged_admission import (
    verify_pre_consumption_packet, verify_post_fence_packet,
)


class StagedAdmissionTest(unittest.TestCase):
    def setUp(self):
        self.fixture = WriterBrokerContractTest(
            methodName="test_four_domain_signatures_verify_but_no_authority")
        self.fixture.setUp()
        self.f = self.fixture
        self.pre = {key: copy.deepcopy(self.f.packet[key])
                    for key in ("approval", "hubLink", "coreLink")}
        self.receipt = self.f.issuer["receiptId"]
        self.fence = self.f.issuer["fenceId"]

    def stage_one(self, packet=None, roots=None, now=None):
        return verify_pre_consumption_packet(
            self.pre if packet is None else packet,
            self.f.roots if roots is None else roots,
            self.f.now if now is None else now)

    def test_pre_consumption_three_signatures_pass_without_issuer(self):
        result = self.stage_one()
        self.assertTrue(result["threeSignaturesVerified"])
        self.assertFalse(result["persistedAdminApprovalReadBack"])
        for field in ("databaseWritePerformed", "nonceConsumed", "leaseConsumed",
                      "signingPermitted", "authorizationGranted", "dispatchPermitted"):
            self.assertFalse(result[field])
        self.assertEqual(result["releaseDecision"], "NO_GO")

    def test_pre_stage_rejects_issuer_payload_and_caller_flags(self):
        for key, value in (("issuerEvidence", self.f.packet["issuerEvidence"]),
                           ("approved", True), ("dispatchPermitted", True)):
            candidate = copy.deepcopy(self.pre)
            candidate[key] = value
            with self.assertRaises(BrokerAdmissionError):
                self.stage_one(candidate)

    def test_pre_stage_rejects_tampering_or_role_swap(self):
        for variant in ("tamper", "swap"):
            candidate = copy.deepcopy(self.pre)
            if variant == "tamper":
                candidate["approval"]["claims"]["taskId"] = 141
            else:
                candidate["coreLink"]["signature"] = candidate["hubLink"]["signature"]
            with self.assertRaises(BrokerAdmissionError):
                self.stage_one(candidate)

    def test_pre_stage_rejects_wrong_operator_or_old_task_after_resigning(self):
        for value in (139, 135):
            candidate = copy.deepcopy(self.pre)
            candidate["approval"]["claims"]["taskId"] = value
            candidate["approval"]["signature"] = sign(
                self.f.keys["approval"], candidate["approval"]["claims"], APPROVAL_FIELDS)
            with self.assertRaises(BrokerAdmissionError):
                self.stage_one(candidate)
        candidate = copy.deepcopy(self.pre)
        candidate["hubLink"]["claims"]["hubOperatorId"] = "attacker"
        candidate["coreLink"]["claims"]["hubOperatorId"] = "attacker"
        for key, role, domain in (("hubLink", "hub", b"GPT02_OPERATOR_LINK_V1:hub\n"),
                                  ("coreLink", "core", b"GPT02_OPERATOR_LINK_V1:core\n")):
            candidate[key]["signature"] = sign(
                self.f.keys[role], candidate[key]["claims"], LINK_FIELDS, domain)
        with self.assertRaises(BrokerAdmissionError):
            self.stage_one(candidate)

    def test_pre_stage_rejects_expired_or_future_clock(self):
        for now in (self.f.now + 130000, self.f.now - 2000):
            with self.assertRaises(BrokerAdmissionError):
                self.stage_one(now=now)

    def test_pre_stage_rejects_duplicate_roots(self):
        roots = dict(self.f.roots)
        roots["issuer"] = roots["hub"]
        with self.assertRaises(BrokerAdmissionError):
            self.stage_one(roots=roots)

    def test_post_fence_all_four_signatures_and_matching_lineage(self):
        result = verify_post_fence_packet(
            self.f.packet, self.f.roots, self.f.now, self.receipt, self.fence)
        self.assertTrue(result["trustedLineageIdsMatched"])
        self.assertTrue(result["issuerEvidenceVerified"])
        self.assertFalse(result["dispatchPermitted"])
        self.assertEqual(result["releaseDecision"], "NO_GO")

    def test_post_fence_rejects_untrusted_or_mismatched_lineage(self):
        for receipt, fence in (
            ("not-a-uuid", self.fence),
            ("60000000-0000-4000-8000-000000000099", self.fence),
            (self.receipt, "70000000-0000-4000-8000-000000000099"),
        ):
            with self.assertRaises(BrokerAdmissionError):
                verify_post_fence_packet(
                    self.f.packet, self.f.roots, self.f.now, receipt, fence)

    def test_post_fence_rejects_issuer_tampering(self):
        packet = copy.deepcopy(self.f.packet)
        packet["issuerEvidence"]["claims"]["leaseEpoch"] = 2
        with self.assertRaises(BrokerAdmissionError):
            verify_post_fence_packet(
                packet, self.f.roots, self.f.now, self.receipt, self.fence)

    def test_contract_has_no_database_or_signing_surface(self):
        from pathlib import Path
        path = Path(__file__).parents[2] / (
            "deploy/ai-coding-standalone-dev/gpt02_issue159_staged_admission.py")
        body = path.read_text()
        for forbidden in ("psycopg", "sqlite3", "Ed25519PrivateKey", "socket.socket",
                          "INSERT INTO", "UPDATE ", "DELETE FROM", "dispatch("):
            self.assertNotIn(forbidden, body)


if __name__ == "__main__":
    unittest.main()
