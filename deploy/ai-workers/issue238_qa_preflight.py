"""Pre-execution composition for the existing Issue #238 QA safety modules.

THIS IS NOT A RUNNER: no Docker calls, subprocess, SQL, network, or credential
provisioning. The caller MUST be an independently authenticated trusted adapter.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
import re
import uuid
from pathlib import Path
from typing import Callable

from issue238_qa_permit import PermitDenied, verify_permit, WORKER_ID
from issue238_qa_integrity import verify_source_manifest, verify_image_metadata
from issue238_qa_ledger import reserve

# Verified CST-DEV AI Core service-token record (separate from worker client ID).
# A future adapter must authenticate this exact DB-backed credential.
VPS_AGENT_TOKEN_NAME = "openclaw-vps-dev-consumer"


@dataclass(frozen=True)
class AuthenticatedWork:
    # Populated exclusively by a future existing-control-plane trusted adapter.
    # NEVER from a request body, model message, or claimed worker identity.
    authenticated_worker_id: str
    durable_command_id: str
    durable_job_id: str


# Source-only adapter for the *already authenticated* AI Core work/claim result.
# Both inputs MUST originate from the trusted control plane. Parsing a JSON
# message from a worker or Owner is not itself proof of authentication.
def bind_claimed_ai_core_work(*, credential: dict, claimed_work: dict, now: datetime | None = None) -> AuthenticatedWork:
    """Fail closed if a service token can claim a different worker's work.

    This does not fetch/authorize work, sign a permit or execute QA. The caller
    must independently authenticate the token and confirm the claim lease in
    AI Core's durable command store before relying on this returned identity.
    """
    if not isinstance(credential, dict) or not isinstance(claimed_work, dict):
        raise PermitDenied("trusted_work_context_required")
    # AI Core registers the canonical work client as openclaw-vps-main,
    # but its actual scoped service credential is openclaw-vps-dev-consumer.
    # Do not compare these two different identifiers for equality or accept
    # an arbitrary agent:work token merely because its scope is sufficient.
    if (credential.get("name") != VPS_AGENT_TOKEN_NAME or credential.get("isActive") is not True):
        raise PermitDenied("worker_credential_mismatch")
    scopes = credential.get("scopes")
    if not isinstance(scopes, list) or "agent:work" not in scopes:
        raise PermitDenied("agent_work_scope_required")
    metadata = claimed_work.get("metadata")
    if not isinstance(metadata, dict) or any(metadata.get(key) != WORKER_ID
                                             for key in ("claimedBy", "assignedClientId")):
        raise PermitDenied("claimed_worker_mismatch")
    if claimed_work.get("status") != "PROCESSING":
        raise PermitDenied("active_claim_required")
    claim_token = claimed_work.get("claimToken")
    if not isinstance(claim_token, str) or not claim_token:
        raise PermitDenied("claim_token_required")
    command_id = claimed_work.get("commandId")
    job_id = claimed_work.get("taskId")
    if not isinstance(command_id, str) or not isinstance(job_id, str):
        raise PermitDenied("durable_command_and_job_required")
    try:
        if any(str(uuid.UUID(value)) != value.lower() for value in (claim_token, command_id, job_id)):
            raise ValueError("noncanonical UUID")
    except ValueError as exc:
        raise PermitDenied("malformed_durable_claim_id") from exc
    # AI Core writes a PostgreSQL timestamptz rendered with a space or T,
    # and an offset. Never interpret offset-less timestamps as local time.
    expires = metadata.get("claimLeaseExpiresAt")
    if not isinstance(expires, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)",
        expires,
    ):
        raise PermitDenied("claim_lease_missing_or_unbounded")
    try:
        lease_end = datetime.fromisoformat(expires.replace("Z", "+00:00"))
    except ValueError as exc:
        raise PermitDenied("claim_lease_invalid") from exc
    clock = datetime.now(timezone.utc) if now is None else now
    if not isinstance(clock, datetime) or clock.tzinfo is None or clock.utcoffset() is None:
        raise PermitDenied("trusted_utc_clock_required")
    remaining = (lease_end - clock).total_seconds()
    if not (0 < remaining <= 300):
        raise PermitDenied("claim_lease_expired_or_unbounded")
    return AuthenticatedWork(WORKER_ID, command_id, job_id)


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
