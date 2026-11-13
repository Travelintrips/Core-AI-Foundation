#!/usr/bin/env python3
"""Synthetic broker integration: no live database, credentials or worker."""
from __future__ import annotations

import copy
import os
from pathlib import Path
import unittest
from unittest.mock import patch

import gpt02_issue159_positive_release_broker as broker
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError
from test_gpt02_issue159_positive_permit_handoff import PositivePermitHandoffTest

PERMIT = "88888888-8888-4888-8888-888888888888"


class FakeConnection:
    def __init__(self, *, role=broker.DEDICATED_DB_ROLE,
                 fail_at=None, consume_value="OUTBOX_RECORDED_NO_WORKER_DISPATCH"):
        self.role = role
        self.fail_at = fail_at
        self.consume_value = consume_value
        self.events = []
        self.result = None

    def transaction(self):
        return self

    def __enter__(self):
        self.events.append("BEGIN")
        return self

    def __exit__(self, typ, error, traceback):
        self.events.append("ROLLBACK" if typ else "COMMIT")
        return False

    def cursor(self):
        return self

    def execute(self, statement, params=None):
        if statement == broker.ROLE_SQL:
            self.events.append("ROLE")
            self.result = (self.role, self.role)
        elif statement == broker.RESERVE_SQL:
            self.events.append(("RESERVE", params))
            if self.fail_at == "reserve":
                raise RuntimeError("SYNTHETIC_RESERVE_FAILURE")
            self.result = (PERMIT,)
        elif statement == broker.CONSUME_SQL:
            self.events.append(("CONSUME", params))
            if self.fail_at == "consume":
                raise RuntimeError("SYNTHETIC_CONSUME_FAILURE")
            self.result = (self.consume_value,)
        else:
            raise AssertionError("UNEXPECTED_SQL_STATEMENT")

    def fetchone(self):
        return self.result


class PositiveReleaseBrokerTest(unittest.TestCase):
    def setUp(self):
        f = PositivePermitHandoffTest()
        f.setUp()
        self.fixture = f
        self.packet = f.packet
        self.db = FakeConnection()
        self.patches = [
            patch.object(broker, "_load_public_roots", return_value=f.roots),
            patch.object(broker, "inspect_proposed_permit_candidate",
                         side_effect=lambda p, roots: f.check(packet=p)),
            patch.object(broker.time, "time", return_value=f.now / 1000.0),
            patch.dict(os.environ, {"GPT02_ISSUE159_POSITIVE_RELEASE_ENABLED": "true"}),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def test_verified_packet_held_outbox_once_with_exact_id(self):
        result = broker.record_held_outbox_from_signed_packet(self.packet, self.db)
        self.assertEqual(result["commandId"], self.packet["approval"]["claims"]["commandId"])
        self.assertEqual(result["attemptId"], self.packet["approval"]["claims"]["attemptId"])
        self.assertEqual(result["outboxState"], "HELD_NO_DISPATCH")
        self.assertTrue(result["outboxRecorded"])
        for flag in ("workerCommandCreated", "finalAckVerified", "signingPermitted",
                     "authorizationGranted", "dispatchPermitted"):
            self.assertFalse(result[flag], flag)
        self.assertEqual(result["releaseDecision"], "NO_GO")
        self.assertEqual(self.db.events[0:2], ["BEGIN", "ROLE"])
        self.assertEqual(self.db.events[-1], "COMMIT")
        self.assertEqual(self.db.events[2][0], "RESERVE")
        self.assertEqual(self.db.events[3][0], "CONSUME")
        cmd = self.packet["approval"]["claims"]["commandId"]
        self.assertEqual(self.db.events[2][1][0], cmd)
        self.assertEqual(self.db.events[3][1][1], cmd)
        self.assertEqual(self.db.events[3][1][0], PERMIT)
        self.assertEqual(self.db.events[3][1][2], self.db.events[2][1][1])
        self.assertEqual(self.db.events[2][1][2], self.fixture.check()["issuerClaimsSha"])
        self.assertEqual(self.db.events[2][1][3],
                         self.packet["issuerEvidence"]["signature"])

    def test_release_off_denied_before_verifier_or_database(self):
        with patch.dict(os.environ, {"GPT02_ISSUE159_POSITIVE_RELEASE_ENABLED": "false"}):
            with patch.object(broker, "_load_public_roots") as loader:
                with self.assertRaises(BrokerAdmissionError):
                    broker.record_held_outbox_from_signed_packet(self.packet, self.db)
                loader.assert_not_called()
        self.assertEqual(self.db.events, [])

    def test_other_database_identity_rejected_before_reservation(self):
        self.db.role = "service_role"
        with self.assertRaisesRegex(BrokerAdmissionError,
                                    "DEDICATED_RELEASE_WRITER_ROLE_REQUIRED"):
            broker.record_held_outbox_from_signed_packet(self.packet, self.db)
        self.assertEqual(self.db.events, ["BEGIN", "ROLE", "ROLLBACK"])

    def test_signature_tamper_denied_before_database_transaction(self):
        p = copy.deepcopy(self.packet)
        p["issuerEvidence"]["signature"] = "A" * 86
        with self.assertRaises(BrokerAdmissionError):
            broker.record_held_outbox_from_signed_packet(p, self.db)
        self.assertEqual(self.db.events, [])

    def test_issuer_lease_expiration_denied_before_database(self):
        with patch.object(broker.time, "time",
                          return_value=(self.packet["issuerEvidence"]["claims"]["expiresAt"] - 2900) / 1000.0):
            with self.assertRaisesRegex(BrokerAdmissionError,
                                        "ISSUER_LEASE_TOO_CLOSE_TO_EXPIRY"):
                broker.record_held_outbox_from_signed_packet(self.packet, self.db)
        self.assertEqual(self.db.events, [])

    def test_forged_packet_sha_denied_before_database(self):
        real = self.fixture.check()
        real["verifiedPacketSha256"] = "0" * 64
        with patch.object(broker, "inspect_proposed_permit_candidate", return_value=real):
            with self.assertRaisesRegex(BrokerAdmissionError,
                                        "VERIFIER_HASH_BINDING_MISMATCH"):
                broker.record_held_outbox_from_signed_packet(self.packet, self.db)
        self.assertEqual(self.db.events, [])

    def test_forged_issuer_claim_sha_denied_before_database(self):
        real = self.fixture.check()
        real["issuerClaimsSha256"] = "e" * 64
        with patch.object(broker, "inspect_proposed_permit_candidate", return_value=real):
            with self.assertRaisesRegex(BrokerAdmissionError,
                                        "VERIFIER_HASH_BINDING_MISMATCH"):
                broker.record_held_outbox_from_signed_packet(self.packet, self.db)
        self.assertEqual(self.db.events, [])

    def test_verifier_deny_denied_before_database(self):
        with patch.object(broker, "inspect_proposed_permit_candidate",
                          side_effect=BrokerAdmissionError("NO_PERSISTED_APPROVAL")):
            with self.assertRaises(BrokerAdmissionError):
                broker.record_held_outbox_from_signed_packet(self.packet, self.db)
        self.assertEqual(self.db.events, [])

    def test_reserve_failure_transaction_rollback(self):
        self.db.fail_at = "reserve"
        with self.assertRaisesRegex(RuntimeError, "SYNTHETIC_RESERVE_FAILURE"):
            broker.record_held_outbox_from_signed_packet(self.packet, self.db)
        self.assertEqual(self.db.events[-1], "ROLLBACK")
        self.assertNotIn("COMMIT", self.db.events)

    def test_consume_failure_transaction_rollback(self):
        self.db.fail_at = "consume"
        with self.assertRaisesRegex(RuntimeError, "SYNTHETIC_CONSUME_FAILURE"):
            broker.record_held_outbox_from_signed_packet(self.packet, self.db)
        self.assertEqual(self.db.events[-1], "ROLLBACK")
        self.assertNotIn("COMMIT", self.db.events)

    def test_unexpected_consume_result_rolls_back(self):
        self.db.consume_value = "DISPATCH_GRANTED"
        with self.assertRaisesRegex(BrokerAdmissionError,
                                    "ATOMIC_OUTBOX_CONSUMPTION_NOT_PROVEN"):
            broker.record_held_outbox_from_signed_packet(self.packet, self.db)
        self.assertEqual(self.db.events[-1], "ROLLBACK")

    def test_broker_is_not_network_worker_or_credential_reader(self):
        source = (Path(__file__).resolve().parents[2] /
                  "deploy/ai-coding-standalone-dev" /
                  "gpt02_issue159_positive_release_broker.py").read_text()
        for forbidden in ("openclaw agent", "httpx", "requests.", "sqlite3",
                          "subprocess", "private-key.pkcs8", "service_role",
                          "INSERT INTO", "UPDATE ai_platform",
                          "create_command(", "dispatch_worker("):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
