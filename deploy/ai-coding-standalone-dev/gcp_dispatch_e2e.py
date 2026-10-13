"""DEV-only authenticated-dispatch integration test; does not alter PROD."""
import json
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, "/opt/ai-coding-standalone-dev")
import approval_api

TEST_PRINCIPAL = "4c3c1a80-b6a3-4b29-81f8-56a24f006421"
approval_api.Handler.principal = lambda self: TEST_PRINCIPAL if self.headers.get("Authorization") == "Bearer e2e-gcp-controller" else None
server = ThreadingHTTPServer(("127.0.0.1", 18189), approval_api.Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()

try:
    body = {
        "kind": "coding_test",
        "repository": "Travelintrips/Core-AI-Foundation",
        "ref": "develop",
        "filename": "ai-coding-sandbox/solution.py",
        "source": "def add(a,b):\n return a+b\n",
        "tests": "import unittest\nfrom solution import add\nclass TestMath(unittest.TestCase):\n def test_add(self):\n  self.assertEqual(add(2,3),5)\n",
        "requires_ollama": True,
    }
    req = urllib.request.Request(
        "http://127.0.0.1:18189/api/jobs",
        data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer e2e-gcp-controller", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        assert response.status == 201
        result = json.load(response)
    job_id = result["job_id"]
    print("DEV_JOB_ID", job_id, flush=True)

    for i in range(90):
        with sqlite3.connect(approval_api.DB) as connection:
            row = connection.execute(
                "SELECT status,checkpoint FROM jobs WHERE id=?", (job_id,)
            ).fetchone()
        if row and row[0] in ("WAITING_APPROVAL", "FAILED"):
            break
        time.sleep(2)
    assert row, "Job missing from durable DB"
    print("DEV_JOB_STATUS", row[0], flush=True)
    if row[0] == "FAILED":
        raise RuntimeError("DEV GCP dispatch failed: " + str(row[1])[:300])
    evidence = json.loads(row[1])
    assert evidence["passed"] is True
    assert evidence["gcp_controller"]["gcp_start"] in ("requested", "already_active")
    print("DEV_GCP_CONTROLLER", json.dumps(evidence["gcp_controller"]), flush=True)
    print("PASS DEV job dispatch -> GCP controller -> sandbox test", flush=True)
finally:
    server.shutdown()
