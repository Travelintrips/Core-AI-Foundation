#!/usr/bin/env python3
"""CST-DEV Gate A fixed-query lease reader: pure contract/no database access."""
import sys
from pathlib import Path
import unittest
from datetime import timezone

sys.path.insert(0,str(Path(__file__).resolve().parent))
import cst_onejob_gatea_lease_reader as r

class Tests(unittest.TestCase):
    def setUp(self):
        self.issued="2026-11-22T12:00:00.000Z"
        self.expires="2026-11-22T12:05:00.000Z"
        self.heartbeat="2026-11-22T12:00:10.000Z"
        self.row=[r.PROJECT,"a"*32,"b"*40,self.issued,self.expires,
                  self.heartbeat,"ACTIVE"]
        self.statements=[]

    def query(self,statement):
        self.statements.append(statement)
        if statement==r.LEASE_SQL:return [self.row]
        if statement==r.CLOCK_SQL:return [["2026-11-22T12:00:15.000Z"]]
        raise AssertionError("UNEXPECTED_SQL")

    def test_exact_fixed_project_sql_and_no_writes(self):
        actual=r.read_project_lease(self.query)
        self.assertEqual(actual["project"],r.PROJECT)
        self.assertEqual(actual["nonce"],"a"*32)
        self.assertEqual(actual["sourceSha"],"b"*40)
        self.assertEqual(actual["issuedAt"].tzinfo,timezone.utc)
        self.assertEqual(actual["heartbeatAt"].tzinfo,timezone.utc)
        self.assertEqual(self.statements,[r.LEASE_SQL])
        for statement in self.statements:
            self.assertNotIn("ALTER ROLE",statement)
            self.assertNotIn("DELETE",statement)

    def test_database_clock_is_utc_authoritative(self):
        time=r.read_database_utc_clock(self.query)
        self.assertEqual(time.tzinfo,timezone.utc)
        self.assertEqual(time.isoformat(),"2026-11-22T12:00:15+00:00")
        self.assertEqual(self.statements,[r.CLOCK_SQL])

    def test_missing_lease_returns_none(self):
        self.assertIsNone(r.read_project_lease(lambda _:[]))

    def test_duplicate_rows_denied(self):
        with self.assertRaisesRegex(r.StageLeaseReadDenied,"CARDINALITY_DENIED"):
            r.read_project_lease(lambda _: [self.row,self.row])

    def test_unexpected_fields_denied(self):
        for bad in (self.row[:-1],self.row+["extra"]):
            with self.subTest(size=len(bad)):
                with self.assertRaisesRegex(r.StageLeaseReadDenied,"CARDINALITY_DENIED"):
                    r.read_project_lease(lambda _: [bad])

    def test_wrong_project_or_malformed_nonce_denied(self):
        for index,bad in ((0,"other-project"),(1,"BAD"),
                          (2,"b"*39),(6,"UNVERIFIED")):
            sample=self.row[:]
            sample[index]=bad
            with self.subTest(index=index),self.assertRaisesRegex(
                    r.StageLeaseReadDenied,"SCOPE_DENIED"):
                r.read_project_lease(lambda _: [sample])

    def test_bad_timestamps_denied(self):
        for bad in ("2026-11-22T12:00:00Z","2026-11-22 12:00:00.000Z",
                    "2026-11-22T30:00:00.000Z",None):
            sample=self.row[:]
            sample[3]=bad
            with self.subTest(bad=bad),self.assertRaisesRegex(
                    r.StageLeaseReadDenied,"TIMESTAMP_INVALID"):
                r.read_project_lease(lambda _: [sample])

    def test_invalid_clock_denied(self):
        for bad in ([],[["invalid"]],[["2026-11-22T12:00:00.000Z"]]*2):
            with self.assertRaises(r.StageLeaseReadDenied):
                r.read_database_utc_clock(lambda _:bad)

    def test_query_callback_failures_fail_closed(self):
        def fail(_sql):
            raise RuntimeError("QA_DATABASE_UNAVAILABLE")
        with self.assertRaisesRegex(RuntimeError,"DATABASE_UNAVAILABLE"):
            r.read_project_lease(fail)
        with self.assertRaisesRegex(RuntimeError,"DATABASE_UNAVAILABLE"):
            r.read_database_utc_clock(fail)

    def test_module_cannot_issue_login_or_access_secret(self):
        text=Path(r.__file__).read_text()
        for denied in ("psycopg.connect(","ALTER ROLE ","os.environ",
                       "DATABASE_URL","SESSION_SECRET","LoadCredential"):
            self.assertNotIn(denied,text)
        self.assertIn("SOURCE_ONLY_NO_OPERATIONAL_ENTRYPOINT",text)

if __name__=="__main__":
    unittest.main(verbosity=2)
