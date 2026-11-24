#!/usr/bin/env python3
"""Synthetic DB session and ledger QA; never connects to live Supabase."""
import importlib.util
import sys
import unittest
from pathlib import Path

root=Path(__file__).parent
for name in ("gpt02_relock_once_candidate","gpt02_owner_ledger_reader_candidate",
             "gpt02_relock_pg_reader_adapter_candidate",
             "test_gpt02_owner_ledger_reader_candidate"):
    if name not in sys.modules:
        spec=importlib.util.spec_from_file_location(name,root/(name+".py"))
        obj=importlib.util.module_from_spec(spec)
        sys.modules[name]=obj
        spec.loader.exec_module(obj)
m=sys.modules["gpt02_relock_pg_reader_adapter_candidate"]
o=sys.modules["gpt02_relock_once_candidate"]
l=sys.modules["gpt02_owner_ledger_reader_candidate"]
fixture=sys.modules["test_gpt02_owner_ledger_reader_candidate"]


def identity():
    return [{"session_user":m.EXPECTED_ROLE,"current_user":m.EXPECTED_ROLE,
             "database_name":m.DB_NAME,"tx_read_only":"on","default_read_only":"on"}]


class Fake:
    def __init__(self, claims=None, rows=None):
        self.claims=identity() if claims is None else claims
        self.rows=[fixture.make_row()] if rows is None else rows
        self.calls=[]
    def fetch_mappings(self,sql,args):
        self.calls.append((sql,args))
        return self.claims if sql==m._SESSION_SQL else self.rows


class Tests(unittest.TestCase):
    def test_verified_read_only_ledger_works(self):
        f=Fake()
        decision=l.verify_owner_ledger_record(m.Gpt02OwnerLedgerPgReaderCandidate(f),fixture.ID)
        self.assertEqual(decision.decision,"APPROVED")
        self.assertEqual(len(f.calls),2)
        self.assertEqual(f.calls[1][1],(fixture.ID,))

    def test_transaction_read_write_denied(self):
        for field in ("tx_read_only","default_read_only"):
            claim=identity()
            claim[0][field]="off"
            f=Fake(claims=claim)
            with self.subTest(field=field),self.assertRaisesRegex(o.GateDenied,"OWNER_LEDGER_READ_UNAVAILABLE"):
                l.verify_owner_ledger_record(m.Gpt02OwnerLedgerPgReaderCandidate(f),fixture.ID)
            self.assertEqual(len(f.calls),1)

    def test_role_and_database_mismatch_denied(self):
        for field,val in (("session_user","postgres"),("current_user","postgres"),
                          ("database_name","production")):
            claim=identity();claim[0][field]=val;f=Fake(claims=claim)
            with self.subTest(field=field),self.assertRaises(o.GateDenied):
                l.verify_owner_ledger_record(m.Gpt02OwnerLedgerPgReaderCandidate(f),fixture.ID)
            self.assertEqual(len(f.calls),1)

    def test_cannot_substitute_sql(self):
        f=Fake()
        with self.assertRaisesRegex(o.GateDenied,"UNEXPECTED_LEDGER_SQL"):
            m.Gpt02OwnerLedgerPgReaderCandidate(f).read_exact_owner_decision(
                l._OWNER_READ_SQL+" SELECT 1", (fixture.ID,))
        self.assertEqual(len(f.calls),0)

    def test_error_denies_without_fallback(self):
        class Bad:
            def fetch_mappings(self,sql,args):
                raise OSError("synthetic connection failure")
        with self.assertRaises(o.GateDenied):
            l.verify_owner_ledger_record(m.Gpt02OwnerLedgerPgReaderCandidate(Bad()),fixture.ID)

    def test_result_limit(self):
        f=Fake(rows=[fixture.make_row()]*3)
        with self.assertRaisesRegex(o.GateDenied,"LEDGER_READ_UNAVAILABLE"):
            l.verify_owner_ledger_record(m.Gpt02OwnerLedgerPgReaderCandidate(f),fixture.ID)

    def test_no_connection_fails(self):
        with self.assertRaises(o.GateDenied):
            m.Gpt02OwnerLedgerPgReaderCandidate(object())

if __name__=="__main__":
    unittest.main()
