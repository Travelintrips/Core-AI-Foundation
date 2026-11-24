#!/usr/bin/env python3
"""Gate A exclusive JIT stage test: no live DB, key or systemd service."""
import multiprocessing as mp
import os
import signal
import time
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from datetime import datetime,timedelta,timezone
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parent))
import cst_onejob_stage_single_flight as lock
import cst_onejob_stage_jit_open_controller as jit

def worker(path,start,release,results):
    try:
        start.wait(8)
        with lock.make_stage_lock(path)():
            results.put("WIN")
            release.wait(8)
    except lock.SingleFlightDenied:
        results.put("DENIED")
    except BaseException as err:
        results.put("ERROR_"+type(err).__name__)

def abandon(path,ready):
    with lock.make_stage_lock(path)():
        ready.put("LOCKED")
        time.sleep(60)

class Flight(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix="cst-gatea-exclusion-")
        self.addCleanup(self.tmp.cleanup)
        self.directory=Path(self.tmp.name)/"gatea-jit-only"
        self.directory.mkdir(mode=0o700)
        self.directory.chmod(0o700)
        self.acquire=lock.make_stage_lock(self.directory)

    def test_four_processes_only_one_holds_stage(self):
        ctx=mp.get_context("fork")
        start=ctx.Event()
        release=ctx.Event()
        results=ctx.Queue()
        children=[ctx.Process(target=worker,args=(str(self.directory),start,release,results))
                  for _ in range(4)]
        try:
            for proc in children:proc.start()
            start.set()
            verdicts=[results.get(timeout=8) for _ in children]
            self.assertEqual(sorted(verdicts),["DENIED"]*3+["WIN"])
        finally:
            release.set()
            for proc in children:
                proc.join(timeout=5)
                if proc.is_alive():proc.terminate()
                proc.join(timeout=3)
        with self.acquire():
            pass

    def test_source_jit_second_distinct_nonce_denied_before_db_or_reservation(self):
        ctx=mp.get_context("fork")
        start=ctx.Event()
        release=ctx.Event()
        out=ctx.Queue()
        child=ctx.Process(target=worker,args=(str(self.directory),start,release,out))
        try:
            child.start()
            start.set()
            self.assertEqual(out.get(timeout=8),"WIN")
            now=datetime(2026,11,22,2,0,tzinfo=timezone.utc)
            manifest={"sourceSha":"a"*40,"project":jit.PROJECT,
                      "nonce":"f"*32,
                      "expiresAt":(now+timedelta(minutes=2)).isoformat(timespec="milliseconds").replace("+00:00","Z")}
            operations=[]
            with patch.object(jit,"read_signed_manifest",return_value=manifest):
                with self.assertRaisesRegex(lock.SingleFlightDenied,"ANOTHER_STAGE_ACTIVE"):
                    jit.run_signed_one_stage(
                        lambda sql: operations.append(("sql",sql)),
                        lambda:operations.append(("stage",True)),
                        reserve_nonce=lambda *_: operations.append(("reserve",True)),
                        acquire_single_flight=self.acquire,
                        envelope_path="SYNTHETIC",public_key_path="SYNTHETIC",
                        approved_public_pin="b"*64,
                        approved_source_sha="a"*40)
            self.assertEqual(operations,[])
        finally:
            release.set()
            child.join(timeout=5)
            if child.is_alive(): child.terminate(); child.join(timeout=3)

    def test_sigkill_abandoned_process_releases_kernel_lock(self):
        ctx=mp.get_context("fork")
        ready=ctx.Queue()
        # SIGKILL bypasses Python finally and leaves the lock file in place.
        child=ctx.Process(target=abandon,args=(str(self.directory),ready))
        try:
            child.start()
            self.assertEqual(ready.get(timeout=8),"LOCKED")
            child.kill()
            child.join(timeout=5)
            self.assertEqual(child.exitcode,-signal.SIGKILL)
            with self.acquire():pass
        finally:
            if child.is_alive():child.terminate();child.join(timeout=3)

    def test_directory_mode_denied(self):
        self.directory.chmod(0o777)
        try:
            with self.assertRaisesRegex(lock.SingleFlightDenied,"DIRECTORY_UNSAFE"):
                with self.acquire():pass
        finally:self.directory.chmod(0o700)

    def test_symlink_directory_denied(self):
        alias=Path(self.tmp.name)/"alias"
        alias.symlink_to(self.directory,target_is_directory=True)
        with self.assertRaises(OSError):
            with lock.make_stage_lock(alias)():pass

    def test_lockfile_symlink_and_unsafe_mode_denied(self):
        file=self.directory/"jit-stage.lock"
        external=Path(self.tmp.name)/"external"
        external.write_text("NO-CHANGE")
        file.symlink_to(external)
        with self.assertRaises(OSError):
            with self.acquire():pass
        self.assertEqual(external.read_text(),"NO-CHANGE")
        file.unlink()
        file.write_text("")
        file.chmod(0o666)
        with self.assertRaisesRegex(lock.SingleFlightDenied,"FILE_UNSAFE"):
            with self.acquire():pass

    def test_exception_releases_lock(self):
        with self.assertRaisesRegex(RuntimeError,"MOCK_STAGE_FAILURE"):
            with self.acquire():raise RuntimeError("MOCK_STAGE_FAILURE")
        with self.acquire():pass

    def test_relative_directory_denied(self):
        with self.assertRaisesRegex(lock.SingleFlightDenied,"ABSOLUTE"):
            lock.make_stage_lock("relative-path")

    def test_lockfile_is_private_and_source_nonoperational(self):
        with self.acquire():
            p=self.directory/"jit-stage.lock"
            self.assertTrue(p.is_file())
            self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o600)
        source=Path(lock.__file__).read_text()
        for forbidden in ("DATABASE_URL","psycopg.connect(","SESSION_SECRET","systemctl start","ALTER ROLE"):
            self.assertNotIn(forbidden,source)

if __name__=="__main__":
    unittest.main(verbosity=2)
