#!/usr/bin/env python3
"""DISPOSABLE ONLY: connect real Gate A watchdog runner to synthetic Docker PG17.

No real Supabase host, passwords, signing, stage privileges, or production.
The runner policy and function are imported unchanged; connection is injected
for a synthetic trust-auth PostgreSQL on private Docker bridge.
"""
from __future__ import annotations

import ipaddress
import signal
import sys
import threading

from cst_onejob_stage_watchdog_runner import run_loop

WATCHER="cst_gatea_watchdog_relock"
FIXED_SHA="b"*40

def main():
    import os
    if os.environ.get("CST_GATEA_DISPOSABLE_PG17_QA")!="1":
        raise SystemExit("QA_EXPLICIT_SYNTHETIC_ENV_REQUIRED")
    if len(sys.argv)!=2:
        raise SystemExit("QA_EXPECTED_PRIVATE_PG_IP")
    host=sys.argv[1]
    addr=ipaddress.ip_address(host)
    if addr.version!=4 or not addr.is_private or addr.is_loopback:
        raise SystemExit("QA_REQUIRES_PRIVATE_DOCKER_PG_ONLY")
    import psycopg
    stop=threading.Event()
    signal.signal(signal.SIGTERM,lambda *_:stop.set())
    signal.signal(signal.SIGINT,lambda *_:stop.set())
    def connect(_unused_dsn,_unused_ca):
        # Trust is confined to the isolated disposable PostgreSQL instance.
        # No input URL or password; production runner's connection remains pinned.
        return psycopg.connect(host=host,port=5432,dbname="postgres",
          user=WATCHER,sslmode="disable",connect_timeout=3,autocommit=True,
          application_name="cst-gatea-disposable-runner")
    run_loop(FIXED_SHA,"DISPOSABLE_PG17_ONLY","NO_REAL_CA",connect=connect,stop=stop)

if __name__=="__main__":
    try:main()
    except Exception:
        print("CST_GATEA_DISPOSABLE_RUNNER_FAILED_CLOSED",flush=True)
        raise SystemExit(2)