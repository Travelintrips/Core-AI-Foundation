#!/usr/bin/env python3
from __future__ import annotations
import argparse,base64,hashlib,json,os,re,socket,stat,time
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROLES=("approval","hub","core","issuer")
APPROVAL_FIELDS=("v","environment","audience","taskId","commandId","attemptId","nonce","operatorNamespace","superAdminId","companyId","issuedAt","expiresAt")
LINK_FIELDS=("v","environment","audience","linkId","companyId","hubTaskId","hubExecutionId","coreTaskId","coreCommandId","attemptId","attemptNumber","assigneeId","accountableOwnerId","hubOperatorNamespace","hubOperatorId","hubRole","hubActive","coreOperatorNamespace","coreOperatorUserId","coreRole","coreActive","corePasswordChanged","workerId","approvalDigest","nonce","issuedAt","expiresAt")
ISSUER_FIELDS=("v","environment","audience","companyId","hubTaskId","hubExecutionId","coreTaskId","commandId","attemptId","workerId","receiptId","linkId","fenceId","approvalDigest","nonceDigest","issuerRole","leaseEpoch","issuedAt","expiresAt")
UUID=re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")
HEX=re.compile(r"^[0-9a-f]{64}$")
WORKER="openclaw-dell-chatgpt-wake-dev"
PRESIGN_SOCKET="/run/gpt02-reader/reader.sock"
APPROVED_PACKET="/opt/ai-coding-standalone-dev/gpt02_issue159_approved_claims.json"

def deny(code): raise RuntimeError(code)
def exact(o,fields): return isinstance(o,dict) and set(o)==set(fields)
def canonical(o,fields):
    if not exact(o,fields): deny("CLAIMS_SHAPE_INVALID")
    return json.dumps({k:o[k] for k in fields},ensure_ascii=False,separators=(",",":")).encode()
def unix_post(path,route,payload):
    st=os.lstat(path)
    if not stat.S_ISSOCK(st.st_mode) or stat.S_IMODE(st.st_mode)!=0o660: deny("TRUSTED_READER_SOCKET_INVALID")
    body=json.dumps(payload,separators=(",",":")).encode()
    req=(f"POST {route} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n").encode()+body
    s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM); s.settimeout(5)
    try:
        s.connect(path); s.sendall(req); chunks=[]; n=0
        while True:
            c=s.recv(4096)
            if not c: break
            n+=len(c)
            if n>65536: deny("TRUSTED_READER_RESPONSE_TOO_LARGE")
            chunks.append(c)
    finally: s.close()
    raw=b"".join(chunks); h,sep,b=raw.partition(b"\r\n\r\n")
    if not sep: deny("TRUSTED_READER_HTTP_INVALID")
    status=int(h.split(b" ",2)[1]); data=json.loads(b)
    return status,data
def approved_packet():
    p=Path(APPROVED_PACKET); st=os.lstat(p)
    if not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o600: deny("APPROVED_PACKET_SECURITY_INVALID")
    d=json.loads(p.read_text())
    if d.get("decision")!="APPROVE" or d.get("authMethod") not in ("supabase_admin_session","supabase_aal2"): deny("APPROVED_PACKET_INVALID")
    return d
def load_key(role):
    if role not in ROLES: deny("SIGNER_ROLE_INVALID")
    cd=os.environ.get("CREDENTIALS_DIRECTORY","")
    if not cd: deny("SYSTEMD_CREDENTIALS_REQUIRED")
    kb=Path(cd,"private-key.pkcs8").read_bytes(); key=serialization.load_der_private_key(kb,password=None); kb=b""
    if not isinstance(key,Ed25519PrivateKey): deny("ED25519_PRIVATE_KEY_REQUIRED")
    manifest=json.loads(Path(cd,"manifest.json").read_text())
    if set(manifest)!=set(ROLES): deny("MANIFEST_INVALID")
    der=key.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)
    if hashlib.sha256(der).hexdigest()!=manifest[role]: deny("PRIVATE_PUBLIC_FINGERPRINT_MISMATCH")
    return key
def validate_approval(c,packet,now):
    if not exact(c,APPROVAL_FIELDS) or c!=packet.get("claims"): deny("APPROVAL_NOT_APPROVED_PACKET")
    if c["taskId"]<=139 or c["environment"]!="DEV" or c["audience"]!="GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL" or c["companyId"]!="default" or c["operatorNamespace"]!="ai-task-hub.public.users": deny("APPROVAL_SCOPE_INVALID")
    if not UUID.fullmatch(c["commandId"]) or not UUID.fullmatch(c["attemptId"]) or c["commandId"]==c["attemptId"]: deny("APPROVAL_IDS_INVALID")
    if not isinstance(c["issuedAt"],int) or not isinstance(c["expiresAt"],int) or not(c["issuedAt"]<=now<c["expiresAt"]) or c["expiresAt"]-c["issuedAt"]>300000: deny("APPROVAL_TIME_INVALID")
    digest=hashlib.sha256(canonical(c,APPROVAL_FIELDS)).hexdigest()
    if digest!=packet.get("claimsSha256"): deny("APPROVAL_DIGEST_MISMATCH")
    return digest
def validate_link(c,packet,now):
    if not exact(c,LINK_FIELDS): deny("LINK_SHAPE_INVALID")
    a=packet.get("claims"); ad=validate_approval(a,packet,now)
    q={"companyId":c["companyId"],"hubTaskId":c["hubTaskId"],"commandCandidateId":c["coreCommandId"],"attemptId":c["attemptId"]}
    status,r=unix_post(PRESIGN_SOCKET,"/pre-sign-facts",q)
    if status!=200 or r.get("ok") is not True: deny("PRESIGN_FACTS_UNAVAILABLE")
    f=r["facts"]; p=f["prepared"]; h=f["hubOperator"]; core=f["core"]
    checks=[
      c["v"]==1,c["environment"]=="DEV",c["audience"]=="GPT02_DUAL_ACCOUNT_COMMAND_LINK",
      c["companyId"]==a["companyId"]=="default",c["hubTaskId"]==a["taskId"]==p["hubTaskId"],
      c["hubExecutionId"]==p["hubExecutionId"],c["coreTaskId"]==p["coreTaskId"],
      c["coreCommandId"]==a["commandId"]==p["commandCandidateId"],c["attemptId"]==a["attemptId"]==p["attemptId"],
      c["attemptNumber"]==1,c["assigneeId"]==p["memberId"],c["accountableOwnerId"]==h["accountableOwnerId"],
      c["hubOperatorNamespace"]=="ai-task-hub.public.users",c["hubOperatorId"]==a["superAdminId"]==h["subject"],
      c["hubRole"]=="super_admin",c["hubActive"] is True,
      c["coreOperatorNamespace"]=="ai-core.ai_platform.internal_users",c["coreOperatorUserId"]==core["operatorUserId"],
      c["coreRole"]==core["operatorRole"] and c["coreRole"] in ("owner","admin"),c["coreActive"] is True,c["corePasswordChanged"] is True,
      c["workerId"]==WORKER,c["approvalDigest"]==ad,c["nonce"]==a["nonce"],
      isinstance(c["issuedAt"],int),isinstance(c["expiresAt"],int),a["issuedAt"]<=c["issuedAt"]<=now<c["expiresAt"]<=a["expiresAt"],
      c["expiresAt"]-c["issuedAt"]<=120000,UUID.fullmatch(c["linkId"]) is not None
    ]
    if not all(checks): deny("LINK_BINDING_INVALID")
    return hashlib.sha256(canonical(c,LINK_FIELDS)).hexdigest()
def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--role",required=True,choices=ROLES); ap.add_argument("--claims",required=True); args=ap.parse_args()
    claims=json.loads(Path(args.claims).read_text()); now=int(time.time()*1000); packet=approved_packet()
    if args.role=="approval": digest=validate_approval(claims,packet,now); domain=b""; fields=APPROVAL_FIELDS
    elif args.role in ("hub","core"): digest=validate_link(claims,packet,now); domain=f"GPT02_OPERATOR_LINK_V1:{args.role}\n".encode(); fields=LINK_FIELDS
    else: deny("ISSUER_SIGNING_NOT_ENABLED_IN_THIS_STAGE")
    key=load_key(args.role); sig=key.sign(domain+canonical(claims,fields))
    out={"role":args.role,"digest":digest,"signatureBase64url":base64.urlsafe_b64encode(sig).decode().rstrip("="),"signingPermitted":False,"authorizationGranted":False,"dispatchPermitted":False,"releaseDecision":"NO_GO"}
    print(json.dumps(out,separators=(",",":"),sort_keys=True))
if __name__=="__main__":
    try: main()
    except Exception as e:
        print(str(e),file=os.sys.stderr); raise SystemExit(2)
