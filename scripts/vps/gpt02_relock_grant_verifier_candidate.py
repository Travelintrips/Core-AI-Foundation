#!/usr/bin/env python3
"""Pure Ed25519 verifier for an *executor-specific* CST-DEV relock grant.

SOURCE-ONLY: No CLI, systemd unit, network client, private signing key, key
generation, database access or authority to run mutations. A separately
audited trusted caller supplies the pinned public key, signed envelope,
independently verified Owner ledger record, and current wall clock.
"""
from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from gpt02_relock_once_candidate import (
    VerifiedDecision, VerifiedExecutorGrant, SCOPE, PROJECT, HOST,
    PRINCIPAL, OPERATIONS, GateDenied,
)

B64U = re.compile(r"^[A-Za-z0-9_-]+$")
HEX = re.compile(r"^[0-9a-f]{64}$")
UUID = re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")
ENVELOPE_DOMAIN = b"CST-GPT02-RELOCK-EXECUTOR-GRANT-V1\n"
MAX_TTL_MS = 120_000
ALLOWED_FIELDS = frozenset((
    "version", "scope", "projectId", "hostId", "principal",
    "challengeId", "manifestSha256", "operations", "executorNonce",
    "issuedAtMs", "expiresAtMs",
))


@dataclass(frozen=True)
class SignedExecutorGrant:
    payload: bytes
    signature: bytes


def decode_b64u(value: str, max_bytes: int) -> bytes:
    if not isinstance(value, str) or not B64U.fullmatch(value) or len(value) > max_bytes * 2:
        raise GateDenied("INVALID_GRANT_ENCODING")
    try:
        result = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
        if len(result) > max_bytes or base64.urlsafe_b64encode(result).rstrip(b"=").decode() != value:
            raise ValueError("noncanonical encoding")
        return result
    except (ValueError, TypeError):
        raise GateDenied("INVALID_GRANT_ENCODING") from None


def parse_signed_envelope(obj: object) -> SignedExecutorGrant:
    if not isinstance(obj, dict) or set(obj) != {"payloadB64u", "signatureB64u"}:
        raise GateDenied("SIGNED_EXECUTOR_ENVELOPE_INVALID")
    return SignedExecutorGrant(
        decode_b64u(obj["payloadB64u"], 4096),
        decode_b64u(obj["signatureB64u"], 64),
    )


def verify_signed_executor_grant(
    envelope: object, pinned_public_key: bytes, decision: VerifiedDecision, now_ms: int
) -> VerifiedExecutorGrant:
    if (not isinstance(decision, VerifiedDecision)
        or not isinstance(now_ms, int) or isinstance(now_ms, bool) or now_ms < 0):
        raise GateDenied("TRUSTED_DECISION_AND_CLOCK_REQUIRED")
    if not isinstance(pinned_public_key, bytes) or len(pinned_public_key) != 32:
        raise GateDenied("PINNED_EXECUTOR_PUBLIC_KEY_REQUIRED")
    signed = parse_signed_envelope(envelope)
    if len(signed.signature) != 64:
        raise GateDenied("INVALID_EXECUTOR_SIGNATURE")
    try:
        Ed25519PublicKey.from_public_bytes(pinned_public_key).verify(
            signed.signature, ENVELOPE_DOMAIN + signed.payload
        )
    except (InvalidSignature, ValueError):
        raise GateDenied("INVALID_EXECUTOR_SIGNATURE") from None
    try:
        payload = json.loads(signed.payload.decode("utf-8"))
    except (ValueError, UnicodeError):
        raise GateDenied("EXECUTOR_GRANT_PAYLOAD_INVALID") from None
    if not isinstance(payload, dict) or set(payload) != ALLOWED_FIELDS:
        raise GateDenied("EXECUTOR_GRANT_PAYLOAD_INVALID")
    if (json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        .encode("utf-8") != signed.payload):
        raise GateDenied("NON_CANONICAL_EXECUTOR_GRANT")
    issued = payload["issuedAtMs"]
    expires = payload["expiresAtMs"]
    if (type(issued) is not int or type(expires) is not int or
        issued > now_ms + 30_000 or expires <= now_ms or
        expires <= issued or expires - issued > MAX_TTL_MS):
        raise GateDenied("EXECUTOR_GRANT_EXPIRED_OR_UNBOUNDED")
    if (payload["version"] != 1 or payload["scope"] != SCOPE or
        payload["projectId"] != PROJECT or payload["hostId"] != HOST or
        payload["principal"] != PRINCIPAL or
        not isinstance(payload["challengeId"], str) or not UUID.fullmatch(payload["challengeId"]) or
        not isinstance(payload["manifestSha256"], str) or not HEX.fullmatch(payload["manifestSha256"]) or
        not isinstance(payload["executorNonce"], str) or not UUID.fullmatch(payload["executorNonce"]) or
        payload["operations"] != list(OPERATIONS)):
        raise GateDenied("EXECUTOR_GRANT_SCOPE_INVALID")
    if (payload["challengeId"] != decision.challenge_id or
        payload["manifestSha256"] != decision.manifest_digest or
        decision.scope != SCOPE or decision.project != PROJECT or
        decision.decision != "APPROVED" or decision.challenge_status != "CONSUMED" or
        decision.matching_decisions != 1 or decision.consumed_challenges != 1 or
        tuple(decision.operations) != OPERATIONS):
        raise GateDenied("EXECUTOR_GRANT_OWNER_BINDING_INVALID")
    return VerifiedExecutorGrant(
        challenge_id=payload["challengeId"],
        manifest_digest=payload["manifestSha256"],
        executor_nonce=payload["executorNonce"],
        scope=payload["scope"], project=payload["projectId"],
        host=payload["hostId"], principal=payload["principal"],
        operations=tuple(payload["operations"]), grant_active=True,
    )
