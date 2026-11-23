#!/usr/bin/env python3
"""Real local UNIX sockets; existing Gate A broker code, no DB/pooler connection.
Proves held-open downstream and upstream sockets get EOF at stop and lease expiry.
"""
import os
from pathlib import Path
import socket
import sys
import threading
import time
import unittest
from datetime import datetime,timedelta,timezone

# Test the actual canonical PR candidate, NOT an older VPS bootstrap copy.
sys.path.insert(0,str(Path(__file__).resolve().parent))
import cst_onejob_preapproval_stage_broker as broker

def stamp(value):
    return value.isoformat(timespec="milliseconds").replace("+00:00","Z")

def manifest(seconds):
    now=datetime.now(timezone.utc)
    return dict(zip(broker.FIELDS,[
        1,"PREAPPROVAL_STAGE_ONLY",broker.PROJECT,"1","a"*40,
        "cst_team_model_pilot_stage_login","52.62.122.103",broker.HOST,
        broker.PORT,broker.SOCKET_PATH,28500,28501,28502,28501,
        123456789,stamp(now-timedelta(seconds=2)),
        stamp(now+timedelta(seconds=seconds)),"b"*32,
    ]))

def run_case(test,expiry_sec,stop_after=None,traffic=False):
    downstream,client=socket.socketpair(socket.AF_UNIX,socket.SOCK_STREAM)
    upstream,pooler=socket.socketpair(socket.AF_UNIX,socket.SOCK_STREAM)
    client.settimeout(2)
    pooler.settimeout(2)
    start=time.monotonic()
    stop=threading.Event()
    done=threading.Event()
    outcome=[]
    m=manifest(expiry_sec)
    def broker_thread():
        try:
            with downstream:  # identical to serve_stage_once's with client:
                broker.forward_stage_with_lease(
                    downstream,m,dial=lambda:upstream,stopped=stop.is_set)
        except RuntimeError as e:
            outcome.append(str(e))
        finally:
            done.set()
    worker=threading.Thread(target=broker_thread,daemon=True)
    try:
        worker.start()
        client.sendall(b"read-only-qa-client")
        test.assertEqual(pooler.recv(64),b"read-only-qa-client")
        pooler.sendall(b"read-only-qa-upstream")
        test.assertEqual(client.recv(64),b"read-only-qa-upstream")
        if traffic:
            # Keep both channels active even while signed deadline approaches.
            while not done.is_set() and time.monotonic()-start < expiry_sec+1:
                try: client.sendall(b"x")
                except OSError:break
                time.sleep(0.025)
        elif stop_after is not None:
            time.sleep(stop_after)
            stop.set()  # represents externally verified stop signal at relock
        worker.join(timeout=3.0)
        test.assertFalse(worker.is_alive(),"broker must close held-open sockets promptly")
        test.assertTrue(outcome,"broker must report fail-closed stop/expiry")
        test.assertEqual(upstream.fileno(),-1,"upstream TCP socket must close")
        # Client never sends a PostgreSQL Terminate packet nor closes itself.
        # Drain any previously buffered data before checking the server-side EOF.
        test.assertEqual(client.recv(1),b"","held-open client must see server EOF")
        # The pooler side can legitimately have data buffered BEFORE the
        # forwarded TCP socket is closed. EOF must follow bounded draining.
        remaining=4096
        while remaining>0:
            got=pooler.recv(min(128,remaining))
            if not got:
                break
            remaining-=len(got)
        else:
            test.fail("upstream data did not reach EOF under bounded drain")
        return time.monotonic()-start,outcome[0]
    finally:
        stop.set()
        for s in (client,pooler,downstream,upstream):
            try:s.close()
            except OSError:pass
        worker.join(timeout=1)

class RealSockets(unittest.TestCase):
    def test_early_relock_stop_closes_original_frontend_and_upstream(self):
        elapsed,outcome=run_case(self,expiry_sec=4,stop_after=0.10)
        self.assertLess(elapsed,1.5)
        self.assertIn("SESSION_STOP_REQUESTED",outcome)
        print("GATEA_BROKER_EARLY_STOP_FRONTEND_AND_UPSTREAM_EOF_PASS",flush=True)
    def test_expiry_closes_held_open_connection_even_with_traffic(self):
        elapsed,outcome=run_case(self,expiry_sec=0.90,traffic=True)
        self.assertLess(elapsed,2.5)
        self.assertIn("SESSION_LEASE",outcome)
        print("GATEA_BROKER_HARD_EXPIRY_HELD_OPEN_FRONTEND_EOF_PASS",flush=True)
    def test_idle_lease_enforced_without_client_terminate(self):
        elapsed,outcome=run_case(self,expiry_sec=1.0)
        self.assertLess(elapsed,2.5)
        self.assertIn("SESSION_LEASE",outcome)
        print("GATEA_BROKER_IDLE_EXPIRY_SERVER_SIDE_EOF_PASS",flush=True)

if __name__=="__main__":unittest.main(verbosity=2)
