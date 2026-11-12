import base64,hashlib,importlib.util,json,os,tempfile,threading,unittest
from pathlib import Path
from http.server import BaseHTTPRequestHandler
from socketserver import UnixStreamServer
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT=Path(__file__).resolve().parents[2]
TARGET=ROOT/"deploy/ai-coding-standalone-dev/gpt02_issue159_operational_sign_once.py"
spec=importlib.util.spec_from_file_location("sign_once",TARGET)
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

def claims():
    a={"v":2,"environment":"DEV","audience":"GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL","taskId":147,
       "commandId":"11111111-1111-1111-1111-111111111111","attemptId":"22222222-2222-2222-2222-222222222222",
       "nonce":"A"*40,"operatorNamespace":"ai-task-hub.public.users","superAdminId":"hub_admin","companyId":"default",
       "issuedAt":100000,"expiresAt":300000}
    l={"v":1,"environment":"DEV","audience":"GPT02_DUAL_ACCOUNT_COMMAND_LINK","linkId":"33333333-3333-3333-3333-333333333333",
       "companyId":"default","hubTaskId":147,"hubExecutionId":"44444444-4444-4444-4444-444444444444",
       "coreTaskId":"55555555-5555-5555-5555-555555555555","coreCommandId":a["commandId"],"attemptId":a["attemptId"],
       "attemptNumber":1,"assigneeId":5,"accountableOwnerId":"hub_admin","hubOperatorNamespace":"ai-task-hub.public.users",
       "hubOperatorId":"hub_admin","hubRole":"super_admin","hubActive":True,"coreOperatorNamespace":"ai-core.ai_platform.internal_users",
       "coreOperatorUserId":7,"coreRole":"owner","coreActive":True,"corePasswordChanged":True,"workerId":m.WORKER,
       "approvalDigest":hashlib.sha256(m.canonical(a,m.APPROVAL_FIELDS)).hexdigest(),"nonce":a["nonce"],
       "issuedAt":110000,"expiresAt":220000}
    return a,l

class Handler(BaseHTTPRequestHandler):
    facts=None
    def do_POST(self):
        length=int(self.headers.get("Content-Length","0")); q=json.loads(self.rfile.read(length))
        f=self.__class__.facts
        if self.path!="/pre-sign-facts":
            self.send_response(404); self.end_headers(); return
        body=json.dumps({"ok":True,"environment":"DEV","facts":f,"signingPermitted":False,
                         "authorizationGranted":False,"dispatchPermitted":False,"releaseDecision":"NO_GO"}).encode()
        self.send_response(200); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self,*args): pass

class TestSignOnce(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory(); self.root=Path(self.t.name)
        self.a,self.l=claims()
        self.packet=self.root/"approved.json"
        self.packet.write_text(json.dumps({"claims":self.a,"decision":"APPROVE","authMethod":"supabase_admin_session",
                                           "claimsSha256":hashlib.sha256(m.canonical(self.a,m.APPROVAL_FIELDS)).hexdigest()}))
        os.chmod(self.packet,0o600)
        self.old_packet=m.APPROVED_PACKET; m.APPROVED_PACKET=str(self.packet)
        self.socket=str(self.root/"reader.sock")
        Handler.facts={"prepared":{"companyId":"default","hubTaskId":147,"memberId":5,"memberAuditId":9,"operatorSubject":"hub_admin",
                                   "coreTaskId":self.l["coreTaskId"],"hubExecutionId":self.l["hubExecutionId"],
                                   "commandCandidateId":self.a["commandId"],"attemptId":self.a["attemptId"],"expiresAt":400000},
                       "job":{"companyId":"default","taskId":147,"executionId":self.l["hubExecutionId"],"status":"prepared","commandId":None,
                              "workerCommandCount":0,"attemptNumber":1,"dispatchStarted":False,"memberId":5,"memberAuditId":9,"operatorSubject":"hub_admin"},
                       "core":{"taskId":self.l["coreTaskId"],"commandCandidateId":self.a["commandId"],"attemptId":self.a["attemptId"],
                               "status":"PENDING","commandCount":0,"runCount":0,"workerId":m.WORKER,"operatorUserId":7,
                               "operatorRole":"owner","operatorActive":True,"passwordChanged":True},
                       "hubOperator":{"subject":"hub_admin","role":"super_admin","active":True,"memberId":5,"accountableOwnerId":"hub_admin"},
                       "hubAssignment":{"action":"gpt02_pic_assigned","entityId":"147","actorId":"hub_admin","actorRole":"super_admin","actorActive":True},
                       "observedAt":120000,"trustedReadProof":{"source":"gpt02-issue159-presign-reader"}}
        self.server=UnixStreamServer(self.socket,Handler); self.thread=threading.Thread(target=self.server.serve_forever,daemon=True); self.thread.start()
        os.chmod(self.socket,0o660); self.old_socket=m.PRESIGN_SOCKET; m.PRESIGN_SOCKET=self.socket
    def tearDown(self):
        m.APPROVED_PACKET=self.old_packet; m.PRESIGN_SOCKET=self.old_socket
        self.server.shutdown(); self.server.server_close(); self.t.cleanup()
    def test_approval_and_link_validation(self):
        d=m.validate_approval(self.a,m.approved_packet(),120000)
        self.assertEqual(d,self.l["approvalDigest"])
        ld=m.validate_link(self.l,m.approved_packet(),120000)
        self.assertEqual(ld,hashlib.sha256(m.canonical(self.l,m.LINK_FIELDS)).hexdigest())
    def test_tampered_link_fails(self):
        bad={**self.l,"coreOperatorUserId":8}
        with self.assertRaisesRegex(RuntimeError,"LINK_BINDING_INVALID"):
            m.validate_link(bad,m.approved_packet(),120000)
    def test_expired_approval_fails(self):
        with self.assertRaisesRegex(RuntimeError,"APPROVAL_TIME_INVALID"):
            m.validate_approval(self.a,m.approved_packet(),300001)
    def test_key_fingerprint_binding(self):
        creds=self.root/"creds"; creds.mkdir()
        keys={}; manifest={}
        for role in m.ROLES:
            k=Ed25519PrivateKey.generate(); keys[role]=k
            der=k.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)
            manifest[role]=hashlib.sha256(der).hexdigest()
        (creds/"manifest.json").write_text(json.dumps(manifest))
        (creds/"private-key.pkcs8").write_bytes(keys["approval"].private_bytes(serialization.Encoding.DER,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
        old=os.environ.get("CREDENTIALS_DIRECTORY"); os.environ["CREDENTIALS_DIRECTORY"]=str(creds)
        try: self.assertIsInstance(m.load_key("approval"),Ed25519PrivateKey)
        finally:
            if old is None: os.environ.pop("CREDENTIALS_DIRECTORY",None)
            else: os.environ["CREDENTIALS_DIRECTORY"]=old
    def test_issuer_is_not_enabled_in_source(self):
        source=TARGET.read_text()
        self.assertIn('ISSUER_SIGNING_NOT_ENABLED_IN_THIS_STAGE',source)
        self.assertNotIn('"dispatchPermitted":True',source)

if __name__=="__main__": unittest.main()
