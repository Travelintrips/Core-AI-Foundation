"""Synthetic read-only Hub/Core presign bridge into EXISTING GPT02 sign_once.

This test never calls a live signer, writes to Supabase, or uses real keys.
"""
from __future__ import annotations

import copy
import grp
import json
import os
from pathlib import Path
import pwd
import socketserver
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import gpt02_issue159_hub_core_signer_guard as gate
from gpt02_issue159_signer_approval_guard import canonical_sha
from test_gpt02_issue159_sign_once import claims


class ReaderHandler(socketserver.StreamRequestHandler):
    def handle(self):
        first=self.rfile.readline(200)
        if first != b"POST /pre-sign-facts HTTP/1.1\r\n":
            return
        headers={}
        while True:
            line=self.rfile.readline(1024)
            if line == b"\r\n":break
            k,_,v=line.partition(b":")
            headers[k.strip().lower()]=v.strip()
        req=json.loads(self.rfile.read(int(headers[b"content-length"])))
        self.server.requests.append(req)
        response={
            "ok":True,"environment":"DEV","facts":self.server.facts,
            "signingPermitted":False,"authorizationGranted":False,
            "dispatchPermitted":False,"releaseDecision":"NO_GO"
        }
        response.update(self.server.overrides)
        body=json.dumps(response,separators=(",",":")).encode()
        self.wfile.write(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                         +b"Content-Length: "+str(len(body)).encode()
                         +b"\r\nConnection: close\r\n\r\n"+body)


class HubCoreSignerTrustTest(unittest.TestCase):
    def setUp(self):
        self.now=int(time.time()*1000)
        self.approved=claims("approval",self.now)
        self.approved["expiresAt"]=self.now+115000
        self.approved["issuedAt"]=self.now-500
        self.link=claims("hub",self.now)
        self.link["issuedAt"]=self.now-300
        self.link["expiresAt"]=self.now+90000
        self.link["approvalDigest"]=canonical_sha(self.approved)
        self.temp=tempfile.TemporaryDirectory()
        d=Path(self.temp.name)/"reader";d.mkdir(mode=0o750)
        os.chmod(d,0o750)
        self.path=d/"reader.sock"
        self.server=socketserver.UnixStreamServer(str(self.path),ReaderHandler)
        os.chmod(self.path,0o660)
        L=self.link
        self.server.facts={
            "prepared":{
                "companyId":"default","hubTaskId":L["hubTaskId"],
                "memberId":L["assigneeId"],"memberAuditId":99,
                "operatorSubject":L["hubOperatorId"],
                "coreTaskId":L["coreTaskId"],
                "hubExecutionId":L["hubExecutionId"],
                "commandCandidateId":L["coreCommandId"],
                "attemptId":L["attemptId"],"expiresAt":self.now+110000
            },
            "job":{
                "companyId":"default","taskId":L["hubTaskId"],
                "executionId":L["hubExecutionId"],"status":"prepared",
                "commandId":None,"workerCommandCount":0,
                "attemptNumber":1,"dispatchStarted":False,"memberId":L["assigneeId"],
                "memberAuditId":99,"operatorSubject":L["hubOperatorId"],
            },
            "core":{
                "taskId":L["coreTaskId"],"commandCandidateId":L["coreCommandId"],
                "attemptId":L["attemptId"],"status":"PENDING",
                "commandCount":0,"runCount":0,"workerId":L["workerId"],
                "operatorUserId":L["coreOperatorUserId"],
                "operatorRole":L["coreRole"],"operatorActive":True,
                "passwordChanged":True
            },
            "hubOperator":{
                "subject":L["hubOperatorId"],"role":"super_admin",
                "active":True,"memberId":L["assigneeId"],
                "accountableOwnerId":L["accountableOwnerId"]
            },
            "hubAssignment":{
                "action":"gpt02_pic_assigned","entityId":str(L["hubTaskId"]),
                "actorId":L["hubOperatorId"],"actorRole":"super_admin","actorActive":True
            },
            "observedAt":self.now,
            "trustedReadProof":{
                "source":"gpt02-issue159-presign-reader","environment":"DEV",
                "hubRole":"gpt02_hub_evidence_reader",
                "coreRole":"gpt02_core_evidence_reader",
                "separateBackends":True,"clientTlsVerified":True,
                "readOnly":True,"signingPermitted":False,
                "authorizationGranted":False,"dispatchPermitted":False,
                "releaseDecision":"NO_GO"
            },
        }
        self.server.overrides={}
        self.server.requests=[]
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def call(self, role="hub", link=None, approved=None):
        class Group:
            gr_gid=os.getgid()
        class User:
            pw_uid=os.getuid()
        with patch.object(grp,"getgrnam",return_value=Group()):
            with patch.object(pwd,"getpwnam",return_value=User()):
                with patch.object(gate,"persisted_approval_fresh",return_value=canonical_sha(self.approved)) as check:
                    r=gate.require_hub_core_facts(
                        role,
                        link if link is not None else self.link,
                        approved if approved is not None else self.approved,
                        reader_socket=str(self.path),reader_uid=os.getuid(),
                        now_ms=self.now)
                    check.assert_called_once()
                    return r

    def test_hub_core_exact_preparation_and_persisted_approval(self):
        for role in ("hub","core"):
            with self.subTest(role=role):
                self.assertIsNone(self.call(role))
        self.assertEqual(len(self.server.requests),2)
        self.assertEqual(set(self.server.requests[0]),{
            "companyId","hubTaskId","commandCandidateId","attemptId"})
        self.assertEqual(self.server.requests[0]["hubTaskId"],200)

    def test_wrong_core_identity_rejected(self):
        self.server.facts["core"]["operatorUserId"]=999
        with self.assertRaisesRegex(RuntimeError,"OPERATOR_READER_PERSISTED_BINDING_MISMATCH"):
            self.call("core")

    def test_wrong_hub_audit_rejected(self):
        self.server.facts["hubAssignment"]["actorRole"]="staff"
        with self.assertRaisesRegex(RuntimeError,"OPERATOR_READER_PERSISTED_BINDING_MISMATCH"):
            self.call()

    def test_cross_task_link_rejected(self):
        broken=copy.deepcopy(self.link)
        broken["hubTaskId"]=201
        with self.assertRaisesRegex(RuntimeError,"OPERATOR_APPROVAL_BINDING_MISMATCH"):
            self.call(link=broken)

    def test_unsigned_admin_digest_rejected(self):
        broken=copy.deepcopy(self.link)
        broken["approvalDigest"]="f"*64
        with self.assertRaisesRegex(RuntimeError,"OPERATOR_APPROVAL_DIGEST_MISMATCH"):
            self.call(link=broken)

    def test_reader_forged_authority_rejected(self):
        self.server.overrides["dispatchPermitted"]=True
        with self.assertRaisesRegex(RuntimeError,"OPERATOR_READER_RESPONSE_NOT_TRUSTED"):
            self.call()

    def test_expired_operator_link_rejected_without_readback(self):
        broken=copy.deepcopy(self.link)
        broken["expiresAt"]=self.now+5000
        with self.assertRaisesRegex(RuntimeError,"OPERATOR_LINK_NOT_FRESH_OR_ALLOWED"):
            self.call(link=broken)

    def test_socket_mode_rejected(self):
        os.chmod(self.path,0o666)
        with self.assertRaisesRegex(RuntimeError,"OPERATOR_READER_CUSTODY_INVALID"):
            self.call()


if __name__=="__main__":
    unittest.main()
