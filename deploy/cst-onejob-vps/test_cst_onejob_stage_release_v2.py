"""Source-only nine-stage synthetic proof; no DEV login or signer service."""
import base64
import copy
import datetime
import hashlib
import json
import pathlib
import tempfile
import subprocess
import sys
import types
import unittest
from unittest import mock

# Python -m unittest <file-path> on hosted CI does not insert this script's
# sibling directory into sys.path. Resolve only this versioned local test
# module; do not depend on caller cwd or an ambient PYTHONPATH.
ROOT=pathlib.Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0,str(ROOT))

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
import cst_onejob_stage_release_v2 as v2
import install_approved_release_batch as old
import install_staged_release_v2 as installer

class StageTests(unittest.TestCase):
    def setUp(self):
        now=datetime.datetime.now(datetime.timezone.utc)
        self.now=now.timestamp()
        self.fmt=lambda n: n.strftime("%Y-%m-%dT%H:%M:%S.")+f"{n.microsecond//1000:03d}Z"
        self.root=Ed25519PrivateKey.generate()
        self.public=self.root.public_key()
        self.fingerprint=v2.public_fingerprint(self.public)
        self.sign=lambda blob:base64.b64encode(self.root.sign(blob)).decode()
        self.pins={}
        self.uids={}
        self.manifest={
          "project":v2.PROJECT,"environment":"DEV",
          "approvalStatus":"CANDIDATE_NOT_RELEASED","roles":[]
        }
        for i,(role,(signer,operator,purposes)) in enumerate(v2.ROLES.items()):
            k=Ed25519PrivateKey.generate().public_key()
            fp=v2.public_fingerprint(k)
            self.pins[role]=fp
            self.uids[signer]=13000+i
            self.uids[operator]=14000+i
            self.manifest["roles"].append({
                "role":role,"osIdentity":signer,
                "publicKeyPem":k.public_bytes(
                   serialization.Encoding.PEM,
                   serialization.PublicFormat.SubjectPublicKeyInfo).decode(),
                "fingerprint":fp,"activated":False,"trustedForRelease":False
            })
        self.pwd=mock.patch.object(v2.signer.pwd,"getpwnam",
          side_effect=lambda s:types.SimpleNamespace(pw_uid=self.uids[s]))
        self.pwd.start()
        self.addCleanup(self.pwd.stop)
        self.auth=self.job_auth()
    def job_auth(self):
        issued=self.fmt(datetime.datetime.fromtimestamp(
          self.now-40,datetime.timezone.utc))
        expires=self.fmt(datetime.datetime.fromtimestamp(
          self.now+2200,datetime.timezone.utc))
        p={"schema":v2.AUTH_SCHEMA,"project":v2.PROJECT,"companyId":"1",
          "changeId":"CST-DEV-20261121-STAGED", "jobId":483,
          "approvalId":"123e4567-e89b-12d3-a456-426614174000",
          "sourceSha":"a"*40,
          "workerName":"cst-dev-dell-onejob-20261121-abcdef12",
          "manifestSha256":v2.MANIFEST_SHA,
          "issuedAt":issued,"expiresAt":expires,
          "roles":self.pins.copy()}
        return {"payload":p,"signatureBase64":self.sign(v2.canonical(p))}
    def permit(self,stage,payload,nonce,issued=None,expires=None):
        p=self.auth["payload"]
        role,purpose=v2.STAGES[stage]
        signer,operator,_=v2.ROLES[role]
        c={"v":1,"project":v2.PROJECT,"companyId":"1","role":role,
          "purpose":purpose,"jobId":p["jobId"],"sourceSha":p["sourceSha"],
          "approvalId":p["approvalId"],"workerName":p["workerName"],
          "payloadSha256":hashlib.sha256(payload).hexdigest(),
          "nonce":hashlib.sha256(nonce.encode()).hexdigest(),
          "operatorUid":self.uids[operator],"signerUid":self.uids[signer],
          "publicKeyFingerprint":self.pins[role],
          "issuedAt":issued or self.fmt(datetime.datetime.fromtimestamp(
            self.now-30,datetime.timezone.utc)),
          "expiresAt":expires or self.fmt(datetime.datetime.fromtimestamp(
            self.now+180,datetime.timezone.utc))}
        return {"claims":c,"signatureBase64":self.sign(old.canonical_permit(c))}
    def verify(self,stage,payload,permit,**kw):
        return v2.verify_stage_permit(
          self.auth,permit,self.manifest,self.public,stage,payload,
          self.now,approved_root_fingerprint=self.fingerprint,
          uid_lookup=lambda s:self.uids[s],**kw)
    def test_nine_real_payload_bound_permits_one_job_one_owner_consent(self):
        proofs=[]
        preceding=b"owner-approved-483"
        first=None
        for i,stage in enumerate(v2.STAGES):
            # Actual next payload is only computed *after* previous step,
            # not known at the signed job authorization step.
            payload=(stage+":").encode()+hashlib.sha256(preceding).digest()
            p=self.permit(stage,payload,stage+str(i))
            status=self.verify(stage,payload,p)
            self.assertEqual(status["jobId"],483)
            self.assertEqual(status["approvalId"],self.auth["payload"]["approvalId"])
            self.assertFalse(status["ownerApprovalVerified"])
            self.assertFalse(status["finalAckVerified"])
            self.assertFalse(status["signerActivated"])
            if stage=="qa-pre":first=p
            if stage=="qa-post":
                self.assertNotEqual(p["claims"]["nonce"],first["claims"]["nonce"])
                self.assertTrue(v2.previous_qa_consumed_marker(b"consumed\n",first))
            # A synthetic signed response/receipt changes the next payload.
            preceding=hashlib.sha256(payload+self.root.sign(payload)).digest()
            proofs.append(status)
        self.assertEqual(len(proofs),9)
        self.assertEqual(len({s["nonce"] for s in proofs}),9)
        self.assertEqual(len({s["role"] for s in proofs}),8)
        self.assertNotIn("permits",self.auth["payload"])
        self.assertNotIn("payloadSha256",self.auth["payload"])
    def test_unapproved_source_root_cannot_approve_any_stage(self):
        self.assertIsNone(v2.APPROVED_OPERATIONS_ROOT_FINGERPRINT)
        with self.assertRaisesRegex(v2.GateError,"INDEPENDENT_ROOT_PIN_MISSING"):
            v2.verify_job_authorization(self.auth,self.manifest,self.public,
                 self.now,v2.APPROVED_OPERATIONS_ROOT_FINGERPRINT)
        self.assertIsNone(installer.v2.APPROVED_OPERATIONS_ROOT_FINGERPRINT)
    def test_tampered_authority_unknown_job_invalid_root_and_bad_role(self):
        a=copy.deepcopy(self.auth)
        a["payload"]["jobId"]=484
        with self.assertRaisesRegex(v2.GateError,"AUTH_SIGNATURE_INVALID"):
            v2.verify_job_authorization(a,self.manifest,self.public,
                 self.now,self.fingerprint)
        bogus=Ed25519PrivateKey.generate().public_key()
        with self.assertRaisesRegex(v2.GateError,"UNTRUSTED_OPERATIONS_ROOT"):
            v2.verify_job_authorization(self.auth,self.manifest,bogus,
                 self.now,self.fingerprint)
        b=copy.deepcopy(self.auth)
        b["payload"]["roles"].pop("reviewer")
        b["signatureBase64"]=self.sign(v2.canonical(b["payload"]))
        with self.assertRaisesRegex(v2.GateError,"AUTH_ROLES_INVALID"):
            v2.verify_job_authorization(b,self.manifest,self.public,
                 self.now,self.fingerprint)
    def test_stage_cannot_sign_unknown_future_payload(self):
        stage="subscriber-ack"
        known=b"before-worker-completion"
        p=self.permit(stage,known,"synthetic-sub")
        with self.assertRaisesRegex(v2.GateError,"STAGE_SIGNER_CONTRACT_DENIED"):
            self.verify(stage,b"actual-result-after-worker",p)
    def test_wrong_stage_role_uid_nonce_and_scope_denied(self):
        payload=b"real-qa-pre"
        p=self.permit("qa-pre",payload,"nonce-pre")
        with self.assertRaisesRegex(v2.GateError,"STAGE_NOT_BOUND_TO_APPROVED_JOB"):
            self.verify("qa-post",payload,p)
        q=copy.deepcopy(p);q["claims"]["sourceSha"]="b"*40
        q["signatureBase64"]=self.sign(old.canonical_permit(q["claims"]))
        with self.assertRaisesRegex(v2.GateError,"STAGE_NOT_BOUND_TO_APPROVED_JOB"):
            self.verify("qa-pre",payload,q)
        q=copy.deepcopy(p);q["claims"]["operatorUid"]=0
        q["signatureBase64"]=self.sign(old.canonical_permit(q["claims"]))
        with self.assertRaisesRegex(v2.GateError,"STAGE_SIGNER_CONTRACT_DENIED"):
            self.verify("qa-pre",payload,q)
    def test_stage_expiry_must_be_within_1hour_authorization_and_5minute_permit(self):
        payload=b"event-completed"
        start=self.auth["payload"]["issuedAt"]
        too_late=self.fmt(datetime.datetime.fromtimestamp(
            self.now+3200,datetime.timezone.utc))
        p=self.permit("qa-pre",payload,"time-abuse",expires=too_late)
        with self.assertRaisesRegex(v2.GateError,"STAGE_OUTSIDE_AUTH_WINDOW"):
            self.verify("qa-pre",payload,p)
        auth=copy.deepcopy(self.auth)
        auth["payload"]["expiresAt"]=self.fmt(datetime.datetime.fromtimestamp(
          self.now+7200,datetime.timezone.utc))
        auth["signatureBase64"]=self.sign(v2.canonical(auth["payload"]))
        with self.assertRaisesRegex(v2.GateError,"AUTH_EXPIRED_OR_UNBOUNDED"):
            v2.verify_job_authorization(auth,self.manifest,self.public,
                 self.now,self.fingerprint)
    def test_wrong_qa_previous_nonce_state_denies_second_signature(self):
        pre=self.permit("qa-pre",b"abc","old-qa")
        for marker in [None,b"",b"fake\n",b"consumed",b"consumed\nextra"]:
            with self.assertRaises(v2.GateError):
                v2.previous_qa_consumed_marker(marker,pre)
        q=self.permit("qa-post",b"response","new-qa")
        with self.assertRaisesRegex(v2.GateError,"QA_PRE_PERMIT_REQUIRED_FOR_POST"):
            v2.previous_qa_consumed_marker(b"consumed\n",q)
    def test_v1_full_future_payload_cli_is_deprecated_and_does_not_install(self):
        p=subprocess.run([sys.executable,str(pathlib.Path(old.__file__)),
          "--install-after-signed-approval"],capture_output=True,text=True)
        self.assertNotEqual(p.returncode,0)
        self.assertIn("CST_DEV_EXTERNAL_RELEASE_IMPORT=DENIED",p.stderr)
        self.assertIn("V1_FUTURE_PAYLOAD_BATCH_DEPRECATED",old.main.__code__.co_consts.__repr__())
    def test_disposable_job_install_writes_only_public_metadata_without_future_permits(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp)
            doc=self.auth
            p=doc["payload"]
            with mock.patch.object(installer,"ROOT",root),\
                 mock.patch.object(installer,"APPROVED_PUBLIC",root/"approved-public"),\
                 mock.patch.object(installer,"APPROVED_CHANGE",root/"approved-change"),\
                 mock.patch.object(installer,"prepare_job",return_value=(doc,p)),\
                 mock.patch.object(installer,"safe_dir",return_value=None),\
                 mock.patch.object(installer.os,"chown",return_value=None):
                report=installer.install_job(self.manifest,self.public)
            self.assertEqual(report["stagePermitsInstalled"],0)
            self.assertFalse(report["signerActivated"])
            self.assertEqual(len(list((root/"approved-public").glob("*.json"))),8)
            self.assertTrue((root/"approved-change"/"job-authorization-v2.json").exists())
            self.assertFalse((root/"authorized-releases").exists())
            self.assertFalse((root/"authorized-releases"/"qa-evidence.json").exists())
    def test_disposable_stage_write_hash_replay_and_qa_second_stage_replacement(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp)
            approved=root/"approved-change"
            public=root/"approved-public"
            permits=root/"authorized-releases"
            ledger=root/"stage-permit-ledger"
            inbox=root/"inbox"/"stages"
            payloads=root/"inbox"/"payloads"
            for path in (approved,public,inbox,payloads):
                path.mkdir(parents=True,exist_ok=True)
            (approved/"job-authorization-v2.json").write_text(
                json.dumps(self.auth))
            raw=b"PRE_ACTUAL_INDEPENDENT_QA_EVIDENCE"
            p=self.permit("qa-pre",raw,"qa-first-raw")
            (inbox/"qa-pre.json").write_text(json.dumps(p))
            (payloads/"qa-pre.bin").write_bytes(raw)
            patcher=[
               mock.patch.object(installer,"APPROVED_CHANGE",approved),
               mock.patch.object(installer,"APPROVED_PUBLIC",public),
               mock.patch.object(installer,"ROLE_PERMITS",permits),
               mock.patch.object(installer,"STAGE_LEDGER",ledger),
               mock.patch.object(installer,"STAGE_INBOX",inbox),
               mock.patch.object(installer,"PAYLOAD_INBOX",payloads),
               mock.patch.object(installer,"verified_authorization_file",
                   return_value=(self.auth,self.auth["payload"])),
               mock.patch.object(installer.legacy,"root_file",
                   side_effect=lambda path,limit=8192: pathlib.Path(path).read_bytes()),
               mock.patch.object(installer.v2,"APPROVED_OPERATIONS_ROOT_FINGERPRINT",
                   self.fingerprint),
               mock.patch.object(installer,"safe_dir",return_value=None),
               mock.patch.object(installer.os,"chown",return_value=None),
            ]
            for patch in patcher:patch.start()
            try:
                bad=b"NOT_THE_SIGNED_PAYLOAD"
                (payloads/"qa-pre.bin").write_bytes(bad)
                with self.assertRaisesRegex(v2.GateError,
                     "STAGE_SIGNER_CONTRACT_DENIED"):
                    installer.install_stage("qa-pre",self.manifest,self.public)
                self.assertFalse(ledger.exists(),
                    "BAD_PAYLOAD_MUST_NOT_TOUCH_STAGE_LEDGER")
                (payloads/"qa-pre.bin").write_bytes(raw)
                result=installer.install_stage("qa-pre",self.manifest,self.public)
                self.assertEqual(result["status"],"ONE_STAGE_PERMIT_INSTALLED")
                self.assertFalse(result["signerActivated"])
                self.assertEqual(json.loads(
                    (permits/"qa-evidence.json").read_text())["claims"]["nonce"],
                    p["claims"]["nonce"])
                with self.assertRaisesRegex(v2.GateError,
                    "STAGE_PERMIT_ALREADY_INSTALLED"):
                    installer.install_stage("qa-pre",self.manifest,self.public)
                raw2=b"POST_ACTUAL_OUTPUT_AFTER_SUBSCRIBER"
                post=self.permit("qa-post",raw2,"qa-post-raw")
                (inbox/"qa-post.json").write_text(json.dumps(post))
                (payloads/"qa-post.bin").write_bytes(raw2)
                with mock.patch.object(installer,"check_prior_qa_consumed",
                  return_value=None) as prior:
                    result=installer.install_stage("qa-post",self.manifest,self.public)
                    prior.assert_called_once()
                self.assertEqual(result["stage"],"qa-post")
                self.assertEqual(json.loads(
                    (permits/"qa-evidence.json").read_text())["claims"]["nonce"],
                    post["claims"]["nonce"])
                self.assertNotEqual(p["claims"]["nonce"],post["claims"]["nonce"])
            finally:
                for patch in reversed(patcher):patch.stop()
    def test_existing_signer_protocol_unmodified(self):
        signer_source=pathlib.Path(v2.signer.__file__).read_text()
        self.assertIn("PERMIT_EXPIRED_OR_TOO_LONG",signer_source)
        self.assertIn("consume_nonce(nonce_dir,nonce)",signer_source)
        self.assertIn("root_file",signer_source)
        self.assertEqual(len(v2.ROLES),8)
        self.assertEqual(len(v2.STAGES),9)
        self.assertEqual(sum(1 for r,p in v2.STAGES.values() if r=="qa-evidence"),2)

if __name__=="__main__":
    unittest.main()
