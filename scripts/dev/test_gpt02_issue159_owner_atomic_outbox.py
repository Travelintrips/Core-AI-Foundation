#!/usr/bin/env python3
"""Atomic single-human Owner consent + immutable SQLite outbox regression.

Networkless, synthetic Owner identity, memory-only SQLite. Never connects to
real CST-DEV SQLite, PostgreSQL, login, signer, issuer, worker or DELL.
"""
from __future__ import annotations
import sqlite3
import unittest
from pathlib import Path
from gpt02_issue159_approval_intent import record_issue159_approval_intent

ROOT=Path(__file__).resolve().parents[2]
SCHEMA=ROOT/"deploy/ai-coding-standalone-dev/gpt02_issue159_approval_intent_schema.sql"
CLAIMS={
  "v":2, "environment":"DEV","audience":"GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
  "taskId":183,
  "commandId":"11111111-1111-4111-8111-111111111111",
  "attemptId":"22222222-2222-4222-8222-222222222222",
  "nonce":"A"*44,"operatorNamespace":"ai-task-hub.public.users",
  "superAdminId":"synthetic_owner_183", "companyId":"default",
  "issuedAt":1000,"expiresAt":101000,
}
TOKEN="synthetic_only_private_test_session_"+"T"*45

def trusted(_token, _db):
    return {
       "userId":CLAIMS["superAdminId"],
       "role":"super_admin","enabled":True,
       "authMethod":"supabase_admin_session",
    }

class AtomicOwnerOutboxTest(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(":memory:",isolation_level="DEFERRED")
        self.addCleanup(self.db.close)
        self.db.executescript(SCHEMA.read_text())
        self.db.commit()
    def record(self, **overrides):
        return record_issue159_approval_intent(
            TOKEN,self.db,{**CLAIMS,**overrides},identity_verifier=trusted,
            now_ms=2000,
        )
    def n(self,table):
        return self.db.execute("SELECT COUNT(*) FROM "+table).fetchone()[0]
    def test_existing_dev_auto_chain_readiness_gate_denies_without_any_owner_row(self):
        for gate in (
            lambda _record: False,
            lambda _record: None,
            lambda _record: 1,
            lambda _record: (_ for _ in ()).throw(
                RuntimeError("SYNTHETIC_NOT_READY")
            ),
            "NOT_A_CALLABLE",
        ):
            with self.subTest(gate=repr(gate)):
                result=record_issue159_approval_intent(
                    TOKEN,self.db,CLAIMS,identity_verifier=trusted,
                    now_ms=2000,readiness_gate=gate,
                )
                self.assertFalse(result["ok"])
                self.assertEqual(result["reason"],"AUTO_CHAIN_PREREQUISITES_NOT_READY")
                self.assertEqual(self.n("gpt02_issue159_approval_intents"),0)
                self.assertEqual(self.n("gpt02_issue159_owner_approval_outbox"),0)

    def test_existing_readiness_gate_true_allows_same_atomic_owner_outbox(self):
        observed=[]
        def ready(record):
            observed.append((record["task_id"],record["company_id"]))
            return True
        result=record_issue159_approval_intent(
            TOKEN,self.db,CLAIMS,identity_verifier=trusted,
            now_ms=2000,readiness_gate=ready,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(observed,[(183,"default")])
        self.assertEqual(self.n("gpt02_issue159_approval_intents"),1)
        self.assertEqual(self.n("gpt02_issue159_owner_approval_outbox"),1)
        self.assertFalse(result["authorizationGranted"])

    def test_one_genuine_owner_consent_commits_same_decision_to_immutable_outbox(self):
        res=self.record()
        self.assertTrue(res["ok"],res)
        self.assertTrue(res["intentRecorded"])
        self.assertFalse(res["authorizationGranted"])
        self.assertEqual(res["releaseDecision"],"NO_GO")
        self.assertEqual(self.n("gpt02_issue159_approval_intents"),1)
        self.assertEqual(self.n("gpt02_issue159_owner_approval_outbox"),1)
        self.assertEqual(self.n("gpt02_issue159_owner_bridge_receipts"),0)
        src=self.db.execute("""SELECT id,task_id,company_id,command_id,attempt_id,
          claims_sha256,actor_id,auth_method,role_at_decision,
          recorded_at_ms,expires_at_ms
          FROM gpt02_issue159_approval_intents""").fetchone()
        mirror=self.db.execute("""SELECT decision_id,task_id,company_id,
          command_id,attempt_id,claims_sha256,actor_id,auth_method,
          role_at_decision,recorded_at_ms,expires_at_ms
          FROM gpt02_issue159_owner_approval_outbox""").fetchone()
        self.assertEqual(src,mirror)
        self.assertEqual(mirror[1],183)
        self.assertEqual(res["intentId"],mirror[0])

    def test_replay_is_denied_without_second_consent_or_outbox(self):
        self.assertTrue(self.record()["ok"])
        rejected=self.record()
        self.assertFalse(rejected["ok"])
        self.assertEqual(rejected["reason"],"APPROVAL_INTENT_REPLAY_OR_CONFLICT")
        self.assertEqual(self.n("gpt02_issue159_owner_approval_outbox"),1)
        self.assertEqual(self.n("gpt02_issue159_owner_bridge_receipts"),0)

    def test_missing_outbox_schema_rolls_back_original_consent(self):
        self.db.executescript("DROP TRIGGER gpt02_issue159_owner_outbox_no_update;"
            "DROP TRIGGER gpt02_issue159_owner_outbox_no_delete;"
            "DROP TABLE gpt02_issue159_owner_approval_outbox;")
        denied=self.record()
        self.assertFalse(denied["ok"])
        self.assertEqual(denied["reason"],"APPROVAL_INTENT_WRITE_FAILED")
        self.assertEqual(self.n("gpt02_issue159_approval_intents"),0)

    def test_outbox_insert_failure_rolls_back_original_consent(self):
        self.db.executescript("""CREATE TRIGGER synthetic_fail_owner_outbox
            BEFORE INSERT ON gpt02_issue159_owner_approval_outbox
            BEGIN SELECT RAISE(ABORT,'SYNTHETIC_DB_CRASH'); END;""")
        denied=self.record()
        self.assertFalse(denied["ok"])
        self.assertEqual(denied["reason"],"APPROVAL_INTENT_WRITE_FAILED")
        self.assertEqual(self.n("gpt02_issue159_approval_intents"),0)
        self.assertEqual(self.n("gpt02_issue159_owner_approval_outbox"),0)

    def test_outbox_cannot_change_or_delete_original_owner_evidence(self):
        self.assertTrue(self.record()["ok"])
        for sql in (
            "UPDATE gpt02_issue159_owner_approval_outbox SET task_id=184",
            "DELETE FROM gpt02_issue159_owner_approval_outbox",
        ):
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(sql)
            self.db.rollback()
        self.assertEqual(self.n("gpt02_issue159_owner_approval_outbox"),1)

    def test_only_separately_verified_mirror_receipt_may_be_recorded(self):
        result=self.record()
        self.assertTrue(result["ok"])
        # The approval writer itself NEVER inserts a false PostgreSQL ACK.
        self.assertEqual(self.n("gpt02_issue159_owner_bridge_receipts"),0)
        self.db.execute("""INSERT INTO gpt02_issue159_owner_bridge_receipts
          (decision_id,scope_sha256,packet_sha256,verified_at_ms)
          VALUES (?,?,?,?)""",(result["intentId"],"a"*64,"b"*64,2100))
        self.db.commit()
        for sql in (
            "UPDATE gpt02_issue159_owner_bridge_receipts SET scope_sha256='"+
            "c"*64+"'",
            "DELETE FROM gpt02_issue159_owner_bridge_receipts",
        ):
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(sql)
            self.db.rollback()
        self.assertEqual(self.n("gpt02_issue159_owner_bridge_receipts"),1)

    def test_invalid_owner_identity_or_claims_never_enter_outbox(self):
        invalid=record_issue159_approval_intent(
            TOKEN,self.db,CLAIMS,
            identity_verifier=lambda *_:{"userId":CLAIMS["superAdminId"],
              "role":"admin","enabled":True,
              "authMethod":"supabase_admin_session"},now_ms=2000)
        self.assertFalse(invalid["ok"])
        self.assertEqual(self.n("gpt02_issue159_owner_approval_outbox"),0)
        self.assertFalse(self.record(environment="PROD")["ok"])
        self.assertEqual(self.n("gpt02_issue159_approval_intents"),0)

    def test_outbox_cannot_reuse_decision_for_second_task_or_digest(self):
        res=self.record()
        self.assertTrue(res["ok"])
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO gpt02_issue159_owner_approval_outbox
                (decision_id,task_id,company_id,command_id,attempt_id,
                 claims_sha256,actor_id,auth_method,role_at_decision,
                 recorded_at_ms,expires_at_ms)
                SELECT decision_id,184,company_id,command_id,attempt_id,
                       claims_sha256,actor_id,auth_method,role_at_decision,
                       recorded_at_ms,expires_at_ms
                FROM gpt02_issue159_owner_approval_outbox""")
        self.db.rollback()
        self.assertEqual(self.n("gpt02_issue159_owner_approval_outbox"),1)

if __name__=="__main__":
    unittest.main()
