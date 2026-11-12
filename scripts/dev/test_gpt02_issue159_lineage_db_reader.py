"""No real DB or credentials: execute adapter against a fake read-only cursor."""
from datetime import datetime, timezone, timedelta
import unittest

from gpt02_issue159_lineage_db_reader import (
    _clean_lookup, normalize_row, read_lineage_once,
)
from gpt02_issue159_lineage_readback_contract import ROW_FIELDS
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError


class _Column:
    def __init__(self, name):
        self.name = name


class _Cursor:
    def __init__(self, connection):
        self.connection = connection
        self.description = [_Column(x) for x in ROW_FIELDS]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=None):
        self.connection.calls.append((sql, params))
        if sql.startswith("SELECT") and not self.connection.read_only:
            raise AssertionError("SQL issued before read-only gate")
        if sql.startswith("SET TRANSACTION READ ONLY"):
            self.connection.read_only = True

    def fetchmany(self, size):
        assert size == 3
        return self.connection.rows


class _Connection:
    def __init__(self, rows=(), autocommit=False):
        self.autocommit = autocommit
        self.rows = rows
        self.calls = []
        self.read_only = False
        self.rollbacks = 0

    def cursor(self):
        return _Cursor(self)

    def rollback(self):
        self.rollbacks += 1


class LineageDbReaderTest(unittest.TestCase):
    def setUp(self):
        self.lookup = {
            "company_id": "default", "task_id": 140,
            "command_id": "10000000-0000-4000-8000-000000000001",
            "attempt_id": "20000000-0000-4000-8000-000000000002",
            "approval_digest": "a" * 64,
        }

    def test_query_is_parameterized_and_read_only(self):
        conn = _Connection()
        self.assertEqual(read_lineage_once(conn, self.lookup), [])
        self.assertEqual(conn.rollbacks, 1)
        self.assertEqual(len(conn.calls), 3)
        self.assertEqual(conn.calls[0][0], "SET TRANSACTION READ ONLY")
        self.assertIn("statement_timeout", conn.calls[1][0])
        self.assertIn("%(command_id)s", conn.calls[2][0])
        self.assertEqual(conn.calls[2][1], self.lookup)
        self.assertNotIn(self.lookup["command_id"], conn.calls[2][0])

    def test_caller_cannot_supply_receipt_or_fence_ids(self):
        for key in ("receipt_id", "fence_id", "approved", "dispatch_allowed"):
            with self.subTest(key=key), self.assertRaises(BrokerAdmissionError):
                read_lineage_once(_Connection(), {**self.lookup, key: True})

    def test_invalid_task_digest_or_command_is_rejected(self):
        for key, value in (("task_id", 139), ("task_id", True),
                           ("company_id", "PROD"),
                           ("approval_digest", "z"*64),
                           ("command_id", "not-a-uuid")):
            with self.subTest(key=key), self.assertRaises(BrokerAdmissionError):
                read_lineage_once(_Connection(), {**self.lookup, key: value})

    def test_reject_autocommit(self):
        with self.assertRaises(BrokerAdmissionError):
            read_lineage_once(_Connection(autocommit=True), self.lookup)

    def test_duplicate_rows_rejected(self):
        conn = _Connection(rows=[tuple(None for _ in ROW_FIELDS)]*2)
        with self.assertRaises(BrokerAdmissionError):
            read_lineage_once(conn, self.lookup)
        self.assertEqual(conn.rollbacks, 1)

    def test_missing_or_naive_timestamps_rejected(self):
        row = {name: None for name in ROW_FIELDS}
        with self.assertRaises(BrokerAdmissionError):
            normalize_row(row)
        row["lease_started_at"] = datetime(2026, 11, 13)
        with self.assertRaises(BrokerAdmissionError):
            normalize_row(row)

    def test_timestamptz_normalized_in_utc(self):
        row = {name: False for name in ROW_FIELDS}
        stamp = datetime(2026, 11, 13, 0, 0, 1, 123000, tzinfo=timezone(timedelta(hours=7)))
        for field in ("approval_expires_at", "link_expires_at",
                      "receipt_consumed_at", "lease_started_at", "lease_expires_at"):
            row[field] = stamp
        normalized = normalize_row(row)
        expected = int(stamp.timestamp()*1000)
        self.assertEqual(normalized["lease_started_at"], expected)
        self.assertEqual(normalized["approval_expires_at"], expected)

    def test_no_writer_or_authz_surface(self):
        from pathlib import Path
        src = (Path(__file__).parents[2] /
               "deploy/ai-coding-standalone-dev/gpt02_issue159_lineage_db_reader.py").read_text()
        for forbidden in ("INSERT INTO", "UPDATE ", "DELETE FROM",
                          "Ed25519PrivateKey", "dispatch(", "service_role"):
            # A reference in documentation to service_role is permitted.
            if forbidden != "service_role":
                self.assertNotIn(forbidden, src)


if __name__ == "__main__":
    unittest.main()
