"""DEV-only Hub/Core operator signing gate, backed by EXISTING two-reader sidecar.

This is an extension of the existing one-shot signer workflow, not a signer
daemon or new database writer. Accepts no caller supplied trust booleans.
"""
from __future__ import annotations

import grp
import json
import os
from pathlib import Path
import pwd
import socket
import stat
import struct
import time

from gpt02_issue159_signer_approval_guard import (
    canonical_sha, persisted_approval_fresh, fail, SIGNER_GROUP, MIN_VALIDITY_MS,
)

READER = "/run/gpt02-reader/reader.sock"
WORKER = "openclaw-dell-chatgpt-wake-dev"


def require_hub_core_facts(role: str, link: dict, approved: dict,
                           *, reader_socket: str = READER,
                           now_ms: int | None = None,
                           reader_uid: int | None = None) -> None:
    """Require original persisted admin decision + live independent Hub/Core rows.

    The production CLI does not expose reader_socket, reader_uid, or a bypass.
    Any success allows only the following *detached signature*, no dispatch.
    """
    if role not in ("hub", "core"):
        fail("OPERATOR_SIGNER_ROLE_DENIED")
    if not isinstance(link, dict) or not isinstance(approved, dict):
        fail("OPERATOR_EVIDENCE_SHAPE_DENIED")
    if type(now_ms) is not int:
        now_ms = int(time.time() * 1000)
    keys = (
        "v","environment","audience","linkId","companyId","hubTaskId",
        "hubExecutionId","coreTaskId","coreCommandId","attemptId",
        "attemptNumber","assigneeId","accountableOwnerId",
        "hubOperatorNamespace","hubOperatorId","hubRole","hubActive",
        "coreOperatorNamespace","coreOperatorUserId","coreRole",
        "coreActive","corePasswordChanged","workerId","approvalDigest",
        "nonce","issuedAt","expiresAt"
    )
    if set(link) != set(keys):
        fail("OPERATOR_CLAIMS_SHAPE_DENIED")
    if (link["v"] != 1 or link["environment"] != "DEV"
            or link["companyId"] != "default"
            or link["audience"] != "GPT02_DUAL_ACCOUNT_COMMAND_LINK"
            or link["workerId"] != WORKER
            or type(link["hubTaskId"]) is not int or link["hubTaskId"] <= 139
            or type(link["issuedAt"]) is not int
            or type(link["expiresAt"]) is not int
            or link["issuedAt"] > now_ms
            or link["expiresAt"] - now_ms < MIN_VALIDITY_MS
            or link["expiresAt"] - link["issuedAt"] > 120_000
            or link["attemptNumber"] != 1
            or link["hubOperatorId"] != link["accountableOwnerId"]
            or link["hubRole"] != "super_admin" or link["hubActive"] is not True
            or link["coreRole"] not in ("owner","admin")
            or link["coreActive"] is not True
            or link["corePasswordChanged"] is not True):
        fail("OPERATOR_LINK_NOT_FRESH_OR_ALLOWED")
    for left,right in (("hubTaskId","taskId"),
                       ("coreCommandId","commandId"),
                       ("attemptId","attemptId"),
                       ("nonce","nonce"),
                       ("hubOperatorId","superAdminId"),
                       ("companyId","companyId")):
        if link[left] != approved.get(right):
            fail("OPERATOR_APPROVAL_BINDING_MISMATCH")
    # Trust can only come from persisted Super Admin decision via its original
    # root-owned approval-reader socket. No JSON request may substitute it.
    digest = persisted_approval_fresh(approved, now_ms=now_ms)
    if link["approvalDigest"] != digest:
        fail("OPERATOR_APPROVAL_DIGEST_MISMATCH")

    try:
        reader_gid = grp.getgrnam(SIGNER_GROUP).gr_gid
        expected_uid = pwd.getpwnam("gpt02-issue159-reader").pw_uid if reader_uid is None else reader_uid
        directory = str(Path(reader_socket).parent)
        pst = os.lstat(directory)
        if stat.S_ISLNK(pst.st_mode):
            if (reader_socket != READER
                    or os.path.realpath(directory) != "/run/private/gpt02-reader"):
                fail("OPERATOR_READER_SOCKET_PATH_INVALID")
            pst = os.stat(directory)
        st = os.lstat(reader_socket)
    except (OSError, KeyError) as exc:
        raise RuntimeError("OPERATOR_READER_NOT_AVAILABLE") from exc
    if (not stat.S_ISDIR(pst.st_mode) or pst.st_uid != expected_uid
            or pst.st_gid != reader_gid or stat.S_IMODE(pst.st_mode) != 0o750
            or not stat.S_ISSOCK(st.st_mode) or stat.S_ISLNK(st.st_mode)
            or st.st_uid != expected_uid or st.st_gid != reader_gid
            or stat.S_IMODE(st.st_mode) != 0o660):
        fail("OPERATOR_READER_CUSTODY_INVALID")

    identity = {
        "companyId": link["companyId"],
        "hubTaskId": link["hubTaskId"],
        "commandCandidateId": link["coreCommandId"],
        "attemptId": link["attemptId"],
    }
    body = json.dumps(identity,separators=(",",":"),allow_nan=False).encode()
    request = (
        b"POST /pre-sign-facts HTTP/1.1\r\n"
        b"Host: localhost\r\nContent-Type: application/json\r\n"
        b"Content-Length: " + str(len(body)).encode("ascii")
        + b"\r\nConnection: close\r\n\r\n" + body
    )
    response=bytearray()
    try:
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as conn:
            conn.settimeout(5)
            conn.connect(reader_socket)
            if not hasattr(socket,"SO_PEERCRED"):
                fail("OPERATOR_READER_PEER_CREDENTIALS_UNAVAILABLE")
            pid,uid,gid=struct.unpack("3i",conn.getsockopt(
                socket.SOL_SOCKET,socket.SO_PEERCRED,12))
            if uid != expected_uid or gid != reader_gid:
                fail("OPERATOR_READER_PEER_NOT_TRUSTED")
            conn.sendall(request)
            while True:
                chunk=conn.recv(4096)
                if not chunk:break
                response.extend(chunk)
                if len(response)>65536:
                    fail("OPERATOR_READER_RESPONSE_TOO_LARGE")
    except (TimeoutError,ConnectionError,OSError) as exc:
        raise RuntimeError("OPERATOR_READER_SOCKET_UNAVAILABLE") from exc
    head,sep,raw=bytes(response).partition(b"\r\n\r\n")
    if not sep or not head.startswith(b"HTTP/1.1 200 "):
        fail("OPERATOR_READER_PRE_SIGN_NOT_AVAILABLE")
    headers={}
    for line in head.split(b"\r\n")[1:]:
        key,colon,value=line.partition(b":")
        key=key.strip().lower()
        if not colon or key in headers:
            fail("OPERATOR_READER_HTTP_HEADER_INVALID")
        headers[key]=value.strip()
    length=headers.get(b"content-length",b"")
    if (b"transfer-encoding" in headers
            or not length.isdigit() or int(length)!=len(raw)
            or not headers.get(b"content-type",b"").startswith(b"application/json")):
        fail("OPERATOR_READER_HTTP_FRAMING_INVALID")
    try:
        envelope=json.loads(raw)
    except (ValueError,UnicodeError) as exc:
        raise RuntimeError("OPERATOR_READER_RESPONSE_INVALID") from exc
    if (not isinstance(envelope,dict) or envelope.get("ok") is not True
            or envelope.get("environment") != "DEV"
            or envelope.get("signingPermitted") is not False
            or envelope.get("authorizationGranted") is not False
            or envelope.get("dispatchPermitted") is not False
            or envelope.get("releaseDecision") != "NO_GO"):
        fail("OPERATOR_READER_RESPONSE_NOT_TRUSTED")
    facts=envelope.get("facts")
    if not isinstance(facts,dict):
        fail("OPERATOR_READER_FACTS_MISSING")
    p=facts.get("prepared",{}); job=facts.get("job",{})
    core=facts.get("core",{}); hub=facts.get("hubOperator",{})
    assignment=facts.get("hubAssignment",{}); proof=facts.get("trustedReadProof",{})
    if not all(isinstance(x,dict) for x in (p,job,core,hub,assignment,proof)):
        fail("OPERATOR_READER_FACTS_SHAPE_INVALID")
    if (p.get("companyId") != link["companyId"]
            or p.get("hubTaskId") != link["hubTaskId"]
            or p.get("coreTaskId") != link["coreTaskId"]
            or p.get("hubExecutionId") != link["hubExecutionId"]
            or p.get("commandCandidateId") != link["coreCommandId"]
            or p.get("attemptId") != link["attemptId"]
            or p.get("memberId") != link["assigneeId"]
            or p.get("operatorSubject") != link["hubOperatorId"]
            or type(p.get("expiresAt")) is not int
            or p["expiresAt"]-int(time.time()*1000) < MIN_VALIDITY_MS
            or job.get("executionId") != link["hubExecutionId"]
            or job.get("taskId") != link["hubTaskId"]
            or job.get("status") != "prepared"
            or job.get("commandId") is not None
            or job.get("workerCommandCount") != 0
            or job.get("attemptNumber") != 1
            or job.get("memberId") != link["assigneeId"]
            or job.get("operatorSubject") != link["hubOperatorId"]
            or job.get("dispatchStarted") is not False
            or core.get("taskId") != link["coreTaskId"]
            or core.get("commandCandidateId") != link["coreCommandId"]
            or core.get("attemptId") != link["attemptId"]
            or core.get("status") != "PENDING"
            or core.get("commandCount") != 0
            or core.get("runCount") != 0
            or core.get("operatorUserId") != link["coreOperatorUserId"]
            or core.get("operatorRole") != link["coreRole"]
            or core.get("operatorActive") is not True
            or core.get("passwordChanged") is not True
            or core.get("workerId") != WORKER
            or hub.get("subject") != link["hubOperatorId"]
            or hub.get("role") != "super_admin"
            or hub.get("active") is not True
            or hub.get("memberId") != link["assigneeId"]
            or hub.get("accountableOwnerId") != link["accountableOwnerId"]
            or assignment.get("action") != "gpt02_pic_assigned"
            or assignment.get("entityId") != str(link["hubTaskId"])
            or assignment.get("actorId") != link["hubOperatorId"]
            or assignment.get("actorRole") != "super_admin"
            or assignment.get("actorActive") is not True
            or proof.get("source") != "gpt02-issue159-presign-reader"
            or proof.get("environment") != "DEV"
            or proof.get("hubRole") != "gpt02_hub_evidence_reader"
            or proof.get("coreRole") != "gpt02_core_evidence_reader"
            or proof.get("separateBackends") is not True
            or proof.get("clientTlsVerified") is not True
            or proof.get("readOnly") is not True
            or any(proof.get(k) is not False for k in
                   ("signingPermitted","authorizationGranted","dispatchPermitted"))
            or proof.get("releaseDecision") != "NO_GO"
            or link["expiresAt"]-int(time.time()*1000) < MIN_VALIDITY_MS):
        fail("OPERATOR_READER_PERSISTED_BINDING_MISMATCH")
    # Returning no authority is intentional. Caller may sign one detached link
    # only after it independently passed the approval-reader + Hub/Core reader.
    return None
