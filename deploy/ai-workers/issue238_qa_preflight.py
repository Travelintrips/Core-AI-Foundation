"""Pre-execution composition for the existing Issue #238 QA safety modules.

THIS IS NOT A RUNNER: no Docker calls, subprocess, SQL, network, or credential
provisioning. The caller MUST be an independently authenticated trusted adapter.
"""
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from issue238_qa_permit import PermitDenied, verify_permit, WORKER_ID
from issue238_qa_integrity import verify_source_manifest, verify_image_metadata
from issue238_qa_ledger import reserve


@dataclass(frozen=True)
class AuthenticatedWork:
    # Populated exclusively by a future existing-control-plane trusted adapter.
    # NEVER from a request body, model message, or claimed worker identity.
    authenticated_worker_id: str
    durable_command_id: str
    durable_job_id: str


@dataclass(frozen=True)
class PreparedQa:
    command_id: str
    job_id: str
    nonce: str
    script_name: str
    image_id: str
    claims_digest: str
    # Receipt proves reservation/preflight, NOT QA execution.
    status: str = "RESERVED_NOT_EXECUTED"


def prepare_qa(*, identity: AuthenticatedWork, envelope: dict,
               custodian_public_key, source_root: Path, ledger_path: Path,
               trusted_image_inspection: Callable[[], dict], now: int | None = None,
               expected_owner_uid: int = 0) -> PreparedQa:
    """Fail closed before durable reservation. No launch is performed.

    Caller must authenticate work, key custody, image inspection, and atomic
    source snapshot separately. This function cannot provide those properties.
    """
    if not isinstance(identity, AuthenticatedWork) or not isinstance(envelope, dict):
        raise PermitDenied("authenticated_job_required")
    claims = envelope.get("claims")
    if not isinstance(claims, dict):
        raise PermitDenied("claims_required")
    if identity.authenticated_worker_id != WORKER_ID or (
        claims.get("worker_id") != identity.authenticated_worker_id
        or claims.get("command_id") != identity.durable_command_id
        or claims.get("job_id") != identity.durable_job_id
    ):
        raise PermitDenied("authenticated_job_mismatch")
    if not callable(trusted_image_inspection):
        raise PermitDenied("trusted_image_inspector_required")

    # Validate all source and image references *before* reserving anything.
    verify_source_manifest(source_root, expected_owner_uid=expected_owner_uid)
    image_id = verify_image_metadata(trusted_image_inspection())
    script_path = verify_permit(
        envelope, public_key=custodian_public_key,
        sql_source=source_root / "issue238-postgres17-relock.sql",
        test_root=source_root, used_nonces=set(), now=now,
    )
    claims_digest = reserve(ledger_path, signed_claims=claims)
    return PreparedQa(
        command_id=claims["command_id"], job_id=claims["job_id"],
        nonce=claims["nonce"], script_name=script_path.name,
        image_id=image_id, claims_digest=claims_digest,
    )
