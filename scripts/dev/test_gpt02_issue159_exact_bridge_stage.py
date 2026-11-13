#!/usr/bin/env python3
"""Synthetic tests for proposed held bridge staging, not worker delivery."""
from __future__ import annotations
import os
from pathlib import Path
import unittest
from unittest.mock import patch

import gpt02_issue159_exact_bridge_stage as stage
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError

COMMAND="10000000-0000-4000-8000-000000000001"
ATTEMPT="20000000-0000-4000-8000-000000000002"
CORE="50000000-0000-4000-8000-000000000005"
SHA="a"*64
SIGNED={
    "coreLink":{"claims":{
        "coreTaskId":CORE,"coreCommandId":COMMAND,"attemptId":ATTEMPT,
    }},
}


class FakeConnection:
    def __init__(self,role=stage.STAGING_ROLE,returned=True,raise_on_insert=False):
        self.role=role
        self.returned=returned
        self.raise_on_insert=raise_on_insert
        self.events=[]
        self.last=None
        self.depth=0

    def transaction(self):
        return self

    def cursor(self):
        return self

    def __enter__(self):
        self.depth+=1
        if self.depth==1:self.events.append("BEGIN")
        return self

    def __exit__(self,typ,error,tb):
        if self.depth==1:self.events.append("ROLLBACK" if typ else "COMMIT")
        self.depth-=1
        return False

    def execute(self,query,args=None):
        if query==stage.ROLE_SQL:
            self.events.append("ROLE")
            self.last=(self.role,self.role)
        elif query==stage.HELD_BRIDGE_INSERT_SQL:
            self.events.append(("STAGE_HELD",args))
            if self.raise_on_insert:
                raise RuntimeError("SYNTHETIC_UNIQUE_CONFLICT")
            self.last=(COMMAND,CORE,"ai-core","gpt02-issue159:"+COMMAND,
                       "ISSUE159_HELD","RECEIVED",None) if self.returned else None
        else:
            raise AssertionError("UNEXPECTED_SQL")

    def fetchone(self):
        return self.last


class HeldBridgeStageTest(unittest.TestCase):
    def setUp(self):
        self.connection=FakeConnection()
        self.proof={
            "commandId":COMMAND,"attemptId":ATTEMPT,"packetSha":SHA,
        }
        self.addCleanup(patch.stopall)
        patch.object(stage,"_make_verified_request",return_value=self.proof).start()
        patch.dict(os.environ,{"APP_ENV":"development",
                               "GPT02_ISSUE159_HELD_STAGE_ENABLED":"true"}).start()

    def test_original_uuid_is_staged_unassigned_not_sent(self):
        out=stage.stage_exact_held_bridge_command(SIGNED,self.connection)
        self.assertEqual(out["commandId"],COMMAND)
        self.assertEqual(out["stage"],"BRIDGE_COMMAND_STORED_BUT_HELD")
        self.assertTrue(out["durableCommandStored"])
        for key in ("commandIdReplaced","workerNotified","workerClaimAuthorized",
                    "dispatchPermitted","finalAckVerified"):
            self.assertFalse(out[key])
        self.assertEqual(out["releaseDecision"],"NO_GO")
        self.assertEqual(self.connection.events[:2],["BEGIN","ROLE"])
        self.assertEqual(self.connection.events[-1],"COMMIT")
        self.assertEqual(self.connection.events[2],("STAGE_HELD",(COMMAND,SHA)))

    def test_env_off_denied_before_db_or_packet_verification(self):
        with patch.dict(os.environ,{"GPT02_ISSUE159_HELD_STAGE_ENABLED":"false"}):
            with patch.object(stage,"_make_verified_request") as verifier:
                with self.assertRaisesRegex(BrokerAdmissionError,"HELD_STAGE_DISABLED"):
                    stage.stage_exact_held_bridge_command(SIGNED,self.connection)
                verifier.assert_not_called()
        self.assertEqual(self.connection.events,[])

    def test_wrong_role_denied_before_insert(self):
        for role in ("postgres","service_role","dev_gpt02_release_writer",
                     "dev_gpt02_bridge_stage_writer"):
            with self.subTest(role=role):
                db=FakeConnection(role=role)
                with self.assertRaisesRegex(BrokerAdmissionError,
                                            "EXCLUSIVE_BRIDGE_STAGE_ROLE_REQUIRED"):
                    stage.stage_exact_held_bridge_command(SIGNED,db)
                self.assertEqual(db.events,["BEGIN","ROLE","ROLLBACK"])

    def test_missing_approved_packet_denied_before_db(self):
        with patch.object(stage,"_make_verified_request",
                          side_effect=BrokerAdmissionError("NO_TRUSTED_OWNER_APPROVAL")):
            with self.assertRaises(BrokerAdmissionError):
                stage.stage_exact_held_bridge_command(SIGNED,self.connection)
        self.assertEqual(self.connection.events,[])

    def test_signed_link_command_or_attempt_mismatch_denied(self):
        for key,value in (("coreCommandId",CORE),("attemptId",CORE)):
            with self.subTest(key=key):
                p={"coreLink":{"claims":dict(SIGNED["coreLink"]["claims"])}}
                p["coreLink"]["claims"][key]=value
                with self.assertRaisesRegex(BrokerAdmissionError,
                                            "VERIFIED_CORE_COMMAND_BINDING_REQUIRED"):
                    stage.stage_exact_held_bridge_command(p,self.connection)
                self.assertEqual(self.connection.events,[])

    def test_conflict_requires_reconciliation_not_renotify(self):
        db=FakeConnection(returned=False)
        with self.assertRaisesRegex(BrokerAdmissionError,
                                    "HELD_BRIDGE_INSERT_COLLISION_OR_EXPIRED"):
            stage.stage_exact_held_bridge_command(SIGNED,db)
        self.assertEqual(db.events[-1],"ROLLBACK")

    def test_db_error_rollback(self):
        db=FakeConnection(raise_on_insert=True)
        with self.assertRaises(RuntimeError):
            stage.stage_exact_held_bridge_command(SIGNED,db)
        self.assertEqual(db.events[-1],"ROLLBACK")

    def test_sql_uses_immutable_consumed_outbox_and_original_uuid(self):
        sql=stage.HELD_BRIDGE_INSERT_SQL.lower()
        self.assertIn("insert into ai_platform.ai_coding_bridge_commands",sql)
        self.assertIn("select o.command_id,o.core_task_id",sql)
        self.assertIn("positive_dispatch_consumptions",sql)
        self.assertIn("positive_dispatch_outbox",sql)
        self.assertIn("positive_dispatch_permits",sql)
        self.assertIn("join ai_platform.ai_coding_tasks",sql)
        self.assertIn("'issue159_held'",sql)
        self.assertIn("'held_no_dispatch'",sql)
        self.assertIn("not exists",sql)
        self.assertIn("returning id::text",sql)
        self.assertNotIn("'assignedclientid'",sql)
        self.assertNotIn("notify",sql)
        self.assertNotIn("on conflict do update",sql)

    def test_no_live_worker_or_db_connection_creation(self):
        src=(Path(__file__).resolve().parents[2]
             / "deploy/ai-coding-standalone-dev/gpt02_issue159_exact_bridge_stage.py"
            ).read_text()
        for marker in ("psycopg.connect","sqlite3.connect","requests.post",
                       "dispatchExternalAgentWork(","notifyExternalAgentWork(",
                       "worker.send(", "subprocess.run"):
            with self.subTest(marker=marker):
                self.assertNotIn(marker,src)


if __name__=="__main__":
    unittest.main()
