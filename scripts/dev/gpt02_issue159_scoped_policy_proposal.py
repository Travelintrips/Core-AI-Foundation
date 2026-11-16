#!/usr/bin/env python3
"""SOURCE-ONLY proposed exact-task policy renderer for GPT02 Issue159.

NEVER import this as operational authorization. The caller MUST first obtain
a genuinely authenticated, persisted four-signature lineage readback. Even
then, the current candidate has NO authority to provision credentials.
This function returns review-only SQL text, performs NO DB connection,
role activation, credential generation, service change, or dispatch.

Five table/column names are pinned to the schema observed read-only in
CST-DEV on 2026-11-15. Proposed SQL is tested ONLY against an isolated,
networkless disposable PostgreSQL 16 clone, NOT applied to live database.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
import uuid

from gpt02_issue159_writer_broker_contract import BrokerAdmissionError

TABLE_COLUMNS = {
    "approvals": (
        "task_id", "company_id", "attempt_id", "command_id",
        "digest", "nonce", "expires_at", "claims",
    ),
    "operator_links": (
        "link_id", "hub_execution_id", "core_task_id", "link_digest",
        "expires_at", "company_id", "hub_task_id", "command_id",
        "attempt_id", "approval_digest", "claims", "attempt_number",
    ),
    "receipts": ("id", "command_id", "nonce", "digest", "consumed_at"),
    "core_identity_receipts": (
        "receipt_id", "command_id", "link_id", "link_digest",
        "binding_verified", "may_dispatch_worker", "may_issue_grant",
        "may_close_job", "core_ledger_written",
    ),
    "post_consumption_fences": (
        "fence_id", "receipt_id", "command_id", "link_id",
        "hub_execution_id", "core_task_id", "attempt_id", "worker_id",
        "lease_epoch", "lease_started_at", "lease_expires_at",
        "dispatch_allowed", "core_ledger_written",
    ),
}
SCOPE_KEYS = frozenset((
    "company_id", "task_id", "command_id", "attempt_id",
    "approval_digest", "approval_nonce", "link_id", "link_digest",
    "hub_execution_id", "core_task_id", "receipt_id", "fence_id",
    "lease_epoch", "worker_id",
))
NO_AUTHORITY_FLAGS = (
    "databaseRoleProvisioned", "credentialIssuancePermitted",
    "databaseWritePerformed", "signingPermitted",
    "authorizationGranted", "dispatchPermitted",
)
HEX = re.compile(r"[a-f0-9]{64}\Z")
ROLE = re.compile(r"dev_gpt02_task_[1-9][0-9]*_[a-f0-9]{12}\Z")
UUID_FIELDS = (
    "command_id", "attempt_id", "link_id", "hub_execution_id",
    "core_task_id", "receipt_id", "fence_id",
)
WORKER = "openclaw-dell-chatgpt-wake-dev"


def deny(reason):
    raise BrokerAdmissionError(reason)


def quote(value: str) -> str:
    if not isinstance(value, str) or "\x00" in value:
        deny("SCOPED_POLICY_QUOTING_INVALID")
    return "'" + value.replace("'", "''") + "'"


def exact_uuid(value: str):
    if not isinstance(value, str):
        deny("SCOPED_POLICY_UUID_INVALID")
    try:
        if str(uuid.UUID(value)) != value:
            deny("SCOPED_POLICY_UUID_NOT_CANONICAL")
    except (ValueError, AttributeError):
        deny("SCOPED_POLICY_UUID_INVALID")
    return quote(value) + "::uuid"


def validate_inert_candidate(candidate: object, observed_ms: int) -> tuple[dict, str, int]:
    """Only validate a candidate SHAPE, not its trust origin or authority."""
    if type(observed_ms) is not int or observed_ms <= 0:
        deny("SCOPED_POLICY_CLOCK_INVALID")
    if not isinstance(candidate, dict):
        deny("SCOPED_POLICY_CANDIDATE_INVALID")
    if (
        candidate.get("environment") != "DEV"
        or candidate.get("stage")
          != "FOUR_SIGNATURE_PERSISTED_LINEAGE_SCOPED_READER_REVIEW_ONLY"
        or candidate.get("releaseDecision") != "NO_GO"
        or candidate.get("persistedAdminApprovalReadBack") is not True
        or candidate.get("persistedLineageMatched") is not True
        or any(candidate.get(flag) is not False for flag in NO_AUTHORITY_FLAGS)
    ):
        deny("SCOPED_POLICY_NO_AUTHORITY_REQUIRED")
    scope = candidate.get("scope")
    if not isinstance(scope, dict) or set(scope) != SCOPE_KEYS:
        deny("SCOPED_POLICY_SCOPE_SHAPE_INVALID")
    task = scope.get("task_id")
    if (
        type(task) is not int or task <= 139
        or scope["company_id"] != "default"
        or scope["worker_id"] != WORKER
        or type(scope["lease_epoch"]) is not int or scope["lease_epoch"] != 1
    ):
        deny("SCOPED_POLICY_TASK_OR_TENANT_INVALID")
    for key in UUID_FIELDS:
        exact_uuid(scope[key])
    if scope["command_id"] == scope["attempt_id"]:
        deny("SCOPED_POLICY_IDS_DUPLICATED")
    for field in ("approval_digest", "link_digest"):
        if not isinstance(scope[field], str) or not HEX.fullmatch(scope[field]):
            deny("SCOPED_POLICY_DIGEST_INVALID")
    if not isinstance(scope["approval_nonce"], str) or not re.fullmatch(
        r"[A-Za-z0-9_-]{32,96}", scope["approval_nonce"]
    ):
        deny("SCOPED_POLICY_NONCE_INVALID")
    packet_sha = candidate.get("verifiedPacketSha256")
    scope_sha = candidate.get("scopeSha256")
    if (
        not isinstance(packet_sha, str) or not HEX.fullmatch(packet_sha)
        or not isinstance(scope_sha, str) or not HEX.fullmatch(scope_sha)
    ):
        deny("SCOPED_POLICY_HASH_INVALID")
    payload = json.dumps(scope, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=False, allow_nan=False).encode("utf-8")
    derived = hashlib.sha256(
        b"GPT02_POSTLINEAGE_SCOPED_READER_V1\\n" +
        payload + packet_sha.encode("ascii")
    ).hexdigest()
    if derived != scope_sha:
        deny("SCOPED_POLICY_SCOPE_BINDING_INVALID")
    expected_role = "dev_gpt02_task_" + str(task) + "_" + derived[:12]
    if (candidate.get("candidateRole") != expected_role
            or not ROLE.fullmatch(expected_role)
            or len(expected_role) >= 63):
        deny("SCOPED_POLICY_ROLE_BINDING_INVALID")
    expires = candidate.get("expiresAt")
    # A renderer must never create a policy for an already-expired lease.
    # It is not a TTL extender or authority issuer.
    if (
        type(expires) is not int or expires-observed_ms < 3500
        or expires-observed_ms > 300000
    ):
        deny("SCOPED_POLICY_SIGNED_LEASE_INVALID")
    return scope, expected_role, expires


def proposed_sql(candidate: object, observed_ms: int) -> str:
    """Produce DRAFT DDL text; NO execution, NO credential and NO permission."""
    scope, role, expires = validate_inert_candidate(candidate, observed_ms)
    cmd = exact_uuid(scope["command_id"])
    att = exact_uuid(scope["attempt_id"])
    lnk = exact_uuid(scope["link_id"])
    rec = exact_uuid(scope["receipt_id"])
    fence = exact_uuid(scope["fence_id"])
    hex_digest = quote(scope["approval_digest"])
    link_digest = quote(scope["link_digest"])
    nonce = quote(scope["approval_nonce"])
    owner = quote(scope["company_id"])
    worker = quote(scope["worker_id"])
    exp = "to_timestamp(" + str(expires) + "/1000.0)"
    # Clock evaluated by PostgreSQL, not a caller-supplied GUC or JWT.
    period = "clock_timestamp() < " + exp
    predicates = {
        "approvals": (
            f"task_id = {scope['task_id']} AND company_id = {owner} "
            f"AND command_id = {cmd} AND attempt_id = {att} "
            f"AND digest = {hex_digest} AND nonce = {nonce} "
            "AND claims->>'environment' = 'DEV' "
            f"AND expires_at > clock_timestamp() AND {period}"
        ),
        "operator_links": (
            f"hub_task_id = {scope['task_id']} AND company_id = {owner} "
            f"AND command_id = {cmd} AND attempt_id = {att} "
            f"AND link_id = {lnk} AND approval_digest = {hex_digest} "
            f"AND link_digest = {link_digest} "
            "AND attempt_number = 1 AND claims->>'environment' = 'DEV' "
            f"AND expires_at > clock_timestamp() AND {period}"
        ),
        "receipts": (
            f"id = {rec} AND command_id = {cmd} "
            f"AND nonce = {nonce} AND digest = {hex_digest} "
            f"AND consumed_at <= clock_timestamp() AND {period}"
        ),
        "core_identity_receipts": (
            f"receipt_id = {rec} AND command_id = {cmd} "
            f"AND link_id = {lnk} AND link_digest = {link_digest} "
            "AND NOT binding_verified AND NOT may_dispatch_worker "
            "AND NOT may_issue_grant AND NOT may_close_job "
            f"AND NOT core_ledger_written AND {period}"
        ),
        "post_consumption_fences": (
            f"fence_id = {fence} AND receipt_id = {rec} "
            f"AND command_id = {cmd} AND link_id = {lnk} "
            f"AND attempt_id = {att} "
            f"AND hub_execution_id = {exact_uuid(scope['hub_execution_id'])} "
            f"AND core_task_id = {exact_uuid(scope['core_task_id'])} "
            f"AND worker_id = {worker} AND lease_epoch = 1 "
            "AND lease_started_at <= clock_timestamp() "
            "AND lease_expires_at > clock_timestamp() "
            "AND NOT dispatch_allowed AND NOT core_ledger_written "
            f"AND {period}"
        ),
    }
    # The ACTUAL CST-DEV tables belong to gpt02_store_owner, while
    # postgres has CREATEROLE but pg_has_role(...,'SET') is FALSE.
    # Reuse the same transactional owner-custody pattern already proposed
    # in gpt02-issue159-positive-dispatch-permit.PROPOSED.sql. Do not weaken
    # either the operating reader or the permanent owner membership.
    stmts = [
        "-- SOURCE-ONLY PROPOSAL. NEVER APPLY TO LIVE DEV OR PROD.",
        "-- No LOGIN/password, signer, dispatch, privileged routine or worker.",
        "-- This requires an independently approved, dedicated migrator.",
        "BEGIN;",
        "DO $preflight$ DECLARE tbl text; BEGIN",
        " IF current_user <> 'postgres' OR",
        " NOT (SELECT rolcreaterole FROM pg_roles WHERE rolname='postgres')",
        " THEN RAISE EXCEPTION 'SCOPED_POLICY_MIGRATOR_IDENTITY_REQUIRED'; END IF;",
        " IF pg_has_role('postgres','gpt02_store_owner','SET')",
        " OR NOT EXISTS (SELECT 1 FROM pg_auth_members m",
        " WHERE m.roleid='gpt02_store_owner'::regrole",
        " AND m.member='postgres'::regrole AND m.admin_option)",
        " THEN RAISE EXCEPTION 'SCOPED_POLICY_OWNER_CUSTODY_BASELINE_INVALID'; END IF;",
        " IF NOT EXISTS (SELECT 1 FROM pg_namespace n",
        " WHERE n.nspname='gpt02_private'",
        " AND n.nspowner='gpt02_store_owner'::regrole)",
        " THEN RAISE EXCEPTION 'SCOPED_POLICY_SCHEMA_OWNER_DRIFT'; END IF;",
        " FOREACH tbl IN ARRAY ARRAY['approvals','operator_links','receipts',",
        " 'core_identity_receipts','post_consumption_fences'] LOOP",
        " IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n",
        " ON n.oid=c.relnamespace",
        " WHERE n.nspname='gpt02_private' AND c.relname=tbl",
        " AND c.relowner='gpt02_store_owner'::regrole",
        " AND c.relrowsecurity AND c.relforcerowsecurity)",
        " THEN RAISE EXCEPTION 'SCOPED_POLICY_TABLE_OWNER_OR_RLS_DRIFT:%',tbl;",
        " END IF;",
        " END LOOP;",
        "END $preflight$;",
        f"CREATE ROLE {role} NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;",
        "GRANT gpt02_store_owner TO postgres WITH SET TRUE;",
        "SET ROLE gpt02_store_owner;",
        f"GRANT USAGE ON SCHEMA gpt02_private TO {role};",
    ]
    for table, cols in TABLE_COLUMNS.items():
        stmts.append(
            f"GRANT SELECT ({', '.join(cols)}) ON gpt02_private.{table} "
            f"TO {role};"
        )
        stmts.append(
            f"CREATE POLICY gpt02_scope_{scope['task_id']}_{candidate['scopeSha256'][:12]} "
            f"ON gpt02_private.{table} FOR SELECT TO {role} "
            f"USING ({predicates[table]});"
        )
    stmts.extend([
        "RESET ROLE;",
        "GRANT gpt02_store_owner TO postgres WITH SET FALSE;",
        "DO $postflight$ BEGIN",
        " IF current_user <> 'postgres' OR",
        " pg_has_role('postgres','gpt02_store_owner','SET')",
        " THEN RAISE EXCEPTION 'SCOPED_POLICY_OWNER_PRIVILEGE_NOT_RESTORED';",
        " END IF;",
        "END $postflight$;",
        "COMMIT;",
    ])
    return "\n".join(stmts) + "\n"



def review_sql_from_authenticated_signed_packet(packet: object) -> str:
    """Only review entrypoint: NO caller-supplied roots, role, candidate or clock.

    The ACTIVE verifier's pinned public roots and independent persisted
    approval/lineage readback are used before deriving scope. This returns
    SQL text for review only. It cannot issue credentials, connect to
    PostgreSQL, apply DDL, or grant any runtime authority.

    Tests may call the lower-level proposed_sql(candidate, observed_ms) with
    synthetically signed inert candidates, but that function is NOT an
    authentication boundary and must never be used by a live issuer.
    """
    from gpt02_issue159_writer_broker_runtime import (
        _load_public_roots, DEFAULT_FINGERPRINT_MANIFEST,
    )
    from gpt02_issue159_positive_permit_handoff import (
        VERIFIER_PUBLIC_ROOT_DIR, inspect_postlineage_scoped_reader_candidate,
    )
    roots = _load_public_roots(
        VERIFIER_PUBLIC_ROOT_DIR, DEFAULT_FINGERPRINT_MANIFEST,
    )
    candidate = inspect_postlineage_scoped_reader_candidate(packet, roots)
    return proposed_sql(candidate, int(time.time() * 1000))


# A source-only review of owner-issued reader ledger values. Operational
# issuance remains a separately reviewed, unimplemented trust boundary:
# NOTHING in this module performs INSERT, COMMIT, CREATE ROLE, or LOGIN.
MAX_REVIEW_LEDGER_LIFETIME_MS = 15_000


def review_issuance_bindings_from_authenticated_signed_packet(packet: object) -> dict:
    """Derive a bounded, inert issuance row from EXISTING pinned trust evidence.

    Uses the same four-root verifier + persisted Super Admin approval and
    lineage readback as exact-task policy review. The only output is a
    candidate set of ledger values for independent owner/security review,
    never a credential, INSERT, permission or operational issuance token.
    No caller can pass a role, packet digest, approval, clock, or public roots.
    """
    from gpt02_issue159_writer_broker_runtime import (
        _load_public_roots, _require_persisted_admin_decision,
        DEFAULT_FINGERPRINT_MANIFEST, DEFAULT_APPROVAL_READER_SOCKET,
    )
    from gpt02_issue159_positive_permit_handoff import (
        VERIFIER_PUBLIC_ROOT_DIR, inspect_postlineage_scoped_reader_candidate,
    )
    roots = _load_public_roots(
        VERIFIER_PUBLIC_ROOT_DIR, DEFAULT_FINGERPRINT_MANIFEST,
    )
    candidate = inspect_postlineage_scoped_reader_candidate(packet, roots)
    observed_ms = int(time.time() * 1000)
    scope, role, signed_expiry = validate_inert_candidate(
        candidate, observed_ms,
    )
    # An earlier verifier's positive readback can become stale. Recheck the
    # actual persisted Super Admin intent through the private, pinned reader
    # immediately before deriving review values; NEVER trust a supplied TTL.
    # This is still a non-atomic SQLite-to-PostgreSQL review, NOT issuance.
    persisted_expiry = _require_persisted_admin_decision(
        packet["approval"]["claims"], scope["approval_digest"],
        DEFAULT_APPROVAL_READER_SOCKET, observed_ms,
    )
    fresh_ms = int(time.time() * 1000)
    if (
        type(persisted_expiry) is not int
        or persisted_expiry <= fresh_ms
        or persisted_expiry - fresh_ms > 300_000
    ):
        deny("REVIEW_PERSISTED_APPROVAL_EXPIRY_INVALID")
    # An extra conservative cap, NOT an operational authorization. The
    # eventual DB writer must independently check real approval/revocation
    # at issuance and the signed lease using a trustworthy clock.
    proposed_expiry = min(
        signed_expiry, persisted_expiry,
        fresh_ms + MAX_REVIEW_LEDGER_LIFETIME_MS,
    )
    if proposed_expiry - fresh_ms < 3500:
        deny("REVIEW_ISSUANCE_LEASE_TOO_CLOSE_TO_EXPIRY")
    return {
        "environment": "DEV",
        "stage": "SIGNED_PERSISTED_APPROVAL_LEDGER_ISSUANCE_REVIEW_ONLY",
        "sourceVerified": True,
        "signedLeaseExpiresAt": signed_expiry,
        "persistedApprovalExpiresAt": persisted_expiry,
        "proposedLedgerExpiresAt": proposed_expiry,
        "issuanceParameters": {
            "scope_sha": candidate["scopeSha256"],
            "packet_sha": candidate["verifiedPacketSha256"],
            "role_name": role,
            "task_id": scope["task_id"],
            "company_id": scope["company_id"],
            "command_id": scope["command_id"],
            "attempt_id": scope["attempt_id"],
            "receipt_id": scope["receipt_id"],
            "fence_id": scope["fence_id"],
            "expires_at_ms": proposed_expiry,
        },
        "databaseWritePerformed": False,
        "ownerIssuanceCommitted": False,
        "databaseRoleProvisioned": False,
        "credentialIssuancePermitted": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }

if __name__ == "__main__":
    raise SystemExit("REVIEW_ONLY_NO_CLI_NO_LIVE_APPLY")
