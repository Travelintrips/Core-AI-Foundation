"""Synthetic signed-verifier + persisted Super Admin admission preflight tests.

Uses existing verifier runtime, isolated disposable SQLite approval-reader socket,
ephemeral Ed25519 keys. No live Supabase or signer credentials and no writes.
"""
from __future__ import annotations
import copy
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from gpt02_issue159_attestor_preflight import verify_stage_before_attestor
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError
import test_gpt02_issue159_writer_broker_runtime as verifier_fixture


class AttestorPreflightTest(unittest.TestCase):
    def setUp(self):
        self.fixture = verifier_fixture.WriterBrokerRuntimeTest(methodName="test_socket_returns_verified_but_no_authority")
        self.fixture.setUp()

    def tearDown(self):
        self.fixture.tearDown()

    def packet(self):
        return self.fixture._pre_consumption()

    def verify(self, packet=None):
        from gpt02_issue159_attestor_preflight import pwd, grp
        with patch.object(pwd, "getpwnam", return_value=SimpleNamespace(pw_uid=os.getuid())):
            with patch.object(grp, "getgrnam", return_value=SimpleNamespace(gr_gid=os.getgid())):
                return verify_stage_before_attestor(
                    self.packet() if packet is None else packet,
                    verifier_socket=str(self.fixture.socket_path),
                    now_ms=self.fixture.now,
                )

    def test_authentic_three_signers_and_persisted_admin_are_verification_only(self):
        self.fixture._start_approval_reader()
        self.fixture._start()
        result = self.verify()
        self.assertEqual(result["taskId"], 140)
        self.assertTrue(result["threeSignaturesVerified"])
        self.assertTrue(result["persistedAdminApprovalReadBack"])
        self.assertTrue(result["verifierPeerAuthenticated"])
        self.assertEqual(len(result["approvalDigest"]), 64)
        for name in ("databaseWritePerformed", "recordLinkedApprovalExecuted",
                     "signingPermitted", "authorizationGranted", "dispatchPermitted"):
            self.assertIs(result[name], False, name)
        self.assertEqual(result["releaseDecision"], "NO_GO")

    def test_missing_persisted_admin_is_rejected(self):
        self.fixture._start()
        with self.assertRaisesRegex(BrokerAdmissionError, "STAGED_VERIFIER_REJECTED"):
            self.verify()

    def test_tampered_signatures_rejected(self):
        self.fixture._start_approval_reader()
        self.fixture._start()
        packet = self.packet()
        packet["approval"]["claims"]["taskId"] += 1
        with self.assertRaisesRegex(BrokerAdmissionError, "STAGED_VERIFIER_REJECTED"):
            self.verify(packet)

    def test_wrong_stored_admin_digest_rejected(self):
        self.fixture._start_approval_reader(stored_digest="f" * 64)
        self.fixture._start()
        with self.assertRaisesRegex(BrokerAdmissionError, "STAGED_VERIFIER_REJECTED"):
            self.verify()

    def test_expired_approval_rejected_before_socket(self):
        packet = self.packet()
        packet["approval"]["claims"]["expiresAt"] = self.fixture.now - 1
        with self.assertRaisesRegex(BrokerAdmissionError, "STAGED_EVIDENCE_EXPIRED_OR_TOO_CLOSE"):
            self.verify(packet)

    def test_forbidden_socket_permission_denied(self):
        self.fixture._start_approval_reader()
        self.fixture._start()
        os.chmod(self.fixture.socket_path, 0o666)
        with self.assertRaisesRegex(RuntimeError, "VERIFIER_SOCKET_CUSTODY_INVALID"):
            self.verify()

    def test_wrong_peer_identity_denied(self):
        self.fixture._start_approval_reader()
        self.fixture._start()
        from gpt02_issue159_attestor_preflight import pwd, grp
        with patch.object(pwd, "getpwnam", return_value=SimpleNamespace(pw_uid=os.getuid()+1)):
            with patch.object(grp, "getgrnam", return_value=SimpleNamespace(gr_gid=os.getgid())):
                with self.assertRaisesRegex(RuntimeError, "VERIFIER_SOCKET_CUSTODY_INVALID"):
                    verify_stage_before_attestor(self.packet(),
                        verifier_socket=str(self.fixture.socket_path),
                        now_ms=self.fixture.now)

    def test_no_db_writer_or_signer_apis_in_stage_gate_source(self):
        source=(Path(__file__).resolve().parents[2] /
                "deploy/ai-coding-standalone-dev/gpt02_issue159_attestor_preflight.py").read_text()
        for forbidden in ("psycopg", "sqlite3", "INSERT INTO", "UPDATE ",
                          "DELETE FROM", "Ed25519PrivateKey", "key.sign(",
                          "subprocess", "dispatch(", "consume_linked_approval("):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
