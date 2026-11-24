#!/usr/bin/env python3
"""CST-DEV *operational-capable* one-job fixed TCP broker.

No server starts on import. Requires an independently signed, short-lived,
exact-scope manifest; separate pinned public key; an ALREADY-ENFORCED kernel
egress ACL; non-root broker and per-connection kernel SO_PEERCRED. It has no
job/SQL/secret handling and forwards at most ONE accepted PostgreSQL session.

An operational caller must separately prove the signed manifest's owner
approval, subscriber readiness, source SHA and nftables ACL before signing.
This broker alone cannot grant dispatch or Final ACK.

The --qa-run mode is restricted to network-none localhost-only fixtures;
it cannot serve or be promoted as a real CST-DEV broker.
"""
from __future__ import annotations

import argparse
import base64
import ipaddress
import json
import os
from pathlib import Path
import selectors
import signal
import socket
import stat
import sys
import time
from datetime import datetime, timezone
from hashlib import sha256

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from cst_team_onejob_peercred import verify_unix_peer

PROJECT="xssrfshdrtdfupgqwfdw"
HOST="aws-1-ap-southeast-2.pooler.supabase.com"
SOCKET="/run/cst-onejob-dev-db/pg-pooler.sock"
PORT=6543
MAX_BYTES=32*1024*1024
ALL_FIELDS=(
    "version","mode","project","companyId","sourceSha","jobId",
    "requestId","ownerApprovalSha256","subscriberArmedSha256",
    "allowedDestinationIp","destinationHostname","destinationPort",
    "socketPath","brokerUid","brokerGid","workerUid","workerGid",
    "networkNamespaceInode","issuedAt","expiresAt","nonce",
)

def fail(reason: str) -> None:
    raise RuntimeError("CST_ONEJOB_BROKER_"+reason)

def exact_timestamp(value: object) -> datetime:
    if not isinstance(value,str) or len(value)!=24 or not value.endswith("Z"):
        fail("INVALID_TIMESTAMP")
    try:
        d=datetime.strptime(value,"%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
        if d.isoformat(timespec="milliseconds").replace("+00:00","Z")!=value:
            fail("INVALID_TIMESTAMP")
        return d
    except ValueError:
        fail("INVALID_TIMESTAMP")

def hex_lower(s: object,n:int)->bool:
    return isinstance(s,str) and len(s)==n and all(c in "0123456789abcdef" for c in s)

def validated_manifest(value: object, qa: bool, now=None) -> dict:
    if not isinstance(value,dict) or tuple(value.keys())!=ALL_FIELDS:
        fail("MANIFEST_SHAPE")
    if value["version"]!=1 or value["project"]!=PROJECT or value["companyId"]!="1":
        fail("PROJECT_SCOPE")
    if not isinstance(value["jobId"],int) or isinstance(value["jobId"],bool) or value["jobId"]<=0 or value["jobId"]==482:
        fail("FRESH_JOB_REQUIRED")
    if not hex_lower(value["sourceSha"],40) or not hex_lower(value["ownerApprovalSha256"],64) or not hex_lower(value["subscriberArmedSha256"],64):
        fail("INDEPENDENT_AUTHORITY_HASH_MISSING")
    if (not isinstance(value["requestId"],str) or
        not value["requestId"].startswith("cst-ai-team-company1-dev:pilot-") or
        not hex_lower(value["requestId"].split("pilot-")[-1],20)):
        fail("WRONG_REQUEST")
    if not hex_lower(value["nonce"],32):
        fail("MANIFEST_NONCE")
    for k in ("brokerUid","brokerGid","workerUid","workerGid","networkNamespaceInode"):
        v=value[k]
        if type(v) is not int or v<1 or v>2**40:
            fail("UNSAFE_LINUX_ID")
    if value["brokerUid"]==value["workerUid"] or value["brokerGid"]!=value["workerGid"]:
        fail("PEER_NOT_DISTINCT")
    if os.geteuid()!=value["brokerUid"] or os.getegid()!=value["brokerGid"] or os.geteuid()==0:
        fail("BROKER_UNEXPECTED_OS_IDENTITY")
    if os.stat("/proc/self/ns/net").st_ino != value["networkNamespaceInode"]:
        fail("NETWORK_NAMESPACE_MISMATCH")
    start=exact_timestamp(value["issuedAt"])
    end=exact_timestamp(value["expiresAt"])
    actual=now or datetime.now(timezone.utc)
    if start>actual or end<=actual or (end-start).total_seconds()>1800:
        fail("MANIFEST_EXPIRED_OR_FUTURE")
    if qa:
        if value["mode"]!="DISPOSABLE_NETWORK_NONE_QA" or value["allowedDestinationIp"]!="127.0.0.1" or value["destinationHostname"]!="localhost" or value["destinationPort"]!=6543:
            fail("QA_REQUIRES_NETWORK_NONE_LOCALHOST_ONLY")
        if not value["socketPath"].startswith("/tmp/cst-onejob-broker-qa-"):
            fail("QA_SOCKET_PATH_NOT_DISPOSABLE")
        # Reject outbound routes; a QA identity may never turn into production.
        with open("/proc/net/route",encoding="ascii") as routes:
            if any(line.split()[1]=="00000000" for line in routes.readlines()[1:] if len(line.split())>1):
                fail("QA_HAS_DEFAULT_IPV4_ROUTE")
        try:
            with open("/proc/net/ipv6_route",encoding="ascii") as routes:
                for line in routes:
                    fields=line.strip().split()
                    if len(fields)>1 and fields[0]=="0"*32 and fields[1]=="00" and fields[-1]!="lo":
                        fail("QA_HAS_DEFAULT_IPV6_ROUTE")
        except FileNotFoundError:
            pass
    else:
        if (value["mode"]!="OPERATIONAL_CST_DEV" or value["destinationHostname"]!=HOST
            or value["destinationPort"]!=PORT or value["socketPath"]!=SOCKET):
            fail("OPERATIONAL_FIXED_DESTINATION_MISMATCH")
        try:
            ip=ipaddress.ip_address(value["allowedDestinationIp"])
        except ValueError:
            fail("OPERATIONAL_IP_NOT_PUBLIC")
        if ip.version!=4 or not ip.is_global:
            fail("OPERATIONAL_IP_NOT_PUBLIC")
    return value

def read_regular(path: str, max_bytes:int, exact_owner=None) -> bytes:
    p=Path(path)
    st=p.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_mode&0o022 or st.st_size<=0 or st.st_size>max_bytes:
        fail("UNTRUSTED_FILE")
    if exact_owner is not None and st.st_uid!=exact_owner:
        fail("UNTRUSTED_OWNER")
    with p.open("rb") as f:
        return f.read(max_bytes+1)

def verify_manifest(envelope_path:str, trusted_pem_path:str, pin:str, qa:bool) -> dict:
    if not hex_lower(pin,64):
        fail("TRUST_PIN_MISSING")
    # No public key from the untrusted envelope may become a trust root.
    public=serialization.load_pem_public_key(read_regular(trusted_pem_path,8192,0))
    if not isinstance(public,Ed25519PublicKey):
        fail("KEY_TYPE_NOT_ED25519")
    actual=sha256(public.public_bytes(serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo)).hexdigest()
    if actual!=pin:
        fail("TRUST_KEY_PIN_MISMATCH")
    envelope=json.loads(read_regular(envelope_path,8192,0))
    if not isinstance(envelope,dict) or tuple(envelope)!=( "manifest","signatureBase64" ):
        fail("ENVELOPE_SHAPE")
    m=envelope["manifest"]
    validated_manifest(m,qa)
    raw=envelope["signatureBase64"]
    if not isinstance(raw,str) or len(raw)!=88 or not raw.endswith("=="):
        fail("SIGNATURE_SHAPE")
    try:
        sig=base64.b64decode(raw,validate=True)
        if len(sig)!=64 or base64.b64encode(sig).decode()!=raw:
            fail("SIGNATURE_SHAPE")
        public.verify(sig,json.dumps(m,separators=(",",":"),ensure_ascii=False).encode("utf8"))
    except Exception:
        fail("MANIFEST_SIGNATURE_INVALID")
    return m

def secure_parent_and_socket(path:str,uid:int,gid:int) -> None:
    p=Path(path)
    parent=p.parent
    st=parent.lstat()
    if not stat.S_ISDIR(st.st_mode) or st.st_uid!=uid or st.st_gid!=gid or st.st_mode&0o777!=0o750:
        fail("SOCKET_PARENT_UNSAFE")
    if p.exists() or p.is_symlink():
        fail("SOCKET_PATH_EXISTS")

def forward_once(client:socket.socket,m:dict) -> None:
    upstream=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
    try:
        upstream.settimeout(3)
        upstream.connect((m["allowedDestinationIp"],m["destinationPort"]))
        upstream.setblocking(False)
        client.setblocking(False)
        sel=selectors.DefaultSelector()
        sel.register(upstream,selectors.EVENT_READ,client)
        sel.register(client,selectors.EVENT_READ,upstream)
        deadline=time.monotonic()+12
        total=0
        try:
            while time.monotonic()<deadline:
                ready=sel.select(timeout=.6)
                if not ready:continue
                for key,_ in ready:
                    source=key.fileobj
                    dest=key.data
                    try:buf=source.recv(8192)
                    except BlockingIOError:continue
                    if not buf:return
                    total+=len(buf)
                    if total>MAX_BYTES:
                        fail("DATA_CAP_EXCEEDED")
                    # Blocking sends have a fixed timeout; never log PG bytes.
                    dest.setblocking(True)
                    dest.settimeout(2)
                    dest.sendall(buf)
                    dest.setblocking(False)
                    deadline=time.monotonic()+12
        finally:
            sel.close()
    finally:
        upstream.close()

def serve(m:dict) -> None:
    path=m["socketPath"]
    secure_parent_and_socket(path,m["brokerUid"],m["brokerGid"])
    os.umask(0o117)
    s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
    stop=False
    def halt(_signum,_frame):
        nonlocal stop
        stop=True
    signal.signal(signal.SIGTERM,halt)
    signal.signal(signal.SIGINT,halt)
    try:
        s.bind(path)
        os.chmod(path,0o660)
        s.listen(1)
        s.settimeout(.5)
        print("CST_ONEJOB_BROKER_READY_NO_DISPATCH",flush=True)
        end=exact_timestamp(m["expiresAt"]).timestamp()
        while not stop and time.time()<end:
            try:c,_=s.accept()
            except socket.timeout:continue
            with c:
                v=verify_unix_peer(c,expected_uid=m["workerUid"],expected_gid=m["workerGid"])
                if not v.accepted:
                    print("CST_ONEJOB_BROKER_PEER_DENIED",flush=True)
                    continue
                print("CST_ONEJOB_BROKER_ONE_SESSION_ACCEPTED",flush=True)
                forward_once(c,m)
                print("CST_ONEJOB_BROKER_ONE_SESSION_CLOSED",flush=True)
                return
        fail("NO_APPROVED_SESSION_BEFORE_EXPIRY")
    finally:
        s.close()
        try:os.unlink(path)
        except FileNotFoundError:pass

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("mode",choices=("validate","run","qa-run"))
    parser.add_argument("--envelope",required=True)
    parser.add_argument("--public-key",required=True)
    parser.add_argument("--pinned-sha256",required=True)
    args=parser.parse_args()
    qa=args.mode=="qa-run"
    if args.mode=="validate":
        # Validates signature/scope in the CURRENT isolated OS context but
        # never opens sockets. Does not attest the actual kernel ACL.
        m=verify_manifest(args.envelope,args.public_key,args.pinned_sha256,qa=False)
        print(json.dumps({"manifestVerified":True,"mode":m["mode"],
            "operationalAuthorityGranted":False,"dispatchPermitted":False}))
        return
    m=verify_manifest(args.envelope,args.public_key,args.pinned_sha256,qa)
    serve(m)

if __name__=="__main__":
    try:main()
    except Exception as exc:
        label=str(exc)
        if not label.startswith("CST_ONEJOB_BROKER_"):label="CST_ONEJOB_BROKER_FAILED_CLOSED"
        print(label,file=sys.stderr)
        sys.exit(2)