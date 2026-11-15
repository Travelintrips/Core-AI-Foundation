#!/usr/bin/env python3
"""Offline signed pre-lineage scope derivation, never database role issuance.

Reuses synthetic four-root Ed25519 fixtures, existing pinned-root loader and
persisted approval socket API via test doubles. No DB, socket, credentials
or running services are accessed.
"""
from __future__ import annotations
import copy
import re
import unittest
from unittest.mock import patch

import gpt02_issue159_positive_permit_handoff as handoff
import gpt02_issue159_writer_broker_runtime as writer
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError
from test_gpt02_issue159_writer_broker_contract import WriterBrokerContractTest


class PrelineageScopeCandidateTest(unittest.TestCase):
    def setUp(self):
        f = WriterBrokerContractTest(
            methodName="test_four_domain_signatures_verify_but_no_authority"
        )
        f.setUp()
        self.fixture = f
        self.now_ms = f.now

    def check(self, packet=None, *, now_ms=None, approval_error=None):
        now = self.now_ms if now_ms is None else now_ms
        with patch.object(writer, "_load_public_roots",
                          return_value=self.fixture.roots) as roots:
            with patch.object(writer, "_require_persisted_admin_decision",
                              side_effect=approval_error) as approval:
                with patch.object(handoff.time, "time", return_value=now / 1000):
                    if approval_error is not None:
                        with self.assertRaises(BrokerAdmissionError):
                            handoff.inspect_prelineage_reader_scope_candidate(
                                self.fixture.packet if packet is None else packet
                            )
                        return roots, approval, None
                    result = handoff.inspect_prelineage_reader_scope_candidate(
                        self.fixture.packet if packet is None else packet
                    )
                    return roots, approval, result

    def test_signed_packet_and_persisted_approval_yield_only_inert_scope(self):
        roots, approval, result = self.check()
        self.assertEqual(result["stage"],
                         "SIGNED_PACKET_PERSISTED_ADMIN_PRELINEAGE_REVIEW_ONLY")
        self.assertEqual(result["scope"]["task_id"], self.fixture.approval["taskId"])
        self.assertEqual(result["scope"]["command_id"], self.fixture.approval["commandId"])
        self.assertEqual(result["scope"]["attempt_id"], self.fixture.approval["attemptId"])
        self.assertEqual(result["scope"]["company_id"], "default")
        self.assertEqual(result["expiresAt"], self.fixture.issuer["expiresAt"])
        self.assertRegex(result["candidateRole"], r"^dev_gpt02_task_140_[0-9a-f]{12}$")
        self.assertRegex(result["scopeSha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(result["signedPacketSha256"], r"^[0-9a-f]{64}$")
        self.assertFalse(result["lineageReadbackCompleted"])
        for key in ("databaseRoleProvisioned", "credentialIssuancePermitted",
                    "signingPermitted", "authorizationGranted", "dispatchPermitted"):
            self.assertIs(result[key], False)
        self.assertEqual(result["releaseDecision"], "NO_GO")
        roots.assert_called_once_with(
            writer.DEFAULT_PUBLIC_ROOTS, writer.DEFAULT_FINGERPRINT_MANIFEST
        )
        args = approval.call_args.args
        self.assertEqual(args[0], self.fixture.approval)
        self.assertEqual(args[1], result["scope"]["approval_digest"])
        self.assertEqual(args[2], writer.DEFAULT_APPROVAL_READER_SOCKET)
        self.assertEqual(args[3], self.now_ms)

    def test_same_packet_replay_creates_no_capability(self):
        first = self.check()[2]
        second = self.check()[2]
        self.assertEqual(first["candidateRole"], second["candidateRole"])
        self.assertEqual(first["signedPacketSha256"], second["signedPacketSha256"])
        self.assertIs(first["credentialIssuancePermitted"], False)
        self.assertIs(second["credentialIssuancePermitted"], False)

    def test_tampered_task_is_rejected_before_persisted_approval_reader(self):
        packet = copy.deepcopy(self.fixture.packet)
        packet["approval"]["claims"]["taskId"] = 172
        with patch.object(writer, "_load_public_roots",
                          return_value=self.fixture.roots):
            with patch.object(writer, "_require_persisted_admin_decision") as read:
                with patch.object(handoff.time, "time", return_value=self.now_ms / 1000):
                    with self.assertRaises(BrokerAdmissionError):
                        handoff.inspect_prelineage_reader_scope_candidate(packet)
                read.assert_not_called()

    def test_persisted_approval_unavailable_cannot_yield_candidate(self):
        self.check(approval_error=BrokerAdmissionError(
            "PERSISTED_ADMIN_APPROVAL_NOT_FOUND"
        ))

    def test_lease_near_expiry_refused_before_approval_read(self):
        # Signed issuer evidence remains valid, but has <3.5 seconds left.
        with patch.object(writer, "_load_public_roots",
                          return_value=self.fixture.roots):
            with patch.object(writer, "_require_persisted_admin_decision") as read:
                with patch.object(handoff.time, "time",
                                  return_value=(self.now_ms + 1800) / 1000):
                    with self.assertRaisesRegex(
                        BrokerAdmissionError, "ISSUER_LEASE_TOO_CLOSE_TO_EXPIRY"
                    ):
                        handoff.inspect_prelineage_reader_scope_candidate(
                            self.fixture.packet
                        )
                read.assert_not_called()

    def test_unsigned_override_is_not_accepted(self):
        with self.assertRaises(TypeError):
            handoff.inspect_prelineage_reader_scope_candidate(
                self.fixture.packet, task_id=172
            )


if __name__ == "__main__":
    unittest.main()
