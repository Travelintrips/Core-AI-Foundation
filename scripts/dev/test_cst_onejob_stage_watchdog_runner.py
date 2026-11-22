#!/usr/bin/env python3
"""CST-DEV Gate-A independent watchdog runner: source-only security tests."""
import json
import os
import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parent))
import cst_onejob_stage_watchdog_runner as runner
from cst_onejob_gatea_lease_reader import CLOCK_SQL,LEASE_SQL
from cst_onejob_stage_relock_controller import (
    ROLE_QUERY,ACTIVE_QUERY,NOLOGIN_QUERY,TERMINATE_QUERY,
)

class Db:
    def __init__(self):
        self.login=1
        self.sessions=1
        self.lease=[
            runner.PROJECT,"a"*32,"b"*40,
            "2026-11-22T23:59:30.000Z",
            "2026-11-23T00:04:30.000Z",
            "2026-11-22T23:59:55.000Z","ACTIVE"]
        self.commands=[]
    def query(self,sql):
        self.commands.append(sql)
        if sql==CLOCK_SQL:return [["2026-11-23T00:00:00.000Z"]]
        if sql==LEASE_SQL:return [self.lease] if self.lease is not None else []
        if sql==ROLE_QUERY:return [[self.login,0,0,0,1]]
        if sql==ACTIVE_QUERY:return [[self.sessions]]
        if sql==NOLOGIN_QUERY:
            self.login=0
            return []
        if sql==TERMINATE_QUERY:
            self.sessions=0
            return [[True]]
        raise AssertionError("UNEXPECTED_SQL")

class TestRunner(unittest.TestCase):
    def setUp(self):
        self.db=Db()
    def tick(self):
        return runner.run_watchdog_check(self.db.query,"b"*40)
    def test_live_lease_never_opens_a_role_or_claims_operational_go(self):
        res=self.tick()
        self.assertEqual(res["status"],"LEASE_VALID_OBSERVATION_ONLY")
        self.assertTrue(res["roleLogin"])
        self.assertEqual(res["releaseDecision"],"NO_GO")
        self.assertNotIn(NOLOGIN_QUERY,self.db.commands)
        self.assertTrue(set(self.db.commands)<=runner.ALLOWED_SQL)
    def test_stale_heartbeat_relocks_and_kills_session(self):
        self.db.lease[5]="2026-11-22T23:59:20.000Z"
        res=self.tick()
        self.assertEqual(res["status"],"RELOCKED_STALE_OR_ABSENT_LEASE")
        self.assertEqual((self.db.login,self.db.sessions),(0,0))
        self.assertIn(NOLOGIN_QUERY,self.db.commands)
        self.assertIn(TERMINATE_QUERY,self.db.commands)
    def test_missing_lease_relocks(self):
        self.db.lease=None
        res=self.tick()
        self.assertEqual(res["status"],"RELOCKED_STALE_OR_ABSENT_LEASE")
        self.assertEqual((self.db.login,self.db.sessions),(0,0))
    def test_reader_error_attempts_relock_then_reports_failure(self):
        def error_query(sql):
            if sql==LEASE_SQL:raise RuntimeError("SIMULATED_LEASE_SQL_FAILURE")
            return self.db.query(sql)
        with self.assertRaisesRegex(RuntimeError,"SIMULATED_LEASE_SQL_FAILURE"):
            runner.run_watchdog_check(error_query,"b"*40)
        self.assertEqual((self.db.login,self.db.sessions),(0,0))
    def test_db_clock_error_never_claims_success(self):
        with self.assertRaisesRegex(RuntimeError,"SIMULATED_DB_DISCONNECT"):
            runner.run_watchdog_check(
                lambda _sql: (_ for _ in ()).throw(
                    RuntimeError("SIMULATED_DB_DISCONNECT")),"b"*40)
    def test_wrong_source_and_callback_fail_before_db(self):
        with self.assertRaisesRegex(runner.WatchdogRunnerDenied,"SOURCE_PIN_REQUIRED"):
            runner.run_watchdog_check(self.db.query,"bad")
        with self.assertRaisesRegex(runner.WatchdogRunnerDenied,"SQL_READER_REQUIRED"):
            runner.run_watchdog_check(None,"b"*40)
        self.assertEqual(self.db.commands,[])
    def test_unlisted_sql_denied(self):
        with self.assertRaisesRegex(runner.WatchdogRunnerDenied,"SQL_OUTSIDE_RELOCK_ALLOWLIST"):
            runner.query_with_connection(None,"ALTER ROLE some_other_user LOGIN")
    def test_credential_scope_and_tls_reject_unauthorized_destination(self):
        dsn=("postgresql://"+runner.ADMIN_USERNAME+":"
             +("p"*24)+"@"+runner.HOST+":6543/postgres?sslmode=verify-full")
        obj={"version":1,"project":runner.PROJECT,"dsn":dsn}
        self.assertEqual(runner.validate_credential(json.dumps(obj)),dsn)
        for replacement in (
            dsn.replace(runner.HOST,"malicious.example.com"),
            dsn.replace(":6543/",":5432/"),
            dsn.replace("/postgres?","/other?"),
            dsn.replace("sslmode=verify-full","sslmode=disable"),
            dsn+"&options=-c%20role%3Dpostgres",
            dsn.replace(runner.ADMIN_USERNAME,"postgres"),
            dsn.replace(runner.PROJECT,"wrong-project"),
        ):
            with self.subTest(replacement=replacement[-50:]):
                with self.assertRaises(runner.WatchdogRunnerDenied):
                    runner.validate_credential(json.dumps({**obj,"dsn":replacement}))
        for bad in ({**obj,"version":2},{**obj,"project":"not-dev"},
                    {**obj,"extra":"something"}):
            with self.assertRaises(runner.WatchdogRunnerDenied):
                runner.validate_credential(json.dumps(bad))
    def test_unpinned_ca_denied(self):
        with self.assertRaisesRegex(runner.WatchdogRunnerDenied,"CA_INVALID_SIZE"):
            runner.validate_pinned_ca(b"not-a-cert")
        with self.assertRaisesRegex(runner.WatchdogRunnerDenied,"CA_NOT_PINNED"):
            runner.validate_pinned_ca(b"x"*640)
    def test_no_systemd_credentials_means_no_live_db(self):
        with patch.dict(os.environ,{},clear=True):
            self.assertEqual(runner.main([
                "--credential-file","/tmp/unused",
                "--ca-file","/tmp/unused-ca",
                "--expected-source-sha","b"*40]),2)
    def test_loop_shutdown_relock_after_database_clock_error(self):
        @contextmanager
        def connected():
            yield object()
        def q(_conn,sql):
            if sql==CLOCK_SQL:
                raise RuntimeError("SYNTHETIC_CLOCK_ERROR")
            return self.db.query(sql)
        with patch.object(runner,"query_with_connection",side_effect=q):
            with self.assertRaisesRegex(RuntimeError,"SYNTHETIC_CLOCK_ERROR"):
                runner.run_loop("b"*40,"synthetic","synthetic",
                    connect=lambda _dsn,_ca:connected())
        self.assertEqual((self.db.login,self.db.sessions),(0,0))
    def test_loop_can_stop_after_first_observation(self):
        class Stop:
            def __init__(self):self.count=0
            def is_set(self):return self.count>0
            def wait(self,_seconds):self.count+=1
        @contextmanager
        def connected():
            yield object()
        stop=Stop()
        with patch.object(runner,"query_with_connection",
                          side_effect=lambda _conn,q:self.db.query(q)):
            runner.run_loop("b"*40,"synthetic","synthetic",
                            connect=lambda _dsn,_ca:connected(),stop=stop)
        self.assertEqual(stop.count,1)
        self.assertEqual((self.db.login,self.db.sessions),(0,0))

if __name__=="__main__":
    unittest.main(verbosity=2)