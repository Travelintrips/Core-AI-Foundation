import base64, hashlib, json, os, subprocess, sys, tempfile, time, unittest
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT=Path(__file__).resolve().parents[2]
SIGNER=ROOT/"deploy/ai-coding-standalone-dev/gpt02_issue159_sign_once.py"
ROLES=("approval","hub","core","issuer")

def fixture(root:Path):
    creds=root/"creds"; creds.mkdir()
    keys={}; manifest={}
    for role in ROLES:
        key=Ed25519PrivateKey.generate(); keys[role]=key
        der=key.public_key().public_bytes(serialization.Encoding.DER,
                                          serialization.PublicFormat.SubjectPublicKeyInfo)
        manifest[role]=hashlib.sha256(der).hexdigest()
    (creds/"manifest.json").write_text(json.dumps(manifest)); os.chmod(creds/"manifest.json",0o600)
    return creds,keys,manifest

def claims(role,now):
    approval={"v":2,"environment":"DEV","audience":"GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
      "taskId":200,"commandId":"11111111-1111-4111-8111-111111111111",
      "attemptId":"22222222-2222-4222-8222-222222222222",
      "nonce":"A"*40,"operatorNamespace":"ai-task-hub.public.users",
      "superAdminId":"google_test_admin","companyId":"default",
      "issuedAt":now-100,"expiresAt":now+5000}
    if role=="approval": return approval
    link={"v":1,"environment":"DEV","audience":"GPT02_DUAL_ACCOUNT_COMMAND_LINK",
      "linkId":"33333333-3333-4333-8333-333333333333","companyId":"default",
      "hubTaskId":200,"hubExecutionId":"44444444-4444-4444-8444-444444444444",
      "coreTaskId":"55555555-5555-4555-8555-555555555555",
      "coreCommandId":approval["commandId"],"attemptId":approval["attemptId"],
      "attemptNumber":1,"assigneeId":5,"accountableOwnerId":"google_test_admin",
      "hubOperatorNamespace":"ai-task-hub.public.users","hubOperatorId":"google_test_admin",
      "hubRole":"super_admin","hubActive":True,
      "coreOperatorNamespace":"ai-core.ai_platform.internal_users","coreOperatorUserId":2,
      "coreRole":"admin","coreActive":True,"corePasswordChanged":True,
      "workerId":"openclaw-dell-chatgpt-wake-dev","approvalDigest":"b"*64,
      "nonce":approval["nonce"],"issuedAt":now,"expiresAt":now+5000}
    if role in ("hub","core"): return link
    return {"v":1,"environment":"DEV","audience":"GPT02_ISSUER_LEASE_EVIDENCE_V1",
      "companyId":"default","hubTaskId":200,
      "hubExecutionId":link["hubExecutionId"],"coreTaskId":link["coreTaskId"],
      "commandId":approval["commandId"],"attemptId":approval["attemptId"],
      "workerId":"openclaw-dell-chatgpt-wake-dev",
      "receiptId":"66666666-6666-4666-8666-666666666666",
      "linkId":link["linkId"],"fenceId":"77777777-7777-4777-8777-777777777777",
      "approvalDigest":"b"*64,"nonceDigest":"c"*64,
      "issuerRole":"dev_gpt02_issuer_evidence","leaseEpoch":1,
      "issuedAt":now,"expiresAt":now+5000}

class SignOnceTest(unittest.TestCase):
    def test_all_four_roles_sign_exact_domain_and_digest(self):
        now=int(time.time()*1000)
        for role in ROLES:
            with self.subTest(role=role), tempfile.TemporaryDirectory() as td:
                root=Path(td); creds,keys,_=fixture(root)
                (creds/"private-key.pkcs8").write_bytes(keys[role].private_bytes(
                    serialization.Encoding.DER,serialization.PrivateFormat.PKCS8,
                    serialization.NoEncryption()))
                os.chmod(creds/"private-key.pkcs8",0o600)
                c=claims(role,now); cp=root/"claims.json"; cp.write_text(json.dumps(c)); os.chmod(cp,0o600)
                out=root/"result.json"
                env=dict(os.environ,APP_ENV="development",CREDENTIALS_DIRECTORY=str(creds))
                p=subprocess.run([sys.executable,str(SIGNER),"--role",role,
                                  "--claims",str(cp),"--output",str(out)],
                                 env=env,capture_output=True,text=True,timeout=5)
                self.assertEqual(p.returncode,0,p.stderr)
                d=json.loads(out.read_text())
                self.assertEqual(d["role"],role)
                self.assertFalse(d["authorizationGranted"])
                self.assertFalse(d["dispatchPermitted"])
                fields={
                  "approval":("v","environment","audience","taskId","commandId","attemptId","nonce","operatorNamespace","superAdminId","companyId","issuedAt","expiresAt"),
                  "hub":("v","environment","audience","linkId","companyId","hubTaskId","hubExecutionId","coreTaskId","coreCommandId","attemptId","attemptNumber","assigneeId","accountableOwnerId","hubOperatorNamespace","hubOperatorId","hubRole","hubActive","coreOperatorNamespace","coreOperatorUserId","coreRole","coreActive","corePasswordChanged","workerId","approvalDigest","nonce","issuedAt","expiresAt"),
                  "core":("v","environment","audience","linkId","companyId","hubTaskId","hubExecutionId","coreTaskId","coreCommandId","attemptId","attemptNumber","assigneeId","accountableOwnerId","hubOperatorNamespace","hubOperatorId","hubRole","hubActive","coreOperatorNamespace","coreOperatorUserId","coreRole","coreActive","corePasswordChanged","workerId","approvalDigest","nonce","issuedAt","expiresAt"),
                  "issuer":("v","environment","audience","companyId","hubTaskId","hubExecutionId","coreTaskId","commandId","attemptId","workerId","receiptId","linkId","fenceId","approvalDigest","nonceDigest","issuerRole","leaseEpoch","issuedAt","expiresAt")
                }[role]
                canonical=json.dumps({k:c[k] for k in fields},separators=(",",":")).encode()
                domain=b"" if role=="approval" else (
                  ("GPT02_OPERATOR_LINK_V1:"+role+"\n").encode() if role in ("hub","core")
                  else b"GPT02_ISSUER_LEASE_EVIDENCE_V1\n")
                sig=base64.urlsafe_b64decode(d["signatureBase64url"]+"==")
                keys[role].public_key().verify(sig,domain+canonical)
                self.assertEqual(d["claimsSha256"],hashlib.sha256(canonical).hexdigest())

    def test_expired_and_wrong_fingerprint_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); creds,keys,manifest=fixture(root)
            wrong=Ed25519PrivateKey.generate()
            (creds/"private-key.pkcs8").write_bytes(wrong.private_bytes(
                serialization.Encoding.DER,serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption())); os.chmod(creds/"private-key.pkcs8",0o600)
            now=int(time.time()*1000); c=claims("approval",now)
            cp=root/"claims.json"; cp.write_text(json.dumps(c)); os.chmod(cp,0o600)
            env=dict(os.environ,APP_ENV="development",CREDENTIALS_DIRECTORY=str(creds))
            p=subprocess.run([sys.executable,str(SIGNER),"--role","approval","--claims",str(cp),
                              "--output",str(root/"o.json")],env=env,capture_output=True,text=True)
            self.assertEqual(p.returncode,2); self.assertIn("PRIVATE_PUBLIC_FINGERPRINT_MISMATCH",p.stderr)
            (creds/"private-key.pkcs8").write_bytes(keys["approval"].private_bytes(
                serialization.Encoding.DER,serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption())); os.chmod(creds/"private-key.pkcs8",0o600)
            c["issuedAt"]=now-10000;c["expiresAt"]=now-5000;cp.write_text(json.dumps(c));os.chmod(cp,0o600)
            p=subprocess.run([sys.executable,str(SIGNER),"--role","approval","--claims",str(cp),
                              "--output",str(root/"o2.json")],env=env,capture_output=True,text=True)
            self.assertEqual(p.returncode,2); self.assertIn("CLAIMS_TIME_INVALID",p.stderr)

if __name__=="__main__": unittest.main()
