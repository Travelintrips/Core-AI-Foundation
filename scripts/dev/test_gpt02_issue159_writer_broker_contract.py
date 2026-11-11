import base64
import json
import unittest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from gpt02_issue159_writer_broker_contract import (
    APPROVAL_FIELDS, LINK_FIELDS, ISSUER_FIELDS, BrokerAdmissionError,
    verify_lifecycle_evidence_packet,
)


def b64(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def sign(key, claims, fields, domain=b""):
    body=json.dumps({k:claims[k] for k in fields},ensure_ascii=False,separators=(",",":")).encode()
    return b64(key.sign(domain+body))


class WriterBrokerContractTest(unittest.TestCase):
    def setUp(self):
        self.keys={r:Ed25519PrivateKey.generate() for r in ("approval","hub","core","issuer")}
        self.roots={r:k.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode() for r,k in self.keys.items()}
        self.now=1_800_000_000_000
        self.approval={
          "v":2,"environment":"DEV","audience":"GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
          "taskId":140,"commandId":"10000000-0000-4000-8000-000000000001",
          "attemptId":"20000000-0000-4000-8000-000000000002",
          "nonce":"N"*40,"operatorNamespace":"ai-task-hub.public.users",
          "superAdminId":"sup-admin-test","companyId":"default",
          "issuedAt":self.now-1000,"expiresAt":self.now+120000,
        }
        import hashlib
        ad=hashlib.sha256(json.dumps({k:self.approval[k] for k in APPROVAL_FIELDS},separators=(",",":")).encode()).hexdigest()
        self.link={
          "v":1,"environment":"DEV","audience":"GPT02_DUAL_ACCOUNT_COMMAND_LINK",
          "linkId":"30000000-0000-4000-8000-000000000003","companyId":"default",
          "hubTaskId":140,"hubExecutionId":"40000000-0000-4000-8000-000000000004",
          "coreTaskId":"50000000-0000-4000-8000-000000000005",
          "coreCommandId":self.approval["commandId"],"attemptId":self.approval["attemptId"],
          "attemptNumber":1,"assigneeId":5,"accountableOwnerId":"sup-admin-test",
          "hubOperatorNamespace":"ai-task-hub.public.users","hubOperatorId":"sup-admin-test",
          "hubRole":"super_admin","hubActive":True,
          "coreOperatorNamespace":"ai-core.ai_platform.internal_users","coreOperatorUserId":5,
          "coreRole":"admin","coreActive":True,"corePasswordChanged":True,
          "workerId":"openclaw-dell-chatgpt-wake-dev","approvalDigest":ad,
          "nonce":self.approval["nonce"],"issuedAt":self.now-900,"expiresAt":self.now+90000,
        }
        self.issuer={
          "v":1,"environment":"DEV","audience":"GPT02_ISSUER_LEASE_EVIDENCE_V1",
          "companyId":"default","hubTaskId":140,
          "hubExecutionId":self.link["hubExecutionId"],"coreTaskId":self.link["coreTaskId"],
          "commandId":self.approval["commandId"],"attemptId":self.approval["attemptId"],
          "workerId":"openclaw-dell-chatgpt-wake-dev",
          "receiptId":"60000000-0000-4000-8000-000000000006",
          "linkId":self.link["linkId"],"fenceId":"70000000-0000-4000-8000-000000000007",
          "approvalDigest":ad,"nonceDigest":hashlib.sha256(self.approval["nonce"].encode()).hexdigest(),
          "issuerRole":"dev_gpt02_issuer_evidence","leaseEpoch":1,
          "issuedAt":self.now-100,"expiresAt":self.now+5000,
        }
        self.packet={
          "approval":{"claims":self.approval,"signature":sign(self.keys["approval"],self.approval,APPROVAL_FIELDS)},
          "hubLink":{"claims":self.link,"signature":sign(self.keys["hub"],self.link,LINK_FIELDS,b"GPT02_OPERATOR_LINK_V1:hub\n")},
          "coreLink":{"claims":self.link,"signature":sign(self.keys["core"],self.link,LINK_FIELDS,b"GPT02_OPERATOR_LINK_V1:core\n")},
          "issuerEvidence":{"claims":self.issuer,"signature":sign(self.keys["issuer"],self.issuer,ISSUER_FIELDS,b"GPT02_ISSUER_LEASE_EVIDENCE_V1\n")},
        }

    def test_four_domain_signatures_verify_but_no_authority(self):
        out=verify_lifecycle_evidence_packet(self.packet,self.roots,self.now)
        self.assertTrue(out["packetVerified"])
        self.assertFalse(out["databaseWritePerformed"])
        self.assertFalse(out["nonceConsumed"])
        self.assertFalse(out["leaseConsumed"])
        self.assertFalse(out["signingPermitted"])
        self.assertFalse(out["authorizationGranted"])
        self.assertFalse(out["dispatchPermitted"])
        self.assertEqual(out["releaseDecision"],"NO_GO")

    def test_tampered_approval_fails(self):
        p=json.loads(json.dumps(self.packet));p["approval"]["claims"]["taskId"]=141
        with self.assertRaises(BrokerAdmissionError): verify_lifecycle_evidence_packet(p,self.roots,self.now)

    def test_cross_role_signature_fails(self):
        p=json.loads(json.dumps(self.packet));p["coreLink"]["signature"]=p["hubLink"]["signature"]
        with self.assertRaises(BrokerAdmissionError): verify_lifecycle_evidence_packet(p,self.roots,self.now)

    def test_duplicate_public_roots_fail_role_verification(self):
        roots=dict(self.roots);roots["issuer"]=roots["hub"]
        with self.assertRaises(BrokerAdmissionError): verify_lifecycle_evidence_packet(self.packet,roots,self.now)

    def test_same_private_key_cannot_impersonate_four_independent_signers(self):
        one=Ed25519PrivateKey.generate()
        roots={r:one.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode() for r in ("approval","hub","core","issuer")}
        p={
          "approval":{"claims":self.approval,"signature":sign(one,self.approval,APPROVAL_FIELDS)},
          "hubLink":{"claims":self.link,"signature":sign(one,self.link,LINK_FIELDS,b"GPT02_OPERATOR_LINK_V1:hub\n")},
          "coreLink":{"claims":self.link,"signature":sign(one,self.link,LINK_FIELDS,b"GPT02_OPERATOR_LINK_V1:core\n")},
          "issuerEvidence":{"claims":self.issuer,"signature":sign(one,self.issuer,ISSUER_FIELDS,b"GPT02_ISSUER_LEASE_EVIDENCE_V1\n")},
        }
        with self.assertRaises(BrokerAdmissionError): verify_lifecycle_evidence_packet(p,roots,self.now)

    def test_contract_has_no_runtime_or_mutation_surface(self):
        from pathlib import Path
        source=Path(__file__).parents[2]/"deploy/ai-coding-standalone-dev/gpt02_issue159_writer_broker_contract.py"
        body=source.read_text()
        for forbidden in ("sqlite3", "psycopg", "socket.socket", "connect(", "Ed25519PrivateKey", "INSERT INTO", "UPDATE ", "DELETE FROM", "CREATE TASK", "dispatch("):
            self.assertNotIn(forbidden,body)

    def test_operator_link_uses_official_dual_account_contract(self):
        self.assertEqual(self.link["audience"],"GPT02_DUAL_ACCOUNT_COMMAND_LINK")
        self.assertEqual(self.link["hubRole"],"super_admin")
        self.assertIn(self.link["coreRole"],("owner","admin"))
        p=json.loads(json.dumps(self.packet))
        p["hubLink"]["claims"]["audience"]="GPT02_OPERATOR_LINK_V1"
        with self.assertRaises(BrokerAdmissionError): verify_lifecycle_evidence_packet(p,self.roots,self.now)
        p=json.loads(json.dumps(self.packet))
        p["hubLink"]["claims"]["coreRole"]="super_admin"
        with self.assertRaises(BrokerAdmissionError): verify_lifecycle_evidence_packet(p,self.roots,self.now)

    def test_expired_approval_fails(self):
        p=json.loads(json.dumps(self.packet));p["approval"]["claims"]["expiresAt"]=self.now-1
        with self.assertRaises(BrokerAdmissionError): verify_lifecycle_evidence_packet(p,self.roots,self.now)

    def test_task_135_136_are_rejected(self):
        for task in (135,136):
            p=json.loads(json.dumps(self.packet));p["approval"]["claims"]["taskId"]=task
            with self.assertRaises(BrokerAdmissionError): verify_lifecycle_evidence_packet(p,self.roots,self.now)

if __name__=="__main__": unittest.main()

[executed on device: srv1792369 (0891e23a-6a6b-4f8c-a16a-962e888e2014)]