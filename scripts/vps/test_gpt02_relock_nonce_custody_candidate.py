#!/usr/bin/env python3
"""Temporary-file SQLite concurrency/replay tests, never CST-DEV ledger."""
import importlib.util
import sqlite3
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

root=Path(__file__).parent
for name in ("gpt02_relock_once_candidate", "gpt02_relock_nonce_custody_candidate"):
    spec=importlib.util.spec_from_file_location(name, root/(name+".py"))
    mod=importlib.util.module_from_spec(spec)
    sys.modules[name]=mod
    spec.loader.exec_module(mod)
o=sys.modules["gpt02_relock_once_candidate"]
c=sys.modules["gpt02_relock_nonce_custody_candidate"]


class NonceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=str(Path(self.tmp.name)/"isolated-qa-only.sqlite3")
        self.a=sqlite3.connect(self.path, timeout=1, isolation_level=None)
        self.a.execute("""CREATE TABLE gpt02_oneuse_claims (
            nonce TEXT PRIMARY KEY, challenge_id TEXT NOT NULL,
            manifest_digest TEXT NOT NULL, status TEXT NOT NULL)""")
        self.b=sqlite3.connect(self.path, timeout=1, isolation_level=None)
        self.grant=o.VerifiedExecutorGrant(str(uuid.uuid4()),"a"*64,str(uuid.uuid4()),
            o.SCOPE,o.PROJECT,o.HOST,o.PRINCIPAL,o.OPERATIONS,True)

    def tearDown(self):
        self.a.close()
        self.b.close()
        self.tmp.cleanup()

    def test_one_use_across_two_distinct_connections(self):
        x=c.SQLiteNonceCustodyCandidate(self.a)
        y=c.SQLiteNonceCustodyCandidate(self.b)
        self.assertEqual(x.claim_executor_nonce_once(self.grant),self.grant.executor_nonce)
        with self.assertRaisesRegex(o.GateDenied,"EXECUTOR_NONCE_REPLAY"):
            y.claim_executor_nonce_once(self.grant)
        row=self.b.execute("SELECT status FROM gpt02_oneuse_claims").fetchone()
        self.assertEqual(row,("CLAIMED",))

    def test_claim_remains_durable_after_reconnect(self):
        c.SQLiteNonceCustodyCandidate(self.a).claim_executor_nonce_once(self.grant)
        self.a.close()
        self.a=sqlite3.connect(self.path,timeout=1,isolation_level=None)
        with self.assertRaisesRegex(o.GateDenied,"EXECUTOR_NONCE_REPLAY"):
            c.SQLiteNonceCustodyCandidate(self.a).claim_executor_nonce_once(self.grant)

    def test_failed_reconciliation_is_terminal(self):
        x=c.SQLiteNonceCustodyCandidate(self.a)
        claim=x.claim_executor_nonce_once(self.grant)
        x.record_terminal_receipt(claim,"FAILED_RECONCILIATION_REQUIRED")
        with self.assertRaises(o.GateDenied):
            x.record_terminal_receipt(claim,"RELOCK_READBACK_PASS")
        self.assertEqual(self.a.execute(
            "SELECT status FROM gpt02_oneuse_claims").fetchone()[0],
            "FAILED_RECONCILIATION_REQUIRED")

    def test_success_receipt_append_once(self):
        x=c.SQLiteNonceCustodyCandidate(self.a)
        claim=x.claim_executor_nonce_once(self.grant)
        x.record_terminal_receipt(claim,"RELOCK_READBACK_PASS")
        with self.assertRaises(o.GateDenied):
            x.record_terminal_receipt(claim,"RELOCK_READBACK_PASS")
        with self.assertRaises(o.GateDenied):
            x.claim_executor_nonce_once(self.grant)

    def test_bad_grant_or_receipt_denied(self):
        x=c.SQLiteNonceCustodyCandidate(self.a)
        with self.assertRaises(o.GateDenied):
            x.claim_executor_nonce_once("fake")
        with self.assertRaises(o.GateDenied):
            x.record_terminal_receipt(str(uuid.uuid4()),"UNLOCK")

    def test_unavailable_schema_fails_closed(self):
        self.a.execute("DROP TABLE gpt02_oneuse_claims")
        with self.assertRaises(o.GateDenied):
            c.SQLiteNonceCustodyCandidate(self.a).claim_executor_nonce_once(self.grant)

    def test_external_transaction_denied(self):
        self.a.execute("BEGIN")
        with self.assertRaises(o.GateDenied):
            c.SQLiteNonceCustodyCandidate(self.a)
        self.a.execute("ROLLBACK")


if __name__=="__main__":
    unittest.main()
