#!/usr/bin/env python3
"""DEV Issue159 existing-verifier -> proposed-permit review handoff.

Never produces grant/dispatch authority. This adapter authenticates the existing
read-only Unix verifier, independently checks the four Ed25519 signatures using
the existing canonical contract and binds its persisted approval/lineage answer
to the exact caller packet. A later separately reviewed *operational writer*
must provide the positive authorization decision and one-use DB transaction.

This module has NO database driver, private keys, signer calls or worker client.
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
    BrokerAdmissionError,
    ISSUER_FIELDS,
    verify_lifecycle_evidence_packet,
)

VERIFIER_SOCKET = "/run/gpt02-issue159-verifier/verify.sock"
VERIFIER_USER = "gpt02-issue159-verifier"
VERIFIER_GROUP = "gpt02-issue159-signers"
MAX_RESPONSE = 32768
REQUEST_TIMEOUT_S = 3.0

TOP_FIELDS = frozenset((
    "ok", "environment", "result", "writerEnabled", "databaseConnected",
    "signingPermitted", "authorizationGranted", "dispatchPermitted",
    "releaseDecision",
))
REQUIRED_TRUE = (
    "packetVerified", "fourDistinctRoleRootsUsed",
    "issuerEvidenceVerified", "persistedAdminApprovalReadBack",
    "fourSignaturesVerified", "persistedLineageMatched",
    "trustedAdapterAuthenticated", "lineageReaderReadOnly",
)
REQUIRED_FALSE = (
    "databaseWritePerformed", "nonceConsumed", "leaseConsumed",
    "signingPermitted", "authorizationGranted", "dispatchPermitted",
)


def _fail(code: str) -> None:
    raise BrokerAdmissionError(code)


def verify_readonly_envelope(
    packet: dict[str, Any], public_roots: dict[str, str],
    envelope: Any, observed_at_ms: int,
) -> dict[str, Any]:
    """Check verifier reply AND independently re-verify the original packet.

    Caller-supplied envelopes are NOT authenticated by this pure function.
    Operational callers must use the strict peer-pinned Unix client below.
    The return value deliberately has no permit ID or usable grant.
    """
    if type(observed_at_ms) is not int or observed_at_ms <= 0:
        _fail("OBSERVATION_TIME_INVALID")
    # Refuse a positive-looking reply even when all signatures are valid.
    if not isinstance(envelope, dict) or set(envelope) != TOP_FIELDS:
        _fail("VERIFIER_ENVELOPE_SHAPE_INVALID")
    if (
        envelope["ok"] is not True
        or envelope["environment"] != "DEV"
        or envelope["writerEnabled"] is not False
        or envelope["databaseConnected"] is not False
        or envelope["signingPermitted"] is not False
        or envelope["authorizationGranted"] is not False
        or envelope["dispatchPermitted"] is not False
        or envelope["releaseDecision"] != "NO_GO"
    ):
        _fail("VERIFIER_NOT_READONLY_NO_GO")
    result = envelope["result"]
    if not isinstance(result, dict):
        _fail("VERIFIER_RESULT_INVALID")
    if (
        any(result.get(k) is not True for k in REQUIRED_TRUE)
        or any(result.get(k) is not False for k in REQUIRED_FALSE)
        or result.get("stage") != "POST_FENCE_TRUSTED_READBACK_VERIFICATION_ONLY"
        or result.get("releaseDecision") != "NO_GO"
        or result.get("environment") != "DEV"
    ):
        _fail("PERSISTED_SIGNED_LINEAGE_NOT_PROVEN")

    verified = verify_lifecycle_evidence_packet(
        packet, public_roots, observed_at_ms,
    )
    for name in ("approvalDigest", "hubLinkDigest", "coreLinkDigest"):
        if result.get(name) != verified[name]:
            _fail("VERIFIER_PACKET_DIGEST_MISMATCH")
    if verified.get("packetVerified") is not True:
        _fail("FOUR_SIGNATURE_VERIFICATION_FAILED")
    approval = packet["approval"]["claims"]
    issuer = packet["issuerEvidence"]["claims"]
    if (
        issuer["commandId"] != approval["commandId"]
        or issuer["attemptId"] != approval["attemptId"]
        or issuer["hubTaskId"] != approval["taskId"]
    ):
        _fail("EXACT_COMMAND_ATTEMPT_LINEAGE_REQUIRED")

    # Hash the *whole signed packet*, never trust caller-supplied SHA fields.
    packet_bytes = json.dumps(
        packet, sort_keys=True, ensure_ascii=False,
        separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")
    issuer_bytes = json.dumps(
        {k: issuer[k] for k in ISSUER_FIELDS},
        ensure_ascii=False, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")
    return {
        "environment": "DEV",
        "stage": "FOUR_SIGNATURE_PERSISTED_LINEAGE_REVIEWED",
        "hubTaskId": approval["taskId"],
        "commandId": approval["commandId"],
        "attemptId": approval["attemptId"],
        "fenceId": issuer["fenceId"],
        "verifiedPacketSha256": hashlib.sha256(packet_bytes).hexdigest(),
        "issuerClaimsSha256": hashlib.sha256(issuer_bytes).hexdigest(),
        "approvalDigest": verified["approvalDigest"],
        "verifiedByExistingReader": True,
        "positivePermitCreated": False,
        "databaseWritePerformed": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }


def _pinned_verifier_socket(socket_path: str) -> tuple[int, int]:
    # NO arbitrary socket URL/path supplied by caller in the live function.
    if socket_path != VERIFIER_SOCKET:
        _fail("VERIFIER_SOCKET_PATH_NOT_PINNED")
    try:
        uid = pwd.getpwnam(VERIFIER_USER).pw_uid
        gid = grp.getgrnam(VERIFIER_GROUP).gr_gid
        parent = os.lstat(str(Path(socket_path).parent))
        entry = os.lstat(socket_path)
    except (KeyError, OSError) as exc:
        raise BrokerAdmissionError("PINNED_VERIFIER_UNAVAILABLE") from exc
    if (
        not stat.S_ISDIR(parent.st_mode)
        or stat.S_ISLNK(parent.st_mode)
        or parent.st_uid != uid
        or parent.st_gid != gid
        or stat.S_IMODE(parent.st_mode) != 0o750
        or not stat.S_ISSOCK(entry.st_mode)
        or stat.S_ISLNK(entry.st_mode)
        or entry.st_uid != uid
        or entry.st_gid != gid
        or stat.S_IMODE(entry.st_mode) != 0o660
    ):
        _fail("PINNED_VERIFIER_SOCKET_CUSTODY_INVALID")
    return uid, gid


def _verifier_post(packet: dict[str, Any], now_ms: int) -> dict[str, Any]:
    uid, gid = _pinned_verifier_socket(VERIFIER_SOCKET)
    body = json.dumps(
        {"packet": packet, "observedAt": now_ms},
        separators=(",", ":"), ensure_ascii=False, allow_nan=False,
    ).encode("utf-8")
    if len(body) > 24 * 1024:
        _fail("VERIFIER_PACKET_TOO_LARGE")
    request = (
        b"POST /verify-persisted-lineage HTTP/1.1\r\n"
        b"Host: localhost\r\n"
        b"Content-Type: application/json\r\n"
        b"Connection: close\r\n"
        b"Content-Length: " + str(len(body)).encode("ascii")
        + b"\r\n\r\n" + body
    )
    chunks: list[bytes] = []
    size = 0
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
            conn.settimeout(REQUEST_TIMEOUT_S)
            conn.connect(VERIFIER_SOCKET)
            if not hasattr(socket, "SO_PEERCRED"):
                _fail("VERIFIER_PEER_CREDENTIALS_REQUIRED")
            peer_pid, peer_uid, peer_gid = struct.unpack(
                "3i", conn.getsockopt(
                    socket.SOL_SOCKET, socket.SO_PEERCRED, 12,
                ),
            )
            if peer_pid <= 0 or peer_uid != uid or peer_gid != gid:
                _fail("VERIFIER_PEER_NOT_TRUSTED")
            conn.sendall(request)
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_RESPONSE:
                    _fail("VERIFIER_RESPONSE_TOO_LARGE")
                chunks.append(chunk)
    except (OSError, TimeoutError) as exc:
        raise BrokerAdmissionError("VERIFIER_TRANSPORT_FAILED") from exc

    raw = b"".join(chunks)
    head, sep, response_body = raw.partition(b"\r\n\r\n")
    if not sep or len(head) > 4096:
        _fail("VERIFIER_RESPONSE_FRAMING_INVALID")
    lines = head.split(b"\r\n")
    if lines[0] != b"HTTP/1.1 200 OK":
        _fail("VERIFIER_POSITIVE_READBACK_UNAVAILABLE")
    headers: dict[bytes, bytes] = {}
    for line in lines[1:]:
        key, separator, value = line.partition(b":")
        key = key.strip().lower()
        if not separator or key in headers:
            _fail("VERIFIER_HTTP_HEADERS_INVALID")
        headers[key] = value.strip()
    length = headers.get(b"content-length", b"")
    if (
        headers.get(b"content-type") != b"application/json"
        or b"transfer-encoding" in headers
        or not length.isdigit()
        or int(length) != len(response_body)
    ):
        _fail("VERIFIER_HTTP_BODY_LENGTH_INVALID")
    try:
        obj = json.loads(response_body)
    except (ValueError, UnicodeError) as exc:
        raise BrokerAdmissionError("VERIFIER_RESPONSE_JSON_INVALID") from exc
    return obj


def inspect_proposed_permit_candidate(
    packet: dict[str, Any], pinned_public_roots: dict[str, str],
) -> dict[str, Any]:
    """Only operational entrypoint; reader peer is pinned and never writable."""
    now_ms = int(time.time() * 1000)
    verify_lifecycle_evidence_packet(packet, pinned_public_roots, now_ms)
    envelope = _verifier_post(packet, now_ms)
    return verify_readonly_envelope(
        packet, pinned_public_roots, envelope, int(time.time() * 1000),
    )
