#!/usr/bin/env python3
"""Offline close-first relock orchestration QA; no real DB/stop service."""
from pathlib import Path
from unittest.mock import patch
import threading
import unittest
import sys

sys.path.insert(0,str(Path(__file__).resolve().parent))
import cst_onejob_stage_watchdog_runner as w

GOOD={'service':'cst-onejob-gatea-preapproval-broker.service',
      'active':False,'socketPresent':False}

class CloseFirst(unittest.TestCase):
    def run_case(self,receipt,stop_error=None,db_error=None):
        order=[]
        def stop():
            order.append('TRANSPORT_STOP')
            if stop_error:raise RuntimeError('STOP_ERROR_TEST_ONLY')
            return receipt
        def relock(query):
            order.append('DB_RELOCK')
            if db_error:raise RuntimeError('DB_DENIED_TEST_ONLY')
            return {'status':'PASS','roleLogin':False,'residualRoleSessions':0}
        with patch.object(w,'relock_exact',relock):
            try:
                v=w.close_transport_before_relock(lambda s:[],stop)
                return order,v,None
            except Exception as e:
                return order,None,str(e)
    def test_verified_stop_then_database_relock_success(self):
        order,value,err=self.run_case(GOOD)
        self.assertEqual(order,['TRANSPORT_STOP','DB_RELOCK'])
        self.assertIsNone(err)
        self.assertEqual(value['status'],'PASS')
    def test_stop_exception_still_attempts_db_relock_and_fails_closed(self):
        order,value,err=self.run_case(GOOD,stop_error=True)
        self.assertEqual(order,['TRANSPORT_STOP','DB_RELOCK'])
        self.assertEqual(err,'FRONTEND_TRANSPORT_STOP_NOT_VERIFIED')
    def test_did_not_stop_is_not_pass(self):
        order,value,err=self.run_case({**GOOD,'active':True})
        self.assertEqual(order,['TRANSPORT_STOP','DB_RELOCK'])
        self.assertEqual(err,'FRONTEND_TRANSPORT_STOP_NOT_VERIFIED')
    def test_stale_socket_is_not_pass(self):
        order,value,err=self.run_case({**GOOD,'socketPresent':True})
        self.assertEqual(order,['TRANSPORT_STOP','DB_RELOCK'])
        self.assertEqual(err,'FRONTEND_TRANSPORT_STOP_NOT_VERIFIED')
    def test_unexpected_broker_service_rejected(self):
        order,value,err=self.run_case({**GOOD,'service':'cst-onejob-gatea-watchdog.service'})
        self.assertEqual(err,'FRONTEND_TRANSPORT_STOP_NOT_VERIFIED')
    def test_extra_receipt_field_rejected(self):
        order,value,err=self.run_case({**GOOD,'bypass':True})
        self.assertEqual(err,'FRONTEND_TRANSPORT_STOP_NOT_VERIFIED')
    def test_database_error_not_masked_by_verified_stop(self):
        order,value,err=self.run_case(GOOD,db_error=True)
        self.assertEqual(order,['TRANSPORT_STOP','DB_RELOCK'])
        self.assertEqual(err,'DB_DENIED_TEST_ONLY')
    def test_database_error_not_masked_by_stop_error(self):
        order,value,err=self.run_case(GOOD,stop_error=True,db_error=True)
        self.assertEqual(order,['TRANSPORT_STOP','DB_RELOCK'])
        self.assertEqual(err,'DB_DENIED_TEST_ONLY')
    def test_normal_existing_no_transport_hook_backward_compatible(self):
        with patch.object(w,'relock_exact',return_value={'status':'PASS'}) as rel:
            self.assertIsNone(w.run_watchdog_check.__kwdefaults__['close_stage_transport'])
            self.assertEqual(w.relock_exact(lambda _sql:[]),{'status':'PASS'})
            rel.assert_called_once()
    def test_final_shutdown_relock_is_also_close_first(self):
        order=[]
        stop=threading.Event()
        class Conn:
            def __enter__(self):return self
            def __exit__(self,*a):return False
        def connect(*a):
            order.append('CONNECT')
            return Conn()
        def close_transport():
            order.append('TRANSPORT_STOP')
            return GOOD
        def relock(q):
            order.append('DB_RELOCK')
            return {'status':'PASS'}
        def check(q,sha,*,close_stage_transport=None):
            self.assertIs(close_stage_transport,close_transport)
            order.append('CHECK_TICK')
            stop.set()
            return {'status':'LEASE_VALID_OBSERVATION_ONLY'}
        with patch.object(w,'relock_exact',relock),patch.object(w,'run_watchdog_check',check):
            w.run_loop('a'*40,'DISPOSABLE_DSN_ONLY','DISPOSABLE_CA_ONLY',
                       connect=connect,stop=stop,close_stage_transport=close_transport)
        self.assertEqual(order,['CONNECT','CHECK_TICK','CONNECT','TRANSPORT_STOP','DB_RELOCK'])
    def test_no_transport_during_normal_valid_tick(self):
        observed=[]
        class Conn:
            def __enter__(self):return self
            def __exit__(self,*a):return False
        event=threading.Event()
        def check(q,sha,*,close_stage_transport=None):
            observed.append(('TICK',close_stage_transport))
            event.set()
            return {'status':'LEASE_VALID_OBSERVATION_ONLY'}
        with patch.object(w,'relock_exact',return_value={'status':'PASS'}) as rel,patch.object(w,'run_watchdog_check',check):
            w.run_loop('a'*40,'DISPOSABLE','DISPOSABLE',
                       connect=lambda *_:Conn(),stop=event)
        self.assertEqual(observed,[('TICK',None)])
        rel.assert_called_once()
if __name__=='__main__':
    unittest.main(verbosity=2)

