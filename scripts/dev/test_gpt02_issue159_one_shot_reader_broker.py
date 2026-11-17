#!/usr/bin/env python3
"""Source-only one-shot broker contract regression, no live credentials/DB.

Uses ephemeral Ed25519 fixture and existing trusted-row contract; all
PostgreSQL contexts and supervisor cleanup are TEST DOUBLES. The module's
return can never authorize credential issuance or dispatch.
"""
from __future__ import annotations

import copy
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import gpt02_issue159_one_shot_reader_broker as broker
import gpt02_issue159_native_relock_attestation as native
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
            "host": broker.POOLER_HOST,
            "port": 5432,
            "get_parameters": lambda _self: {
                "sslmode": "verify-full",
                "sslrootcert": "/synthetic/ca.pem",
            },
        })()
        self.autocommit = False
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True
        return False



class NativeAuditCursor:
    def __init__(self, connection):
        self.connection = connection
        self.description = [SimpleNamespace(name=("consumption_persisted" if connection.kind == "consumption" else "fully_locked"))]
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, statement, params=None):
        self.calls.append((statement, params))
        # The first audit connection can be used for postread RELOCK when
        # a failure occurs BEFORE any consumption audit. Select the column
        # by the SQL ACTUALLY executed, not by which connection came first.
        if statement == native.CONSUMPTION_READBACK_SQL:
            self.description = [SimpleNamespace(name="consumption_persisted")]
            self.connection.events.append("audit_consumption")
        elif statement == native.BOOLEAN_READBACK_SQL:
            self.description = [SimpleNamespace(name="fully_locked")]
            self.connection.events.append("audit_relock")
        elif statement not in ("SET TRANSACTION READ ONLY",
                               "SET LOCAL statement_timeout = '1500ms'"):
            raise AssertionError("UNEXPECTED_NATIVE_AUDITOR_SQL")
        if self.connection.audit_error is not None:
            raise self.connection.audit_error

    def fetchmany(self, size):
        if size != 2:
            raise AssertionError("NATIVE_AUDIT_MUST_BE_BOUNDED")
        if self.connection.rows_override is not None:
            return self.connection.rows_override
        return [(True,)]


class FakeMinimalAuditConnection:
    def __init__(self, role, *, kind="relock"):
        self.role = role
        self.kind = kind
        self.info = type("AdminInfo", (), {
            "user": native.AUDITOR_DB_USER,
            "dbname": "postgres",
            "host": native.HOST,
            "port": 5432,
            "get_parameters": lambda _self: {
                "sslmode": "verify-full",
                "sslrootcert": "/synthetic/root.pem",
            },
        })()
        self.autocommit = False
        self.rollback_calls = 0
        self.closed = False
        self.rows_override = None
        self.audit_error = None
        self.last_cursor = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True
        return False

    def cursor(self):
        self.last_cursor = NativeAuditCursor(self)
        return self.last_cursor

    def rollback(self):
        self.rollback_calls += 1



class NativeCanonicalGuardCursor:
    def __init__(self, connection):
        self.connection = connection
        self.description = [SimpleNamespace(name="approval_current")]
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, statement, params=None):
        self.calls.append((statement, params))
        if statement == broker.CANONICAL_CURRENT_GUARD_SQL:
            self.connection.events.append("guard_current")
            self.connection.guard_checked = True
        elif statement not in (
            "SET TRANSACTION READ WRITE",
            "SET LOCAL statement_timeout = '1500ms'",
            "SET LOCAL lock_timeout = '1500ms'",
        ):
            raise AssertionError("UNREVIEWED_CANONICAL_GUARD_SQL")
        if self.connection.error is not None:
            raise self.connection.error

    def fetchmany(self, size):
        assert size == 2, "CURRENT_APPROVAL_READBACK_NOT_BOUNDED"
        return (self.connection.rows_override if self.connection.rows_override is not None
                else [(True,)])


class FakeCanonicalGuardConnection:
    def __init__(self, events):
        self.events = events
        self.info = type("GuardInfo", (), {
            "user": broker.GUARD_DB_USER,
            "dbname": "postgres",
            "host": broker.POOLER_HOST,
            "port": 5432,
            "get_parameters": lambda _self: {
                "sslmode": "verify-full",
                "sslrootcert": "/synthetic/ca.pem",
            },
        })()
        self.autocommit = False
        self.active = False
        self.closed = False
        self.guard_checked = False
        self.rows_override = None
        self.error = None
        self.last_cursor = None
        self.rollback_calls = 0

    def __enter__(self):
        self.active = True
        return self

    def __exit__(self, *args):
        self.active = False
        self.closed = True
        self.events.append("guard_close")
        return False

    def cursor(self):
        self.last_cursor = NativeCanonicalGuardCursor(self)
        return self.last_cursor

    def rollback(self):
        self.rollback_calls += 1
        self.events.append("guard_rollback")




class FakeSupervisor:
    def __init__(self, role, scope_sha):
        self.connection = NativeConnection(role)
        self.events = []
        self.consumption_calls = []
        self.read_challenges = []
        self.consumed_scopes = set()
        self.consumption_error = None
        self.consumption_override = None
        self.claim_auditor_connection = FakeMinimalAuditConnection(role, kind="consumption")
        self.auditor_connection = FakeMinimalAuditConnection(role)
        self.claim_auditor_connection.events = self.events
        self.auditor_connection.events = self.events
        self.guard_connection = FakeCanonicalGuardConnection(self.events)
        self.guard_open_calls = []
        self.auditor_open_calls = []
        self.open_calls = []
        self.relock_calls = []
        self.scope_sha = scope_sha
        self.relock_ok = True
        self.open_failure = None

    def consume_scope_once(self, candidate, read_challenge):
        self.events.append("consume")
        self.consumption_calls.append(candidate)
        self.read_challenges.append(read_challenge)
        if self.consumption_error is not None:
            raise self.consumption_error
        scope_sha = candidate["scopeSha256"]
        if scope_sha in self.consumed_scopes:
            raise BrokerAdmissionError("SYNTHETIC_ALREADY_CONSUMED")
        self.consumed_scopes.add(scope_sha)
        scope = candidate["scope"]
        receipt = {
            "scopeSha256": scope_sha,
            "verifiedPacketSha256": candidate["verifiedPacketSha256"],
            "role": candidate["candidateRole"],
            "commandId": scope["command_id"],
            "attemptId": scope["attempt_id"],
            "receiptId": scope["receipt_id"],
            "fenceId": scope["fence_id"],
            "consumedExactlyOnce": True,
            "readChallenge": read_challenge,
            "releaseDecision": "NO_GO",
        }
        if self.consumption_override is not None:
            receipt.update(self.consumption_override)
        return receipt

    def open_canonical_guard_connection(self, candidate):
        self.events.append("guard_open")
        self.guard_open_calls.append(candidate)
        return self.guard_connection

    def open_one_scoped_connection(self, candidate):
        if (not self.guard_connection.active
                or not self.guard_connection.guard_checked):
            raise AssertionError("CANONICAL_APPROVAL_ROW_LOCK_MUST_BE_HELD")
        self.events.append("open")
        self.open_calls.append(candidate)
        if self.open_failure is not None:
            raise self.open_failure
        return self.connection

    def open_minimal_auditor_connection(self, candidate):
        self.auditor_open_calls.append(candidate)
        if len(self.auditor_open_calls) == 1:
            return self.claim_auditor_connection
        return self.auditor_connection

    def relock_and_verify(self, candidate):
        self.events.append("relock")
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
        read_challenge = kwargs.pop("challenge", "a" * 64)
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
                                      return_value=user_time / 1000), \
                         patch.object(broker.secrets, "token_hex",
                                      return_value=read_challenge):
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
        self.assertEqual(len(self.supervisor.consumption_calls), 1)
        self.assertEqual(len(self.supervisor.open_calls), 1)
        self.assertEqual(len(self.supervisor.relock_calls), 1)
        self.assertEqual(self.supervisor.events, [
            "consume", "audit_consumption",
            "guard_open", "guard_current", "open",
            "guard_rollback", "guard_close", "relock", "audit_relock",
        ])
        self.assertEqual(len(self.supervisor.guard_open_calls), 1)
        self.assertTrue(self.supervisor.guard_connection.closed)
        self.assertEqual(self.supervisor.guard_connection.rollback_calls, 1)
        self.assertEqual(
            self.supervisor.guard_connection.last_cursor.calls,
            [
                ("SET TRANSACTION READ WRITE", None),
                ("SET LOCAL statement_timeout = '1500ms'", None),
                ("SET LOCAL lock_timeout = '1500ms'", None),
                (broker.CANONICAL_CURRENT_GUARD_SQL, {
                    "role": self.candidate["candidateRole"],
                    "scope_sha": self.candidate["scopeSha256"],
                    "packet_sha": self.candidate["verifiedPacketSha256"],
                    "command_id": self.candidate["scope"]["command_id"],
                    "attempt_id": self.candidate["scope"]["attempt_id"],
                    "receipt_id": self.candidate["scope"]["receipt_id"],
                    "fence_id": self.candidate["scope"]["fence_id"],
                    "read_challenge": "a" * 64,
                }),
            ],
        )
        self.assertTrue(self.supervisor.connection.closed)
        self.assertTrue(value["oneCanonicalReadReviewed"])
        self.assertTrue(value["preReadConsumptionClaimReviewed"])
        self.assertTrue(value["preReadConsumptionVerifiedByPostgres"])
        self.assertEqual(self.supervisor.read_challenges, ["a" * 64])
        self.assertTrue(value["postReadRelockReported"])
        self.assertTrue(value["postReadRelockVerifiedByNativePostgres"])
        self.assertEqual(len(self.supervisor.auditor_open_calls), 2)
        self.assertTrue(self.supervisor.claim_auditor_connection.closed)
        self.assertEqual(self.supervisor.claim_auditor_connection.rollback_calls, 1)
        self.assertEqual(
            self.supervisor.claim_auditor_connection.last_cursor.calls,
            [
                ("SET TRANSACTION READ ONLY", None),
                ("SET LOCAL statement_timeout = '1500ms'", None),
                (native.CONSUMPTION_READBACK_SQL, {
                    "role": self.candidate["candidateRole"],
                    "scope_sha": self.candidate["scopeSha256"],
                    "packet_sha": self.candidate["verifiedPacketSha256"],
                    "command_id": self.candidate["scope"]["command_id"],
                    "attempt_id": self.candidate["scope"]["attempt_id"],
                    "receipt_id": self.candidate["scope"]["receipt_id"],
                    "fence_id": self.candidate["scope"]["fence_id"],
                    "read_challenge": "a" * 64,
                }),
            ],
        )
        self.assertTrue(self.supervisor.auditor_connection.closed)
        self.assertEqual(self.supervisor.auditor_connection.rollback_calls, 1)
        self.assertEqual(
            self.supervisor.auditor_connection.last_cursor.calls,
            [
                ("SET TRANSACTION READ ONLY", None),
                ("SET LOCAL statement_timeout = '1500ms'", None),
                (native.BOOLEAN_READBACK_SQL, {"role": self.candidate["candidateRole"]}),
            ],
        )
        self.assertEqual(value["releaseDecision"], "NO_GO")
        for key in ("credentialIssuancePermitted", "databaseRoleProvisioned",
                    "databaseWritePerformed", "signingPermitted",
                    "authorizationGranted", "dispatchPermitted"):
            self.assertIs(value[key], False)

    def test_missing_canonical_guard_dependency_is_fail_closed(self):
        self.supervisor.open_canonical_guard_connection = None
        with self.assertRaisesRegex(
            BrokerAdmissionError,
            "ONE_SHOT_CURRENT_APPROVAL_GUARD_SUPERVISOR_MISSING",
        ):
            self.call()
        self.last_read.assert_not_called()
        self.assertEqual(len(self.supervisor.consumption_calls), 0)

    def test_revoked_or_stale_canonical_approval_never_opens_reader(self):
        for rows in ([(False,)], [(None,)], [(0,)], [("true",)],
                     [], [(True,), (True,)], [()]):
            with self.subTest(rows=rows):
                self.setUp()
                self.supervisor.guard_connection.rows_override = rows
                with self.assertRaisesRegex(
                    BrokerAdmissionError,
                    "ONE_SHOT_CANONICAL_APPROVAL_REVOKED_OR_STALE",
                ):
                    self.call()
                self.last_read.assert_not_called()
                self.assertEqual(len(self.supervisor.open_calls), 0)
                self.assertEqual(len(self.supervisor.relock_calls), 1)
                self.assertTrue(self.supervisor.guard_connection.closed)

    def test_canonical_guard_wrong_native_role_or_tls_denies(self):
        for field, value in (
            ("user", "dev_gpt02_relock_catalog_auditor"),
            ("dbname", "another"),
            ("host", "localhost"),
            ("port", 6543),
            ("autocommit", True),
        ):
            with self.subTest(field=field):
                self.setUp()
                target = (self.supervisor.guard_connection if field=="autocommit"
                          else self.supervisor.guard_connection.info)
                setattr(target, field, value)
                with self.assertRaisesRegex(
                    BrokerAdmissionError,
                    "ONE_SHOT_CANONICAL_GUARD_NATIVE_IDENTITY_INVALID",
                ):
                    self.call()
                self.last_read.assert_not_called()
                self.assertEqual(len(self.supervisor.relock_calls), 1)
        self.setUp()
        self.supervisor.guard_connection.info.get_parameters = lambda: {
            "sslmode": "require", "sslrootcert": "/synthetic/ca.pem",
        }
        with self.assertRaisesRegex(
            BrokerAdmissionError,
            "ONE_SHOT_CANONICAL_GUARD_TLS_VERIFY_FULL_REQUIRED",
        ):
            self.call()
        self.last_read.assert_not_called()
        self.assertEqual(len(self.supervisor.relock_calls), 1)

    def test_canonical_guard_sql_error_denies_and_relocks(self):
        self.supervisor.guard_connection.error = RuntimeError(
            "synthetic_native_current_guard_unavailable"
        )
        with self.assertRaisesRegex(
            RuntimeError, "synthetic_native_current_guard_unavailable",
        ):
            self.call()
        self.last_read.assert_not_called()
        self.assertEqual(len(self.supervisor.open_calls), 0)
        self.assertEqual(len(self.supervisor.relock_calls), 1)

    def test_native_reader_is_bound_to_live_guard_transaction(self):
        observed = []
        def assert_locked(*args):
            c = self.supervisor.guard_connection
            self.assertTrue(c.active)
            self.assertFalse(c.closed)
            self.assertTrue(c.guard_checked)
            self.assertEqual(c.rollback_calls, 0)
            observed.append(True)
            return [self.row]
        out = self.call(reader=Mock(side_effect=assert_locked))
        self.assertEqual(observed, [True])
        self.assertTrue(self.supervisor.guard_connection.closed)
        self.assertEqual(self.supervisor.guard_connection.rollback_calls, 1)
        self.assertEqual(out["releaseDecision"], "NO_GO")

    def test_claim_reported_success_but_db_has_no_row_prevents_reader(self):
        for rows in (
            [(False,)], [(None,)], [(0,)], [("true",)], [],
            [(True,), (True,)], [()],
        ):
            with self.subTest(rows=rows):
                self.setUp()
                self.supervisor.claim_auditor_connection.rows_override = rows
                with self.assertRaisesRegex(
                    BrokerAdmissionError,
                    "ONE_READ_DB_COMMITTED_CONSUMPTION_NOT_PROVEN",
                ):
                    self.call()
                self.last_read.assert_not_called()
                self.assertEqual(len(self.supervisor.consumption_calls), 1)
                self.assertEqual(len(self.supervisor.open_calls), 0)
                self.assertEqual(len(self.supervisor.relock_calls), 1)
                self.assertTrue(self.supervisor.claim_auditor_connection.closed)
                self.assertTrue(self.supervisor.auditor_connection.closed)

    def test_wrong_native_claim_auditor_identity_does_not_start_reader(self):
        self.supervisor.claim_auditor_connection.info.user = "service_role"
        with self.assertRaisesRegex(
            BrokerAdmissionError, "RELOCK_MINIMAL_AUDITOR_DB_IDENTITY_INVALID"
        ):
            self.call()
        self.last_read.assert_not_called()
        self.assertEqual(len(self.supervisor.open_calls), 0)
        self.assertEqual(len(self.supervisor.relock_calls), 1)

    def test_native_consumption_readback_db_error_always_relocks(self):
        self.supervisor.claim_auditor_connection.audit_error = RuntimeError(
            "synthetic_consumption_ledger_unavailable"
        )
        with self.assertRaisesRegex(
            RuntimeError, "synthetic_consumption_ledger_unavailable"
        ):
            self.call()
        self.last_read.assert_not_called()
        self.assertEqual(len(self.supervisor.open_calls), 0)
        self.assertEqual(len(self.supervisor.relock_calls), 1)
        self.assertEqual(
            self.supervisor.claim_auditor_connection.rollback_calls, 1
        )

    def test_wrong_database_user_blocks_before_any_query_and_relocks(self):
        self.supervisor.connection.info.user = "service_role"
        with self.assertRaisesRegex(BrokerAdmissionError,
                                    "ONE_SHOT_NATIVE_READER_IDENTITY"):
            self.call()
        self.last_read.assert_not_called()
        self.assertEqual(len(self.supervisor.relock_calls), 1)
        self.assertTrue(self.supervisor.connection.closed)

    def test_wrong_database_name_and_autocommit_deny(self):
        for field, value in (
            ("dbname", "other"), ("autocommit", True),
            ("host", "localhost"), ("port", 5433),
        ):
            with self.subTest(field=field):
                self.setUp()
                obj = (self.supervisor.connection
                       if field == "autocommit"
                       else self.supervisor.connection.info)
                setattr(obj, field, value)
                with self.assertRaises(BrokerAdmissionError):
                    self.call()
                self.last_read.assert_not_called()
                self.assertEqual(len(self.supervisor.relock_calls), 1)

    def test_weak_or_unverified_tls_denied_before_query_and_relocked(self):
        for params in (
            {"sslmode": "require", "sslrootcert": "/synthetic/ca.pem"},
            {"sslmode": "verify-full", "sslrootcert": ""},
            {"sslmode": "verify-full"},
        ):
            with self.subTest(params=params):
                self.setUp()
                self.supervisor.connection.info.get_parameters = (
                    lambda p=params: p
                )
                with self.assertRaisesRegex(BrokerAdmissionError,
                                            "ONE_SHOT_TLS_VERIFY_FULL_REQUIRED"):
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
        self.setUp()  # fresh disposable approval-scope fixture after first use
        self.supervisor.scope_sha = "f" * 64
        with self.assertRaisesRegex(BrokerAdmissionError,
                                    "ONE_SHOT_POSTREAD_RELOCK_NOT_PROVEN"):
            self.call()

    def test_boolean_audit_denies_false_missing_or_malformed_native_result(self):
        for rows in (
            [(False,)], [(None,)], [(0,)], [],
            [(True,), (True,)], [("true",)], [(True, False)], [()],
        ):
            with self.subTest(rows=rows):
                self.setUp()
                self.supervisor.auditor_connection.rows_override = rows
                with self.assertRaisesRegex(
                    BrokerAdmissionError, "RELOCK_MINIMAL_CATALOG_BOOL_NOT_PROVEN"
                ):
                    self.call()
                self.assertEqual(len(self.supervisor.relock_calls), 1)
                self.assertTrue(self.supervisor.auditor_connection.closed)

    def test_minimal_auditor_identity_and_tls_cannot_be_substituted(self):
        cases = ("user", "host", "port", "tls")
        for key in cases:
            with self.subTest(key=key):
                self.setUp()
                conn = self.supervisor.auditor_connection
                if key == "user":
                    conn.info.user = "service_role"
                elif key == "host":
                    conn.info.host = "localhost"
                elif key == "port":
                    conn.info.port = 5433
                else:
                    conn.info.get_parameters = lambda: {
                        "sslmode": "require", "sslrootcert": "/synthetic/root.pem"
                    }
                with self.assertRaises(BrokerAdmissionError):
                    self.call()
                self.assertEqual(len(self.supervisor.relock_calls), 1)
                self.assertTrue(conn.closed)

    def test_native_catalog_error_fails_closed_even_after_reported_relock(self):
        self.supervisor.auditor_connection.audit_error = RuntimeError(
            "synthetic_minimal_audit_function_unavailable"
        )
        with self.assertRaisesRegex(RuntimeError, "synthetic_minimal_audit"):
            self.call()
        self.assertEqual(len(self.supervisor.relock_calls), 1)
        self.assertTrue(self.supervisor.auditor_connection.closed)
        self.assertEqual(self.supervisor.auditor_connection.rollback_calls, 1)

    def test_duplicate_packet_replay_is_denied_before_second_query(self):
        self.call()
        self.assertEqual(len(self.supervisor.consumption_calls), 1)
        self.assertEqual(len(self.supervisor.open_calls), 1)
        self.assertEqual(len(self.supervisor.relock_calls), 1)
        with self.assertRaisesRegex(BrokerAdmissionError, "SYNTHETIC_ALREADY_CONSUMED"):
            self.call()
        self.last_read.assert_not_called()
        self.assertEqual(len(self.supervisor.consumption_calls), 2)
        self.assertEqual(len(self.supervisor.open_calls), 1)
        self.assertEqual(len(self.supervisor.relock_calls), 2)

    def test_new_invocation_never_reuses_previous_read_challenge(self):
        self.call(challenge="a" * 64)
        with self.assertRaisesRegex(
            BrokerAdmissionError, "SYNTHETIC_ALREADY_CONSUMED"
        ):
            self.call(challenge="b" * 64)
        self.last_read.assert_not_called()
        self.assertEqual(self.supervisor.read_challenges, [
            "a" * 64, "b" * 64,
        ])
        self.assertEqual(len(self.supervisor.open_calls), 1)
        self.assertEqual(len(self.supervisor.relock_calls), 2)

    def test_malformed_fresh_challenge_fails_before_any_read(self):
        self.supervisor.read_challenges.clear()
        with self.assertRaisesRegex(
            BrokerAdmissionError, "ONE_READ_CHALLENGE_FORMAT_INVALID"
        ):
            self.call(challenge="invalid")
        self.last_read.assert_not_called()
        self.assertEqual(len(self.supervisor.open_calls), 0)
        self.assertEqual(len(self.supervisor.relock_calls), 1)

    def test_query_failure_after_consumption_cannot_replay(self):
        with self.assertRaisesRegex(RuntimeError, "synthetic_reader_timeout"):
            self.call(reader=Mock(side_effect=RuntimeError("synthetic_reader_timeout")))
        self.assertEqual(len(self.supervisor.consumption_calls), 1)
        self.assertEqual(len(self.supervisor.relock_calls), 1)
        with self.assertRaisesRegex(BrokerAdmissionError, "SYNTHETIC_ALREADY_CONSUMED"):
            self.call()
        self.last_read.assert_not_called()
        self.assertEqual(len(self.supervisor.open_calls), 1)
        self.assertEqual(len(self.supervisor.relock_calls), 2)

    def test_atomic_claim_error_always_relocks_but_never_queries(self):
        self.supervisor.consumption_error = RuntimeError("synthetic_claim_commit_unknown")
        with self.assertRaisesRegex(RuntimeError, "synthetic_claim_commit_unknown"):
            self.call()
        self.last_read.assert_not_called()
        self.assertEqual(len(self.supervisor.open_calls), 0)
        self.assertEqual(len(self.supervisor.relock_calls), 1)
        self.assertEqual(self.supervisor.events, ["consume", "relock", "audit_relock"])

    def test_forged_consumption_fields_are_denied_before_open(self):
        for key, changed in (
            ("scopeSha256", "f" * 64),
            ("verifiedPacketSha256", "f" * 64),
            ("role", "postgres"),
            ("commandId", "11111111-1111-4111-8111-111111111111"),
            ("attemptId", "22222222-2222-4222-8222-222222222222"),
            ("receiptId", "33333333-3333-4333-8333-333333333333"),
            ("fenceId", "44444444-4444-4444-8444-444444444444"),
            ("consumedExactlyOnce", False),
            ("readChallenge", "f" * 64),
            ("releaseDecision", "GO"),
        ):
            with self.subTest(key=key):
                self.setUp()
                self.supervisor.consumption_override = {key: changed}
                with self.assertRaisesRegex(
                    BrokerAdmissionError, "ONE_SHOT_CONSUMPTION_BINDING_NOT_PROVEN"
                ):
                    self.call()
                self.last_read.assert_not_called()
                self.assertEqual(len(self.supervisor.open_calls), 0)
                self.assertEqual(len(self.supervisor.relock_calls), 1)

    def test_consumption_dependency_is_required_before_open(self):
        self.supervisor.consume_scope_once = None
        with self.assertRaisesRegex(
            BrokerAdmissionError, "ONE_SHOT_DURABLE_CONSUMPTION_SUPERVISOR_MISSING"
        ):
            self.call()
        self.assertEqual(len(self.supervisor.open_calls), 0)
        self.assertEqual(len(self.supervisor.relock_calls), 0)

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
        self.assertIn("attest_boolean_relock", source)
        self.assertIn("attest_persisted_read_consumption", source)
        self.assertIn("open_minimal_auditor_connection", source)
        self.assertNotIn("attest_native_relock(", source)
        self.assertNotIn("open_trusted_admin_connection", source)
        for forbidden in ("psycopg.connect(", "ALTER ROLE ", "CREATE ROLE ",
                          "dispatchOnce(", "gateway.send(", "private_key(",):
            self.assertNotIn(forbidden, source)


class _ClaimCursor:
    def __init__(self, conn):
        self.conn = conn
        self.description = [SimpleNamespace(name="claimed_once")]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=None):
        self.conn.calls.append((sql, params))
        if self.conn.query_error is not None:
            raise self.conn.query_error

    def fetchmany(self, n):
        if n != 2:
            raise AssertionError("CLAIM_MUST_USE_BOUNDED_CARDINALITY")
        return self.conn.rows


class _ClaimConnection:
    def __init__(self):
        self.info = SimpleNamespace(
            user=broker.READER_CONSUMER_USER,
            dbname="postgres", host=broker.POOLER_HOST, port=5432,
            get_parameters=lambda: {
                "sslmode": "verify-full", "sslrootcert": "/synthetic/ca.pem",
            },
        )
        self.autocommit = False
        self.rows = [(True,)]
        self.calls = []
        self.commits = 0
        self.rollbacks = 0
        self.query_error = None
        self.commit_error = None

    def cursor(self):
        return _ClaimCursor(self)

    def commit(self):
        self.commits += 1
        if self.commit_error is not None:
            raise self.commit_error

    def rollback(self):
        self.rollbacks += 1


class NativeClaimConsumerAdapterTest(unittest.TestCase):
    """No real DB or credentials: native writer adapter source contract."""

    def setUp(self):
        fixture = PostlineageReaderScopeOfflineTest()
        fixture.setUp()
        self.candidate = fixture.check()
        self.now = fixture.fixture.now
        self.db = _ClaimConnection()
        self.challenge = "a" * 64

    def consume(self, *, challenge=None):
        with patch.object(broker.time, "time", return_value=self.now/1000):
            return broker.consume_once_via_pinned_connection(
                self.db, self.candidate,
                self.challenge if challenge is None else challenge,
            )

    def test_only_one_bounded_rpc_commits_before_returning_claim(self):
        result = self.consume()
        scope = self.candidate["scope"]
        self.assertEqual(self.db.commits, 1)
        self.assertEqual(self.db.rollbacks, 0)
        self.assertEqual(self.db.calls, [
            ("SET TRANSACTION READ WRITE", None),
            ("SET LOCAL statement_timeout = '1500ms'", None),
            (broker.CONSUME_ONCE_SQL, {
                "role": self.candidate["candidateRole"],
                "scope_sha": self.candidate["scopeSha256"],
                "packet_sha": self.candidate["verifiedPacketSha256"],
                "command_id": scope["command_id"],
                "attempt_id": scope["attempt_id"],
                "receipt_id": scope["receipt_id"],
                "fence_id": scope["fence_id"],
                "read_challenge": self.challenge,
            }),
        ])
        self.assertTrue(broker._review_consumption_binding(
            result, self.candidate, self.challenge,
        ))
        self.assertEqual(result["releaseDecision"], "NO_GO")

    def test_false_null_duplicates_and_malformed_db_result_never_commit(self):
        for rows in (
            [(False,)], [(None,)], [], [(True,), (True,)],
            [("t",)], [(1,)], [()], [(True, False)],
        ):
            with self.subTest(rows=rows):
                self.setUp()
                self.db.rows = rows
                with self.assertRaisesRegex(
                    BrokerAdmissionError,
                    "ONE_READ_CONSUMER_DB_NOT_ATOMICALLY_CLAIMED",
                ):
                    self.consume()
                self.assertEqual(self.db.commits, 0)
                self.assertEqual(self.db.rollbacks, 1)

    def test_unknown_commit_fails_closed_without_returning_approval(self):
        self.db.commit_error = RuntimeError("synthetic_commit_unknown")
        with self.assertRaisesRegex(RuntimeError, "synthetic_commit_unknown"):
            self.consume()
        self.assertEqual(self.db.commits, 1)
        self.assertEqual(self.db.rollbacks, 1)

    def test_query_failure_rolls_back(self):
        self.db.query_error = RuntimeError("synthetic_database_query_failed")
        with self.assertRaisesRegex(RuntimeError, "synthetic_database_query_failed"):
            self.consume()
        self.assertEqual(self.db.commits, 0)
        self.assertEqual(self.db.rollbacks, 1)

    def test_incorrect_identity_host_port_db_or_autocommit_denied(self):
        for field, value in (
            ("user", "postgres." + broker.PROJECT),
            ("user", "service_role"),
            ("host", "localhost"), ("port", 5433), ("dbname", "other"),
            ("autocommit", True),
        ):
            with self.subTest(field=field, value=value):
                self.setUp()
                target = self.db if field == "autocommit" else self.db.info
                setattr(target, field, value)
                with self.assertRaisesRegex(
                    BrokerAdmissionError, "ONE_READ_CONSUMER_NATIVE_DB_IDENTITY_INVALID"
                ):
                    self.consume()
                self.assertEqual(self.db.calls, [])
                self.assertEqual(self.db.commits, 0)

    def test_tls_downgrade_and_missing_ca_denied(self):
        for parameters in (
            {"sslmode": "require", "sslrootcert": "/synthetic/ca.pem"},
            {"sslmode": "verify-full", "sslrootcert": ""},
            {"sslmode": "verify-full"},
        ):
            with self.subTest(parameters=parameters):
                self.setUp()
                self.db.info.get_parameters = lambda p=parameters: p
                with self.assertRaisesRegex(
                    BrokerAdmissionError, "ONE_READ_CONSUMER_TLS_VERIFY_FULL_REQUIRED"
                ):
                    self.consume()
                self.assertEqual(self.db.calls, [])

    def test_invalid_challenge_and_expired_candidate_denied(self):
        with self.assertRaisesRegex(
            BrokerAdmissionError, "ONE_READ_CHALLENGE_FORMAT_INVALID"
        ):
            self.consume(challenge="caller-supplied-invalid")
        self.assertEqual(self.db.commits, 0)
        with patch.object(broker.time, "time",
                          return_value=(self.candidate["expiresAt"]-2000)/1000):
            with self.assertRaisesRegex(
                BrokerAdmissionError, "ONE_SHOT_SIGNED_LEASE_INSUFFICIENT"
            ):
                broker.consume_once_via_pinned_connection(
                    self.db, self.candidate, self.challenge,
                )
        self.assertEqual(self.db.calls, [])


if __name__ == "__main__":
    unittest.main()
