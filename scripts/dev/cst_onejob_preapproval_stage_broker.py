#!/usr/bin/env python3
"""CST-DEV Gate-A-only preapproval DB socket broker, never imported as starter.

Only a separately authorized short-lived *technical* manifest is accepted.
NO job, Owner decision or subscriber hash is required because none exists yet.
The approved key, signed manifest, nonroot UIDs, independently installed
kernel default-deny egress and source pin are prerequisites, not created here.
The broker neither authenticates PostgreSQL nor changes roles or dispatches.
"""
from __future__ import annotations
import argparse
import ipaddress
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
from datetime import datetime, timezone
from hashlib import sha256

from cst_team_onejob_operational_broker import (
    exact_timestamp, hex_lower, read_regular, forward_once,
)
from cst_team_onejob_peercred import verify_unix_peer
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
import base64

PROJECT = "xssrfshdrtdfupgqwfdw"
HOST = "aws-1-ap-southeast-2.pooler.supabase.com"
PORT = 6543
SOCKET_PATH = "/run/cst-onejob-stage-db/pg-pooler.sock"
NFT_TABLE = "cst_onejob_stage_egress"
FIELDS = (
    "version","mode","project","companyId","sourceSha",
    "stageLogin","allowedDestinationIp","destinationHostname",
    "destinationPort","socketPath","brokerUid","brokerGid",
    "stageClientUid","stageClientGid","networkNamespaceInode",
    "issuedAt","expiresAt","nonce",
)

def deny(code):
    raise RuntimeError("CST_STAGE_BROKER_"+code)

def validate_scope(m, now=None):
    if not isinstance(m,dict) or tuple(m)!=FIELDS:
        deny("SCHEMA_DENIED")
    if (m["version"] != 1 or m["mode"] != "PREAPPROVAL_STAGE_ONLY"
        or m["project"] != PROJECT or m["companyId"] != "1"
        or m["stageLogin"] != "cst_team_model_pilot_stage_login"):
        deny("STAGE_SCOPE_DENIED")
    if not hex_lower(m["sourceSha"],40) or not hex_lower(m["nonce"],32):
        deny("SOURCE_OR_NONCE_DENIED")
    if (m["destinationHostname"] != HOST or m["destinationPort"] != PORT
        or m["socketPath"] != SOCKET_PATH):
        deny("FIXED_DESTINATION_DENIED")
    try:
        ip = ipaddress.ip_address(m["allowedDestinationIp"])
        if ip.version != 4 or not ip.is_global:
            deny("PUBLIC_IPV4_REQUIRED")
    except ValueError:
        deny("PUBLIC_IPV4_REQUIRED")
    for field in ("brokerUid","brokerGid","stageClientUid",
                  "stageClientGid","networkNamespaceInode"):
        if type(m[field]) is not int or m[field] < 1 or m[field] > 2**40:
            deny("NONROOT_IDENTITY_REQUIRED")
    if (m["brokerUid"] == m["stageClientUid"]
        or m["brokerGid"] != m["stageClientGid"]):
        deny("DISTINCT_SAME_GROUP_PEER_REQUIRED")
    start=exact_timestamp(m["issuedAt"])
    end=exact_timestamp(m["expiresAt"])
    current=now or datetime.now(timezone.utc)
    if start>current or current>=end or (end-start).total_seconds()>600:
        deny("TEN_MINUTE_LEASE_DENIED")
    # Do not accept a preapproval manifest masquerading as Gate B.
    if any(k in m for k in ("jobId","requestId","ownerApprovalSha256",
                           "subscriberArmedSha256","dispatchPermitted")):
        deny("POSTAPPROVAL_FIELDS_DENIED")
    return m

def read_signed_manifest(envelope, pubpath, trusted_pin, now=None):
    if not hex_lower(trusted_pin,64):
        deny("TRUST_PIN_MISSING")
    rawpub=read_regular(pubpath,8192,0)
    key=serialization.load_pem_public_key(rawpub)
    if not isinstance(key,Ed25519PublicKey):
        deny("TRUST_KEY_TYPE")
    got=sha256(key.public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo)).hexdigest()
    if got != trusted_pin:
        deny("TRUST_KEY_PIN")
    payload=json.loads(read_regular(envelope,8192,0))
    if not isinstance(payload,dict) or tuple(payload)!=("manifest","signatureBase64"):
        deny("ENVELOPE_SHAPE")
    m=validate_scope(payload["manifest"],now)
    try:
        raw=payload["signatureBase64"]
        sig=base64.b64decode(raw,validate=True)
        if len(sig)!=64 or base64.b64encode(sig).decode()!=raw:
            deny("SIGNATURE_FORMAT")
        key.verify(sig,json.dumps(m,separators=(",",":"),ensure_ascii=False).encode())
    except Exception:
        deny("SIGNATURE_DENIED")
    return m

def kernel_egress_ready(m, output=None):
    """Verify actual namespace kernel rules, not metadata or a file receipt.
    The strict two-rule OUTPUT default-drop policy must preexist. No writes.
    """
    if output is None:
        run=subprocess.run(["/usr/sbin/nft","-j","list","table","inet",NFT_TABLE],
                           capture_output=True,text=True,timeout=4,check=False)
        if run.returncode!=0:
            deny("KERNEL_EGRESS_NOT_INSTALLED")
        output=json.loads(run.stdout)
    objects=[item for item in output.get("nftables",[]) if "metainfo" not in item]
    tables=[v["table"] for v in objects if "table" in v]
    chains=[v["chain"] for v in objects if "chain" in v]
    rules=[v["rule"] for v in objects if "rule" in v]
    if len(objects)!=4 or len(tables)!=1 or len(chains)!=1 or len(rules)!=2:
        deny("KERNEL_RULE_SHAPE")
    if (tables[0].get("family")!="inet" or tables[0].get("name")!=NFT_TABLE
        or set(tables[0])-{"family","name","handle"}):
        deny("KERNEL_TABLE_SCOPE")
    ch=chains[0]
    if not all((ch.get("family")=="inet",ch.get("table")==NFT_TABLE,
                ch.get("name")=="output",ch.get("type")=="filter",
                ch.get("hook")=="output",ch.get("policy")=="drop",
                ch.get("prio")==0)):
        deny("KERNEL_DEFAULT_DROP")
    def match(expr,protocol,field,value):
        m=expr.get("match",{})
        return (m.get("op")=="==" and
                m.get("left")=={"payload":{"protocol":protocol,"field":field}}
                and m.get("right")==value)
    allow=rules[0].get("expr",[])
    drop=rules[1].get("expr",[])
    if not all(r.get("family")=="inet" and r.get("table")==NFT_TABLE
               and r.get("chain")=="output" for r in rules):
        deny("KERNEL_RULE_FOREIGN")
    if (len(allow)!=4 or not match(allow[0],"ip","daddr",m["allowedDestinationIp"])
        or not match(allow[1],"tcp","dport",PORT)
        or "counter" not in allow[2] or allow[3]!={"accept":None}
        or len(drop)!=2 or "counter" not in drop[0] or drop[1]!={"drop":None}):
        deny("KERNEL_UNBOUNDED_EGRESS")
    for rule in (allow[2],drop[0]):
        c=rule["counter"]
        if not isinstance(c,dict) or not all(
          type(c.get(k)) is int and c[k]>=0 for k in ("packets","bytes")):
            deny("KERNEL_COUNTER_MISSING")
    return True

def serve_stage_once(m):
    """Will not listen unless authorized non-root identity and kernel ACL pass."""
    if (os.geteuid()!=m["brokerUid"] or os.getegid()!=m["brokerGid"]
        or os.geteuid()==0 or os.stat("/proc/self/ns/net").st_ino!=m["networkNamespaceInode"]):
        deny("BROKER_NAMESPACE_OR_UID")
    kernel_egress_ready(m)
    parent=Path(SOCKET_PATH).parent
    ps=parent.lstat()
    if (not stat.S_ISDIR(ps.st_mode) or ps.st_uid!=m["brokerUid"]
        or ps.st_gid!=m["brokerGid"] or stat.S_IMODE(ps.st_mode)!=0o750):
        deny("SOCKET_DIRECTORY_DENIED")
    if Path(SOCKET_PATH).exists() or Path(SOCKET_PATH).is_symlink():
        deny("SOCKET_OCCUPIED")
    os.umask(0o117)
    server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
    try:
        server.bind(SOCKET_PATH)
        os.chmod(SOCKET_PATH,0o660)
        server.listen(1)
        # Exact signed lease enforced; never start a general permanent broker.
        end=exact_timestamp(m["expiresAt"]).timestamp()
        import time
        while time.time()<end:
            server.settimeout(min(0.5,max(0.01,end-time.time())))
            try:client,_=server.accept()
            except socket.timeout:continue
            with client:
                verdict=verify_unix_peer(client,expected_uid=m["stageClientUid"],
                                        expected_gid=m["stageClientGid"])
                if not verdict.accepted:
                    continue
                # Recheck real kernel rules immediately before making a socket.
                kernel_egress_ready(m)
                forward_once(client,m)
                return
        deny("LEASE_EXPIRED_NO_SESSION")
    finally:
        server.close()
        Path(SOCKET_PATH).unlink(missing_ok=True)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("mode",choices=("validate","run"))
    parser.add_argument("--envelope",required=True)
    parser.add_argument("--public-key",required=True)
    parser.add_argument("--pinned-sha256",required=True)
    parser.add_argument("--expected-source-sha",required=True)
    args=parser.parse_args()
    m=read_signed_manifest(args.envelope,args.public_key,args.pinned_sha256)
    if not hex_lower(args.expected_source_sha,40) or m["sourceSha"]!=args.expected_source_sha:
        deny("PINNED_SOURCE_MISMATCH")
    if args.mode=="validate":
        print('{"technicalScopeVerified":true,"runtimeAuthorized":false,"dispatchPermitted":false}')
        return
    serve_stage_once(m)

if __name__=="__main__":
    try:main()
    except Exception as e:
        label=str(e)
        if not label.startswith("CST_STAGE_BROKER_"):
            label="CST_STAGE_BROKER_FAIL_CLOSED"
        print(label,file=sys.stderr)
        sys.exit(2)
