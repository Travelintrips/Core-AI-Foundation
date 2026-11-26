"""Source-only Issue #238 permit verifier for a future isolated QA runner.

DOES NOT dispatch commands, run Docker, grant DB privileges, or create approvals.
A trusted custodian must provision the signing key and separately authorize runner deployment.
"""
import base64
import binascii
import hashlib
import json
import re
import time
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

PROJECT_REF = "xssrfshdrtdfupgqwfdw"
APPROVED_SQL_SHA256 = "0c7815ee6e9ffc9950ee1d7e5680e6debf8e11cd840074dd2991ec49fe6d79c4"
APPROVED_IMAGE_SHA256 = "d9e2aef79dfb5d2737351a0010bb9d645726b331d42d4e25b87b31cff85d58d7"
WORKER_ID = "openclaw-vps-main"
OPERATION = "issue238-pg17-disposable-qa"
ALLOWED_TESTS = frozenset((
    "issue238-pg17-lock-expiry-concurrency-qa.sh",
    "issue238-pgcron164-nonsuperuser-crash-qa.sh",
    "issue238-pgcron164-scheduler-crash-qa.sh",
))
EXPECTED_CLAIMS = frozenset((
    "command_id", "job_id", "nonce", "worker_id", "operation", "environment",
    "project_ref", "sql_sha256", "image_sha256", "test", "issued_at", "expires_at",
))

class PermitDenied(ValueError):
    """Permit missing, untrusted, expired, replayed, or outside approved scope."""


def canonical_payload(claims):
    return json.dumps(claims, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def verify_permit(envelope, *, public_key: Ed25519PublicKey, sql_source: Path,
                  test_root: Path, used_nonces: set[str], now: int | None = None):
    """Return immutable test path only after signature, scope, source and replay checks.

    Caller must supply the independently authenticated worker identity as a
    security boundary as well; a JSON worker_id claim alone proves no worker.
    used_nonces must be a *durable, exclusive* registry in a real runner. Tests
    use an in-memory set; this module is not an executable transport.
    """
    if not isinstance(envelope, dict) or set(envelope) != {"claims", "signature"}:
        raise PermitDenied("invalid_envelope")
    claims = envelope["claims"]
    if not isinstance(claims, dict) or set(claims) != EXPECTED_CLAIMS:
        raise PermitDenied("invalid_claims")
    if not isinstance(envelope["signature"], str):
        raise PermitDenied("invalid_signature")
    try:
        signature = base64.b64decode(envelope["signature"], validate=True)
        public_key.verify(signature, canonical_payload(claims))
    except (ValueError, InvalidSignature, TypeError, binascii.Error) as exc:
        raise PermitDenied("signature_not_verified") from exc
    if len(signature) != 64:
        raise PermitDenied("invalid_signature_size")
    for name, value in (
        ("worker_id", WORKER_ID), ("operation", OPERATION),
        ("environment", "dev"), ("project_ref", PROJECT_REF),
        ("sql_sha256", APPROVED_SQL_SHA256),
        ("image_sha256", APPROVED_IMAGE_SHA256),
    ):
        if claims[name] != value:
            raise PermitDenied("scope_mismatch_" + name)
    if not isinstance(claims["test"], str) or claims["test"] not in ALLOWED_TESTS:
        raise PermitDenied("unreviewed_test")
    for name in ("command_id", "job_id", "nonce"):
        if not isinstance(claims[name], str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", claims[name]):
            raise PermitDenied("invalid_" + name)
    if not isinstance(claims["issued_at"], int) or not isinstance(claims["expires_at"], int):
        raise PermitDenied("invalid_permit_dates")
    clock = int(time.time()) if now is None else now
    if not (clock - 60 <= claims["issued_at"] <= clock and
            clock < claims["expires_at"] <= clock + 300):
        raise PermitDenied("permit_expired_or_unbounded")
    if claims["nonce"] in used_nonces:
        raise PermitDenied("replay")
    if not sql_source.is_file() or hashlib.sha256(sql_source.read_bytes()).hexdigest() != APPROVED_SQL_SHA256:
        raise PermitDenied("unreviewed_sql_source")
    test_path = test_root / claims["test"]
    if not test_path.is_file() or test_path.is_symlink():
        raise PermitDenied("missing_or_symlinked_test")
    # This source-only verifier cannot attest the runtime image or the caller's
    # identity. A privileged, separately reviewed runner MUST verify both.
    used_nonces.add(claims["nonce"])
    return test_path
