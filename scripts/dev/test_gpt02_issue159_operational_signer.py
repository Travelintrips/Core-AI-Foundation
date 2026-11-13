import base64
import importlib.util
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT=Path(__file__).resolve().parents[2]
MODULE=ROOT/"deploy/ai-coding-standalone-dev/gpt02_issue159_operational_signer.py"

spec=importlib.util.spec_from_file_location("op_signer",MODULE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def sig(key,role,claims):
    return base64.urlsafe_b64encode(key.sign(m.signing_bytes(role,claims))).decode().rstrip("=")

class OperationalSignerTest(unittest.TestCase):
    def setUp(self):
        self.keys={r:Ed25519PrivateKey.generate() for r in m.ROLES}
        self.public={r:k.public_key() for r,k in self.keys.items()}
        self.now=int(time.time()*1000)
        self.approval={
            "v":2,"environment":"DEV","audience":"GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
            "taskId":200,"commandId":"11111111-1111-4111-8111-111111111111",
            "attemptId":"22222222-2222-4222-8222-222222222222",
            "nonce":"abcdefghijklmnopqrstuvwxyzABCDEFGH12345678",
            "operatorNamespace":"ai-task-hub.public.users","superAdminId":"google_admin",
            "companyId":"default","issuedAt":self.now-1000,"expiresAt":self.now+180000,
        }
        self.facts={
            "prepared":{"companyId":"default","hubTaskId":200,"memberId":5,"memberAuditId":9,
                "operatorSubject":"google_admin","coreTaskId":"33333333-3333-4333-8333-333333333333",
                "hubExecutionId":"44444444-4444-4444-8444-444444444444",
                "commandCandidateId":self.approval["commandId"],"attemptId":self.approval["attemptId"],
                "expiresAt":self.now+300000},
            "job":{"companyId":"default","taskId":200,"executionId":"44444444-4444-4444-8444-444444444444",
                "status":"prepared","commandId":None,"workerCommandCount":0,"attemptNumber":1,
                "dispatchStarted":False,"memberId":5,"memberAuditId":9,"operatorSubject":"google_admin"},
            "core":{"taskId":"33333333-3333-4333-8333-333333333333",
                "commandCandidateId":self.approval["commandId"],"attemptId":self.approval["attemptId"],
                "status":"PENDING","commandCount":0,"runCount":0,"workerId":m.WORKER,
                "operatorUserId":7,"operatorRole":"owner","operatorActive":True,"passwordChanged":True},
            "hubOperator":{"subject":"google_admin","role":"super_admin","active":True,"memberId":5,
                "accountableOwnerId":"google_admin"},
            "hubAssignment":{"action":"gpt02_pic_assigned","entityId":"200","actorId":"google_admin","actorRole":"super_admin","actorActive":True},
            "observedAt":self.now,
            "trustedReadProof":{"source":"gpt02-issue159-presign-reader","environment":"DEV",
                "hubRole":"gpt02_hub_evidence_reader","coreRole":"gpt02_core_evidence_reader",
                "separateBackends":True,"clientTlsVerified":True,"readOnly":True,
                "signingPermitted":False,"authorizationGranted":False,"dispatchPermitted":False,
                "releaseDecision":"NO_GO"}
        }
    def fake_readback(self,c,now):
        return m.hashlib.sha256(m.canonical(c,m.APPROVAL_FIELDS)).hexdigest(),{"decision":"APPROVE"}
    def test_approval_hub_core_chain(self):
        with patch.object(m,"_approval_readback",side_effect=self.fake_readback), patch.object(m,"_presign",return_value=self.facts):
            approval_signer=m.Signer("approval",self.keys["approval"],self.public)
            a=approval_signer.sign_approval({"claims":self.approval})
            self.assertTrue(a["signingEvidenceVerified"])
            m._verify_signature("approval",self.approval,a["signatureBase64url"],self.public["approval"])
            hub=m.Signer("hub",self.keys["hub"],self.public).sign_hub({
                "approval":{"claims":self.approval,"signatureBase64url":a["signatureBase64url"]}})
            self.assertFalse(hub["dispatchPermitted"])
            core=m.Signer("core",self.keys["core"],self.public).sign_core({
                "approval":{"claims":self.approval,"signatureBase64url":a["signatureBase64url"]},
                "operatorLink":{"claims":hub["claims"],"hubSignatureBase64url":hub["hubSignatureBase64url"]}})
            self.assertEqual(hub["linkDigest"],core["linkDigest"])
            m._verify_signature("hub",hub["claims"],hub["hubSignatureBase64url"],self.public["hub"])
            m._verify_signature("core",core["claims"],core["coreSignatureBase64url"],self.public["core"])
    def test_rejects_without_persisted_admin_approval(self):
        signer=m.Signer("approval",self.keys["approval"],self.public)
        with patch.object(m,"_approval_readback",side_effect=RuntimeError("PERSISTED_ADMIN_APPROVAL_REQUIRED")), patch.object(m,"_presign",return_value=self.facts):
            with self.assertRaisesRegex(RuntimeError,"PERSISTED_ADMIN_APPROVAL_REQUIRED"):
                signer.sign_approval({"claims":self.approval})
    def test_issuer_requires_persisted_reader_match(self):
        claims={
            "v":1,"environment":"DEV","audience":"GPT02_ISSUER_LEASE_EVIDENCE_V1",
            "companyId":"default","hubTaskId":200,"hubExecutionId":"44444444-4444-4444-8444-444444444444",
            "coreTaskId":"33333333-3333-4333-8333-333333333333","commandId":self.approval["commandId"],
            "attemptId":self.approval["attemptId"],"workerId":m.WORKER,
            "receiptId":"55555555-5555-4555-8555-555555555555","linkId":"66666666-6666-4666-8666-666666666666",
            "fenceId":"77777777-7777-4777-8777-777777777777","approvalDigest":"a"*64,
            "nonceDigest":"b"*64,"issuerRole":"dev_gpt02_issuer_evidence","leaseEpoch":1,
            "issuedAt":self.now-100,"expiresAt":self.now+5000,
        }
        good=(200,{"ok":True,"environment":"DEV","result":{
            "persistedTrustedReadProven":True,"issuerLedgerMatched":True,"readOnlySessionVerified":True},
            "releaseDecision":"NO_GO"})
        with patch.object(m,"_unix_json",return_value=good):
            out=m.Signer("issuer",self.keys["issuer"],self.public).sign_issuer({"claims":claims})
            self.assertTrue(out["issuerLineageVerified"])
            self.assertFalse(out["dispatchPermitted"])
            m._verify_signature("issuer",claims,out["signatureBase64url"],self.public["issuer"])
        with patch.object(m,"_unix_json",return_value=(409,{"ok":False,"releaseDecision":"NO_GO","result":{}})):
            with self.assertRaisesRegex(RuntimeError,"PERSISTED_ISSUER_LINEAGE_REQUIRED"):
                m.Signer("issuer",self.keys["issuer"],self.public).sign_issuer({"claims":claims})
    def test_source_has_no_db_or_network_dispatch_surface(self):
        source=MODULE.read_text()
        for forbidden in ("psycopg","sqlite3","subprocess","AF_INET","AF_INET6","dispatchPermitted\":True","authorizationGranted\":True"):
            self.assertNotIn(forbidden,source)
        self.assertIn("socket.AF_UNIX",source)
        self.assertIn('grp.getgrnam("gpt02-issue159-signers").gr_gid',source)
        self.assertIn("stat.S_IMODE(parent.st_mode)!=0o750",source)
        self.assertIn("stat.S_IMODE(st.st_mode)!=0o660",source)
        self.assertIn("PERSISTED_ADMIN_APPROVAL_REQUIRED",source)
        self.assertIn("PERSISTED_ISSUER_LINEAGE_REQUIRED",source)

if __name__=="__main__":
    unittest.main()
