#!/usr/bin/env python3
"""Issue159 CST-DEV original Owner SQLite outbox -> PostgreSQL fence.

Source-only, not mounted or provisioned. Two stages share ONE already
recorded Owner decision: (1) source import BEFORE issuer signature,
(2) four-signature scope binding AFTER independently verified issuer.

This is not a human approval screen, a credential issuer, a signer, a worker
or a dispatch route. PostgreSQL writes require a separately authorized
root-custodied native writer session. No caller can submit a source decision
as a plain object: stage one uses the original Ed25519 root + private SQLite
outbox readback. Stage two uses the existing pinned four-signature verifier
and rechecks the exact already committed source row.

The write cannot be atomically committed across SQLite and PostgreSQL.
An uncertain commit is NEVER replayed with new scope; on conflict, the
database row must match all exact values, or the bridge returns NO_GO.
"""
from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any

from gpt02_issue159_owner_source_relay_review import (
    review_owner_source_from_existing_service,
)
from gpt02_issue159_writer_broker_runtime import (
    _load_public_roots, DEFAULT_FINGERPRINT_MANIFEST,
)
from gpt02_issue159_positive_permit_handoff import (
    VERIFIER_PUBLIC_ROOT_DIR, inspect_postlineage_scoped_reader_candidate,
)
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError
from gpt02_issue159_pinned_tls_ca import require_pinned_cst_dev_tls

HOST="aws-1-ap-southeast-2.pooler.supabase.com"
USER="postgres.xssrfshdrtdfupgqwfdw"
PROJECT="xssrfshdrtdfupgqwfdw"
SHA=re.compile(r"^[a-f0-9]{64}$")
SRC_FIELDS=(
    "source_decision_id","claims_sha256","owner_actor_id","auth_method",
    "role_at_decision","company_id","task_id","command_id","attempt_id",
    "recorded_at_ms","expires_at_ms",
)
LINK_FIELDS=("scope_sha","source_decision_id","packet_sha")

# Keep authority in the existing private DB triggers. No application-origin
# approval flag can change those triggers or their FOR SHARE row locks.
SOURCE_INSERT="""
INSERT INTO gpt02_relock_audit.owner_source_decisions (
 source_decision_id,claims_sha256,owner_actor_id,auth_method,
 role_at_decision,company_id,task_id,command_id,attempt_id,
 recorded_at_ms,expires_at_ms
)
SELECT %(source_decision_id)s::uuid,%(claims_sha256)s,
 %(owner_actor_id)s,%(auth_method)s,
 %(role_at_decision)s,%(company_id)s,%(task_id)s,
 %(command_id)s::uuid,%(attempt_id)s::uuid,
 %(recorded_at_ms)s,%(expires_at_ms)s
WHERE to_timestamp(%(expires_at_ms)s/1000.0) >
 clock_timestamp()+interval '3.5 seconds'
ON CONFLICT DO NOTHING
"""
SOURCE_READ="""
SELECT source_decision_id::text AS source_decision_id,
 claims_sha256,owner_actor_id,auth_method,role_at_decision,
 company_id,task_id,command_id::text AS command_id,
 attempt_id::text AS attempt_id,recorded_at_ms,expires_at_ms,
 revoked_at IS NULL AS active,
 to_timestamp(expires_at_ms/1000.0) >
 clock_timestamp()+interval '3.5 seconds' AS fresh
FROM gpt02_relock_audit.owner_source_decisions
WHERE source_decision_id=%(source_decision_id)s::uuid
FOR SHARE
"""
LINK_INSERT="""
INSERT INTO gpt02_relock_audit.reader_owner_source_bindings (
 scope_sha,source_decision_id,packet_sha
)
SELECT %(scope_sha)s,s.source_decision_id,%(packet_sha)s
FROM gpt02_relock_audit.owner_source_decisions s
JOIN gpt02_relock_audit.reader_approval_fences f
 ON f.task_id=s.task_id AND f.company_id=s.company_id
 AND f.command_id=s.command_id AND f.attempt_id=s.attempt_id
WHERE s.source_decision_id=%(source_decision_id)s::uuid
 AND s.claims_sha256=%(claims_sha256)s
 AND s.task_id=%(task_id)s
 AND s.command_id=%(command_id)s::uuid
 AND s.attempt_id=%(attempt_id)s::uuid
 AND s.revoked_at IS NULL
 AND to_timestamp(s.expires_at_ms/1000.0)>
 clock_timestamp()+interval '3.5 seconds'
 AND f.scope_sha=%(scope_sha)s AND f.packet_sha=%(packet_sha)s
 AND f.revoked_at IS NULL
 AND f.approval_expires_at<=to_timestamp(s.expires_at_ms/1000.0)
ON CONFLICT DO NOTHING
"""
LINK_READ="""
SELECT b.scope_sha,b.source_decision_id::text AS source_decision_id,
 b.packet_sha,
 s.claims_sha256,s.task_id,s.command_id::text AS command_id,
 s.attempt_id::text AS attempt_id,
 s.revoked_at IS NULL AS source_active,
 f.revoked_at IS NULL AS fence_active,
 to_timestamp(s.expires_at_ms/1000.0)>
 clock_timestamp()+interval '3.5 seconds' AS source_fresh
FROM gpt02_relock_audit.reader_owner_source_bindings b
JOIN gpt02_relock_audit.owner_source_decisions s
 ON s.source_decision_id=b.source_decision_id
JOIN gpt02_relock_audit.reader_approval_fences f
 ON f.scope_sha=b.scope_sha
WHERE b.scope_sha=%(scope_sha)s
FOR SHARE OF b,s,f
"""

def _deny(code: str) -> None:
    raise BrokerAdmissionError(code)

def _postgres(conn:Any) -> None:
    info=getattr(conn,"info",None)
    if (info is None or getattr(info,"user",None)!=USER or
        getattr(info,"dbname",None)!="postgres" or
        getattr(info,"host",None)!=HOST or
        str(getattr(info,"port",None))!="5432" or
        getattr(conn,"autocommit",None) is not False):
        _deny("OWNER_BRIDGE_PINNED_POSTGRES_SESSION_REQUIRED")
    get=getattr(info,"get_parameters",None)
    require_pinned_cst_dev_tls(
        get() if callable(get) else None,
        "OWNER_BRIDGE_CSTDEV_TLS_VERIFY_FULL_REQUIRED",
    )

def _execute(conn:Any, insert:str, read:str, params:dict,
             fields:tuple[str,...]) -> dict:
    """One exact idempotent transaction with fresh DB-owned readback.

    The caller MUST not retry after an uncertain COMMIT: use independently
    authenticated read-only recovery for that case.
    """
    try:
        with conn.cursor() as cur:
            cur.execute("SET TRANSACTION READ WRITE")
            cur.execute("SET LOCAL statement_timeout = '1500ms'")
            cur.execute("SET LOCAL lock_timeout = '1500ms'")
            cur.execute(insert,params)
            cur.execute(read,params)
            found=cur.fetchmany(2)
            names=tuple(x.name for x in cur.description)
            if names!=fields or len(found)!=1 or len(found[0])!=len(fields):
                _deny("OWNER_BRIDGE_DATABASE_ROW_NOT_UNIQUE")
            row=dict(zip(names,found[0]))
            conn.commit()
            return row
    except Exception:
        try:conn.rollback()
        except Exception:pass
        raise

def _source(signed_approval:dict) -> dict:
    # NO caller-injected verified flags, signatures, roots or SQLite rows.
    review=review_owner_source_from_existing_service(signed_approval)
    if (
        review.get("stage")!="SIGNED_PERSISTED_OWNER_SOURCE_REVIEW_ONLY"
        or review.get("signatureVerifiedByOriginalRoot") is not True
        or review.get("outboxVerifiedInSQLite") is not True
        or review.get("postgresFenceWritten") is not False
        or review.get("releaseDecision")!="NO_GO"
        or review.get("credentialIssuancePermitted") is not False
        or review.get("authorizationGranted") is not False
    ):
        _deny("OWNER_BRIDGE_ORIGINAL_SQLITE_SOURCE_NOT_PROVEN")
    return review

def import_existing_owner_decision(
    signed_approval:dict, postgres:Any,
) -> dict:
    """Stage 1: one genuine decision -> one unprivileged provenance row.

    Must run BEFORE any issuer signature or scoped credential. No issuer
    proof, Core command creation or second human consent is needed here.
    """
    review=_source(signed_approval)
    _postgres(postgres)
    params={
        "source_decision_id":review["sourceDecisionId"],
        "claims_sha256":review["claimsSha256"],
        "owner_actor_id":review["ownerActorId"],
        "auth_method":review["authMethod"],
        "role_at_decision":review["roleAtDecision"],
        "company_id":review["companyId"],
        "task_id":review["taskId"],
        "command_id":review["commandId"],
        "attempt_id":review["attemptId"],
        "recorded_at_ms":review["recordedAtMs"],
        "expires_at_ms":review["expiresAtMs"],
    }
    row=_execute(postgres,SOURCE_INSERT,SOURCE_READ,params,
                 SRC_FIELDS+("active","fresh"))
    if any(row.get(key)!=value for key,value in params.items()) or (
        row.get("active") is not True or row.get("fresh") is not True
    ):
        _deny("OWNER_BRIDGE_SQLITE_POSTGRES_SOURCE_MISMATCH")
    return {
        "stage":"SIGNED_OWNER_OUTBOX_IMPORTED_REVIEW_ONLY",
        "sourceDecisionId":params["source_decision_id"],
        "claimsSha256":params["claims_sha256"],
        "taskId":params["task_id"],
        "sourceDatabaseVerified":True,
        "postgresSourceReadbackMatched":True,
        "authorizationGranted":False,
        "credentialIssuancePermitted":False,
        "dispatchPermitted":False,
        "releaseDecision":"NO_GO",
    }

def bind_existing_issuer_packet(
    packet:dict, postgres:Any,
) -> dict:
    """Stage 2: verified original four-signed scope binds the SAME decision.

    Cannot mint canonical fence or a reader issuance. If source import was
    not already committed, the SELECT on source has zero rows and refuses.
    """
    if not isinstance(packet,dict) or set(packet)!={
        "approval","hubLink","coreLink","issuerEvidence"
    }:
        _deny("OWNER_BRIDGE_FOUR_SIGNED_PACKET_REQUIRED")
    roots=_load_public_roots(
        VERIFIER_PUBLIC_ROOT_DIR,DEFAULT_FINGERPRINT_MANIFEST,
    )
    candidate=inspect_postlineage_scoped_reader_candidate(packet,roots)
    review=_source(packet["approval"])
    scope=candidate.get("scope")
    if (
        not isinstance(scope,dict)
        or scope.get("task_id")!=review["taskId"]
        or scope.get("company_id")!=review["companyId"]
        or scope.get("command_id")!=review["commandId"]
        or scope.get("attempt_id")!=review["attemptId"]
        or scope.get("approval_digest")!=review["claimsSha256"]
        or candidate.get("releaseDecision")!="NO_GO"
        or candidate.get("credentialIssuancePermitted") is not False
        or candidate.get("databaseRoleProvisioned") is not False
    ):
        _deny("OWNER_BRIDGE_FOUR_SIGNATURE_SOURCE_SCOPE_MISMATCH")
    params={
        "source_decision_id":review["sourceDecisionId"],
        "claims_sha256":review["claimsSha256"],
        "task_id":review["taskId"],
        "command_id":review["commandId"],
        "attempt_id":review["attemptId"],
        "scope_sha":candidate["scopeSha256"],
        "packet_sha":candidate["verifiedPacketSha256"],
    }
    for name in ("scope_sha","packet_sha","claims_sha256"):
        if not isinstance(params[name],str) or SHA.fullmatch(params[name]) is None:
            _deny("OWNER_BRIDGE_SIGNED_SCOPE_DIGEST_INVALID")
    _postgres(postgres)
    row=_execute(
        postgres,LINK_INSERT,LINK_READ,params,
        LINK_FIELDS+("claims_sha256","task_id","command_id","attempt_id",
                     "source_active","fence_active","source_fresh"),
    )
    if (
        any(row.get(key)!=params[key] for key in (
            "scope_sha","source_decision_id","packet_sha",
            "claims_sha256","task_id","command_id","attempt_id"
        ))
        or any(row.get(k) is not True for k in (
            "source_active","fence_active","source_fresh"
        ))
    ):
        _deny("OWNER_BRIDGE_ORIGINAL_DECISION_NOT_BOUND_TO_PACKET")
    return {
        "stage":"FOUR_SIGNATURE_OWNER_FENCE_BOUND_REVIEW_ONLY",
        "sourceDecisionId":params["source_decision_id"],
        "scopeSha256":params["scope_sha"],
        "packetSha256":params["packet_sha"],
        "postgresFenceReadbackMatched":True,
        "credentialIssuancePermitted":False,
        "authorizationGranted":False,
        "dispatchPermitted":False,
        "releaseDecision":"NO_GO",
    }

if __name__=="__main__":
    raise SystemExit("OWNER_PG_BRIDGE_SOURCE_ONLY_NOT_MOUNTED")
