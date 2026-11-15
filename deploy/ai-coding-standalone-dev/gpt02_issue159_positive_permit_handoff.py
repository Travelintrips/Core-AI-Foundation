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
# Matches the pinned public-root directory in the ACTIVE verifier systemd unit.
VERIFIER_PUBLIC_ROOT_DIR = "/etc/gpt02-dev/verifier-public"
MAX_RESPONSE = 32768
# Verifier performs two independent bounded trusted readbacks (4s each).
# Keep this request bounded, but do not time out before those readers can finish.
# The broker separately refuses an issuer lease with <3.5s remaining.
REQUEST_TIMEOUT_S = 9.0

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

def inspect_prelineage_reader_scope_candidate(packet: dict[str, Any]) -> dict[str, Any]:
    """Review a one-task scope *before* querying the lineage ledger.

    Reuse the existing four-signature verifier and pinned, persisted Super
    Admin approval reader. The proposed DB scope is derived only from signed
    claims; no task, expected DB role, digest or 'approved' bit can be supplied
    independently by the caller.

    IMPORTANT: This is SOURCE ONLY, NOT A CREDENTIAL ISSUER. The returned
    role name is a deterministic candidate, NOT a database identity grant.
    No role creation, credential generation, PostgreSQL connection or worker
    dispatch is performed; database-enforced scope remains a separate gate.
    """
    # Load pinned PUBLIC roots and the existing private approval reader only
    # when invoked; never load signer private keys or a new database login.
    from gpt02_issue159_writer_broker_runtime import (
        _load_public_roots, _require_persisted_admin_decision,
        DEFAULT_FINGERPRINT_MANIFEST,
        DEFAULT_APPROVAL_READER_SOCKET,
    )

    now_ms = int(time.time() * 1000)
    roots = _load_public_roots(VERIFIER_PUBLIC_ROOT_DIR, DEFAULT_FINGERPRINT_MANIFEST)
    proof = verify_lifecycle_evidence_packet(packet, roots, now_ms)
    approval = packet["approval"]["claims"]
    issuer = packet["issuerEvidence"]["claims"]
    # The short-lived, four-signed issuer evidence must remain useful after
    # completing the independent persisted approval readback.
    if issuer["expiresAt"] - now_ms < 3500:
        _fail("ISSUER_LEASE_TOO_CLOSE_TO_EXPIRY")
    _require_persisted_admin_decision(
        approval, proof["approvalDigest"], DEFAULT_APPROVAL_READER_SOCKET, now_ms,
    )

    scope = {
        "company_id": approval["companyId"],
        "task_id": approval["taskId"],
        "command_id": approval["commandId"],
        "attempt_id": approval["attemptId"],
        "approval_digest": proof["approvalDigest"],
    }
    # Bind the proposed identity label to *all* exact scope fields. The
    # label is inert until an independent owner-reviewed DB role is created.
    canonical = json.dumps(
        scope, sort_keys=True, ensure_ascii=False,
        separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")
    fingerprint = hashlib.sha256(b"GPT02_SCOPED_READER_V1\\n" + canonical).hexdigest()
    packet_canonical = json.dumps(
        packet, sort_keys=True, ensure_ascii=False,
        separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")
    return {
        "environment": "DEV",
        "stage": "SIGNED_PACKET_PERSISTED_ADMIN_PRELINEAGE_REVIEW_ONLY",
        "scope": scope,
        "candidateRole": "dev_gpt02_task_" + str(approval["taskId"]) + "_" + fingerprint[:12],
        "scopeSha256": fingerprint,
        "signedPacketSha256": hashlib.sha256(packet_canonical).hexdigest(),
        "expiresAt": min(approval["expiresAt"], issuer["expiresAt"]),
        "fourSignaturesVerified": True,
        "persistedAdminApprovalReadBack": True,
        "lineageReadbackCompleted": False,
        "databaseRoleProvisioned": False,
        "credentialIssuancePermitted": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }

def inspect_postlineage_scoped_reader_candidate(
    packet: dict[str, Any], pinned_public_roots: dict[str, str],
) -> dict[str, Any]:
    """Derive an INERT exact-row reader candidate after trusted lineage proof.

    Reuse the existing pinned-verifier socket and its persisted Super Admin
    and five-table lineage readbacks. We independently bind the verified
    packet SHA to the signed IDs and never accept independent caller-supplied
    task, command, receipt, fence, role or credential strings.

    No DB connection, role DDL, credential material, grant or dispatch.
    A future implementation MUST separately authorize and atomically consume
    one-use issuance, check all five RLS policies and terminate sessions.
    """
    proof = inspect_proposed_permit_candidate(packet, pinned_public_roots)
    if not isinstance(proof, dict) or proof.get("releaseDecision") != "NO_GO":
        _fail("POSTLINEAGE_VERIFIER_PROOF_INVALID")
    if (
        proof.get("stage") != "FOUR_SIGNATURE_PERSISTED_LINEAGE_REVIEWED"
        or proof.get("verifiedByExistingReader") is not True
        or proof.get("positivePermitCreated") is not False
        or proof.get("databaseWritePerformed") is not False
        or any(proof.get(k) is not False for k in (
            "signingPermitted", "authorizationGranted", "dispatchPermitted"
        ))
    ):
        _fail("POSTLINEAGE_NO_AUTHORITY_PROOF_REQUIRED")

    approval = packet["approval"]["claims"]
    link = packet["hubLink"]["claims"]
    issuer = packet["issuerEvidence"]["claims"]
    # verify_lifecycle_evidence_packet validates exact canonical claim shapes,
    # signatures, distinct root custody and all these cross-link fields in
    # the existing authenticated handoff, not in a caller-provided JSON flag.
    if (
        proof.get("hubTaskId") != approval["taskId"]
        or proof.get("commandId") != approval["commandId"]
        or proof.get("attemptId") != approval["attemptId"]
        or proof.get("fenceId") != issuer["fenceId"]
        or proof.get("approvalDigest") != issuer["approvalDigest"]
        or link["linkId"] != issuer["linkId"]
        or link["hubExecutionId"] != issuer["hubExecutionId"]
        or link["coreTaskId"] != issuer["coreTaskId"]
    ):
        _fail("POSTLINEAGE_SIGNED_SCOPE_MISMATCH")

    packet_bytes = json.dumps(
        packet, sort_keys=True, ensure_ascii=False,
        separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")
    if proof.get("verifiedPacketSha256") != hashlib.sha256(packet_bytes).hexdigest():
        _fail("POSTLINEAGE_SIGNED_PACKET_HASH_MISMATCH")

    now_ms = int(time.time() * 1000)
    # A reader result must not become an alternate authority over fields that
    # the result omits (notably receipt_id and link_id). Recheck the original
    # signed packet even after the pinned verifier has authenticated it.
    independent = verify_lifecycle_evidence_packet(
        packet, pinned_public_roots, now_ms,
    )
    if (
        proof.get("approvalDigest") != independent["approvalDigest"]
        or proof.get("hubLinkDigest") != independent["hubLinkDigest"]
        or proof.get("coreLinkDigest") != independent["coreLinkDigest"]
        or independent.get("fourDistinctRoleRootsUsed") is not True
    ):
        _fail("POSTLINEAGE_INDEPENDENT_SIGNATURE_BINDING_MISMATCH")
    # Prevent a stale previously authenticated handoff being reused after
    # the issuer lease or the Super Admin approval has expired.
    expires_at = min(approval["expiresAt"], link["expiresAt"], issuer["expiresAt"])
    if expires_at - now_ms < 3500:
        _fail("POSTLINEAGE_LEASE_TOO_CLOSE_TO_EXPIRY")

    scope = {
        "company_id": approval["companyId"],
        "task_id": approval["taskId"],
        "command_id": approval["commandId"],
        "attempt_id": approval["attemptId"],
        "approval_digest": proof["approvalDigest"],
        "approval_nonce": approval["nonce"],
        "link_id": link["linkId"],
        "link_digest": proof["hubLinkDigest"],
        "hub_execution_id": link["hubExecutionId"],
        "core_task_id": link["coreTaskId"],
        "receipt_id": issuer["receiptId"],
        "fence_id": issuer["fenceId"],
        "lease_epoch": issuer["leaseEpoch"],
        "worker_id": issuer["workerId"],
    }
    payload = json.dumps(
        scope, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    digest = hashlib.sha256(
        b"GPT02_POSTLINEAGE_SCOPED_READER_V1\\n" + payload
        + proof["verifiedPacketSha256"].encode("ascii")
    ).hexdigest()
    return {
        "environment": "DEV",
        "stage": "FOUR_SIGNATURE_PERSISTED_LINEAGE_SCOPED_READER_REVIEW_ONLY",
        "scope": scope,
        "scopeSha256": digest,
        "candidateRole": f"dev_gpt02_task_{approval['taskId']}_{digest[:12]}",
        "expiresAt": expires_at,
        "verifiedPacketSha256": proof["verifiedPacketSha256"],
        "persistedAdminApprovalReadBack": True,
        "persistedLineageMatched": True,
        "databaseRoleProvisioned": False,
        "credentialIssuancePermitted": False,
        "databaseWritePerformed": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }
