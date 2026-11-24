#!/usr/bin/env python3
"""Pure fail-closed test, no Docker or external database."""
import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import cst_onejob_stage_relock_controller as c

class RelockFailures(unittest.TestCase):
    def test_drift_containment_runs_before_error(self):
        steps=[]
        def db(statement):
            steps.append(statement)
            if statement==c.ROLE_QUERY:
                return [["1" if len([x for x in steps if x==c.ROLE_QUERY])==1 else "0",
                         "1","0","0","1"]]
            if statement==c.ACTIVE_QUERY:return [["0"]]
            return []
        with self.assertRaisesRegex(c.RelockError,"FINAL_ROLE_CHANGED"):
            c.relock_once(db,pause=lambda _:None)
        self.assertLess(steps.index(c.NOLOGIN_QUERY),steps.index(c.TERMINATE_QUERY))
        self.assertIn(c.ACTIVE_QUERY,steps)

    def test_interim_scope_drift_cannot_yield_success_after_containment(self):
        calls=[]
        def db(statement):
            calls.append(statement)
            if statement==c.ROLE_QUERY:
                n=calls.count(c.ROLE_QUERY)
                if n==1:return [["1","0","0","1","1"]]
                return [["0","0","0","0","1"]]
            if statement==c.ACTIVE_QUERY:return [["0"]]
            return []
        with self.assertRaisesRegex(c.RelockError,"ROLE_SCOPE_DRIFT_AFTER_CONTAINMENT"):
            c.relock_once(db,pause=lambda _:None)
        self.assertIn(c.NOLOGIN_QUERY,calls)
        self.assertIn(c.TERMINATE_QUERY,calls)

    def test_unterminated_session_is_never_pass(self):
        calls=[]
        def db(statement):
            calls.append(statement)
            if statement==c.ROLE_QUERY:return [["0","0","0","0","1"]]
            if statement==c.ACTIVE_QUERY:return [["1"]]
            return []
        with self.assertRaisesRegex(c.RelockError,"RESIDUAL_SESSIONS"):
            c.relock_once(db,pause=lambda _:None,attempts=2)
        self.assertEqual(calls.count(c.TERMINATE_QUERY),2)

    def test_missing_catalog_stops_before_unscoped_mutation(self):
        calls=[]
        def db(statement):
            calls.append(statement)
            return []
        with self.assertRaisesRegex(c.RelockError,"PRE_CATALOG_INVALID"):
            c.relock_once(db)
        self.assertEqual(calls,[c.ROLE_QUERY])

if __name__=="__main__":
    unittest.main(verbosity=2)
