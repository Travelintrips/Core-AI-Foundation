#!/usr/bin/env python3
"""DEV-only one-shot detached signer for GPT02 Issue159.

Loads exactly one systemd-mounted Ed25519 private key, verifies its public
fingerprint against the pinned manifest, validates an exact role-specific
claims object, writes one detached signature result, and exits.

No network, database, task creation, nonce/lease mutation or dispatch surface.
"""
from __future__ import annotations
import argparse, base64, hashlib, json, os, re, stat, sys, time
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROLES=("approval","hub","core","issuer")
UUID=re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")
HEX=re.compile(r"^[0-9a-f]{64}$")
NONCE=re.compile(r"^[A-Za-z0-9_-]{32,128}$")
SUBJECT=re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$")
WORKER="openclaw-dell-chatgpt-wake-dev"

APPROVAL_FIELDS=("v","environment","audience","taskId","commandId","attemptId",
 "nonce","operatorNamespace","superAdminId","companyId","issuedAt","expiresAt")
LINK_FIELDS=("v","environment","audience","linkId","companyId","hubTaskId",
 "hubExecutionId","coreTaskId","coreCommandId","attemptId","attemptNumber",
 "assigneeId","accountableOwnerId","hubOperatorNamespace","hubOperatorId",
 "hubRole","hubActive","coreOperatorNamespace","coreOperatorUserId","coreRole",
 "coreActive","corePasswordChanged","workerId","approvalDigest","nonce",
 "issuedAt","expiresAt")
ISSUER_FIELDS=("v","environment","audience","companyId","hubTaskId",
 "hubExecutionId","coreTaskId","commandId","attemptId","workerId","receiptId",
 "linkId","fenceId","approvalDigest","nonceDigest","issuerRole","leaseEpoch",
 "issuedAt","expiresAt")

def fail(code:str):
    raise RuntimeError(code)

def exact(obj,fields):
    return isinstance(obj,dict) and set(obj)==set(fields)

def canonical(claims,fields):
    if not exact(claims,fields): fail("CLAIMS_FIELDS_INVALID")
    return json.dumps({k:claims[k] for k in fields},ensure_ascii=False,
                      separators=(",",":"),allow_nan=False)

def validate(role,claims,now_ms):
    if role=="approval":
        if not exact(claims,APPROVAL_FIELDS): fail("APPROVAL_FIELDS_INVALID")
        if (claims["v"]!=2 or claims["environment"]!="DEV" or
            claims["audience"]!="GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL" or
            not isinstance(claims["taskId"],int) or claims["taskId"]<=139 or
            not UUID.fullmatch(str(claims["commandId"])) or
            not UUID.fullmatch(str(claims["attemptId"])) or
            claims["commandId"]==claims["attemptId"] or
            not NONCE.fullmatch(str(claims["nonce"])) or
            claims["operatorNamespace"]!="ai-task-hub.public.users" or
            not SUBJECT.fullmatch(str(claims["superAdminId"])) or
            claims["companyId"]!="default"):
            fail("APPROVAL_SCOPE_INVALID")
        max_ms=300_000
        domain=b""
        fields=APPROVAL_FIELDS
    elif role in ("hub","core"):
        if not exact(claims,LINK_FIELDS): fail("LINK_FIELDS_INVALID")
        uuids=("linkId","hubExecutionId","coreTaskId","coreCommandId","attemptId")
        if (claims["v"]!=1 or claims["environment"]!="DEV" or
            claims["audience"]!="GPT02_DUAL_ACCOUNT_COMMAND_LINK" or
            claims["companyId"]!="default" or
            not isinstance(claims["hubTaskId"],int) or claims["hubTaskId"]<=139 or
            not all(UUID.fullmatch(str(claims[k])) for k in uuids) or
            claims["attemptNumber"]!=1 or
            not isinstance(claims["assigneeId"],int) or claims["assigneeId"]<=0 or
            claims["accountableOwnerId"]!=claims["hubOperatorId"] or
            claims["hubOperatorNamespace"]!="ai-task-hub.public.users" or
            not SUBJECT.fullmatch(str(claims["hubOperatorId"])) or
            claims["hubRole"]!="super_admin" or claims["hubActive"] is not True or
            claims["coreOperatorNamespace"]!="ai-core.ai_platform.internal_users" or
            not isinstance(claims["coreOperatorUserId"],int) or
            claims["coreOperatorUserId"]<=0 or
            claims["coreRole"] not in ("owner","admin") or
            claims["coreActive"] is not True or
            claims["corePasswordChanged"] is not True or
            claims["workerId"]!=WORKER or
            not HEX.fullmatch(str(claims["approvalDigest"])) or
            not NONCE.fullmatch(str(claims["nonce"]))):
            fail("LINK_SCOPE_INVALID")
        max_ms=120_000
        domain=("GPT02_OPERATOR_LINK_V1:"+role+"\n").encode()
        fields=LINK_FIELDS
    elif role=="issuer":
        if not exact(claims,ISSUER_FIELDS): fail("ISSUER_FIELDS_INVALID")
        uuids=("hubExecutionId","coreTaskId","commandId","attemptId",
               "receiptId","linkId","fenceId")
        if (claims["v"]!=1 or claims["environment"]!="DEV" or
            claims["audience"]!="GPT02_ISSUER_LEASE_EVIDENCE_V1" or
            claims["companyId"]!="default" or
            not isinstance(claims["hubTaskId"],int) or claims["hubTaskId"]<=139 or
            not all(UUID.fullmatch(str(claims[k])) for k in uuids) or
            claims["workerId"]!=WORKER or
            not HEX.fullmatch(str(claims["approvalDigest"])) or
            not HEX.fullmatch(str(claims["nonceDigest"])) or
            claims["issuerRole"]!="dev_gpt02_issuer_evidence" or
            claims["leaseEpoch"]!=1):
            fail("ISSUER_SCOPE_INVALID")
        max_ms=15_000
        domain=b"GPT02_ISSUER_LEASE_EVIDENCE_V1\n"
        fields=ISSUER_FIELDS
    else:
        fail("SIGNER_ROLE_INVALID")
    issued=claims.get("issuedAt"); expires=claims.get("expiresAt")
    if (type(issued) is not int or type(expires) is not int or
        issued<0 or expires<=issued or expires-issued>max_ms or
        now_ms<issued-1000 or now_ms>=expires):
        fail("CLAIMS_TIME_INVALID")
    payload=canonical(claims,fields).encode("utf-8")
    return domain+payload,payload

def secure_file(path:str, label:str):
    st=os.lstat(path)
    if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode):
        fail(label+"_FILE_INVALID")
    if st.st_uid!=0 or stat.S_IMODE(st.st_mode)&0o077:
        fail(label+"_FILE_SECURITY_INVALID")
    return st

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--role",required=True,choices=ROLES)
    ap.add_argument("--claims",required=True)
    ap.add_argument("--output",required=True)
    args=ap.parse_args()
    if os.environ.get("APP_ENV")!="development":
        fail("EXPLICIT_DEV_MODE_REQUIRED")
    creds=os.environ.get("CREDENTIALS_DIRECTORY","")
    if not creds: fail("SYSTEMD_CREDENTIALS_REQUIRED")
    secure_file(args.claims,"CLAIMS")
    claims=json.loads(Path(args.claims).read_text(encoding="utf-8"))
    now_ms=int(time.time()*1000)
    signing_bytes,canonical_bytes=validate(args.role,claims,now_ms)

    key_path=str(Path(creds)/"private-key.pkcs8")
    manifest_path=str(Path(creds)/"manifest.json")
    key_bytes=Path(key_path).read_bytes()
    try:
        key=serialization.load_der_private_key(key_bytes,password=None)
    finally:
        key_bytes=b""
    if not isinstance(key,Ed25519PrivateKey): fail("ED25519_PRIVATE_KEY_REQUIRED")
    manifest=json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    if not isinstance(manifest,dict) or set(manifest)!=set(ROLES):
        fail("FINGERPRINT_MANIFEST_INVALID")
    der=key.public_key().public_bytes(serialization.Encoding.DER,
                                      serialization.PublicFormat.SubjectPublicKeyInfo)
    fp=hashlib.sha256(der).hexdigest()
    if manifest.get(args.role)!=fp: fail("PRIVATE_PUBLIC_FINGERPRINT_MISMATCH")

    sig=base64.urlsafe_b64encode(key.sign(signing_bytes)).decode().rstrip("=")
    if len(sig)!=86: fail("SIGNATURE_ENCODING_INVALID")
    digest=hashlib.sha256(canonical_bytes).hexdigest()
    out={"environment":"DEV","role":args.role,"algorithm":"Ed25519",
         "claimsSha256":digest,"signatureBase64url":sig,
         "fingerprintMatched":True,"authorizationGranted":False,
         "dispatchPermitted":False,"releaseDecision":"NO_GO"}
    target=Path(args.output)
    tmp=target.with_name("."+target.name+".tmp")
    tmp.write_text(json.dumps(out,sort_keys=True,separators=(",",":"))+"\n",encoding="utf-8")
    os.chmod(tmp,0o600)
    os.replace(tmp,target)
    return 0

if __name__=="__main__":
    try: sys.exit(main())
    except Exception as exc:
        print(str(exc),file=sys.stderr)
        sys.exit(2)
