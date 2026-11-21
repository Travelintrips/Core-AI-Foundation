#!/usr/bin/env python3
"""CST-DEV VPS-only one-job Ed25519 socket signer. Default DENY, no DB/dispatch.

An independently signed, exact-payload, five-minute permit is required for
every signature, in addition to the systemd-host-encrypted private credential.
This does not prove independent hardware custody or an operational Final ACK.
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
import pathlib
import pwd
import re
import signal
import socket
import stat
import struct
import sys
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

PROJECT = "xssrfshdrtdfupgqwfdw"
HOST = "srv1792369"
USERS = {
    "qa-evidence": ("cst1j-sig-qa-evidence", "cst1j-op-qa", ("QA_PRE_ADMISSION", "QA_POST_EXECUTION")),
    "subscriber-ack": ("cst1j-sig-subscriber", "cst-onejob-subscriber", ("SUBSCRIBER_DELIVERY_ACK",)),
    "core-reconciliation": ("cst1j-sig-core", "cst1j-op-core", ("CORE_RECONCILIATION",)),
    "agent-coding": ("cst1j-sig-coding", "cst1j-op-coding", ("HUB_AGENT_CODING",)),
    "agent-infrastructure": ("cst1j-sig-infra", "cst1j-op-infra", ("HUB_AGENT_INFRASTRUCTURE",)),
    "agent-security": ("cst1j-sig-security", "cst1j-op-security", ("HUB_AGENT_SECURITY",)),
    "agent-qa": ("cst1j-sig-agentqa", "cst1j-op-agentqa", ("HUB_AGENT_QA",)),
    "reviewer": ("cst1j-sig-reviewer", "cst1j-op-reviewer", ("HUB_REVIEWER_FINAL_ACK",)),
}
FIELDS = (
    "v", "project", "companyId", "role", "purpose", "jobId", "sourceSha",
    "approvalId", "workerName", "payloadSha256", "nonce", "operatorUid",
    "signerUid", "publicKeyFingerprint", "issuedAt", "expiresAt"
)
DOMAIN = b"CST_DEV_ONEJOB_VPS_ONE_SIGNATURE_PERMIT_V1\n"
SHA = re.compile(r"^[a-f0-9]{64}$")
SHA40 = re.compile(r"^[a-f0-9]{40}$")
UUID = re.compile(r"^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$")
WORKER = re.compile(r"^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$")
STAMP = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")

def deny(reason):
    raise RuntimeError(reason)

def public_fingerprint(public):
    spki = public.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return hashlib.sha256(spki).hexdigest()

def root_file(path, limit=65536):
    p = pathlib.Path(path)
    if not p.is_absolute():
        deny("UNTRUSTED_PATH")
    for parent in [pathlib.Path("/"), *list(reversed(p.parents[:-1]))]:
        s = os.lstat(parent)
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
            deny("UNTRUSTED_PARENT")
    s = os.lstat(p)
    if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_nlink != 1 or s.st_mode & 0o022 or s.st_size > limit or s.st_size < 1:
        deny("UNTRUSTED_ROOT_FILE")
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        return os.read(fd, limit + 1)
    finally:
        os.close(fd)

def exact_time(value):
    if not isinstance(value,str) or not STAMP.fullmatch(value):
        deny("INVALID_TIME_FORMAT")
    parsed = datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ")
    return parsed.replace(tzinfo=datetime.timezone.utc).timestamp()

def validate_permit(permit, release_root, signer_fingerprint, role, uid, peer_uid, payload, now):
    if type(permit) is not dict or set(permit) != {"claims","signatureBase64"}:
        deny("PERMIT_ENVELOPE_SHAPE")
    c = permit["claims"]
    if type(c) is not dict or set(c) != set(FIELDS):
        deny("PERMIT_CLAIMS_SHAPE")
    signer, operator, purposes = USERS[role]
    if (c["v"] != 1 or c["project"] != PROJECT or c["companyId"] != "1"
        or c["role"] != role or c["purpose"] not in purposes
        or type(c["jobId"]) is not int or c["jobId"] <= 482
        or not isinstance(c["sourceSha"],str) or not SHA40.fullmatch(c["sourceSha"])
        or not isinstance(c["approvalId"],str) or not UUID.fullmatch(c["approvalId"])
        or not isinstance(c["workerName"],str) or not WORKER.fullmatch(c["workerName"])
        or not isinstance(c["payloadSha256"],str) or not SHA.fullmatch(c["payloadSha256"])
        or hashlib.sha256(payload).hexdigest() != c["payloadSha256"]
        or not isinstance(c["nonce"],str) or not SHA.fullmatch(c["nonce"])
        or type(c["operatorUid"]) is not int or c["operatorUid"] != peer_uid
        or type(c["signerUid"]) is not int or c["signerUid"] != uid
        or c["publicKeyFingerprint"] != signer_fingerprint):
        deny("PERMIT_NOT_BOUND_TO_APPROVED_JOB_PAYLOAD_IDENTITY")
    # The identity from the kernel must match the fixed role directory.
    if peer_uid != pwd.getpwnam(operator).pw_uid:
        deny("UNTRUSTED_OPERATOR_PEER")
    t0, t1 = exact_time(c["issuedAt"]), exact_time(c["expiresAt"])
    if not (t0 <= now < t1 and 0 < t1-t0 <= 300 and now-t0 <= 300):
        deny("PERMIT_EXPIRED_OR_TOO_LONG")
    signature = permit["signatureBase64"]
    if not isinstance(signature,str):
        deny("PERMIT_SIGNATURE_REQUIRED")
    try:
        raw = base64.b64decode(signature, validate=True)
    except Exception:
        deny("PERMIT_SIGNATURE_INVALID")
    if len(raw) != 64 or base64.b64encode(raw).decode("ascii") != signature:
        deny("PERMIT_SIGNATURE_INVALID")
    canonical = DOMAIN + json.dumps({key:c[key] for key in FIELDS},separators=(",",":"),ensure_ascii=False).encode()
    try:
        release_root.verify(raw, canonical)
    except Exception:
        deny("PERMIT_RELEASE_SIGNATURE_UNTRUSTED")
    return c["nonce"]

def load_private_and_pin(role, uid):
    folder=os.environ.get("CREDENTIALS_DIRECTORY","")
    if not folder:
        deny("SYSTEMD_CREDENTIAL_DIRECTORY_REQUIRED")
    encrypted=pathlib.Path(folder)/"private-key.pkcs8"
    if not encrypted.is_file() or encrypted.is_symlink() or encrypted.stat().st_size > 8192:
        deny("SYSTEMD_PRIVATE_CREDENTIAL_UNAVAILABLE")
    data=encrypted.read_bytes()
    try:
        key=serialization.load_der_private_key(data,password=None)
    finally:
        del data
    if not isinstance(key,Ed25519PrivateKey):
        deny("PRIVATE_KEY_TYPE_MISMATCH")
    approved=json.loads(root_file("/etc/cst-onejob-dev/approved-public/"+role+".json"))
    if set(approved) != {"project","role","publicKeyPem","fingerprint","approvedChangeId"}:
        deny("APPROVED_PUBLIC_ROOT_SHAPE")
    if approved["project"] != PROJECT or approved["role"] != role or not approved["approvedChangeId"]:
        deny("PUBLIC_ROOT_NOT_APPROVED")
    key_public=serialization.load_pem_public_key(approved["publicKeyPem"].encode())
    if not isinstance(key_public,Ed25519PublicKey):
        deny("PUBLIC_ROOT_KEY_INVALID")
    fp=public_fingerprint(key_public)
    if not SHA.fullmatch(approved["fingerprint"]) or approved["fingerprint"] != fp or public_fingerprint(key.public_key()) != fp:
        deny("ENCRYPTED_KEY_AND_APPROVED_TRUST_NOT_MATCHED")
    return key,fp

def recv_exact(conn,n):
    data=b""
    while len(data)<n:
        part=conn.recv(n-len(data))
        if not part:
            deny("SIGN_REQUEST_TRUNCATED")
        data+=part
    return data

def consume_nonce(root, nonce):
    path=pathlib.Path(root)
    if not path.is_dir() or path.is_symlink() or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
        deny("PERSISTENT_NONCE_DIRECTORY_UNSAFE")
    file=path/(nonce+".used")
    fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        os.write(fd,b"consumed\n")
        os.fsync(fd)
    finally:
        os.close(fd)

def serve(role,socket_path):
    if os.uname().nodename.split(".")[0]!=HOST or os.getuid() == 0:
        deny("WRONG_HOST_OR_ROOT")
    user,operator,_=USERS[role]
    uid=pwd.getpwnam(user).pw_uid
    if os.getuid()!=uid or os.geteuid()!=uid:
        deny("SIGNER_USER_SID_INVALID")
    if os.environ.get("CST_ONEJOB_LINUX_SIGNING_ENABLED","false") != "true":
        deny("SIGNER_DISABLED_BY_DEFAULT")
    key,fp=load_private_and_pin(role,uid)
    release_pem=root_file("/etc/cst-onejob-dev/operator-trust/release-public.pem")
    release_root=serialization.load_pem_public_key(release_pem)
    if not isinstance(release_root,Ed25519PublicKey):
        deny("RELEASE_PUBLIC_ROOT_INVALID")
    runtime=pathlib.Path(socket_path).parent
    s=os.lstat(runtime)
    if not stat.S_ISDIR(s.st_mode) or s.st_uid!=uid or s.st_mode & 0o027:
        deny("SIGNER_RUNTIME_DIRECTORY_UNSAFE")
    if pathlib.Path(socket_path).exists():
        deny("SIGNER_SOCKET_ALREADY_PRESENT")
    nonce_dir=os.environ.get("STATE_DIRECTORY","")
    if not nonce_dir:
        deny("SYSTEMD_DURABLE_REPLAY_LEDGER_MISSING")
    listener=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
    try:
        listener.bind(socket_path)
        os.chmod(socket_path,0o660)
        listener.listen(4)
        listener.settimeout(1)
        stopped=False
        def stop(_sig,_frame):
            nonlocal stopped
            stopped=True
        signal.signal(signal.SIGTERM,stop)
        signal.signal(signal.SIGINT,stop)
        while not stopped:
            try:
                conn,_=listener.accept()
            except socket.timeout:
                continue
            with conn:
                conn.settimeout(3)
                try:
                    pid,peer_uid,peer_gid=struct.unpack("3i",conn.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
                    if peer_uid != pwd.getpwnam(operator).pw_uid or peer_uid == uid:
                        deny("SO_PEERCRED_OPERATOR_DENIED")
                    n=struct.unpack(">I",recv_exact(conn,4))[0]
                    if n<64 or n>8192:
                        deny("SIGN_REQUEST_LENGTH_INVALID")
                    payload=recv_exact(conn,n)
                    permit=json.loads(root_file("/etc/cst-onejob-dev/authorized-releases/"+role+".json",8192))
                    nonce=validate_permit(permit,release_root,fp,role,uid,peer_uid,payload,
                                          datetime.datetime.now(datetime.timezone.utc).timestamp())
                    consume_nonce(nonce_dir,nonce)
                    conn.sendall(key.sign(payload))
                except Exception:
                    pass  # No oracle, no private bytes or claims in logs
    finally:
        listener.close()
        try:os.unlink(socket_path)
        except OSError:pass

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--role",choices=USERS)
    p.add_argument("--socket")
    p.add_argument("--preflight",action="store_true")
    a=p.parse_args()
    if a.preflight:
        print(json.dumps({"project":PROJECT,"roles":len(USERS),"signaturesIssued":0,
                          "signingEnabled":False,"releaseDecision":"NO_GO"}))
        return 0
    if not a.role or not a.socket:
        deny("ROLE_AND_FIXED_SOCKET_REQUIRED")
    expected= {
        "qa-evidence":"/run/cst-onejob-qa/sign.sock",
        "subscriber-ack":"/run/cst-onejob-subscriber/sign.sock",
        "core-reconciliation":"/run/cst-onejob-core-reconciliation/sign.sock",
    }.get(a.role,"/run/cst-onejob-hub-"+a.role+"/sign.sock")
    if a.socket!=expected:
        deny("SOCKET_PATH_NOT_PINNED")
    serve(a.role,a.socket)
    return 0

if __name__=="__main__":
    try:sys.exit(main())
    except Exception:
        print("CST_ONEJOB_VPS_SIGNER_DENIED",file=sys.stderr)
        sys.exit(2)
