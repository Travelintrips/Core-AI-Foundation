#!/usr/bin/env python3
"""Pure synthetic watchdog policies; no host/DEV/PROD database calls."""
import sys,unittest
from datetime import datetime,timedelta,timezone
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import cst_onejob_stage_watchdog_candidate as w
from cst_onejob_stage_relock_controller import (
    ROLE_QUERY,ACTIVE_QUERY,NOLOGIN_QUERY,TERMINATE_QUERY
)

UTC=timezone.utc
class Db:
    def __init__(self):
        self.login=1
        self.sessions=1
        self.commands=[]
        self.relock_fails=False
        self.role_flags=(0,0,0,1)
    def query(self,stmt):
        self.commands.append(stmt)
        if stmt==ROLE_QUERY:return [[self.login,*self.role_flags]]
        if stmt==ACTIVE_QUERY:return [[self.sessions]]
        if stmt==NOLOGIN_QUERY:
            if self.relock_fails:raise RuntimeError("ADMIN_DB_UNAVAILABLE")
            self.login=0
            return []
        if stmt==TERMINATE_QUERY:
            self.sessions=0
            return [[True]]
        raise AssertionError("UNEXPECTED_SQL")

class Tests(unittest.TestCase):
    def setUp(self):
        self.db=Db()
        self.now=datetime(2026,11,22,2,0,tzinfo=UTC)
        self.lease={"project":w.PROJECT,"nonce":"a"*32,"sourceSha":"b"*40,
                    "issuedAt":self.now-timedelta(seconds=20),
                    "expiresAt":self.now+timedelta(minutes=4),
                    "heartbeatAt":self.now-timedelta(seconds=5),"state":"ACTIVE"}
    def check(self,lease=None):
        return w.check_once(self.db.query,lambda:self.lease if lease is None else lease,
                            now=self.now,approved_source_sha="b"*40)
    def test_active_lease_keeps_role_but_returns_no_go(self):
        result=self.check()
        self.assertEqual(result["status"],"LEASE_VALID_OBSERVATION_ONLY")
        self.assertTrue(result["roleLogin"])
        self.assertEqual(result["releaseDecision"],"NO_GO")
        self.assertNotIn(NOLOGIN_QUERY,self.db.commands)
    def test_future_dated_heartbeat_force_relock(self):
        # Database writer must reject a future timestamp; the already-PASS
        # independent watchdog also rejects it if a row somehow exists.
        self.lease["heartbeatAt"]=self.now+timedelta(seconds=30)
        result=self.check()
        self.assertEqual(result["status"],"RELOCKED_STALE_OR_ABSENT_LEASE")
        self.assertEqual((self.db.login,self.db.sessions),(0,0))
        self.assertIn(TERMINATE_QUERY,self.db.commands)

    def test_stale_heartbeat_force_relock(self):
        self.lease["heartbeatAt"]=self.now-timedelta(seconds=16)
        result=self.check()
        self.assertEqual(result["status"],"RELOCKED_STALE_OR_ABSENT_LEASE")
        self.assertEqual((self.db.login,self.db.sessions),(0,0))
        self.assertIn(TERMINATE_QUERY,self.db.commands)
    def test_missing_lease_force_relock(self):
        self.assertEqual(self.check({})["roleLogin"],False)
        self.assertEqual((self.db.login,self.db.sessions),(0,0))
    def test_expired_lease_force_relock(self):
        self.lease["expiresAt"]=self.now-timedelta(seconds=1)
        self.assertEqual(self.check()["status"],"RELOCKED_STALE_OR_ABSENT_LEASE")
        self.assertEqual(self.db.login,0)
    def test_wrong_project_or_source_force_relock(self):
        for field,value in (("project","not-dev"),("sourceSha","c"*40)):
            with self.subTest(field=field):
                self.setUp()
                self.lease[field]=value
                self.check()
                self.assertEqual(self.db.login,0)
    def test_multiple_sessions_force_relock_and_never_go(self):
        self.db.sessions=2
        with self.assertRaisesRegex(w.WatchdogDenied,"MULTIPLE_STAGE_SESSIONS"):
            self.check()
        self.assertEqual((self.db.login,self.db.sessions),(0,0))
    def test_security_drift_force_relock(self):
        self.db.role_flags=(1,0,0,1)
        with self.assertRaises(RuntimeError):
            self.check()
        self.assertEqual((self.db.login,self.db.sessions),(0,0))
    def test_lease_reader_exception_still_relocks(self):
        def unavailable():
            raise RuntimeError("DURABLE_LEASE_UNAVAILABLE")
        with self.assertRaisesRegex(RuntimeError,"DURABLE_LEASE_UNAVAILABLE"):
            w.check_once(self.db.query,unavailable,now=self.now,
                         approved_source_sha="b"*40)
        self.assertEqual((self.db.login,self.db.sessions),(0,0))
        self.assertIn(NOLOGIN_QUERY,self.db.commands)

    def test_lease_reader_exception_and_failed_relock_never_pass(self):
        self.db.relock_fails=True
        with self.assertRaisesRegex(RuntimeError,"ADMIN_DB_UNAVAILABLE"):
            w.check_once(self.db.query,
                         lambda: (_ for _ in ()).throw(RuntimeError("LEASE_UNAVAILABLE")),
                         now=self.now,approved_source_sha="b"*40)
        self.assertIn(NOLOGIN_QUERY,self.db.commands)

    def test_relock_db_failure_never_returns_pass(self):
        self.db.relock_fails=True
        self.lease["heartbeatAt"]=self.now-timedelta(seconds=20)
        with self.assertRaisesRegex(RuntimeError,"ADMIN_DB_UNAVAILABLE"):
            self.check()
    def test_untrusted_source_pin_denied_before_db(self):
        with self.assertRaisesRegex(w.WatchdogDenied,"PINNED_SOURCE"):
            w.check_once(self.db.query,lambda:self.lease,now=self.now,
                         approved_source_sha="invalid")
        self.assertEqual(self.db.commands,[])
    def test_cannot_be_run_as_live_cli(self):
        text=Path(w.__file__).read_text()
        for forbidden in ("psycopg.connect(","DATABASE_URL","os.environ","ALTER ROLE cst_team_model_pilot_stage_login LOGIN"):
            self.assertNotIn(forbidden,text)
        self.assertIn("SOURCE_ONLY_NO_OPERATIONAL_CLI",text)

if __name__=="__main__":unittest.main(verbosity=2)