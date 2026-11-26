"""Trust-gate the existing GPT02 DEV one-shot approval signer.

Only the independently persisted, still-fresh Super Admin APPROVE decision
can allow an *approval-role signature*. This module neither reads signer keys
nor writes an approval/nonce/lease, and grants no dispatch authority.
"""
from __future__ import annotations

import grp
import hashlib
import json
import os
from pathlib import Path
import socket
import stat
import struct
import time

APPROVAL_READER_SOCKET = "/run/gpt02-approval-reader/approval.sock"
SIGNER_GROUP = "gpt02-issue159-signers"
MIN_VALIDITY_MS = 30_000
MAX_RESPONSE_BYTES = 12_000
CLAIM_KEYS = (
    "v", "environment", "audience", "taskId", "commandId", "attemptId",
    "nonce", "operatorNamespace", "superAdminId", "companyId",
    "issuedAt", "expiresAt",
)


def fail(code: str):
    raise RuntimeError(code)


def canonical_sha(claims: dict) -> str:
    if type(claims) is not dict or set(claims) != set(CLAIM_KEYS):
        fail("APPROVAL_CLAIMS_NOT_CANONICAL")
    data = json.dumps({name: claims[name] for name in CLAIM_KEYS},
                      separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def persisted_approval_fresh(claims: dict, *, socket_path=APPROVAL_READER_SOCKET,
                             now_ms: int | None = None,
                             reader_uid: int = 0) -> str:
    """Return bound approval digest, never authority.

    The production socket path is fixed at the CLI. The path override exists
    only for isolated tests and cannot be passed through the CLI or service.
    """
    if type(now_ms) is not int:
        now_ms = int(time.time() * 1000)
    if (type(claims.get("taskId")) is not int or claims["taskId"] <= 139
            or claims.get("companyId") != "default"
            or claims.get("environment") != "DEV"
            or type(claims.get("issuedAt")) is not int
            or type(claims.get("expiresAt")) is not int
            or not claims["issuedAt"] <= now_ms
            or claims["expiresAt"] - now_ms < MIN_VALIDITY_MS):
        fail("APPROVAL_SIGNER_INSUFFICIENT_VALIDITY")
    digest = canonical_sha(claims)

    try:
        group_gid = grp.getgrnam(SIGNER_GROUP).gr_gid
        st = os.lstat(socket_path)
        parent = os.lstat(str(Path(socket_path).parent))
    except (KeyError, OSError) as exc:
        raise RuntimeError("APPROVAL_READER_NOT_AVAILABLE") from exc
    if (not stat.S_ISSOCK(st.st_mode) or stat.S_ISLNK(st.st_mode)
            or st.st_uid != reader_uid or st.st_gid != group_gid
            or stat.S_IMODE(st.st_mode) != 0o660
            or not stat.S_ISDIR(parent.st_mode) or stat.S_ISLNK(parent.st_mode)
            or parent.st_uid != reader_uid or parent.st_gid != group_gid
            or stat.S_IMODE(parent.st_mode) != 0o750):
        fail("APPROVAL_READER_CUSTODY_DENIED")

    lookup = {
        "claimsSha256": digest,
        "taskId": claims["taskId"],
        "commandId": claims["commandId"],
        "attemptId": claims["attemptId"],
        "companyId": claims["companyId"],
        "superAdminId": claims["superAdminId"],
    }
    data = json.dumps({"lookup": lookup, "observedAt": now_ms},
                      separators=(",", ":"), allow_nan=False).encode()
    message = (
        b"POST /approval-intent HTTP/1.1\r\n"
        b"Host: localhost\r\nContent-Type: application/json\r\n"
        b"Content-Length: " + str(len(data)).encode()
        + b"\r\nConnection: close\r\n\r\n" + data
    )
    reply = bytearray()
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(3.0)
            client.connect(socket_path)
            if not hasattr(socket, "SO_PEERCRED"):
                fail("APPROVAL_READER_PEER_CREDENTIALS_REQUIRED")
            _pid, uid, _gid = struct.unpack("3i", client.getsockopt(
                socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid != reader_uid:
                fail("APPROVAL_READER_PEER_NOT_TRUSTED")
            client.sendall(message)
            while True:
                part = client.recv(4096)
                if not part:
                    break
                reply.extend(part)
                if len(reply) > MAX_RESPONSE_BYTES:
                    fail("APPROVAL_READER_RESPONSE_TOO_LONG")
    except (TimeoutError, ConnectionError, OSError) as exc:
        raise RuntimeError("APPROVAL_READER_CONNECTION_FAILED") from exc

    head, split, body = bytes(reply).partition(b"\r\n\r\n")
    if not split:
        fail("APPROVAL_READER_HTTP_INVALID")
    lines = head.split(b"\r\n")
    if lines[0] != b"HTTP/1.1 200 OK":
        fail("APPROVAL_READER_DECISION_UNAVAILABLE")
    headers: dict[bytes, bytes] = {}
    for line in lines[1:]:
        key, colon, value = line.partition(b":")
        if not colon or key.strip().lower() in headers:
            fail("APPROVAL_READER_HEADERS_INVALID")
        headers[key.strip().lower()] = value.strip()
    size = headers.get(b"content-length", b"")
    if (headers.get(b"content-type") != b"application/json"
            or b"transfer-encoding" in headers
            or not size.isdigit() or int(size) != len(body)):
        fail("APPROVAL_READER_RESPONSE_FRAMING_DENIED")
    try:
        response = json.loads(body)
    except (ValueError, UnicodeError) as exc:
        raise RuntimeError("APPROVAL_READER_INVALID_JSON") from exc
    result = response.get("result") if isinstance(response, dict) else None
    decision = result.get("decision") if isinstance(result, dict) else None
    if (not isinstance(response, dict) or response.get("ok") is not True
            or response.get("environment") != "DEV"
            or response.get("approvalReadOnly") is not True
            or response.get("decisionCreated") is not False
            or any(response.get(k) is not False for k in
                   ("signingPermitted", "authorizationGranted", "dispatchPermitted"))
            or response.get("releaseDecision") != "NO_GO"
            or not isinstance(result, dict)
            or result.get("persistedTrustedReadProven") is not True
            or result.get("approvalBindingMatched") is not True
            or result.get("adminApprovalMatched") is not True
            or result.get("releaseDecision") != "NO_GO"
            or not isinstance(decision, dict)
            or decision.get("claimsSha256") != digest
            or decision.get("actorId") != claims["superAdminId"]
            or decision.get("decision") != "APPROVE"
            or decision.get("roleAtDecision") != "super_admin"
            or decision.get("authMethod") != "supabase_admin_session"
            or type(decision.get("recordedAt")) is not int
            or decision["recordedAt"] > now_ms):
        fail("APPROVAL_READER_TRUSTED_BINDING_REQUIRED")
    # The claim may have expired while reading the persisted decision.
    if claims["expiresAt"] - int(time.time() * 1000) < MIN_VALIDITY_MS:
        fail("APPROVAL_READER_RESULT_EXPIRED")
    return digest
