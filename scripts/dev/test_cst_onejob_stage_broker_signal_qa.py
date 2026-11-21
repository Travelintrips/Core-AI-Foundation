#!/usr/bin/env python3
"""Disposable SIGTERM recovery QA with real AF_UNIX kernel socket, zero egress.

A subprocess uses the actual Gate-A source socket listener under non-root UID.
The kernel ACL inspector is *only* mocked inside this QA process; no real
authorization, manifest or external database access is requested.
"""
from __future__ import annotations
import os, signal, socket, subprocess, sys, tempfile, time, unittest
from pathlib import Path
from datetime import datetime, timedelta, timezone

ROOT=Path(__file__).resolve().parents[2]
SCRIPT=ROOT/"scripts/dev/cst_onejob_preapproval_stage_broker.py"
CHILD=r'''
import sys,os,json
sys.path.insert(0,sys.argv[1])
import cst_onejob_preapproval_stage_broker as b
from datetime import datetime,timedelta,timezone
b.SOCKET_PATH=sys.argv[2]
# QA-only injection: no nft change, no TCP dial, no operational authority.
b.kernel_egress_ready=lambda m:True
now=datetime.now(timezone.utc)
stamp=lambda d:d.isoformat(timespec="milliseconds").replace("+00:00","Z")
m=dict(zip(b.FIELDS,[
 1,"PREAPPROVAL_STAGE_ONLY",b.PROJECT,"1","a"*40,
 "cst_team_model_pilot_stage_login","8.8.8.8",b.HOST,6543,b.SOCKET_PATH,
 28500,28501,28502,28501,os.stat("/proc/self/ns/net").st_ino,
 stamp(now-timedelta(seconds=1)),stamp(now+timedelta(seconds=30)),"a"*32]))
try:b.serve_stage_once(m)
except RuntimeError as e:
 print(str(e))
 sys.exit(2)
sys.exit(8)
'''

class ActualSignalCleanup(unittest.TestCase):
    def fixture(self,root):
        root.chmod(0o755)
        directory=root/"stage"
        directory.mkdir()
        os.chown(directory,28500,28501)
        directory.chmod(0o750)
        sock=directory/"pg-pooler.sock"
        cmd=["setpriv","--reuid=28500","--regid=28501","--clear-groups",
             sys.executable,"-B","-c",CHILD,str(SCRIPT.parent),str(sock)]
        return sock,cmd

    def start(self,sock,cmd):
        child=subprocess.Popen(cmd,stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE,text=True)
        for _ in range(50):
            if sock.is_socket() or child.poll() is not None:break
            time.sleep(.06)
        return child

    def test_second_instance_does_not_unlink_first_listener(self):
        if os.geteuid()!=0:self.skipTest("needs isolated root for setpriv")
        with tempfile.TemporaryDirectory(prefix="onejob-double-qa-") as temp:
            sock,cmd=self.fixture(Path(temp))
            first=self.start(sock,cmd)
            try:
                self.assertTrue(sock.is_socket())
                self.assertIsNone(first.poll())
                before=sock.lstat().st_ino
                second=subprocess.run(cmd,capture_output=True,text=True,timeout=5)
                self.assertEqual(second.returncode,2)
                self.assertIn("SOCKET_OCCUPIED",second.stdout)
                self.assertEqual(sock.lstat().st_ino,before)
                self.assertIsNone(first.poll())
            finally:
                first.send_signal(signal.SIGTERM) if first.poll() is None else None
                first.communicate(timeout=5)
            self.assertFalse(sock.exists())

    def test_replaced_socket_survives_previous_broker_shutdown(self):
        if os.geteuid()!=0:self.skipTest("needs isolated root for setpriv")
        with tempfile.TemporaryDirectory(prefix="onejob-replace-qa-") as temp:
            sock,cmd=self.fixture(Path(temp))
            first=self.start(sock,cmd)
            replacement=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
            old=sock.with_suffix(".old")
            try:
                self.assertTrue(sock.is_socket())
                self.assertIsNone(first.poll())
                os.rename(sock,old)
                replacement.bind(str(sock))
                replacement.listen(1)
                inode=sock.lstat().st_ino
                first.send_signal(signal.SIGTERM)
                stdout,stderr=first.communicate(timeout=5)
                self.assertEqual(first.returncode,2,(stdout+stderr)[-300:])
                self.assertIn("SOCKET_REPLACED_DURING_CLEANUP",stdout)
                self.assertEqual(sock.lstat().st_ino,inode)
            finally:
                replacement.close()
                if first.poll() is None:
                    first.kill()
                    first.communicate(timeout=5)
                sock.unlink(missing_ok=True)
                old.unlink(missing_ok=True)

    def test_sigkill_leaves_stale_socket_and_next_start_fails_closed(self):
        if os.geteuid()!=0:self.skipTest("needs isolated root for setpriv")
        with tempfile.TemporaryDirectory(prefix="onejob-kill-qa-") as temp:
            sock,cmd=self.fixture(Path(temp))
            first=self.start(sock,cmd)
            try:
                self.assertTrue(sock.is_socket())
                self.assertIsNone(first.poll())
                first.kill()
                first.communicate(timeout=5)
                self.assertTrue(sock.is_socket(),"SIGKILL must not be mistaken for clean exit")
                before=sock.lstat().st_ino
                second=subprocess.run(cmd,capture_output=True,text=True,timeout=5)
                self.assertEqual(second.returncode,2)
                self.assertIn("SOCKET_OCCUPIED",second.stdout)
                self.assertEqual(sock.lstat().st_ino,before)
            finally:
                if first.poll() is None:
                    first.kill()
                    first.communicate(timeout=5)
                sock.unlink(missing_ok=True)

    def test_sigterm_cleans_socket_and_denies_reuse(self):
        if os.geteuid()!=0:self.skipTest("needs isolated root for setpriv")
        with tempfile.TemporaryDirectory(prefix="onejob-signal-qa-") as temp:
            root=Path(temp)
            root.chmod(0o755)
            directory=root/"stage"
            directory.mkdir()
            os.chown(directory,28500,28501)
            directory.chmod(0o750)
            sock=directory/"pg-pooler.sock"
            cmd=["setpriv","--reuid=28500","--regid=28501","--clear-groups",
                 sys.executable,"-B","-c",CHILD,str(SCRIPT.parent),str(sock)]
            child=subprocess.Popen(cmd,stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE,text=True)
            try:
                for _ in range(50):
                    if sock.is_socket():break
                    if child.poll() is not None:break
                    time.sleep(0.06)
                self.assertTrue(sock.is_socket(),"non-root broker socket never bound")
                self.assertIsNone(child.poll(),"listener exited before signal")
                child.send_signal(signal.SIGTERM)
                stdout,stderr=child.communicate(timeout=5)
                self.assertEqual(child.returncode,2,(stdout+stderr)[-300:])
                self.assertIn("CST_STAGE_BROKER_STOP_REQUESTED",stdout)
                self.assertFalse(sock.exists(),"stale socket after SIGTERM")
            finally:
                if child.poll() is None:
                    child.kill()
                    child.communicate(timeout=5)

if __name__=="__main__":
    unittest.main(verbosity=2)
