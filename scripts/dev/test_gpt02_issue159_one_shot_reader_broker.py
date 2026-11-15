#!/usr/bin/env python3
"""Source-only one-shot broker contract regression, no live credentials/DB.

Uses ephemeral Ed25519 fixture and existing trusted-row contract; all
PostgreSQL contexts and supervisor cleanup are TEST DOUBLES. The module's
return can never authorize credential issuance or dispatch.
"""
from __future__ import annotations

import copy
import unittest
from unittest.mock import Mock, patch

import gpt02_issue159_one_shot_reader_broker as broker
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError
from test_gpt02_issue159_postlineage_reader_scope import (
    PostlineageReaderScopeOfflineTest,
)
from test_gpt02_issue159_lineage_readback_contract import (
    TrustedLineageReadbackTest,
)


class NativeConnection:
    def __init__(self, role):
        self.info = type("Info", (), {
            "user": role + broker.POOLER_USER_SUFFIX,
            "dbname": "postgres",
        })()
        self.autocommit = False
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True
        return False


class FakeSupervisor:
    def __init__(self, role, scope_sha):
        self.connection = NativeConnection(role)
        self.open_calls = []
        self.relock_calls = []
        self.scope_sha = scope_sha
        self.relock_ok = True
        self.open_failure = None

    def open_one_scoped_connection(self, candidate):
        self.open_calls.append(candidate)
        if self.open_failure is not None:
            raise self.open_failure
        return self.connection

    def relock_and_verify(self, candidate):
        self.relock_calls.append(candidate)
        return {
            "role": candidate["candidateRole"],
            "scopeSha256": self.scope_sha,
            "noLogin": self.relock_ok,
            "passwordNull": True,
            "connectionLimitZero": True,
            "zeroActiveSessions": True,
            "grantsRevoked": True,
        }


class ScopedReaderBrokerTest(unittest.TestCase):
    def setUp(self):
        fixture = PostlineageReaderScopeOfflineTest()
        fixture.setUp()
        self.packet = fixture.fixture.packet
        self.roots = fixture.fixture.roots
        self.candidate = fixture.check()
        self.now = fixture.fixture.now
        other = TrustedLineageReadbackTest()
        other.setUp()
        self.row = other.row
        self.supervisor = FakeSupervisor(
            self.candidate["candidateRole"],
            self.candidate["scopeSha256"],
        )

    def call(self, **kwargs):
        candidate = kwargs.pop("candidate", self.candidate)
        packet = kwargs.pop("packet", self.packet)
        read_rows = kwargs.pop("rows", [self.row])
        user_time = kwargs.pop("at_ms", self.now)
        reader = kwargs.pop("reader", None)
        if kwargs:
            raise AssertionError("UNKNOWN_TEST_OPTIONS")
        if reader is None:
            reader = Mock(return_value=read_rows)
        with patch.object(broker, "_load_public_roots",
                          return_value=self.roots) as roots_loader:
            with patch.object(broker,
                              "inspect_postlineage_scoped_reader_candidate",
                              return_value=candidate) as proof:
                with patch.object(broker, "read_lineage_once",
                                  reader) as bounded_read:
                    with patch.object(broker.time, "time",
                                      return_value=user_time / 1000):
                        try:
                            result = broker.review_one_shot_reader_readback(
                                packet, self.supervisor
                            )
                        finally:
                            self.last_read = bounded_read
                            self.last_roots = roots_loader
                            self.last_proof = proof
        return result

    def test_one_exact_lookup_and_relock_no_authority(self):
        value = self.call()
        self.last_roots.assert_called_once_with(
            broker.VERIFIER_PUBLIC_ROOT_DIR, broker.DEFAULT_FINGERPRINT_MANIFEST
        )
        self.last_proof.assert_called_once_with(self.packet, self.roots)
        self.last_read.assert_called_once_with(
            self.supervisor.connection,
            {
                "company_id": self.candidate["scope"]["company_id"],
                "task_id": self.candidate["scope"]["task_id"],
                "command_id": self.candidate["scope"]["command_id"],
                "attempt_id": self.candidate["scope"]["attempt_id"],
                "approval_digest": self.candidate["scope"]["approval_digest"],
            }
        )
        self.assertEqual(len(self.supervisor.open_calls), 1)
        self.assertEqual(len(self.supervisor.relock_calls), 1)
        self.assertTrue(self.supervisor.connection.closed)
        self.assertTrue(value["oneCanonicalReadReviewed"])
        self.assertTrue(value["postReadRelockReported"])
        self.assertEqual(value["releaseDecision"], "NO_GO")
        for key in ("credentialIssuancePermitted", "databaseRoleProvisioned",
                    "databaseWritePerformed", "signingPermitted",
                    "authorizationGranted", "dispatchPermitted"):
            self.assertIs(value[key], False)

    def test_wrong_database_user_blocks_before_any_query_and_relocks(self):
        self.supervisor.connection.info.user = "service_role"
        with self.assertRaisesRegex(BrokerAdmissionError,
                                    "ONE_SHOT_NATIVE_READER_IDENTITY"):
            self.call()
        self.last_read.assert_not_called()
        self.assertEqual(len(self.supervisor.relock_calls), 1)
        self.assertTrue(self.supervisor.connection.closed)

    def test_wrong_database_name_and_autocommit_deny(self):
        for field, value in (("dbname", "other"), ("autocommit", True)):
            with self.subTest(field=field):
                self.setUp()
                obj = (self.supervisor.connection.info
                       if field == "dbname" else self.supervisor.connection)
                setattr(obj, field, value)
                with self.assertRaises(BrokerAdmissionError):
                    self.call()
                self.last_read.assert_not_called()
                self.assertEqual(len(self.supervisor.relock_calls), 1)

    def test_missing_row_or_bad_row_forbidden(self):
        for rows in ([], [dict(self.row, receipt_id="different")]):
            with self.subTest(rows=len(rows)):
                self.setUp()
                with self.assertRaises(BrokerAdmissionError):
                    self.call(rows=rows)
                self.assertEqual(len(self.supervisor.relock_calls), 1)

    def test_query_failure_relocks_and_preserves_failure(self):
        error = RuntimeError("synthetic_connection_query_failed")
        with self.assertRaisesRegex(RuntimeError, "synthetic_connection_query_failed"):
            self.call(reader=Mock(side_effect=error))
        self.assertEqual(len(self.supervisor.relock_calls), 1)
        self.assertTrue(self.supervisor.connection.closed)

    def test_connection_open_failure_still_relocks(self):
        self.supervisor.open_failure = RuntimeError("open_failed")
        with self.assertRaisesRegex(RuntimeError, "open_failed"):
            self.call()
        self.last_read.assert_not_called()
        self.assertEqual(len(self.supervisor.relock_calls), 1)

    def test_relock_failed_or_wrong_attestation_denies(self):
        self.supervisor.relock_ok = False
        with self.assertRaisesRegex(BrokerAdmissionError,
                                    "ONE_SHOT_POSTREAD_RELOCK_NOT_PROVEN"):
            self.call()
        self.supervisor.relock_ok = True
        self.supervisor.scope_sha = "f" * 64
        with self.assertRaisesRegex(BrokerAdmissionError,
                                    "ONE_SHOT_POSTREAD_RELOCK_NOT_PROVEN"):
            self.call()

    def test_insufficient_lease_denied_before_connection(self):
        with self.assertRaisesRegex(BrokerAdmissionError,
                                    "ONE_SHOT_SIGNED_LEASE_INSUFFICIENT"):
            self.call(at_ms=self.candidate["expiresAt"] - 2000)
        self.assertEqual(len(self.supervisor.open_calls), 0)
        self.assertEqual(len(self.supervisor.relock_calls), 0)

    def test_candidate_cannot_have_positive_authority(self):
        candidate = dict(self.candidate)
        candidate["credentialIssuancePermitted"] = True
        with self.assertRaises(BrokerAdmissionError):
            self.call(candidate=candidate)
        self.assertEqual(len(self.supervisor.open_calls), 0)

    def test_source_has_no_operational_entrypoint_or_dispatch(self):
        from pathlib import Path
        source = (Path(__file__).resolve().parents[2] /
                  "deploy/ai-coding-standalone-dev/" /
                  "gpt02_issue159_one_shot_reader_broker.py").read_text()
        self.assertIn("UNINSTALLED_REVIEW_ONLY_NO_CREDENTIAL_OR_DB_DISPATCH", source)
        for forbidden in ("psycopg.connect(", "ALTER ROLE ", "CREATE ROLE ",
                          "dispatchOnce(", "gateway.send(", "private_key(",):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
