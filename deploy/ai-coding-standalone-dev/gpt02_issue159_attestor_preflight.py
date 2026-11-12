"""GPT02 DEV attestor preflight: authenticated stage-A verifier ONLY.

Existing four-signer staged verifier + persisted Super Admin decision reader
are the only trust authorities. No direct SQLite/PostgreSQL, no signer keys,
no writing, no nonce/lease consumption or dispatch. A successful preflight
is verification evidence, NOT permission to call a writer RPC.
"""
from __future__ import annotations

import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import socket
import stat
import struct
import time
from typing import Any

from gpt02_issue159_writer_broker_contract import (
    APPROVAL_FIELDS, LINK_FIELDS, BrokerAdmissionError, _canonical,
)

VERIFIER_SOCKET = "/run/gpt02-issue159-verifier/verify.sock"
MIN_REMAINING_MS = 30_000
MAX_RESPONSE_BYTES = 16_384


def _reject(reason: str) -> None:
    raise BrokerAdmissionError(reason)


def verify_stage_before_attestor(
    packet: Any,
    *,
    verifier_socket: str = VERIFIER_SOCKET,
    now_ms: int | None = None,
) -> dict[str, Any]:
    """Read-only positive stage proof; never returns writer authority."""
    if (not isinstance(packet, dict)
            or set(packet) != {"approval", "hubLink", "coreLink"}):
        _reject("STAGED_PACKET_SHAPE_INVALID")
    for role in ("approval", "hubLink", "coreLink"):
        obj = packet[role]
        if (not isinstance(obj, dict) or set(obj) != {"claims", "signature"}
                or not isinstance(obj["claims"], dict)
                or not isinstance(obj["signature"], str)):
            _reject("STAGED_SIGNATURE_ENVELOPE_INVALID")
    approval = packet["approval"]["claims"]
    link = packet["hubLink"]["claims"]
    core = packet["coreLink"]["claims"]
    if set(approval) != set(APPROVAL_FIELDS) or set(link) != set(LINK_FIELDS) or link != core:
        _reject("STAGED_CLAIMS_SHAPE_INVALID")
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    if (type(now_ms) is not int or now_ms <= 0
            or type(approval["expiresAt"]) is not int
            or type(link["expiresAt"]) is not int
            or type(approval["taskId"]) is not int
            or approval["taskId"] <= 139
            or min(approval["expiresAt"], link["expiresAt"]) - now_ms < MIN_REMAINING_MS):
        _reject("STAGED_EVIDENCE_EXPIRED_OR_TOO_CLOSE")
    # Local hashes cannot replace remote Ed25519 verification. They only
    # cross-check the independently authenticated verifier's signed bindings.
    try:
        digest = hashlib.sha256(_canonical(approval, APPROVAL_FIELDS)).hexdigest()
        link_digest = hashlib.sha256(_canonical(link, LINK_FIELDS)).hexdigest()
    except (KeyError, ValueError, TypeError) as exc:
        raise BrokerAdmissionError("STAGED_HASH_INPUT_INVALID") from exc

    try:
        uid = pwd.getpwnam("gpt02-issue159-verifier").pw_uid
        gid = grp.getgrnam("gpt02-issue159-signers").gr_gid
        socket_stat = os.lstat(verifier_socket)
        parent_stat = os.lstat(str(Path(verifier_socket).parent))
    except (OSError, KeyError) as exc:
        raise RuntimeError("VERIFIER_SOCKET_DEPENDENCY_UNAVAILABLE") from exc
    if (not stat.S_ISSOCK(socket_stat.st_mode)
            or socket_stat.st_uid != uid or socket_stat.st_gid != gid
            or stat.S_IMODE(socket_stat.st_mode) != 0o660
            or not stat.S_ISDIR(parent_stat.st_mode)
            or stat.S_ISLNK(parent_stat.st_mode)
            or parent_stat.st_uid != uid or parent_stat.st_gid != gid
            or stat.S_IMODE(parent_stat.st_mode) != 0o750):
        raise RuntimeError("VERIFIER_SOCKET_CUSTODY_INVALID")

    body = json.dumps(
        {"packet": packet, "observedAt": now_ms},
        separators=(",", ":"), ensure_ascii=False, allow_nan=False,
    ).encode("utf-8")
    if len(body) > 24_576:
        _reject("STAGED_PACKET_TOO_LARGE")
    request = (
        b"POST /verify-staged-approval HTTP/1.1\r\n"
        b"Host: localhost\r\nContent-Type: application/json\r\n"
        b"Content-Length: " + str(len(body)).encode("ascii")
        + b"\r\nConnection: close\r\n\r\n" + body
    )
    received = bytearray()
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
            conn.settimeout(3)
            conn.connect(verifier_socket)
            if not hasattr(socket, "SO_PEERCRED"):
                raise RuntimeError("VERIFIER_PEER_CREDENTIALS_UNAVAILABLE")
            peer = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
            _pid, peer_uid, _peer_gid = struct.unpack("3i", peer)
            if peer_uid != uid:
                raise RuntimeError("VERIFIER_PEER_UID_MISMATCH")
            conn.sendall(request)
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                received.extend(chunk)
                if len(received) > MAX_RESPONSE_BYTES:
                    raise RuntimeError("VERIFIER_RESPONSE_TOO_LARGE")
    except (TimeoutError, ConnectionError, OSError) as exc:
        raise RuntimeError("VERIFIER_SOCKET_UNAVAILABLE") from exc
    header, sep, response_bytes = bytes(received).partition(b"\r\n\r\n")
    if not sep or not header.startswith(b"HTTP/1.1 "):
        raise RuntimeError("VERIFIER_RESPONSE_HTTP_INVALID")
    lines = header.split(b"\r\n")
    try:
        status_code = int(lines[0].split()[1])
    except (IndexError, ValueError) as exc:
        raise RuntimeError("VERIFIER_RESPONSE_STATUS_INVALID") from exc
    if status_code != 200:
        _reject("STAGED_VERIFIER_REJECTED")
    headers: dict[bytes, bytes] = {}
    for line in lines[1:]:
        key, colon, value = line.partition(b":")
        if not colon or key.strip().lower() in headers:
            raise RuntimeError("VERIFIER_RESPONSE_HEADERS_INVALID")
        headers[key.strip().lower()] = value.strip()
    length = headers.get(b"content-length", b"")
    if (headers.get(b"content-type") != b"application/json"
            or b"transfer-encoding" in headers
            or not length.isdigit() or int(length) != len(response_bytes)):
        raise RuntimeError("VERIFIER_RESPONSE_FRAMING_INVALID")
    try:
        response = json.loads(response_bytes)
    except (ValueError, UnicodeError) as exc:
        raise RuntimeError("VERIFIER_RESPONSE_JSON_INVALID") from exc
    result = response.get("result") if isinstance(response, dict) else None
    if (not isinstance(response, dict) or response.get("ok") is not True
            or response.get("environment") != "DEV"
            or response.get("databaseConnected") is not False
            or response.get("writerEnabled") is not False
            or any(response.get(k) is not False for k in
                   ("signingPermitted", "authorizationGranted", "dispatchPermitted"))
            or response.get("releaseDecision") != "NO_GO"
            or not isinstance(result, dict)
            or result.get("stage") != "PRE_CONSUMPTION_VERIFICATION_ONLY"
            or result.get("threeSignaturesVerified") is not True
            or result.get("persistedAdminApprovalReadBack") is not True
            or result.get("approvalDigest") != digest
            or result.get("hubLinkDigest") != link_digest
            or result.get("coreLinkDigest") != link_digest
            or any(result.get(k) is not False for k in
                   ("databaseWritePerformed", "nonceConsumed", "leaseConsumed",
                    "signingPermitted", "authorizationGranted", "dispatchPermitted"))
            or result.get("releaseDecision") != "NO_GO"):
        _reject("STAGED_VERIFIER_RESPONSE_MISMATCH")
    if min(approval["expiresAt"], link["expiresAt"]) - int(time.time() * 1000) < MIN_REMAINING_MS:
        _reject("STAGED_EVIDENCE_EXPIRED_AFTER_VERIFICATION")
    return {
        "environment": "DEV",
        "taskId": approval["taskId"],
        "threeSignaturesVerified": True,
        "persistedAdminApprovalReadBack": True,
        "verifierPeerAuthenticated": True,
        "approvalDigest": digest,
        "hubLinkDigest": link_digest,
        "databaseWritePerformed": False,
        "recordLinkedApprovalExecuted": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }
