#!/usr/bin/env python3
"""Disposable Gate-A nonce persistence QA; no stage service, keys or database."""
import importlib.util
import multiprocessing as mp
import os
from pathlib import Path
import stat
import sys
from contextlib import nullcontext
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parent))
import cst_onejob_stage_nonce_adapter as a
import cst_onejob_stage_jit_open_controller as jit

SHA="a"*40
NONCE="b"*32
DEADLINE=datetime(2026,11,23,0,0,tzinfo=timezone.utc)

def _contest(path,ready,go,out):
    try:
        reserve=a.make_stage_nonce_reserver(path)
        ready.put(1)
        go.wait(6)
        out.put(("result",reserve(a.PROJECT,NONCE,SHA,DEADLINE)))
    except BaseException as ex:
        out.put(("error",type(ex).__name__))

class DurableGateANonce(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix="cst-gatea-durable-nonce-")
        self.addCleanup(self.tmp.cleanup)
        self.directory=Path(self.tmp.name)/"separate-ledger"
        self.directory.mkdir(mode=0o700)
        self.directory.chmod(0o700)
        self.reserve=a.make_stage_nonce_reserver(self.directory)

    def test_one_permit_consumed_and_replay_denied_across_reserver_instances(self):
        self.assertIs(self.reserve(a.PROJECT,NONCE,SHA,DEADLINE),True)
        self.assertIs(a.make_stage_nonce_reserver(self.directory)(a.PROJECT,NONCE,SHA,DEADLINE),False)
        entries=list(self.directory.iterdir())
        self.assertEqual(len(entries),1)
        self.assertEqual(stat.S_IMODE(entries[0].stat().st_mode),0o600)
        self.assertEqual(entries[0].read_bytes(),b"consumed\n")

    def test_same_nonce_rejected_even_after_source_change(self):
        self.assertTrue(self.reserve(a.PROJECT,NONCE,SHA,DEADLINE))
        self.assertFalse(self.reserve(a.PROJECT,NONCE,"f"*40,DEADLINE))

    def test_multi_process_only_one_winner(self):
        ctx=mp.get_context("fork")
        ready=ctx.Queue()
        go=ctx.Event()
        out=ctx.Queue()
        processes=[ctx.Process(target=_contest,args=(str(self.directory),ready,go,out)) for _ in range(4)]
        try:
            for p in processes:p.start()
            for _ in processes:ready.get(timeout=8)
            go.set()
            rows=[out.get(timeout=8) for _ in processes]
            for p in processes:p.join(timeout=5)
            self.assertEqual([v for typ,v in rows if typ=="error"],[])
            self.assertEqual(sorted(v for typ,v in rows),[False,False,False,True])
            self.assertEqual(len(list(self.directory.iterdir())),1)
            self.assertFalse(self.reserve(a.PROJECT,NONCE,SHA,DEADLINE))
        finally:
            go.set()
            for p in processes:
                if p.is_alive():p.terminate()
                p.join(timeout=3)

    def test_invalid_context_denied_before_write(self):
        for project,nonce,sha,until in [
            ("WRONG",NONCE,SHA,DEADLINE),
            (a.PROJECT,NONCE.upper(),SHA,DEADLINE),
            (a.PROJECT,"../escape",SHA,DEADLINE),
            (a.PROJECT,NONCE,"a"*39,DEADLINE),
            (a.PROJECT,NONCE,SHA,datetime(2026,11,23)),
        ]:
            with self.assertRaisesRegex(a.StageNonceDenied,"CONTEXT_INVALID"):
                self.reserve(project,nonce,sha,until)
        self.assertEqual(list(self.directory.iterdir()),[])

    def test_symlink_ledger_denied(self):
        link=Path(self.tmp.name)/"redirect"
        link.symlink_to(self.directory,target_is_directory=True)
        other=a.make_stage_nonce_reserver(link)
        with self.assertRaisesRegex(RuntimeError,"DIRECTORY_UNSAFE"):
            other(a.PROJECT,NONCE,SHA,DEADLINE)
        self.assertEqual(list(self.directory.iterdir()),[])

    def test_loose_ledger_denied(self):
        self.directory.chmod(0o777)
        try:
            with self.assertRaisesRegex(RuntimeError,"DIRECTORY_UNSAFE"):
                self.reserve(a.PROJECT,NONCE,SHA,DEADLINE)
        finally:
            self.directory.chmod(0o700)

    def test_fsync_failure_keeps_nonce_unusable(self):
        import os
        real=os.fsync
        def fsync_fail_directory(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode):
                raise OSError("QA_DIRECTORY_FSYNC_FAILED")
            return real(fd)
        with patch.object(os,"fsync",side_effect=fsync_fail_directory):
            with self.assertRaisesRegex(OSError,"QA_DIRECTORY_FSYNC_FAILED"):
                self.reserve(a.PROJECT,NONCE,SHA,DEADLINE)
        self.assertFalse(self.reserve(a.PROJECT,NONCE,SHA,DEADLINE))

    def test_jit_controller_callback_contract(self):
        from unittest.mock import patch as patchit
        # No real signature or SQL; prove callback integration and guard.
        now=datetime(2026,11,22,0,0,tzinfo=timezone.utc)
        manifest={"project":a.PROJECT,"sourceSha":SHA,"nonce":NONCE,
                  "expiresAt":(now+timedelta(minutes=2)).isoformat(timespec="milliseconds").replace("+00:00","Z")}
        role=[0,0,0,0,1]
        def query(sql):
            if sql==jit.ACTIVE_QUERY:return [[0]]
            if sql==jit.ROLE_QUERY:return [role.copy()]
            if " LOGIN VALID UNTIL " in sql:role[0]=1;return []
            if sql==jit.relock_once.__globals__["NOLOGIN_QUERY"]:role[0]=0;return []
            if sql==jit.relock_once.__globals__["TERMINATE_QUERY"]:return [[True]]
            raise AssertionError("UNEXPECTED_SQL")
        with patchit.object(jit,"read_signed_manifest",return_value=manifest):
            result=jit.run_signed_one_stage(query,lambda:None,
                reserve_nonce=self.reserve,acquire_single_flight=nullcontext,envelope_path="SYNTHETIC",
                public_key_path="SYNTHETIC",approved_public_pin="c"*64,
                approved_source_sha=SHA,now=now)
            self.assertEqual(result["releaseDecision"],"NO_GO")
            self.assertEqual(role[0],0)
            with self.assertRaisesRegex(jit.JitStageDenied,"NONCE_ALREADY_RESERVED"):
                jit.run_signed_one_stage(query,lambda:None,
                    reserve_nonce=self.reserve,acquire_single_flight=nullcontext,envelope_path="SYNTHETIC",
                    public_key_path="SYNTHETIC",approved_public_pin="c"*64,
                    approved_source_sha=SHA,now=now)

    def test_no_operational_entrypoint(self):
        s=Path(a.__file__).read_text()
        for denied in ("ALTER ROLE","psycopg.connect(","DATABASE_URL",
                       "private_key","os.environ","SUPABASE_PROD"):
            self.assertNotIn(denied,s)

if __name__=="__main__":
    unittest.main(verbosity=2)