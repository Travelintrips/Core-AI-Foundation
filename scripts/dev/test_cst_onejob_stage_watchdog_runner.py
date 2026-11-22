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
from cst_onejob_stage_relock_controller import ROLE_QUERY,ACTIVE_QUERY

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
        if sql==runner.RELOCK_ONLY_SQL:
            self.login=0
            self.sessions=0
            return [[0,0,1]]
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
        self.assertNotIn(runner.RELOCK_ONLY_SQL,self.db.commands)
        self.assertTrue(set(self.db.commands)<=runner.ALLOWED_SQL)
    def test_stale_heartbeat_relocks_and_kills_session(self):
        self.db.lease[5]="2026-11-22T23:59:20.000Z"
        res=self.tick()
        self.assertEqual(res["status"],"RELOCKED_STALE_OR_ABSENT_LEASE")
        self.assertEqual((self.db.login,self.db.sessions),(0,0))
        self.assertIn(runner.RELOCK_ONLY_SQL,self.db.commands)
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
    def test_relock_only_rejects_unclean_readback_without_faking_pass(self):
        for invalid in ([[0,1,1]],[[1,0,1]],[[0,0,0]],[],[[0,0]]):
            with self.subTest(invalid=invalid):
                with self.assertRaises(runner.WatchdogRunnerDenied):
                    runner.relock_exact(lambda _stmt:invalid)
    def test_unlisted_sql_denied(self):
        for statement in ("ALTER ROLE cst_team_model_pilot_stage_login NOLOGIN",
                          "ALTER ROLE cst_team_model_pilot_stage_login LOGIN",
                          "SELECT pg_terminate_backend(1)"):
            with self.subTest(statement=statement),self.assertRaisesRegex(
                 runner.WatchdogRunnerDenied,"SQL_OUTSIDE_RELOCK_ALLOWLIST"):
                runner.query_with_connection(None,statement)
        self.assertNotIn("CREATEROLE",str(runner.ALLOWED_SQL))
    def test_relock_only_migration_never_grants_role_administration(self):
        source=Path(__file__).resolve().parents[2]/"docs/dev/cst-gatea-relock-only.CSTDEV-ONLY.PROPOSED.sql"
        text=source.read_text()
        for required in (
            "CREATE ROLE cst_gatea_watchdog_relock NOLOGIN NOINHERIT",
            "NOCREATEROLE","NOBYPASSRLS",
            "CREATE SCHEMA cst_gatea_relock_private",
            "LANGUAGE plpgsql SECURITY DEFINER",
            "SET search_path = pg_catalog, pg_temp",
            "IF SESSION_USER <> 'cst_gatea_watchdog_relock'",
            "ALTER ROLE cst_team_model_pilot_stage_login NOLOGIN CONNECTION LIMIT 1",
            "REVOKE ALL ON FUNCTION cst_gatea_relock_private.relock_stage_now() FROM PUBLIC",
            "GRANT EXECUTE ON FUNCTION cst_gatea_relock_private.relock_stage_now()",
        ):
            with self.subTest(required=required):
                self.assertIn(required,text)
        self.assertNotIn("GRANT CREATEROLE",text)
        self.assertNotIn("ALTER ROLE cst_team_model_pilot_stage_login LOGIN",text)
        self.assertNotIn("CREATE FUNCTION public.",text)
    def test_relock_only_rollback_denies_active_stage_and_lease(self):
        source=Path(__file__).resolve().parents[2]/"docs/dev/cst-gatea-relock-only.ROLLBACK-CSTDEV-ONLY.sql"
        text=source.read_text()
        self.assertIn("CST_GATEA_RELOCK_ROLLBACK_ACTIVE_OR_DRIFTED",text)
        self.assertIn("DROP ROLE cst_gatea_watchdog_relock",text)
        self.assertIn("DROP FUNCTION cst_gatea_relock_private.relock_stage_now()",text)
        self.assertIn("SELECT 1 FROM ai_platform.cst_gatea_stage_leases",text)
        self.assertNotIn("DROP TABLE ai_platform.cst_gatea_stage_leases",text)
    def test_reviewed_global_pooler_ipv4_required_without_dns(self):
        self.assertEqual(runner.validate_reviewed_pooler_ipv4(
            "52.65.247.42"),"52.65.247.42")
        for invalid in (None,"","127.0.0.53","10.1.2.3","192.168.1.1",
                        "169.254.1.2","224.1.2.3","::1",
                        "52.65.247.42/32","52.65.247.42:6543",
                        "aws-1-ap-southeast-2.pooler.supabase.com"):
            with self.subTest(invalid=invalid):
                with self.assertRaises(runner.WatchdogRunnerDenied):
                    runner.validate_reviewed_pooler_ipv4(invalid)

    def test_connect_preserves_verify_full_hostname_and_uses_pinned_hostaddr(self):
        with patch.dict(os.environ,{"CST_GATEA_POOLER_IPV4":"52.65.247.42"}):
            with patch("psycopg.connect") as connect:
                runner._connect("postgresql://unconnected-example","/qa/root.pem")
                connect.assert_called_once()
                args,kw=connect.call_args
                self.assertEqual(args,("postgresql://unconnected-example",))
                self.assertEqual(kw["hostaddr"],"52.65.247.42")
                self.assertEqual(kw["sslmode"],"verify-full")
                self.assertEqual(kw["sslrootcert"],"/qa/root.pem")
                self.assertEqual(kw["gssencmode"],"disable")
        with patch.dict(os.environ,{"CST_GATEA_POOLER_IPV4":"127.0.0.53"}):
            with patch("psycopg.connect") as connect:
                with self.assertRaises(runner.WatchdogRunnerDenied):
                    runner._connect("dummy","/qa/root.pem")
                connect.assert_not_called()

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