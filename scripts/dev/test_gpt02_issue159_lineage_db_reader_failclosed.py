"""Issue159 lineage reader fail-closed tests, synthetic and offline.

Run from repo root:
  PYTHONPATH=deploy/ai-coding-standalone-dev python3 -m unittest \
    scripts/dev/test_gpt02_issue159_lineage_db_reader_failclosed.py -v

No actual DB connection, credentials, socket, signer, or dispatch.
"""
from __future__ import annotations

import unittest

from gpt02_issue159_lineage_db_reader import _clean_lookup, read_lineage_once
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError


def valid():
    return {
        "company_id": "default",
        "task_id": 170,
        "command_id": "11111111-1111-4111-8111-111111111111",
        "attempt_id": "22222222-2222-4222-8222-222222222222",
        "approval_digest": "a" * 64,
    }


class Cursor:
    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail
        self.description = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        if self.fail and "FROM gpt02_private.approvals" in sql:
            raise RuntimeError("synthetic_private_error")

    def fetchmany(self, count):
        if count != 3:
            raise AssertionError("CARDINALITY_BOUND_CHANGED")
        return []


class DB:
    autocommit = False

    def __init__(self, fail=False):
        self.c = Cursor(fail)
        self.rollbacks = 0

    def cursor(self):
        return self.c

    def rollback(self):
        self.rollbacks += 1


class LineageReaderOffline(unittest.TestCase):
    def test_clean_lookup_exact(self):
        self.assertEqual(_clean_lookup(valid()), valid())

    def test_reject_forged_scope_without_database(self):
        patches = [
            {"task_id": 139},
            {"company_id": "other"},
            {"command_id": valid()["attempt_id"]},
            {"approval_digest": "bad"},
            {"receipt_id": "forged"},
        ]
        for patch in patches:
            with self.subTest(patch=patch):
                request = valid()
                request.update(patch)
                with self.assertRaises(BrokerAdmissionError):
                    _clean_lookup(request)

    def test_exact_bound_readonly_query_fail_closed_on_missing_lineage(self):
        db = DB()
        with self.assertRaisesRegex(BrokerAdmissionError, "CARDINALITY"):
            read_lineage_once(db, valid())
        self.assertEqual(db.rollbacks, 1)
        self.assertEqual(db.c.calls[0][0], "SET TRANSACTION READ ONLY")
        self.assertTrue(any(
            "FROM gpt02_private.approvals" in sql and params == valid()
            for sql, params in db.c.calls
        ))

    def test_rollback_on_database_error(self):
        db = DB(fail=True)
        with self.assertRaisesRegex(RuntimeError, "synthetic_private_error"):
            read_lineage_once(db, valid())
        self.assertEqual(db.rollbacks, 1)


if __name__ == "__main__":
    unittest.main()
