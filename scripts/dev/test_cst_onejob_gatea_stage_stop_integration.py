#!/usr/bin/env python3
"""Opt-in close-first watchguard hook tests; no DB, no service control."""
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent))
from cst_onejob_gatea_lease_reader import CLOCK_SQL, LEASE_SQL
from cst_onejob_stage_relock_controller import ROLE_QUERY, ACTIVE_QUERY
import cst_onejob_stage_watchdog_runner as w
import cst_onejob_gatea_stage_stop_bridge as bridge

GOOD={"service":bridge.BROKER,"active":False,"socketPresent":False}
class FakeDb:
    def __init__(self):
        self.login=1
        self.sessions=1
        self.lease=None
        self.relock_invalid=False
        self.db_fail=False
        self.order=[]
    def query(self,sql):
        self.order.append(sql)
        if sql==CLOCK_SQL:return [["2026-11-23T00:00:00.000Z"]]
        if sql==ROLE_QUERY:return [[self.login,0,0,0,1]]
        if sql==ACTIVE_QUERY:return [[self.sessions]]
        if sql==LEASE_SQL:return [] if self.lease is None else [self.lease]
        if sql==w.RELOCK_ONLY_SQL:
            if self.db_fail:raise RuntimeError("DB_FAILED_TEST")
            self.login=0;self.sessions=0
            return [[1,0,1]] if self.relock_invalid else [[0,0,1]]
        raise AssertionError("UNEXPECTED_SQL")

class CloseFirstBridge(unittest.TestCase):
    def setUp(self):
        self.db=FakeDb()
        self.events=[]
    def stopper(self):
        self.events.append("STOP_BRIDGE")
        return GOOD
    def tick(self,callback=None):
        return w.run_watchdog_check(self.db.query,"b"*40,
                        close_stage_transport=(self.stopper if callback is None else callback))
    def test_stage_open_early_relock_stop_before_sql(self):
        res=self.tick()
        self.assertEqual(res["status"],"RELOCKED_STALE_OR_ABSENT_LEASE")
        self.assertEqual(self.events,["STOP_BRIDGE"])
        self.assertEqual(self.db.order[-1],w.RELOCK_ONLY_SQL)
        self.assertEqual(self.db.login,0)
    def test_idle_closed_stage_does_not_restart_broker(self):
        self.db.login=0;self.db.sessions=0
        res=self.tick()
        self.assertEqual(res["status"],"RELOCKED_STALE_OR_ABSENT_LEASE")
        self.assertEqual(self.events,[])
        self.assertIn(w.RELOCK_ONLY_SQL,self.db.order)
    def test_stale_lease_requires_closure_even_if_no_login(self):
        self.db.login=0;self.db.sessions=0
        self.db.lease=[w.PROJECT,"a"*32,"b"*40,
              "2026-11-22T23:50:00.000Z","2026-11-22T23:59:00.000Z",
              "2026-11-22T23:58:40.000Z","ACTIVE"]
        self.tick()
        self.assertEqual(self.events,["STOP_BRIDGE"])
    def test_valid_lease_does_not_trigger_stop(self):
        self.db.lease=[w.PROJECT,"a"*32,"b"*40,
             "2026-11-22T23:59:30.000Z","2026-11-23T00:04:30.000Z",
             "2026-11-22T23:59:55.000Z","ACTIVE"]
        self.assertEqual(self.tick()["status"],"LEASE_VALID_OBSERVATION_ONLY")
        self.assertEqual(self.events,[])
    def test_bad_stop_receipt_still_relocks_sql_but_refuses_pass(self):
        with self.assertRaisesRegex(w.WatchdogRunnerDenied,
                                    "FRONTEND_TRANSPORT_STOP_NOT_VERIFIED"):
            self.tick(lambda:{"service":bridge.BROKER,"active":True,"socketPresent":False})
        self.assertEqual(self.db.login,0)
        self.assertIn(w.RELOCK_ONLY_SQL,self.db.order)
    def test_stop_bridge_exception_still_relocks_sql(self):
        def fail():raise bridge.StopBridgeDenied("NO_ACK")
        with self.assertRaisesRegex(w.WatchdogRunnerDenied,
                                    "FRONTEND_TRANSPORT_STOP_NOT_VERIFIED"):
            self.tick(fail)
        self.assertEqual(self.db.login,0)
    def test_db_failure_after_good_stop_not_masked(self):
        self.db.db_fail=True
        with self.assertRaisesRegex(RuntimeError,"DB_FAILED_TEST"):
            self.tick()
        self.assertEqual(self.events,["STOP_BRIDGE"])
    def test_live_watcher_no_bridge_flag_backwards_compatible(self):
        self.assertEqual(w.run_watchdog_check(self.db.query,"b"*40)["status"],
                         "RELOCKED_STALE_OR_ABSENT_LEASE")
        self.assertEqual(self.events,[])
    def test_wrong_cli_socket_path_denied_before_connection(self):
        with patch.object(w,"validate_source_sha",return_value="b"*40), \
             patch.object(w,"_read_regular",return_value=b"test"), \
             patch.object(w,"validate_credential",return_value="NO_DB"), \
             patch.object(w,"validate_pinned_ca",return_value=b"test"), \
             patch.dict(w.os.environ,{"CREDENTIALS_DIRECTORY":"/tmp/qa-cred"}), \
             patch.object(w,"run_loop") as loop:
            result=w.main(["--credential-file","/tmp/qa-cred/watchdog-db",
                           "--ca-file","/tmp/qa-cred/watchdog-ca",
                           "--expected-source-sha","b"*40,
                           "--stage-stop-bridge-socket","/tmp/forbidden.sock"])
            self.assertEqual(result,2)
            loop.assert_not_called()
    def test_pinned_cli_passes_exact_callback_only(self):
        with patch.object(w,"validate_source_sha",return_value="b"*40), \
             patch.object(w,"_read_regular",return_value=b"test"), \
             patch.object(w,"validate_credential",return_value="NO_DB"), \
             patch.object(w,"validate_pinned_ca",return_value=b"test"), \
             patch.dict(w.os.environ,{"CREDENTIALS_DIRECTORY":"/tmp/qa-cred"}), \
             patch.object(w,"run_loop") as loop:
            result=w.main(["--credential-file","/tmp/qa-cred/watchdog-db",
                           "--ca-file","/tmp/qa-cred/watchdog-ca",
                           "--expected-source-sha","b"*40,
                           "--stage-stop-bridge-socket",bridge.SOCKET_PATH])
            self.assertEqual(result,0)
            self.assertIs(loop.call_args.kwargs["close_stage_transport"],bridge.notify_stage_stop)
if __name__=="__main__":unittest.main(verbosity=2)
