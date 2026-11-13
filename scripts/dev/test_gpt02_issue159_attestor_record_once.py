"""Existing Stage A verifier -> existing attestor RPC one-shot contract tests.

Only synthetic signatures/admin readback and fake PostgreSQL connections.
No live signer keys, database writes or dispatch.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import sys
import unittest

from gpt02_issue159_attestor_record_once import (
    AttestorDenied, validate_and_verify, record_existing_rpc_once,
    pinned_dev_writer_endpoint, ROLE, PROJECT, POOLER,
)
from gpt02_issue159_writer_broker_contract import (
    APPROVAL_FIELDS, LINK_FIELDS, _canonical,
)
import test_gpt02_issue159_writer_broker_runtime as fixture_module


class FakeCursor:
    def __init__(self, session="dev_gpt02_attestor_evidence",
                 result=True, fail_rpc=False):
        self.session = session
        self.result = result
        self.fail_rpc = fail_rpc
        self.calls = []
    def __enter__(self):
        return self
    def __exit__(self,*args):
        return False
    def execute(self,sql,params=None):
        self.calls.append((sql,params))
        if self.fail_rpc and "record_linked_approval(" in sql:
            raise RuntimeError("SIMULATED_RPC_FAILURE")
    def fetchone(self):
        sql=self.calls[-1][0]
        if "session_user" in sql:
            return self.session,self.session,"postgres","off"
        if "record_linked_approval(" in sql:
            return (self.result,)
        raise AssertionError("UNEXPECTED_SQL")

class FakeConnection:
    def __init__(self,**kwargs):
        self.cursor_obj=FakeCursor(**kwargs)
        self.commits=0
        self.rollbacks=0
    def cursor(self):
        return self.cursor_obj
    def commit(self):
        self.commits+=1
    def rollback(self):
        self.rollbacks+=1


def materialize_packet(packet):
    a=packet["approval"]["claims"]
    link=packet["hubLink"]["claims"]
    ad=hashlib.sha256(_canonical(a,APPROVAL_FIELDS)).hexdigest()
    ld=hashlib.sha256(_canonical(link,LINK_FIELDS)).hexdigest()
    approval={"claims":a,"claimsSha256":ad}
    signatures={
        "approval":{"environment":"DEV","role":"approval","algorithm":"Ed25519",
            "claimsSha256":ad,"signatureBase64url":packet["approval"]["signature"],
            "fingerprintMatched":True,"authorizationGranted":False,
            "dispatchPermitted":False,"releaseDecision":"NO_GO"},
        "hub":{"environment":"DEV","role":"hub","algorithm":"Ed25519",
            "claimsSha256":ld,"signatureBase64url":packet["hubLink"]["signature"],
            "fingerprintMatched":True,"authorizationGranted":False,
            "dispatchPermitted":False,"releaseDecision":"NO_GO"},
        "core":{"environment":"DEV","role":"core","algorithm":"Ed25519",
            "claimsSha256":ld,"signatureBase64url":packet["coreLink"]["signature"],
            "fingerprintMatched":True,"authorizationGranted":False,
            "dispatchPermitted":False,"releaseDecision":"NO_GO"},
    }
    return approval,link,signatures


class AttestorRecordOnceTest(unittest.TestCase):
    def setUp(self):
        self.fixture=fixture_module.WriterBrokerRuntimeTest(
            methodName="test_socket_returns_verified_but_no_authority")
        self.fixture.setUp()
        self.packet=self.fixture._pre_consumption()
        self.approved,self.link,self.sigs=materialize_packet(self.packet)
        self.proof={
            "threeSignaturesVerified":True,
            "persistedAdminApprovalReadBack":True,
            "verifierPeerAuthenticated":True,
            "approvalDigest":self.approved["claimsSha256"],
            "hubLinkDigest":self.sigs["hub"]["claimsSha256"],
            "databaseWritePerformed":False,
            "recordLinkedApprovalExecuted":False,
            "signingPermitted":False,"authorizationGranted":False,
            "dispatchPermitted":False,"releaseDecision":"NO_GO"
        }

    def tearDown(self):
        self.fixture.tearDown()

    def binder(self,verifier=None):
        return validate_and_verify(
            self.approved,self.link,self.sigs,
            now_ms=self.fixture.now,
            verify_fn=(verifier or (lambda *a,**kw:self.proof)),
        )

    def test_verifier_signed_packet_binds_correct_one_rpc(self):
        packet,proof=self.binder()
        conn=FakeConnection()
        self.assertTrue(record_existing_rpc_once(conn,packet,proof))
        self.assertEqual(conn.commits,1)
        self.assertEqual(conn.rollbacks,0)
        self.assertEqual(len(conn.cursor_obj.calls),3)
        sql, params=conn.cursor_obj.calls[2]
        self.assertIn("gpt02_private.record_linked_approval(",sql)
        self.assertEqual(len(params),7)
        self.assertEqual(json.loads(params[0]),self.approved["claims"])
        self.assertEqual(json.loads(params[3]),self.link)
        self.assertEqual(params[1],self.sigs["approval"]["signatureBase64url"])
        self.assertEqual(params[4],self.sigs["hub"]["signatureBase64url"])
        self.assertEqual(params[5],self.sigs["core"]["signatureBase64url"])
        self.assertEqual(params[6],self.sigs["hub"]["claimsSha256"])

    def test_existing_real_verifier_with_synthetic_admin_approval(self):
        # This is the existing peer-authenticated Unix verifier and persisted
        # SQLite admin reader, with disposable synthetic Ed25519 keys only.
        import grp, pwd, functools
        from types import SimpleNamespace
        from unittest.mock import patch
        from gpt02_issue159_attestor_preflight import verify_stage_before_attestor
        self.fixture._start_approval_reader()
        self.fixture._start()
        with patch.object(pwd,"getpwnam",return_value=SimpleNamespace(pw_uid=os.getuid())):
            with patch.object(grp,"getgrnam",return_value=SimpleNamespace(gr_gid=os.getgid())):
                verifier=functools.partial(
                    verify_stage_before_attestor,
                    verifier_socket=str(self.fixture.socket_path))
                packet,proof=self.binder(verifier)
        self.assertTrue(proof["persistedAdminApprovalReadBack"])
        self.assertTrue(proof["threeSignaturesVerified"])
        self.assertEqual(packet["hubLink"]["claims"],packet["coreLink"]["claims"])
        self.assertEqual(proof["releaseDecision"],"NO_GO")

    def test_expired_approval_fails_before_verifier(self):
        self.approved["claims"]["expiresAt"]=self.fixture.now-1
        with self.assertRaisesRegex(AttestorDenied,"ATTESTOR_PACKET_EXPIRED_OR_MALFORMED"):
            self.binder()

    def test_wrong_signer_digest_fails_before_verifier(self):
        self.sigs["hub"]["claimsSha256"]="f"*64
        with self.assertRaisesRegex(AttestorDenied,"ATTESTOR_SIGNER_RESULT_INVALID"):
            self.binder()

    def test_bypassed_or_missing_persisted_admin_fails_closed(self):
        self.proof["persistedAdminApprovalReadBack"]=False
        with self.assertRaisesRegex(AttestorDenied,"ATTESTOR_TRUSTED_VERIFIER_NOT_PROVEN"):
            self.binder()

    def test_mismatched_link_binding_denied(self):
        self.link["nonce"]="OTHER"*10
        with self.assertRaisesRegex(AttestorDenied,"ATTESTOR_HUB_CORE_BINDING_INVALID"):
            self.binder()

    def test_untrusted_attestor_role_denied_before_rpc(self):
        packet,proof=self.binder()
        conn=FakeConnection(session="postgres")
        with self.assertRaisesRegex(AttestorDenied,"ATTESTOR_DATABASE_SESSION_IDENTITY_DENIED"):
            record_existing_rpc_once(conn,packet,proof)
        self.assertEqual(conn.commits,0)
        self.assertEqual(conn.rollbacks,1)
        self.assertEqual(len(conn.cursor_obj.calls),2)

    def test_rpc_failure_rolls_back_and_never_dispatches(self):
        packet,proof=self.binder()
        conn=FakeConnection(fail_rpc=True)
        with self.assertRaisesRegex(RuntimeError,"SIMULATED_RPC_FAILURE"):
            record_existing_rpc_once(conn,packet,proof)
        self.assertEqual(conn.commits,0)
        self.assertEqual(conn.rollbacks,1)

    def test_pinned_direct_and_pooler_attestor_endpoints(self):
        self.assertTrue(pinned_dev_writer_endpoint(
            {"user": f"{ROLE}.{PROJECT}", "host": POOLER}))
        self.assertTrue(pinned_dev_writer_endpoint(
            {"user": ROLE, "host": f"db.{PROJECT}.supabase.co"}))
        for bad in (
            {"user": ROLE, "host": POOLER},
            {"user": f"{ROLE}.{PROJECT}", "host": f"db.{PROJECT}.supabase.co"},
            {"user": ROLE, "host": "untrusted.invalid"},
            {"user": ROLE, "host": f"db.{PROJECT}.supabase.co",
             "hostaddr": "127.0.0.1"},
        ):
            self.assertFalse(pinned_dev_writer_endpoint(bad))

    def test_service_is_static_and_uses_only_dedicated_attestor_credential(self):
        root=Path(__file__).resolve().parents[2]
        unit=(root/"deploy/ai-coding-standalone-dev/gpt02-issue159-attestor-record-once.service").read_text()
        source=(root/"deploy/ai-coding-standalone-dev/gpt02_issue159_attestor_record_once.py").read_text()
        for value in (
            "Type=oneshot","Restart=no","ProtectSystem=strict",
            "NoNewPrivileges=yes","LoadCredentialEncrypted=attestor-dsn:",
            "Environment=GPT02_ATTESTOR_RECORD_ONCE=explicit-approved",
            "ConditionPathExists=/run/gpt02-issue159-verifier/verify.sock",
            "BindReadOnlyPaths=/run/gpt02-issue159-verifier",
        ):
            with self.subTest(value=value):
                self.assertIn(value,unit)
        self.assertNotIn("[Install]",unit)
        self.assertNotIn("WantedBy=",unit)
        self.assertNotIn("ExecStartPost=",unit)
        self.assertNotIn("AI_DISPATCHER_ENABLED=true",unit)
        self.assertNotIn('ROLE = "service_role"',source)
        self.assertNotIn("supabase_admin",source)
        self.assertNotIn("INSERT INTO",source)
        self.assertNotIn("UPDATE gpt02_",source)
        self.assertIn("record_existing_rpc_once(connection, packet, proof)",source)
        self.assertIn("gpt02_private.record_linked_approval(",source)
        self.assertIn('props.get("sslmode") != "verify-full"',source)
        self.assertIn('props.get("sslrootcert") != "/etc/gpt02-dev/supabase-root-ca-2021.crt"',source)

    def test_operational_execution_is_off_by_default(self):
        import subprocess
        code=Path(__file__).resolve().parents[2]/"deploy/ai-coding-standalone-dev/gpt02_issue159_attestor_record_once.py"
        env=dict(os.environ)
        env.pop("GPT02_ATTESTOR_RECORD_ONCE",None)
        proc=subprocess.run([sys.executable,str(code)],capture_output=True,text=True,
                            env=env,timeout=5,check=False)
        self.assertEqual(proc.returncode,2)
        self.assertIn("GPT02_DEV_ATTESTOR_DENIED: AttestorDenied",proc.stderr)
        self.assertNotIn("GPT02_DEV_ATTESTOR_RECORD_EXISTING_RPC_SUCCESS",proc.stdout)

    def test_rpc_no_ack_rolls_back(self):
        packet,proof=self.binder()
        conn=FakeConnection(result=False)
        with self.assertRaisesRegex(AttestorDenied,"ATTESTOR_RECORD_RPC_NO_ACK"):
            record_existing_rpc_once(conn,packet,proof)
        self.assertEqual(conn.commits,0)
        self.assertEqual(conn.rollbacks,1)


if __name__=="__main__":
    unittest.main()
