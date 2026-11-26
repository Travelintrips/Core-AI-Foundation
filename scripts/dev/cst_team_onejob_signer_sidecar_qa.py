#!/usr/bin/env python3
"""Disposable network-none Ed25519 QA signer with real kernel SO_PEERCRED.

NO operational service. Fixed synthetic Company-1 event and two-use limit.
Private key exists only in a separate signer-owned host-side directory, NEVER
mounted into the subscriber client. Uses openssl for signing a bounded file.
"""
import base64
import json
import os
from pathlib import Path
import re
import socket
import struct
import subprocess
import sys
import tempfile
import time

FIELDS = (
 "version", "type", "project", "companyId", "eventId", "jobId", "jobCode",
 "requestId", "workerId", "correlationId", "subscriberId",
 "deliveryState", "receivedAt", "nonce"
)
EVENT="25745d53-9c8d-46ae-8afc-62bfbba92711"
CORRELATION="24a5dc22-318b-42b4-aaed-a7c84e24cd21"
SID="cst-dev-onejob-subscriber-20261120-abcdef12"
REQUEST="cst-ai-team-company1-dev:pilot-"+"a"*20
RECEIVED=re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")
NONCE=re.compile(r"^[0-9a-f]{32}$")
SIZE=struct.calcsize("3i")

def exact(n, conn):
    result=bytearray()
    while len(result)<n:
        part=conn.recv(n-len(result))
        if not part:
            raise ValueError("FRAME_TRUNCATED")
        result.extend(part)
    return bytes(result)

def validated(data):
    if not isinstance(data, bytes) or not 256<=len(data)<=2000:
        raise ValueError("FRAME_SIZE_INVALID")
    try:
        text=data.decode("utf8")
        obj=json.loads(text)
    except (UnicodeDecodeError, ValueError) as exc:
        raise ValueError("FRAME_JSON_INVALID") from exc
    if not isinstance(obj,dict) or tuple(obj)!=FIELDS or not all(
        isinstance(obj[k],(str,int)) and not isinstance(obj[k],bool) for k in FIELDS
    ):
        raise ValueError("FRAME_FIELDS_INVALID")
    fixed={
      "version":1,"type":"CST_DEV_JOB_COMPLETED_SUBSCRIBER_RECEIPT",
      "project":"xssrfshdrtdfupgqwfdw","companyId":"1",
      "eventId":EVENT,"jobId":483,"jobCode":"APPROVED-ONE",
      "requestId":REQUEST,"workerId":991,
      "correlationId":CORRELATION,"subscriberId":SID,
      "deliveryState":"delivered",
    }
    if any(obj.get(k)!=v for k,v in fixed.items()):
        raise ValueError("UNAPPROVED_JOB_OR_SUBSCRIBER")
    if not NONCE.fullmatch(obj["nonce"]) or not RECEIVED.fullmatch(obj["receivedAt"]):
        raise ValueError("NONCE_OR_RECEIPT_DATE_INVALID")
    # Sign only fresh synthetic QA messages, never a replay from last week.
    from datetime import datetime, timezone
    dt=datetime.fromisoformat(obj["receivedAt"].replace("Z","+00:00"))
    if abs((datetime.now(timezone.utc)-dt).total_seconds())>30:
        raise ValueError("REPLAY_OR_FUTURE_RECEIPT")
    return data

def serve(sockpath, keypath):
    if os.getenv("CST_ONEJOB_PG16_DISPOSABLE_QA")!="true" or os.geteuid()!=28510 or os.getegid()!=28501:
        raise RuntimeError("QA_SIGNER_IDENTITY_OR_FLAG_DENIED")
    parent=Path(sockpath).parent
    key=Path(keypath)
    ps=parent.lstat()
    ks=key.lstat()
    if not parent.is_dir() or parent.is_symlink() or ps.st_uid!=28510 or ps.st_gid!=28501 or ps.st_mode&0o777!=0o750:
        raise RuntimeError("QA_SIGNER_SOCKET_DIR_INVALID")
    if not key.is_file() or key.is_symlink() or ks.st_uid!=28510 or ks.st_mode&0o777!=0o400:
        raise RuntimeError("QA_PRIVATE_KEY_CUSTODY_INVALID")
    if Path(sockpath).exists() or Path(sockpath).is_symlink():
        raise RuntimeError("QA_SIGNER_SOCKET_ALREADY_USED")
    served=0
    server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
    try:
        server.bind(sockpath)
        os.chmod(sockpath,0o660)
        server.listen(2)
        server.settimeout(0.4)
        print("QA_SEPARATE_SIGNER_READY_NETWORK_NONE",flush=True)
        stop=time.monotonic()+32
        while served<2 and time.monotonic()<stop:
            try:conn,_=server.accept()
            except socket.timeout:continue
            with conn:
                conn.settimeout(3)
                try:
                    pid,uid,gid=struct.unpack("3i",conn.getsockopt(
                        socket.SOL_SOCKET,socket.SO_PEERCRED,SIZE))
                    if pid<=0 or uid!=28502 or gid!=28501:
                        continue
                    n=struct.unpack(">I",exact(4,conn))[0]
                    if n>2000 or n<256:
                        continue
                    payload=validated(exact(n,conn))
                    # Private signing input stays in private signer process dir.
                    with tempfile.NamedTemporaryFile(
                        prefix="cst-sign-input-",dir=str(key.parent),
                        mode="wb",delete=False
                    ) as fh:
                        input_path=fh.name
                        os.chmod(input_path,0o600)
                        fh.write(payload)
                    try:
                        out=subprocess.run(
                           ["openssl","pkeyutl","-sign","-rawin",
                            "-inkey",str(key),"-in",input_path],
                           capture_output=True,timeout=3,check=False)
                    finally:
                        os.unlink(input_path)
                    if out.returncode!=0 or len(out.stdout)!=64:
                        continue
                    conn.sendall(out.stdout)
                    served+=1
                except (OSError,ValueError,TimeoutError,subprocess.SubprocessError):
                    continue
        if served!=2:
            raise RuntimeError("QA_EXPECTED_TWO_SIGNED_RECEIPTS_NOT_OBSERVED")
        print("QA_SIGNER_SIGNED_TWO_BOUNDED_PAYLOADS_PASS",flush=True)
    finally:
        server.close()
        try:os.unlink(sockpath)
        except FileNotFoundError:pass

if __name__=="__main__":
    if len(sys.argv)!=4 or sys.argv[1]!="--qa-serve":
        raise SystemExit("QA_SIGNER_NOT_AUTHORIZED")
    serve(sys.argv[2],sys.argv[3])
