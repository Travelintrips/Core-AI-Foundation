#!/usr/bin/env python3
"""Offline tests for DEV Issue159 on-demand approval REQUEST refresh only."""
import copy
import concurrent.futures
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"deploy/ai-coding-standalone-dev"))
sys.path.insert(0,str(ROOT/"scripts/dev"))
import gpt02_issue159_approval_request_refresh as mod
from prepare_gpt02_issue159_approval_request import prepare

TASK=148
COMMAND="e40e1908-8b5e-4d36-8123-33ccfc9aa876"
ATTEMPT="8b24fdab-77d2-41fa-b966-989484868404"
NOW=1_800_000_500_000
ADMIN="fixture-gpt02-admin"

def facts(now=NOW, task=TASK, command=COMMAND, attempt=ATTEMPT, expiry=NOW+800_000):
    return {
      "prepared": {
        "companyId":"default", "hubTaskId":task,
        "commandCandidateId":command, "attemptId":attempt,
        "operatorSubject":ADMIN,"coreTaskId":"d9927cda-7881-4318-bba0-8584fab9e8d0",
        "hubExecutionId":"c5ef0b21-9107-47ab-8c8e-7afef0fcbfca",
        "expiresAt":expiry,
      },
      "job": {"taskId":task,"status":"prepared","dispatchStarted":False,
              "commandId":None,"workerCommandCount":0},
      "core":{"status":"PENDING","commandCount":0,"runCount":0,
              "commandCandidateId":command,"attemptId":attempt,
              "taskId":"d9927cda-7881-4318-bba0-8584fab9e8d0"},
      "hubOperator":{"subject":ADMIN,"role":"super_admin","active":True},
      "hubAssignment":{"actorId":ADMIN,"actorRole":"super_admin","actorActive":True},
      "observedAt":now,
      "trustedReadProof":{
        "source":"gpt02-issue159-presign-reader",
        "environment":"DEV",
        "hubRole":"gpt02_hub_evidence_reader",
        "coreRole":"gpt02_core_evidence_reader",
        "separateBackends":True,"clientTlsVerified":True,
        "readOnly":True,"signingPermitted":False,
        "authorizationGranted":False,"dispatchPermitted":False,
        "releaseDecision":"NO_GO",
      },
    }

class RefreshRequestTest(unittest.TestCase):
    def setUp(self):
        td=tempfile.TemporaryDirectory(prefix="issue159-refresh-")
        self.addCleanup(td.cleanup)
        self.root=Path(td.name)
        self.db=self.root/"fixture.sqlite"
        self.pending=self.root/"pending.json"
        con=sqlite3.connect(self.db)
        con.executescript("""
        CREATE TABLE admin_identities(
           user_id TEXT PRIMARY KEY,role TEXT NOT NULL, enabled INTEGER NOT NULL);
        CREATE TABLE gpt02_issue159_admin_operator_links(
           auth_user_id TEXT PRIMARY KEY,hub_operator_id TEXT NOT NULL,
           enabled INTEGER NOT NULL);
        CREATE TABLE gpt02_issue159_approval_intents(
           task_id INTEGER NOT NULL,command_id TEXT NOT NULL,attempt_id TEXT NOT NULL);
        INSERT INTO admin_identities VALUES('auth-fixture-admin','super_admin',1);
        INSERT INTO gpt02_issue159_admin_operator_links
          VALUES('auth-fixture-admin','fixture-gpt02-admin',1);
        """)
        con.commit();con.close()
        prepare(str(self.db),str(self.pending),TASK,COMMAND,ATTEMPT,
                now_ms=NOW-240_100,operational=False)
        self.original=json.loads(self.pending.read_text())["claims"]

    def refresh(self, evidence=None, now=NOW, actor=ADMIN):
        return mod.refresh_pending(str(self.db),str(self.pending),actor,
             fact_reader=lambda query: copy.deepcopy(evidence or facts(now=now)),
             now_fn=lambda:now, operational=False)

    def test_rotates_only_expired_nonce_on_same_preparation_without_approval(self):
        result=self.refresh()
        self.assertTrue(result["requestRefreshed"])
        self.assertTrue(result["previousRequestArchived"])
        self.assertEqual(result["releaseDecision"],"NO_GO")
        self.assertFalse(result["signingPermitted"])
        self.assertFalse(result["dispatchPermitted"])
        current=json.loads(self.pending.read_text())["claims"]
        for k in ("taskId","commandId","attemptId","companyId","superAdminId"):
            self.assertEqual(current[k],self.original[k])
        self.assertNotEqual(current["nonce"],self.original["nonce"])
        self.assertEqual(current["issuedAt"],NOW)
        self.assertEqual(current["expiresAt"],NOW+240_000)
        archives=list(self.root.glob("pending.json.expired-task148-*.json"))
        self.assertEqual(len(archives),1)
        self.assertEqual(json.loads(archives[0].read_text())["claims"],self.original)
        con=sqlite3.connect(self.db)
        self.assertEqual(con.execute("SELECT count(*) FROM gpt02_issue159_approval_intents").fetchone()[0],0)
        con.close()

    def test_two_concurrent_clicks_do_not_rotate_twice(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            result=list(pool.map(lambda _:self.refresh(), range(2)))
        self.assertEqual(sum(x["requestRefreshed"] is True for x in result),1)
        self.assertEqual(sum(x["alreadyFresh"] is True for x in result),1)
        self.assertEqual(len(list(self.root.glob("pending.json.expired-task148-*.json"))),1)

    def test_preparer_failure_restores_original_pending_request(self):
        original=self.pending.read_bytes()
        with patch.object(mod,"prepare",side_effect=RuntimeError("synthetic_preparer_failure")):
            with self.assertRaisesRegex(RuntimeError,"synthetic_preparer_failure"):
                self.refresh()
        self.assertEqual(self.pending.read_bytes(),original)
        self.assertFalse(list(self.root.glob("pending.json.expired-task148-*.json")))

    def test_fresh_request_idempotent_no_new_nonce(self):
        self.refresh()
        contents=self.pending.read_bytes()
        result=self.refresh(now=NOW+1000)
        self.assertTrue(result["alreadyFresh"])
        self.assertFalse(result["requestRefreshed"])
        self.assertEqual(self.pending.read_bytes(),contents)
        self.assertEqual(len(list(self.root.glob("pending.json.expired-task148-*.json"))),1)

    def test_prior_approval_blocks_nonce_refresh_even_if_expired(self):
        con=sqlite3.connect(self.db)
        con.execute("INSERT INTO gpt02_issue159_approval_intents VALUES(?,?,?)",
                    (TASK,COMMAND,ATTEMPT))
        con.commit();con.close()
        with self.assertRaisesRegex(mod.RefreshDenied,"ISSUE159_APPROVAL_ALREADY_RECORDED"):
            self.refresh()
        self.assertEqual(json.loads(self.pending.read_text())["claims"],self.original)

    def test_rejects_other_admin(self):
        with self.assertRaisesRegex(mod.RefreshDenied,"ISSUE159_APPROVAL_ACTOR_MISMATCH"):
            self.refresh(actor="other-admin")
        self.assertEqual(json.loads(self.pending.read_text())["claims"],self.original)

    def test_rejects_when_preparation_is_too_close_to_expiry(self):
        with self.assertRaisesRegex(mod.RefreshDenied,"ISSUE159_PREPARATION_NOT_FRESH_ENOUGH"):
            self.refresh(evidence=facts(expiry=NOW+240_100))
        self.assertEqual(self.pending.read_bytes(),
            json.dumps({"claims":self.original},sort_keys=True,separators=(",",":")).encode()+b"\n")

    def test_rejects_unverified_reader_proof(self):
        broken=facts()
        broken["trustedReadProof"]["clientTlsVerified"]=False
        with self.assertRaisesRegex(mod.RefreshDenied,"ISSUE159_PRESIGN_LINEAGE_MISMATCH"):
            self.refresh(evidence=broken)
        self.assertEqual(len(list(self.root.glob("pending.json.expired-task148-*.json"))),0)

    def test_rejects_different_core_or_command_or_actor(self):
        for field,value in [
            ("attemptId","00000000-0000-4000-8000-000000000001"),
            ("commandCandidateId","00000000-0000-4000-8000-000000000002"),
            ("operatorSubject","other-admin"),
        ]:
            with self.subTest(field=field):
                broken=facts()
                broken["prepared"][field]=value
                with self.assertRaisesRegex(mod.RefreshDenied,"ISSUE159_PRESIGN_LINEAGE_MISMATCH"):
                    self.refresh(evidence=broken)

    def test_rejects_job_with_started_dispatch(self):
        bad=facts();bad["job"]["dispatchStarted"]=True
        with self.assertRaisesRegex(mod.RefreshDenied,"ISSUE159_PRESIGN_LINEAGE_MISMATCH"):
            self.refresh(evidence=bad)

    def test_rejects_reader_observation_clock_skew(self):
        bad=facts();bad["observedAt"]=NOW-60_000
        with self.assertRaisesRegex(mod.RefreshDenied,"ISSUE159_PRESIGN_LINEAGE_MISMATCH"):
            self.refresh(evidence=bad)

    def test_rejects_live_unpinned_target_without_mutation(self):
        with self.assertRaisesRegex(mod.RefreshDenied,"ISSUE159_REFRESH_TARGET_NOT_PINNED"):
            mod.refresh_pending(str(self.db),str(self.pending),ADMIN,
                                fact_reader=lambda q:facts(),operational=True)

    def test_missing_pending_does_not_create_fake_task(self):
        self.pending.unlink()
        with self.assertRaisesRegex(mod.RefreshDenied,"ISSUE159_TEST_SOURCE_MISSING"):
            self.refresh()
        self.assertFalse(self.pending.exists())

if __name__=="__main__":
    unittest.main()
