"""Fail-closed preflight for proposed Issue 238 disposable PostgreSQL 17 QA.

No Docker/SQL, process execution, network, signer, or service socket is provided.
The authenticated worker identity MUST be injected by a trusted transport, never
taken from the submitted permit. This is not authority to run hosted/PROD QA.
"""
import re
from pathlib import Path

from issue238_qa_ledger import reserve
from issue238_qa_integrity import verify_image_metadata, verify_source_manifest
from issue238_qa_permit import (
    APPROVED_SQL_SHA256, PermitDenied,
    WORKER_ID, verify_permit,
)

COMMAND_RE = re.compile(r"[A-Za-z0-9_-]{8,128}\Z")


def preflight(*, envelope, authenticated_worker_id: str,
              authenticated_command_id: str, public_key,
              sql_source: Path, test_root: Path, ledger_path: Path,
              image_metadata: dict,
              now: int | None = None):
    """Verify exact scope, runtime image attestation and durable reservation.

    image_metadata MUST be supplied by an authenticated local image inspector,
    NEVER from the request. No executable approval flag is issued.
    """
    if authenticated_worker_id != WORKER_ID:
        raise PermitDenied("unauthenticated_worker")
    if not isinstance(authenticated_command_id, str) or not COMMAND_RE.fullmatch(authenticated_command_id):
        raise PermitDenied("unauthenticated_command")
    image_id = verify_image_metadata(image_metadata)
    claims = envelope.get("claims", {}) if isinstance(envelope, dict) else {}
    if not isinstance(claims, dict) or claims.get("command_id") != authenticated_command_id:
        raise PermitDenied("command_identity_mismatch")
    # This verifier only handles a verified signed envelope, not freeform shell.
    test_path = verify_permit(
        envelope, public_key=public_key, sql_source=sql_source,
        test_root=test_root, used_nonces=set(), now=now,
    )
    if test_path.parent.resolve() != test_root.resolve():
        raise PermitDenied("test_escaped_review_root")
    # All four reviewed sources must match the manifest before reserving.
    manifest_hashes = verify_source_manifest(test_root)
    if not test_path.is_file() or test_path.is_symlink():
        raise PermitDenied("test_not_regular")
    manifest = {"sql_sha256": APPROVED_SQL_SHA256,
                "image_id": image_id,
                "script": test_path.name,
                "script_sha256": manifest_hashes[test_path.name]}
    # Atomic reservation rejects nonce/command replays, even across restarts.
    reserve(ledger_path, signed_claims=claims)
    # No command, Docker socket or approval token is returned.
    return {"state": "RESERVED", "command_id": authenticated_command_id,
            "job_id": claims["job_id"], "manifest": manifest}
