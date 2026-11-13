"""DEV-only pre-sign gate for GPT02 Issue159 issuer detached signature.

Requires the same fresh persisted Super Admin approval and Hub/Core binding used
by the existing operator signer, then asks the independently authenticated
issuer-reader socket to prove the consumed nonce + non-dispatch fence lineage.
It never loads a private key, writes PostgreSQL, grants a lease, or dispatches.
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

from gpt02_issue159_signer_approval_guard import (
    canonical_sha, persisted_approval_fresh, fail, SIGNER_GROUP,
)
from gpt02_issue159_hub_core_signer_guard import require_hub_core_facts

ISSUER_READER = "/run/gpt02-issuer-reader/reader.sock"
ISSUER_READER_USER = "gpt02-issuer-reader"
WORKER = "openclaw-dell-chatgpt-wake-dev"
ISSUER_ROLE = "dev_gpt02_issuer_evidence"
MAX_RESPONSE_BYTES = 24_000
MIN_ISSUER_VALIDITY_MS = 2_000
ISSUER_FIELDS = (
    "v","environment","audience","companyId","hubTaskId","hubExecutionId",
    "coreTaskId","commandId","attemptId","workerId","receiptId","linkId",
    "fenceId","approvalDigest","nonceDigest","issuerRole","leaseEpoch",
    "issuedAt","expiresAt",
)


def _exact(value, fields):
    return isinstance(value, dict) and set(value) == set(fields)


def _require_socket(path: str, *, expected_uid: int | None = None) -> tuple[int, int]:
    try:
        gid = grp.getgrnam(SIGNER_GROUP).gr_gid
        uid = pwd.getpwnam(ISSUER_READER_USER).pw_uid if expected_uid is None else expected_uid
        parent = Path(path).parent
        pst = os.lstat(parent)
        st = os.lstat(path)
    except (OSError, KeyError) as exc:
        raise RuntimeError("ISSUER_READER_NOT_AVAILABLE") from exc
    if (not stat.S_ISDIR(pst.st_mode) or stat.S_ISLNK(pst.st_mode)
            or pst.st_uid != uid or pst.st_gid != gid
            or stat.S_IMODE(pst.st_mode) != 0o750
            or not stat.S_ISSOCK(st.st_mode) or stat.S_ISLNK(st.st_mode)
            or st.st_uid != uid or st.st_gid != gid
            or stat.S_IMODE(st.st_mode) != 0o660):
        fail("ISSUER_READER_CUSTODY_INVALID")
    return uid, gid


def _request_reader(claims: dict, now_ms: int, socket_path: str,
                    *, expected_uid: int | None = None) -> dict:
    uid, gid = _require_socket(socket_path, expected_uid=expected_uid)
    body = json.dumps(
        {"claims": claims, "observedAt": now_ms},
        separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")
    request = (
        b"POST /issuer-evidence HTTP/1.1\r\n"
        b"Host: localhost\r\n"
        b"Content-Type: application/json\r\n"
        b"Content-Length: " + str(len(body)).encode("ascii")
        + b"\r\nConnection: close\r\n\r\n" + body
    )
    reply = bytearray()
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(4.0)
            client.connect(socket_path)
            if not hasattr(socket, "SO_PEERCRED"):
                fail("ISSUER_READER_PEER_CREDENTIALS_REQUIRED")
            _pid, peer_uid, peer_gid = struct.unpack(
                "3i", client.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
            )
            if peer_uid != uid or peer_gid != gid:
                fail("ISSUER_READER_PEER_NOT_TRUSTED")
            client.sendall(request)
            while True:
                part = client.recv(4096)
                if not part:
                    break
                reply.extend(part)
                if len(reply) > MAX_RESPONSE_BYTES:
                    fail("ISSUER_READER_RESPONSE_TOO_LONG")
    except (TimeoutError, ConnectionError, OSError) as exc:
        raise RuntimeError("ISSUER_READER_CONNECTION_FAILED") from exc

    head, sep, raw = bytes(reply).partition(b"\r\n\r\n")
    if not sep:
        fail("ISSUER_READER_HTTP_INVALID")
    lines = head.split(b"\r\n")
    if lines[0] != b"HTTP/1.1 200 OK":
        fail("ISSUER_READER_LINEAGE_NOT_AVAILABLE")
    headers = {}
    for line in lines[1:]:
        key, colon, value = line.partition(b":")
        key = key.strip().lower()
        if not colon or key in headers:
            fail("ISSUER_READER_HEADERS_INVALID")
        headers[key] = value.strip()
    length = headers.get(b"content-length", b"")
    if (b"transfer-encoding" in headers or not length.isdigit()
            or int(length) != len(raw)
            or not headers.get(b"content-type", b"").startswith(b"application/json")):
        fail("ISSUER_READER_FRAMING_INVALID")
    try:
        envelope = json.loads(raw)
    except (ValueError, UnicodeError) as exc:
        raise RuntimeError("ISSUER_READER_JSON_INVALID") from exc
    return envelope


def require_issuer_facts(
    claims: dict, approved: dict, link: dict, *,
    now_ms: int | None = None,
    reader_socket: str = ISSUER_READER,
    reader_uid: int | None = None,
) -> None:
    """Prove exact fresh approval/link/receipt/fence lineage before issuer sign."""
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    if not _exact(claims, ISSUER_FIELDS):
        fail("ISSUER_CLAIMS_SHAPE_DENIED")
    if (claims.get("v") != 1 or claims.get("environment") != "DEV"
            or claims.get("audience") != "GPT02_ISSUER_LEASE_EVIDENCE_V1"
            or claims.get("companyId") != "default"
            or claims.get("workerId") != WORKER
            or claims.get("issuerRole") != ISSUER_ROLE
            or claims.get("leaseEpoch") != 1
            or type(claims.get("issuedAt")) is not int
            or type(claims.get("expiresAt")) is not int
            or claims["issuedAt"] > now_ms + 1000
            or claims["expiresAt"] - now_ms < MIN_ISSUER_VALIDITY_MS
            or claims["expiresAt"] - claims["issuedAt"] > 15_000):
        fail("ISSUER_CLAIMS_NOT_FRESH_OR_ALLOWED")
    if not isinstance(approved, dict) or not isinstance(link, dict):
        fail("ISSUER_PARENT_EVIDENCE_REQUIRED")

    digest = persisted_approval_fresh(approved, now_ms=now_ms)
    require_hub_core_facts("hub", link, approved, now_ms=now_ms)
    if (claims.get("hubTaskId") != approved.get("taskId")
            or claims.get("commandId") != approved.get("commandId")
            or claims.get("attemptId") != approved.get("attemptId")
            or claims.get("hubExecutionId") != link.get("hubExecutionId")
            or claims.get("coreTaskId") != link.get("coreTaskId")
            or claims.get("linkId") != link.get("linkId")
            or claims.get("approvalDigest") != digest
            or claims.get("nonceDigest") != hashlib.sha256(
                str(approved.get("nonce", "")).encode("utf-8")
            ).hexdigest()):
        fail("ISSUER_PARENT_BINDING_MISMATCH")

    envelope = _request_reader(
        claims, now_ms, reader_socket, expected_uid=reader_uid,
    )
    result = envelope.get("result") if isinstance(envelope, dict) else None
    proof = result.get("trustedReadProof") if isinstance(result, dict) else None
    if (not isinstance(envelope, dict)
            or set(envelope) != {
                "ok","environment","result","signingPermitted",
                "authorizationGranted","dispatchPermitted","releaseDecision",
            }
            or envelope.get("ok") is not True
            or envelope.get("environment") != "DEV"
            or any(envelope.get(k) is not False for k in (
                "signingPermitted","authorizationGranted","dispatchPermitted"))
            or envelope.get("releaseDecision") != "NO_GO"
            or not isinstance(result, dict)
            or result.get("readOnlySessionVerified") is not True
            or result.get("issuerLedgerMatched") is not True
            or result.get("persistedTrustedReadProven") is not True
            or result.get("signingPermitted") is not False
            or result.get("authorizationGranted") is not False
            or result.get("dispatchPermitted") is not False
            or result.get("commandCreated") is not False
            or result.get("releaseDecision") != "NO_GO"
            or not isinstance(proof, dict)
            or proof.get("environment") != "DEV"
            or proof.get("source") != "systemd-credential-backed-issuer-reader"
            or proof.get("role") != "gpt02_issuer_evidence_reader"
            or proof.get("nativeRoleVerified") is not True
            or proof.get("clientTlsVerified") is not True
            or proof.get("readOnlySessionVerified") is not True
            or any(proof.get(k) is not False for k in (
                "signingPermitted","authorizationGranted","dispatchPermitted"))
            or proof.get("releaseDecision") != "NO_GO"):
        fail("ISSUER_READER_TRUSTED_BINDING_REQUIRED")
    if claims["expiresAt"] - int(time.time() * 1000) < 1000:
        fail("ISSUER_READER_RESULT_EXPIRED")
    return None
