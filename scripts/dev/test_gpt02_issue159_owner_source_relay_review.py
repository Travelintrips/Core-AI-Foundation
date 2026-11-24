#!/usr/bin/env python3
"""Genuine approval-signature + existing SQLite immutable outbox review tests.

Uses isolated four-key ephemeral fixture from ORIGINAL existing verifier.
No credentials, real Owner consent, DB connection or deployment.
"""
from __future__ import annotations
import copy
from pathlib import Path
import unittest
from unittest.mock import Mock,patch

import gpt02_issue159_owner_source_relay_review as relay
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError
from test_gpt02_issue159_postlineage_reader_scope import PostlineageReaderScopeOfflineTest

class SourceBridgeReviewTest(unittest.TestCase):
    def setUp(self):
        base=PostlineageReaderScopeOfflineTest()
        base.setUp()
        self.packet=copy.deepcopy(base.fixture.packet)
        # Legacy four-root fixture originated at Task140. Source import
        # deliberately rejects those historical tasks; resign only the
        # synthetic approval to represent the new Task183 namespace.
        self.packet["approval"]["claims"]["taskId"]=183
        base.fixture._resign_valid_packet(self.packet)
        self.roots=base.fixture.roots
        self.now=base.fixture.now
        self.claims=self.packet["approval"]["claims"]
        self.decision={
            "decisionId":"22222222-2222-4222-8222-222222222223",
            "claimsSha256":"",
            "actorId":self.claims["superAdminId"],
            "roleAtDecision":"super_admin",
            "authMethod":"supabase_admin_session",
            "decision":"APPROVE",
            "recordedAt":self.claims["issuedAt"]+1,
            "expiresAt":self.claims["expiresAt"],
        }
        from gpt02_issue159_writer_broker_contract import (
            _verify,APPROVAL_FIELDS,
        )
        self.decision["claimsSha256"]=_verify(
            "approval",self.claims,self.packet["approval"]["signature"],
            self.roots["approval"],APPROVAL_FIELDS,
        )
        self.reader=Mock(side_effect=self.signed_read)
    def signed_read(self,lookup,observed):
        self.assertEqual(lookup["claimsSha256"],self.decision["claimsSha256"])
        self.assertEqual(lookup["taskId"],self.claims["taskId"])
        self.assertEqual(lookup["commandId"],self.claims["commandId"])
        self.assertEqual(lookup["attemptId"],self.claims["attemptId"])
        self.assertEqual(lookup["superAdminId"],self.claims["superAdminId"])
        self.assertEqual(observed,self.now)
        return (200,{
            "ok":True,"environment":"DEV","approvalReadOnly":True,
            "decisionCreated":False,"releaseDecision":"NO_GO",
            "signingPermitted":False,"authorizationGranted":False,
            "dispatchPermitted":False,
            "result":{
                "sourceOutboxMatched":True,
                "persistedTrustedReadProven":True,
                "approvalBindingMatched":True,
                "adminApprovalMatched":True,
                "decision":dict(self.decision),
                "releaseDecision":"NO_GO",
            },
        })
    def review(self,packet=None,roots=None,now=None,reader=None):
        return relay.review_signed_owner_source(
            (packet or self.packet)["approval"],
            pinned_public_roots=roots or self.roots,
            observed_ms=self.now if now is None else now,
            read_owner_outbox=reader or self.reader,
        )
    def test_real_ephemeral_original_signature_and_exact_sqlite_outbox_pass(self):
        out=self.review()
        self.reader.assert_called_once()
        self.assertEqual(out["sourceDecisionId"],self.decision["decisionId"])
        self.assertEqual(out["claimsSha256"],self.decision["claimsSha256"])
        self.assertTrue(out["outboxVerifiedInSQLite"])
        self.assertTrue(out["signatureVerifiedByOriginalRoot"])
        self.assertFalse(out["postgresFenceWritten"])
        self.assertFalse(out["credentialIssuancePermitted"])
        self.assertFalse(out["authorizationGranted"])
        self.assertFalse(out["dispatchPermitted"])
        self.assertEqual(out["releaseDecision"],"NO_GO")
    def test_forged_approval_signature_denied_before_sqlite_read(self):
        changed=copy.deepcopy(self.packet)
        changed["approval"]["signature"]="A"*86
        with self.assertRaises(BrokerAdmissionError):
            self.review(changed)
        self.reader.assert_not_called()
    def test_fake_only_signed_owner_without_committed_outbox_denied(self):
        for field,value in (
            ("sourceOutboxMatched",False),
            ("persistedTrustedReadProven",False),
            ("adminApprovalMatched",False),
        ):
            with self.subTest(field=field):
                self.setUp()
                _,resp=self.signed_read({
                    "claimsSha256":self.decision["claimsSha256"],
                    "taskId":self.claims["taskId"],
                    "commandId":self.claims["commandId"],
                    "attemptId":self.claims["attemptId"],
                    "superAdminId":self.claims["superAdminId"],
                },self.now)
                resp["result"][field]=value
                with self.assertRaisesRegex(
                    BrokerAdmissionError,"OWNER_SOURCE_AUTHENTIC_OUTBOX_NOT_PROVEN",
                ):
                    self.review(reader=Mock(return_value=(200,resp)))
    def test_wrong_decision_id_or_actor_or_recorded_time_denied(self):
        for key,value in (
            ("decisionId","not-a-uuid"),
            ("actorId","another_owner"),
            ("claimsSha256","b"*64),
            ("authMethod","static_dev_token"),
            ("recordedAt",self.now+1000),
            ("expiresAt",self.now+60000),
        ):
            with self.subTest(field=key):
                self.setUp()
                _,resp=self.signed_read({
                    "claimsSha256":self.decision["claimsSha256"],
                    "taskId":self.claims["taskId"],
                    "commandId":self.claims["commandId"],
                    "attemptId":self.claims["attemptId"],
                    "superAdminId":self.claims["superAdminId"],
                },self.now)
                resp["result"]["decision"][key]=value
                with self.assertRaises(BrokerAdmissionError):
                    self.review(reader=Mock(return_value=(200,resp)))
    def test_missing_or_stale_approval_fails_closed(self):
        with self.assertRaisesRegex(BrokerAdmissionError,
                                    "OWNER_SOURCE_SCOPE_OR_LEASE_INVALID"):
            self.review(now=self.claims["expiresAt"]-2000)
        self.reader.assert_not_called()
        with self.assertRaisesRegex(BrokerAdmissionError,
                                    "OWNER_SOURCE_PRIVATE_READBACK_UNAVAILABLE"):
            self.review(reader=Mock(return_value=(404,{"ok":False})))
    def test_operational_wrapper_uses_pinned_reader_socket_not_http(self):
        with (
            patch.object(relay,"_load_public_roots",return_value=self.roots) as roots,
            patch.object(relay,"_unix_json",
                         side_effect=lambda path,route,req,timeout:
                            self.signed_read(req["lookup"],req["observedAt"])) as sock,
            patch.object(relay.time,"time",return_value=self.now/1000),
        ):
            out=relay.review_owner_source_from_existing_service(
                self.packet["approval"]
            )
        self.assertEqual(out["sourceDecisionId"],self.decision["decisionId"])
        roots.assert_called_once_with(
            relay.VERIFIER_PUBLIC_ROOT_DIR,relay.DEFAULT_FINGERPRINT_MANIFEST,
        )
        self.assertEqual(sock.call_args.args[0],relay.APPROVAL_READER)
        self.assertEqual(sock.call_args.args[1],"/owner-outbox-intent")
        self.assertNotIn("service_role",str(sock.call_args))
    def test_no_cross_store_write_or_signer_issuance_in_reviewer(self):
        body=(Path(__file__).resolve().parents[2]/
             "deploy/ai-coding-standalone-dev/gpt02_issue159_owner_source_relay_review.py").read_text()
        for forbidden in (
            "psycopg.connect","sqlite3.connect","CREATE ROLE ",
            "ALTER ROLE ","INSERT INTO ","subprocess.",
            "Ed25519PrivateKey","dispatchPermitted\":True",
        ):
            self.assertNotIn(forbidden,body)

if __name__=="__main__":
    unittest.main()
