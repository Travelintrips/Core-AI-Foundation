import base64
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from gpt02_issue159_writer_broker_contract import (
    APPROVAL_FIELDS, LINK_FIELDS, ISSUER_FIELDS,
)
from gpt02_issue159_writer_broker_runtime import ROOT_FILES


def b64(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def sign(key, claims, fields, domain=b""):
    raw=json.dumps({k:claims[k] for k in fields},ensure_ascii=False,separators=(",",":")).encode()
    return b64(key.sign(domain+raw))


class WriterBrokerRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.public=self.root/"public"
        self.public.mkdir(mode=0o700)
        self.socket_path=self.root/"run"/"verify.sock"
        self.manifest=self.root/"trust-fingerprints.json"
        self.socket_path.parent.mkdir(mode=0o700)
        self.keys={r:Ed25519PrivateKey.generate() for r in ROOT_FILES}
        fingerprints={}
        import hashlib
        for role,filename in ROOT_FILES.items():
            pem=self.keys[role].public_key().public_bytes(
                serialization.Encoding.PEM,
                serialization.PublicFormat.SubjectPublicKeyInfo,
            )
            (self.public/filename).write_bytes(pem)
            os.chmod(self.public/filename,0o600)
            der=self.keys[role].public_key().public_bytes(
                serialization.Encoding.DER,
                serialization.PublicFormat.SubjectPublicKeyInfo,
            )
            fingerprints[role]=hashlib.sha256(der).hexdigest()
        self.manifest.write_text(json.dumps(fingerprints),encoding="utf-8")
        os.chmod(self.manifest,0o600)
        self.now=int(time.time()*1000)
        self.packet=self._packet()

    def tearDown(self):
        if getattr(self,"proc",None) and self.proc.poll() is None:
            self.proc.terminate()
            try:self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:self.proc.kill()
        if getattr(self,"proc",None):
            if self.proc.stdout: self.proc.stdout.close()
            if self.proc.stderr: self.proc.stderr.close()
        self.tmp.cleanup()

    def _packet(self):
        import hashlib
        a={"v":2,"environment":"DEV","audience":"GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
           "taskId":140,"commandId":"10000000-0000-4000-8000-000000000001",
           "attemptId":"20000000-0000-4000-8000-000000000002","nonce":"N"*40,
           "operatorNamespace":"ai-task-hub.public.users","superAdminId":"sup-admin-test",
           "companyId":"default","issuedAt":self.now-1000,"expiresAt":self.now+120000}
        ad=hashlib.sha256(json.dumps({k:a[k] for k in APPROVAL_FIELDS},separators=(",",":")).encode()).hexdigest()
        l={"v":1,"environment":"DEV","audience":"GPT02_DUAL_ACCOUNT_COMMAND_LINK",
           "linkId":"30000000-0000-4000-8000-000000000003","companyId":"default",
           "hubTaskId":140,"hubExecutionId":"40000000-0000-4000-8000-000000000004",
           "coreTaskId":"50000000-0000-4000-8000-000000000005",
           "coreCommandId":a["commandId"],"attemptId":a["attemptId"],"attemptNumber":1,
           "assigneeId":5,"accountableOwnerId":"sup-admin-test",
           "hubOperatorNamespace":"ai-task-hub.public.users","hubOperatorId":"sup-admin-test",
           "hubRole":"super_admin","hubActive":True,"coreOperatorNamespace":"ai-core.ai_platform.internal_users",
           "coreOperatorUserId":5,"coreRole":"admin","coreActive":True,
           "corePasswordChanged":True,"workerId":"openclaw-dell-chatgpt-wake-dev",
           "approvalDigest":ad,"nonce":a["nonce"],"issuedAt":self.now-900,
           "expiresAt":self.now+90000}
        i={"v":1,"environment":"DEV","audience":"GPT02_ISSUER_LEASE_EVIDENCE_V1",
           "companyId":"default","hubTaskId":140,"hubExecutionId":l["hubExecutionId"],
           "coreTaskId":l["coreTaskId"],"commandId":a["commandId"],"attemptId":a["attemptId"],
           "workerId":"openclaw-dell-chatgpt-wake-dev",
           "receiptId":"60000000-0000-4000-8000-000000000006","linkId":l["linkId"],
           "fenceId":"70000000-0000-4000-8000-000000000007","approvalDigest":ad,
           "nonceDigest":hashlib.sha256(a["nonce"].encode()).hexdigest(),
           "issuerRole":"dev_gpt02_issuer_evidence","leaseEpoch":1,
           "issuedAt":self.now-100,"expiresAt":self.now+5000}
        return {
          "approval":{"claims":a,"signature":sign(self.keys["approval"],a,APPROVAL_FIELDS)},
          "hubLink":{"claims":l,"signature":sign(self.keys["hub"],l,LINK_FIELDS,b"GPT02_OPERATOR_LINK_V1:hub\n")},
          "coreLink":{"claims":l,"signature":sign(self.keys["core"],l,LINK_FIELDS,b"GPT02_OPERATOR_LINK_V1:core\n")},
          "issuerEvidence":{"claims":i,"signature":sign(self.keys["issuer"],i,ISSUER_FIELDS,b"GPT02_ISSUER_LEASE_EVIDENCE_V1\n")},
        }

    def _pin_synthetic_public_roots(self):
        files=[str(p) for p in self.public.iterdir()]+[str(self.manifest)]
        if os.geteuid()!=0:
            subprocess.run(["sudo","-n","chown","root:root",*files],check=True)
            subprocess.run(["sudo","-n","chmod","0644",*files],check=True)

    def _start(self):
        runtime=Path(__file__).parents[2]/"deploy/ai-coding-standalone-dev/gpt02_issue159_writer_broker_runtime.py"
        env=dict(os.environ)
        env["PYTHONPATH"]=str(runtime.parent)
        self._pin_synthetic_public_roots()
        import grp
        socket_group=grp.getgrgid(os.getgid()).gr_name
        # The private Unix socket directory must belong to the service identity.
        # Never elevate the socket listener: only the synthetic public roots are
        # made root-owned for the explicit production ownership preflight.
        self.proc=subprocess.Popen([
            sys.executable,str(runtime),"--socket",str(self.socket_path),
            "--public-roots",str(self.public),"--fingerprint-manifest",str(self.manifest),
            "--socket-group",socket_group,
        ],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        deadline=time.time()+5
        while time.time()<deadline and not self.socket_path.exists():
            if self.proc.poll() is not None:
                raise AssertionError(self.proc.stderr.read().decode())
            time.sleep(.025)
        self.assertTrue(self.socket_path.exists())

    def _post(self,packet):
        body=json.dumps({"packet":packet,"observedAt":self.now},separators=(",",":")).encode()
        request=(b"POST /verify-packet HTTP/1.1\r\nHost: localhost\r\n"
                 b"Content-Type: application/json\r\nContent-Length: "+str(len(body)).encode()+
                 b"\r\nConnection: close\r\n\r\n"+body)
        client=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);client.settimeout(3)
        try:
            client.connect(str(self.socket_path));client.sendall(request)
            data=b""
            while True:
                chunk=client.recv(4096)
                if not chunk:break
                data+=chunk
        finally:client.close()
        head,_,raw=data.partition(b"\r\n\r\n")
        return int(head.split()[1]),json.loads(raw)

    def test_socket_returns_verified_but_no_authority(self):
        self._start()
        status,out=self._post(self.packet)
        self.assertEqual(status,200)
        self.assertTrue(out["result"]["packetVerified"])
        self.assertFalse(out["databaseConnected"])
        self.assertFalse(out["writerEnabled"])
        self.assertFalse(out["signingPermitted"])
        self.assertFalse(out["authorizationGranted"])
        self.assertFalse(out["dispatchPermitted"])
        self.assertEqual(out["releaseDecision"],"NO_GO")

    def test_socket_rejects_tampered_packet(self):
        self._start()
        packet=json.loads(json.dumps(self.packet))
        packet["approval"]["claims"]["taskId"]=141
        status,out=self._post(packet)
        self.assertEqual(status,400)
        self.assertFalse(out["ok"])
        self.assertEqual(out["releaseDecision"],"NO_GO")

    def test_unknown_route_rejected(self):
        self._start()
        c=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);c.settimeout(3)
        try:
            c.connect(str(self.socket_path))
            c.sendall(b"GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            data=c.recv(1024)
        finally:c.close()
        self.assertIn(b"404",data.split(b"\r\n",1)[0])

    def test_public_root_manifest_drift_fails_closed(self):
        roots=json.loads(self.manifest.read_text())
        roots["approval"]="0"*64
        self.manifest.write_text(json.dumps(roots))
        self._pin_synthetic_public_roots()
        from gpt02_issue159_writer_broker_runtime import _load_public_roots
        with self.assertRaisesRegex(RuntimeError,"PUBLIC_ROOT_FINGERPRINT_PIN_MISMATCH"):
            _load_public_roots(str(self.public),str(self.manifest))

    def test_runtime_source_has_no_database_or_dispatch_surface(self):
        p=Path(__file__).parents[2]/"deploy/ai-coding-standalone-dev/gpt02_issue159_writer_broker_runtime.py"
        body=p.read_text()
        for forbidden in ("psycopg","sqlite3","psycopg2","create_engine","INSERT INTO","UPDATE ","DELETE FROM","Ed25519PrivateKey","key.sign("):
            self.assertNotIn(forbidden,body)

if __name__=="__main__":unittest.main()