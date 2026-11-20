#!/usr/bin/env python3
"""Genuine-source review -> native PostgreSQL fence bridge: fail-closed tests.

No real Owner consent, SQL credentials, database writes, signing or DELL.
The original signed-source reader and four-signature verifier are tested
separately against their native persisted fixtures; these cases test exactly
the resulting SQL write/atomic rollback/replay boundary.
"""
from __future__ import annotations
from types import SimpleNamespace
from unittest.mock import patch
import unittest
from pathlib import Path
import gpt02_issue159_owner_pg_bridge as bridge
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError

DECISION="22222222-2222-4222-8222-222222222223"
COMMAND="11111111-1111-4111-8111-111111111111"
ATTEMPT="33333333-3333-4333-8333-333333333333"
REVIEW={
 "environment":"DEV","stage":"SIGNED_PERSISTED_OWNER_SOURCE_REVIEW_ONLY",
 "sourceDecisionId":DECISION,"claimsSha256":"a"*64,
 "ownerActorId":"synthetic_owner_183","authMethod":"supabase_admin_session",
 "roleAtDecision":"super_admin","companyId":"default","taskId":183,
 "commandId":COMMAND,"attemptId":ATTEMPT,
 "recordedAtMs":30000,"expiresAtMs":80000,
 "outboxVerifiedInSQLite":True,"signatureVerifiedByOriginalRoot":True,
 "postgresFenceWritten":False,"credentialIssuancePermitted":False,
 "authorizationGranted":False,"dispatchPermitted":False,"releaseDecision":"NO_GO",
}
CANDIDATE={
 "scope":{"task_id":183,"company_id":"default","command_id":COMMAND,
          "attempt_id":ATTEMPT,"approval_digest":"a"*64},
 "scopeSha256":"b"*64,"verifiedPacketSha256":"c"*64,
 "releaseDecision":"NO_GO","credentialIssuancePermitted":False,
 "databaseRoleProvisioned":False,
}
PACKET={k:{"claims":{},"signature":"synthetic_only"} for k in
        ("approval","hubLink","coreLink","issuerEvidence")}

class Native:
 def __init__(self, *, stage="source"):
  self.info=SimpleNamespace(
   user=bridge.USER,host=bridge.HOST,port=5432,dbname="postgres",
   get_parameters=lambda:{
     "sslmode":"verify-full",
     "sslrootcert":"/etc/gpt02-dev/supabase-root-ca-2021.crt",
   },
  )
  self.autocommit=False
  self.stage=stage
  self.writes=[]
  self.commits=0
  self.rollbacks=0
  self.payload=None
  self.mutate={}
  self.fail_at=None
  self.description=None
  self.current_rows=None

 def cursor(self):return self
 def __enter__(self):return self
 def __exit__(self,*args):return False
 def execute(self,sql,params=None):
  self.writes.append((sql,params))
  if self.fail_at and self.fail_at in sql:
   raise RuntimeError("SYNTHETIC_COMMIT_OR_TXN_FAILURE")
  if params is not None:self.payload=params
  if sql==bridge.SOURCE_READ:
   keys=bridge.SRC_FIELDS+("active","fresh")
   row={k:self.payload[k] for k in bridge.SRC_FIELDS}
   row.update(active=True,fresh=True)
  elif sql==bridge.LINK_READ:
   keys=bridge.LINK_FIELDS+(
     "claims_sha256","task_id","command_id","attempt_id",
     "source_active","fence_active","source_fresh",
   )
   row={k:self.payload[k] for k in keys if k in self.payload}
   row.update(source_active=True,fence_active=True,source_fresh=True)
  else:return
  row.update(self.mutate)
  self.description=[SimpleNamespace(name=k) for k in keys]
  self.current_rows=[tuple(row[k] for k in keys)]
 def fetchmany(self,n):
  if n!=2:raise AssertionError("READBACK_NOT_BOUNDED")
  return self.current_rows
 def commit(self):self.commits+=1
 def rollback(self):self.rollbacks+=1

class OwnerBridgeTest(unittest.TestCase):
 def setUp(self):
  self.ca=patch("gpt02_issue159_pinned_tls_ca._public_ca_fingerprint_matches",
                return_value=True)
  self.ca.start()
  self.addCleanup(self.ca.stop)
  self.source=patch.object(bridge,"review_owner_source_from_existing_service",
                           return_value=dict(REVIEW))
  self.relay=self.source.start()
  self.addCleanup(self.source.stop)
  self.pg=Native()

 def stage1(self):
  return bridge.import_existing_owner_decision(PACKET["approval"],self.pg)

 def stage2(self):
  self.pg=Native(stage="link")
  with (
   patch.object(bridge,"_load_public_roots",return_value={
     "approval":"fixture_a","hub":"fixture_b",
     "core":"fixture_c","issuer":"fixture_i",
   }) as root,
   patch.object(bridge,"inspect_postlineage_scoped_reader_candidate",
                return_value=dict(CANDIDATE)) as verified,
  ):
   result=bridge.bind_existing_issuer_packet(PACKET,self.pg)
  root.assert_called_once_with(bridge.VERIFIER_PUBLIC_ROOT_DIR,
                               bridge.DEFAULT_FINGERPRINT_MANIFEST)
  verified.assert_called_once()
  return result

 def test_one_existing_signed_decision_imports_exactly_to_native_postgres(self):
  out=self.stage1()
  self.assertEqual(out["sourceDecisionId"],DECISION)
  self.assertEqual(out["taskId"],183)
  self.assertFalse(out["authorizationGranted"])
  self.assertFalse(out["dispatchPermitted"])
  self.assertEqual(out["releaseDecision"],"NO_GO")
  self.assertEqual(self.pg.commits,1)
  self.assertEqual(self.pg.rollbacks,0)
  self.assertEqual(sum(bridge.SOURCE_INSERT in x for x,_ in self.pg.writes),1)
  self.relay.assert_called_once_with(PACKET["approval"])

 def test_original_postissuer_packet_can_bind_one_original_source(self):
  self.stage1()
  link=self.stage2()
  self.assertTrue(link["postgresFenceReadbackMatched"])
  self.assertEqual(link["sourceDecisionId"],DECISION)
  self.assertEqual(link["scopeSha256"],"b"*64)
  self.assertEqual(link["packetSha256"],"c"*64)
  self.assertFalse(link["credentialIssuancePermitted"])
  self.assertFalse(link["authorizationGranted"])
  self.assertEqual(self.pg.commits,1)
  self.assertIn("ON CONFLICT DO NOTHING",bridge.LINK_INSERT)

 def test_a_mismatched_original_owner_source_is_rejected_without_sql(self):
  self.relay.return_value={**REVIEW,"outboxVerifiedInSQLite":False}
  with self.assertRaisesRegex(BrokerAdmissionError,"ORIGINAL_SQLITE_SOURCE_NOT_PROVEN"):
   self.stage1()
  self.assertEqual(self.pg.writes,[])

 def test_wrong_admin_role_or_tls_denies_prior_to_any_sql_write(self):
  for attr,value in (
   ("user","authenticated"),("dbname","another"),("host","localhost"),
   ("port",6543),("autocommit",True),
  ):
   with self.subTest(attr=attr):
    self.pg=Native()
    obj=self.pg if attr=="autocommit" else self.pg.info
    setattr(obj,attr,value)
    with self.assertRaisesRegex(BrokerAdmissionError,"PINNED_POSTGRES_SESSION_REQUIRED"):
     self.stage1()
    self.assertEqual(self.pg.writes,[])
  self.pg=Native()
  self.pg.info.get_parameters=lambda:{"sslmode":"require"}
  with self.assertRaisesRegex(BrokerAdmissionError,"TLS_VERIFY_FULL_REQUIRED"):
   self.stage1()
  self.assertEqual(self.pg.writes,[])

 def test_failed_fence_readback_rolls_back_before_db_commit(self):
  self.pg.mutate={"claims_sha256":"f"*64}
  with self.assertRaisesRegex(BrokerAdmissionError,"NATIVE_DATABASE_BINDING_MISMATCH"):
   self.stage1()
  self.assertEqual(self.pg.commits,0)
  self.assertEqual(self.pg.rollbacks,1)

 def test_expired_or_revoked_source_before_commit_rolls_back(self):
  for name in ("fresh","active"):
   self.pg=Native()
   self.pg.mutate={name:False}
   with self.assertRaisesRegex(BrokerAdmissionError,"NATIVE_DATABASE_BINDING_MISMATCH"):
    self.stage1()
   self.assertEqual(self.pg.commits,0)
   self.assertEqual(self.pg.rollbacks,1)

 def test_uncertain_native_write_is_not_faked_as_success(self):
  self.pg.fail_at="INSERT INTO"
  with self.assertRaisesRegex(RuntimeError,"SYNTHETIC_COMMIT_OR_TXN_FAILURE"):
   self.stage1()
  self.assertEqual(self.pg.commits,0)
  self.assertEqual(self.pg.rollbacks,1)

 def test_invalid_packet_or_cross_task_issuer_never_links(self):
  with self.assertRaisesRegex(BrokerAdmissionError,"FOUR_SIGNED_PACKET_REQUIRED"):
   bridge.bind_existing_issuer_packet({},self.pg)
  forged=dict(CANDIDATE)
  forged["scope"]={**CANDIDATE["scope"],"task_id":184}
  with patch.object(bridge,"_load_public_roots",return_value={}),patch.object(
    bridge,"inspect_postlineage_scoped_reader_candidate",return_value=forged):
   with self.assertRaisesRegex(BrokerAdmissionError,"FOUR_SIGNATURE_SOURCE_SCOPE_MISMATCH"):
    bridge.bind_existing_issuer_packet(PACKET,self.pg)
  self.assertEqual(self.pg.writes,[])

 def test_revoke_after_source_import_prevents_subsequent_link_commit(self):
  self.pg=Native(stage="link")
  self.pg.mutate={"source_active":False}
  with patch.object(bridge,"_load_public_roots",return_value={}),patch.object(
    bridge,"inspect_postlineage_scoped_reader_candidate",return_value=CANDIDATE):
   with self.assertRaisesRegex(BrokerAdmissionError,"NATIVE_DATABASE_BINDING_MISMATCH"):
    bridge.bind_existing_issuer_packet(PACKET,self.pg)
  self.assertEqual(self.pg.commits,0)
  self.assertEqual(self.pg.rollbacks,1)

 def test_no_rewrite_of_owner_intent_or_original_pg_approval_gate(self):
  src=(Path(__file__).resolve().parents[2]/
      "deploy/ai-coding-standalone-dev/gpt02_issue159_owner_pg_bridge.py"
      ).read_text()
  for forbidden in (
   "ALTER ROLE ","CREATE ROLE ","UPDATE gpt02_issue159_approval_intents",
   "DELETE FROM ","pg_notify(","dispatch_worker","Ed25519PrivateKey",
   "psycopg.connect(","SQLite.connect(","def sign_",
  ):
   self.assertNotIn(forbidden,src)
  self.assertIn("review_owner_source_from_existing_service",src)
  self.assertIn("inspect_postlineage_scoped_reader_candidate",src)
  self.assertIn("OWNER_PG_BRIDGE_SOURCE_ONLY_NOT_MOUNTED",src)

if __name__=="__main__":
 unittest.main()
