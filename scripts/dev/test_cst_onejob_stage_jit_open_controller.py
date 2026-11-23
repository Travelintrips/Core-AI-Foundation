#!/usr/bin/env python3
"""Isolated callback tests; no live Supabase, issuer, or technical approval."""
import sys, unittest
from contextlib import nullcontext
from pathlib import Path
from datetime import datetime,timedelta,timezone
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent))
import cst_onejob_stage_jit_open_controller as j
from cst_onejob_gatea_lease_reader import CLOCK_SQL

class FakeAdmin:
    def __init__(self):
        self.enabled=0
        self.sessions=0
        self.commands=[]
        self.db_now=datetime(2026,11,22,2,0,tzinfo=timezone.utc)
    def query(self,statement):
        self.commands.append(statement)
        if statement==CLOCK_SQL:
            return [[self.db_now.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]+"Z"]]
        if statement==j.ROLE_QUERY:return [[self.enabled,0,0,0,1]]
        if statement==j.ACTIVE_QUERY:return [[self.sessions]]
        if statement==j.relock_once.__globals__["NOLOGIN_QUERY"]:
            self.enabled=0
            return []
        if statement==j.relock_once.__globals__["TERMINATE_QUERY"]:
            self.sessions=0
            return [[True]]
        if statement.startswith("ALTER ROLE "+j.ROLE+" LOGIN VALID UNTIL '"):
            self.enabled=1
            return []
        raise AssertionError("UNEXPECTED_SQL")
class JitContract(unittest.TestCase):
    def setUp(self):
        self.now=datetime(2026,11,22,2,0,tzinfo=timezone.utc)
        self.nonces=set()
        self.stage_lock=nullcontext
        self.manifest={"sourceSha":"a"*40,"project":j.PROJECT,"nonce":"e"*32,
                       "expiresAt":(self.now+timedelta(minutes=5)).isoformat(timespec="milliseconds").replace("+00:00","Z")}
        self.db=FakeAdmin()
        self.db.db_
    def reserve_nonce(self,project,nonce,source,deadline):
        assert project==j.PROJECT and source=="a"*40
        if nonce in self.nonces:return False
        self.nonces.add(nonce)
        return True

    def invoke(self, action=lambda:None, manifest=None, reservation=None):
        reserve=self.reserve_nonce if reservation is None else reservation
        self.db.db_
        with patch.object(j,"read_signed_manifest",return_value=manifest or self.manifest) as verified:
            out=j.run_signed_one_stage(
                self.db.query,action,reserve_nonce=reserve,acquire_single_flight=self.stage_lock,envelope_path="SYNTHETIC",
                public_key_path="SYNTHETIC",approved_public_pin="b"*64,
                approved_source_sha="a"*40)
        self.assertEqual(verified.call_count,1)
        return out
    def test_one_bounded_open_then_existing_relock(self):
        def action():
            self.assertEqual(self.db.enabled,1)
            self.db.sessions=1
        result=self.invoke(action)
        self.assertEqual(result["status"],"SOURCE_ONLY_RELOCKED")
        self.assertEqual(result["releaseDecision"],"NO_GO")
        self.assertEqual((self.db.enabled,self.db.sessions),(0,0))
        self.assertEqual(sum("LOGIN VALID UNTIL" in v for v in self.db.commands),1)
    def test_action_failure_still_relocks(self):
        def fail():
            self.db.sessions=1
            raise ValueError("DISPOSABLE_QA_ERROR")
        with self.assertRaisesRegex(ValueError,"DISPOSABLE_QA_ERROR"):
            self.invoke(fail)
        self.assertEqual((self.db.enabled,self.db.sessions),(0,0))
    def test_wrong_source_denied_before_opening_sql(self):
        with self.assertRaisesRegex(j.JitStageDenied,"MISMATCH"):
            self.invoke(manifest={**self.manifest,"sourceSha":"f"*40})
        self.assertEqual(self.db.commands,[CLOCK_SQL])
        self.assertNotIn("ALTER ROLE",str(self.db.commands))
    def test_session_already_open_denied(self):
        self.db.sessions=1
        with self.assertRaisesRegex(j.JitStageDenied,"CONTAINED"):
            self.invoke()
        self.assertEqual((self.db.enabled,self.db.sessions),(0,0))
    def test_existing_role_login_denied(self):
        self.db.enabled=1
        with self.assertRaisesRegex(j.JitStageDenied,"CONTAINED"):
            self.invoke()
        self.assertEqual((self.db.enabled,self.db.sessions),(0,0))
        self.assertNotIn("LOGIN VALID UNTIL",str(self.db.commands))
    def test_expired_lease_denied(self):
        with self.assertRaisesRegex(j.JitStageDenied,"EXPIRED"):
            self.invoke(manifest={**self.manifest,"expiresAt":self.now.isoformat(timespec="milliseconds").replace("+00:00","Z")})
        self.assertEqual(self.db.commands,[CLOCK_SQL])
        self.assertNotIn("ALTER ROLE",str(self.db.commands))
    def test_source_missing_rejected_without_permit_read(self):
        with patch.object(j,"read_signed_manifest") as verify:
            with self.assertRaisesRegex(j.JitStageDenied,"SOURCE_PIN_REQUIRED"):
                j.run_signed_one_stage(self.db.query,lambda:None,
                  reserve_nonce=self.reserve_nonce,acquire_single_flight=self.stage_lock,envelope_path="unused",public_key_path="unused",
                  approved_public_pin="b"*64,approved_source_sha="invalid")
        verify.assert_not_called()
    def test_same_signed_nonce_cannot_open_twice(self):
        self.invoke()
        opens_before=sum("LOGIN VALID UNTIL" in v for v in self.db.commands)
        with self.assertRaisesRegex(j.JitStageDenied,"NONCE_ALREADY_RESERVED"):
            self.invoke()
        self.assertEqual(opens_before,1)
        self.assertEqual(sum("LOGIN VALID UNTIL" in v for v in self.db.commands),1)
        self.assertEqual(self.db.enabled,0)

    def test_failed_reservation_does_not_open_login(self):
        with self.assertRaisesRegex(j.JitStageDenied,"NONCE_ALREADY_RESERVED"):
            self.invoke(reservation=lambda *_:False)
        self.assertNotIn("LOGIN VALID UNTIL",str(self.db.commands))
        self.assertEqual(self.db.enabled,0)

    def test_signed_nonce_missing_rejected_before_reservation(self):
        called=[]
        with self.assertRaisesRegex(j.JitStageDenied,"SIGNED_NONCE_REQUIRED"):
            self.invoke(manifest={k:v for k,v in self.manifest.items() if k!="nonce"},
                        reservation=lambda *_:called.append(True))
        self.assertEqual(called,[])
        self.assertNotIn("LOGIN VALID UNTIL",str(self.db.commands))

    def test_missing_single_flight_lock_denies_before_db_queries(self):
        with patch.object(j,"read_signed_manifest",return_value=self.manifest):
            with self.assertRaisesRegex(j.JitStageDenied,"SINGLE_FLIGHT_LOCK_REQUIRED"):
                j.run_signed_one_stage(
                    self.db.query,lambda:None,reserve_nonce=self.reserve_nonce,
                    acquire_single_flight=None,envelope_path="SYNTHETIC",
                    public_key_path="SYNTHETIC",approved_public_pin="b"*64,
                    approved_source_sha="a"*40)
        self.assertEqual(self.db.commands,[])
        self.assertEqual(self.nonces,set())

    def test_lock_covers_action_and_relock(self):
        state={"locked":False}
        from contextlib import contextmanager
        @contextmanager
        def exclusive():
            state["locked"]=True
            try: yield
            finally:
                self.assertEqual((self.db.enabled,self.db.sessions),(0,0))
                state["locked"]=False
        self.stage_lock=exclusive
        def action():
            self.assertTrue(state["locked"])
            self.db.sessions=1
        self.invoke(action)
        self.assertFalse(state["locked"])

    def test_no_cli_or_credential_reader(self):
        s=Path(j.__file__).read_text()
        for forbidden in ("psycopg.connect(","os.environ","DATABASE_URL",
                          "CREATE ROLE","password_hash","SUPABASE_PROD"):
            self.assertNotIn(forbidden,s)
    def test_relock_failure_never_returns_success(self):
        def fail_relock(_query):
            raise RuntimeError("RELOCK_FAILED")
        with patch.object(j,"read_signed_manifest",return_value=self.manifest):
            with self.assertRaisesRegex(RuntimeError,"RELOCK_FAILED"):
                j.run_signed_one_stage(self.db.query,lambda:None,
                    reserve_nonce=self.reserve_nonce,acquire_single_flight=self.stage_lock,envelope_path="SYNTHETIC",public_key_path="SYNTHETIC",
                    approved_public_pin="b"*64,approved_source_sha="a"*40,
                    ,relock=fail_relock)

    def test_database_clock_is_used_before_signed_permit(self):
        self.invoke()
        self.assertEqual(self.db.commands[0],CLOCK_SQL)
    def test_permit_expires_after_single_flight_lock_no_nonce_or_login(self):
        from contextlib import contextmanager
        @contextmanager
        def expires_during_lock():
            self.db.db_+timedelta(minutes=6)
            yield
        with patch.object(j,"read_signed_manifest",return_value=self.manifest):
            with self.assertRaisesRegex(j.JitStageDenied,"EXPIRED_OR_UNBOUNDED"):
                j.run_signed_one_stage(
                    self.db.query,lambda:None,reserve_nonce=self.reserve_nonce,
                    acquire_single_flight=expires_during_lock,
                    envelope_path="SYNTHETIC",public_key_path="SYNTHETIC",
                    approved_public_pin="b"*64,approved_source_sha="a"*40)
        self.assertEqual(self.nonces,set())
        self.assertNotIn("LOGIN VALID UNTIL",str(self.db.commands))
    def test_permit_expires_during_nonce_reservation_no_login(self):
        def reserve_then_expire(project,nonce,source,deadline):
            result=self.reserve_nonce(project,nonce,source,deadline)
            self.db.db_now=deadline+timedelta(milliseconds=1)
            return result
        with self.assertRaisesRegex(j.JitStageDenied,"EXPIRED_OR_UNBOUNDED"):
            self.invoke(reservation=reserve_then_expire)
        self.assertEqual(self.db.enabled,0)
        self.assertNotIn("LOGIN VALID UNTIL",str(self.db.commands))
        self.assertEqual(len(self.nonces),1)
    def test_host_clock_override_is_not_available(self):
        import inspect
        self.assertNotIn("now",inspect.signature(j.run_signed_one_stage).parameters)
if __name__=="__main__": unittest.main(verbosity=2)
