#!/usr/bin/env python3
"""Uninstalled DEV-only Issue159 release broker library.

Narrow proof-to-outbox handoff, NOT a worker dispatcher or an authorization
policy. It must only be loaded by a separately reviewed, private, one-shot
service with pinned DEV database credentials. No CLI or web API is exposed.

The canonical verifier checks four independent Ed25519 roots, genuine persisted
Super Admin approval and exact task/command/fence via authenticated Unix readers.
This library does not trust an externally supplied SHA, receipt or approval flag.

The two database RPC calls occur in ONE PostgreSQL transaction. The second RPC
durably writes a HELD_NO_DISPATCH outbox row, not a DELL command.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
import uuid
from typing import Any

from gpt02_issue159_positive_permit_handoff import (
    inspect_proposed_permit_candidate,
)
from gpt02_issue159_writer_broker_runtime import _load_public_roots
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError, ISSUER_FIELDS

PINNED_PUBLIC_DIR = "/etc/gpt02-dev/verifier-public"
PINNED_MANIFEST = "/etc/gpt02-dev/trust-fingerprints.json"
DEDICATED_DB_ROLE = "dev_gpt02_release_writer"
MIN_ISSUER_REMAINING_MS = 3500
HEX64 = re.compile(r"^[0-9a-f]{64}$")
B64URL = re.compile(r"^[A-Za-z0-9_-]{86}$")

ROLE_SQL = "SELECT session_user::text, current_user::text"
RESERVE_SQL = (
    "SELECT gpt02_private.reserve_positive_dispatch_permit("
    "%s::uuid,%s::text,%s::text,%s::text)"
)
CONSUME_SQL = (
    "SELECT gpt02_private.consume_positive_dispatch_permit("
    "%s::uuid,%s::uuid,%s::text)"
)


def _fail(code: str) -> None:
    raise BrokerAdmissionError(code)


def _make_verified_request(packet: Any) -> dict[str, Any]:
    """Derive every DB argument from a verified packet, not caller fields."""
    roots = _load_public_roots(PINNED_PUBLIC_DIR, PINNED_MANIFEST)
    proof = inspect_proposed_permit_candidate(packet, roots)
    if not isinstance(packet, dict) or not isinstance(proof, dict):
        _fail("SIGNED_PACKET_OR_PROOF_MISSING")
    approval = packet.get("approval", {}).get("claims")
    issuer = packet.get("issuerEvidence", {})
    claims = issuer.get("claims") if isinstance(issuer, dict) else None
    if not isinstance(approval, dict) or not isinstance(claims, dict):
        _fail("SIGNED_CLAIMS_MISSING")
    if (
        proof.get("environment") != "DEV"
        or proof.get("stage") != "FOUR_SIGNATURE_PERSISTED_LINEAGE_REVIEWED"
        or proof.get("verifiedByExistingReader") is not True
        or proof.get("positivePermitCreated") is not False
        or proof.get("databaseWritePerformed") is not False
        or proof.get("signingPermitted") is not False
        or proof.get("authorizationGranted") is not False
        or proof.get("dispatchPermitted") is not False
        or proof.get("releaseDecision") != "NO_GO"
        or proof.get("commandId") != approval.get("commandId")
        or proof.get("attemptId") != approval.get("attemptId")
        or proof.get("hubTaskId") != approval.get("taskId")
        or proof.get("fenceId") != claims.get("fenceId")
    ):
        _fail("PROVEN_SIGNED_LINEAGE_REQUIRED")
    now = int(time.time() * 1000)
    if (type(claims.get("expiresAt")) is not int
            or claims["expiresAt"] - now < MIN_ISSUER_REMAINING_MS):
        _fail("ISSUER_LEASE_TOO_CLOSE_TO_EXPIRY")
    packet_sha = proof.get("verifiedPacketSha256")
    issuer_sha = proof.get("issuerClaimsSha256")
    issuer_signature = issuer.get("signature")
    # Recompute both bindings independently of the verifier response.
    try:
        canonical_packet = json.dumps(
            packet, sort_keys=True, ensure_ascii=False,
            separators=(",", ":"), allow_nan=False,
        ).encode("utf-8")
        canonical_issuer = json.dumps(
            {k: claims[k] for k in ISSUER_FIELDS},
            ensure_ascii=False, separators=(",", ":"), allow_nan=False,
        ).encode("utf-8")
    except (KeyError, TypeError, ValueError) as exc:
        raise BrokerAdmissionError("CANONICAL_SIGNED_PACKET_INVALID") from exc
    if (
        packet_sha != hashlib.sha256(canonical_packet).hexdigest()
        or issuer_sha != hashlib.sha256(canonical_issuer).hexdigest()
    ):
        _fail("VERIFIER_HASH_BINDING_MISMATCH")
    if (
        not isinstance(packet_sha, str) or not HEX64.fullmatch(packet_sha)
        or not isinstance(issuer_sha, str) or not HEX64.fullmatch(issuer_sha)
        or not isinstance(issuer_signature, str)
        or not B64URL.fullmatch(issuer_signature)
    ):
        _fail("VERIFIED_PACKET_BINDING_INVALID")
    try:
        command_id = str(uuid.UUID(approval["commandId"]))
        attempt_id = str(uuid.UUID(approval["attemptId"]))
    except (ValueError, TypeError, KeyError, AttributeError) as exc:
        raise BrokerAdmissionError("SIGNED_IDENTIFIERS_INVALID") from exc
    if (command_id != approval["commandId"]
            or attempt_id != approval["attemptId"]):
        _fail("SIGNED_IDENTIFIERS_NOT_CANONICAL")
    return {
        "commandId": command_id,
        "attemptId": attempt_id,
        "packetSha": packet_sha,
        "issuerClaimsSha": issuer_sha,
        "issuerSignature": issuer_signature,
    }


def record_held_outbox_from_signed_packet(packet: dict[str, Any], connection: Any
                                           ) -> dict[str, Any]:
    """One transaction on dedicated writer connection; NO worker dispatch.

    The caller must supply its own already-authorized, private database
    connection; neither a DSN nor an arbitrary verified digest is accepted.
    This source is intentionally not connected to any running service.
    """
    if os.environ.get("GPT02_ISSUE159_POSITIVE_RELEASE_ENABLED") != "true":
        _fail("POSITIVE_RELEASE_NOT_ENABLED")
    verified = _make_verified_request(packet)
    with connection.transaction():
        with connection.cursor() as cur:
            cur.execute(ROLE_SQL)
            row = cur.fetchone()
            if row != (DEDICATED_DB_ROLE, DEDICATED_DB_ROLE):
                _fail("DEDICATED_RELEASE_WRITER_ROLE_REQUIRED")
            cur.execute(RESERVE_SQL, (
                verified["commandId"], verified["packetSha"],
                verified["issuerClaimsSha"], verified["issuerSignature"],
            ))
            row = cur.fetchone()
            if not isinstance(row, (list, tuple)) or len(row) != 1:
                _fail("PERMIT_RESERVATION_RESULT_INVALID")
            try:
                permit_id = str(uuid.UUID(str(row[0])))
            except (ValueError, TypeError, AttributeError) as exc:
                raise BrokerAdmissionError("PERMIT_ID_INVALID") from exc
            cur.execute(CONSUME_SQL, (
                permit_id, verified["commandId"], verified["packetSha"],
            ))
            row = cur.fetchone()
            if row != ("OUTBOX_RECORDED_NO_WORKER_DISPATCH",):
                _fail("ATOMIC_OUTBOX_CONSUMPTION_NOT_PROVEN")
    # The database transaction has committed an immutable held-intent row.
    # There is no service here which can claim or dispatch it.
    return {
        "environment": "DEV",
        "commandId": verified["commandId"],
        "attemptId": verified["attemptId"],
        "permitId": permit_id,
        "outboxState": "HELD_NO_DISPATCH",
        "outboxRecorded": True,
        "workerCommandCreated": False,
        "finalAckVerified": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }
