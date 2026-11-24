#!/usr/bin/env python3
"""Fail-closed, source-only read-only Owner decision ledger verifier.

NO CLI, no connection constructor, no DSN/env, no private key or mutation.
A future independently audited DB custodian must inject an authenticated
CST-DEV read-only connection. This module NEVER treats a caller-provided
approval boolean or an in-memory fixture as live authorization.

Result is only a checked decision record, never an executor grant.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from datetime import datetime
from typing import Protocol

from gpt02_relock_once_candidate import (
    GateDenied, VerifiedDecision, SCOPE, PROJECT, HOST, PRINCIPAL, OPERATIONS,
)

_UUID = re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")
_SHA = re.compile(r"^[0-9a-f]{64}$")
OWNER_METHOD = "FRESH_CST_HUB_SIGNED_GOOGLE_OWNER_SESSION"
CANONICAL_DOMAIN = b"CST_GPT02_RELOCK_OWNER_APPROVAL_V1\n"

# Exact scope and returned columns, no interpolated identifier or SQL text.
_OWNER_READ_SQL = """
SELECT c.id::text AS challenge_id, c.scope, c.environment, c.project_id,
       c.worker_principal, c.owner_subject, c.owner_email,
       c.owner_auth_supabase_id::text AS owner_auth_supabase_id,
       c.status AS challenge_status, c.manifest_json, c.manifest_sha256,
       c.issued_at, c.expires_at, c.consumed_at,
       d.decision, d.decided_at, d.approval_method,
       d.owner_subject AS decision_owner_subject, d.owner_email AS decision_owner_email,
       d.owner_auth_supabase_id::text AS decision_owner_auth_supabase_id,
       d.manifest_sha256 AS decision_digest, d.scope AS decision_scope,
       d.worker_principal AS decision_worker,
       (SELECT count(*) FROM gpt02_owner_approval.gpt02_relock_owner_approval_decisions d2
         WHERE d2.challenge_id = c.id) AS decision_count,
       (SELECT count(*) FROM gpt02_owner_approval.gpt02_relock_owner_approval_challenges c2
         WHERE c2.id = c.id AND c2.status = 'CONSUMED') AS consumed_count
  FROM gpt02_owner_approval.gpt02_relock_owner_approval_challenges c
  JOIN gpt02_owner_approval.gpt02_relock_owner_approval_decisions d
    ON d.challenge_id = c.id
 WHERE c.id = %s::uuid AND c.scope = 'GPT02_RELOCK_CST_DEV'
 LIMIT 2
"""


class ReadOnlyLedgerCursor(Protocol):
    def read_exact_owner_decision(self, sql: str, args: tuple[str, ...]) -> list[Mapping]: ...
    # The installed custodian must pin exact project/role TLS and use a
    # read-only snapshot. No such live adapter is supplied here.


def _canonical(value: object) -> str:
    # Matches the relevant JSON primitive/object/array semantics of the
    # original canonical manifest. Refuse non-JSON, floats and nonstring keys.
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if type(value) is int:
        return str(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(_canonical(item) for item in value) + "]"
    if isinstance(value, dict) and all(isinstance(key, str) for key in value):
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False, separators=(",", ":")) + ":" + _canonical(value[key])
            for key in sorted(value)
        ) + "}"
    raise GateDenied("LEDGER_MANIFEST_JSON_INVALID")


def _nonempty_email(value: object) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[^@\s]+@[^@\s]+", value))


def verify_owner_ledger_record(cursor: ReadOnlyLedgerCursor, challenge_id: str) -> VerifiedDecision:
    if not isinstance(challenge_id, str) or not _UUID.fullmatch(challenge_id):
        raise GateDenied("OWNER_CHALLENGE_ID_INVALID")
    if not callable(getattr(cursor, "read_exact_owner_decision", None)):
        raise GateDenied("INDEPENDENT_READ_ONLY_LEDGER_CUSTODIAN_REQUIRED")
    try:
        rows = cursor.read_exact_owner_decision(_OWNER_READ_SQL, (challenge_id,))
    except Exception:
        raise GateDenied("OWNER_LEDGER_READ_UNAVAILABLE") from None
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], Mapping):
        raise GateDenied("EXACTLY_ONE_OWNER_LEDGER_ROW_REQUIRED")
    row = rows[0]
    manifest = row.get("manifest_json")
    if not isinstance(manifest, dict):
        raise GateDenied("LEDGER_MANIFEST_JSON_INVALID")
    digest = row.get("manifest_sha256")
    if not isinstance(digest, str) or not _SHA.fullmatch(digest):
        raise GateDenied("LEDGER_MANIFEST_DIGEST_INVALID")
    canonical = CANONICAL_DOMAIN + _canonical(manifest).encode("utf-8")
    if hashlib.sha256(canonical).hexdigest() != digest:
        raise GateDenied("LEDGER_MANIFEST_DIGEST_MISMATCH")
    times = [row.get(k) for k in ("issued_at", "decided_at", "expires_at", "consumed_at")]
    if not all(isinstance(t, datetime) and t.tzinfo is not None and t.utcoffset() is not None for t in times):
        raise GateDenied("OWNER_LEDGER_TIMESTAMPS_INVALID")
    required = (
        row.get("challenge_id") == challenge_id and
        row.get("scope") == SCOPE and row.get("environment") == "DEV" and
        row.get("project_id") == PROJECT and row.get("worker_principal") == PRINCIPAL and
        row.get("challenge_status") == "CONSUMED" and row.get("decision") == "APPROVED" and
        row.get("approval_method") == OWNER_METHOD and
        type(row.get("decision_count")) is int and row.get("decision_count") == 1 and
        type(row.get("consumed_count")) is int and row.get("consumed_count") == 1 and
        row.get("consumed_at") is not None and row.get("decided_at") is not None and
        row.get("expires_at") is not None and row.get("issued_at") is not None and
        row.get("issued_at") <= row.get("decided_at") < row.get("expires_at") and
        row.get("decided_at") == row.get("consumed_at") and
        row.get("decision_scope") == SCOPE and row.get("decision_worker") == PRINCIPAL and
        row.get("decision_digest") == digest and
        row.get("owner_subject") == row.get("decision_owner_subject") and
        row.get("owner_email") == row.get("decision_owner_email") and
        row.get("owner_auth_supabase_id") == row.get("decision_owner_auth_supabase_id") and
        _nonempty_email(row.get("owner_email")) and
        manifest.get("scope") == SCOPE and manifest.get("environment") == "DEV" and
        manifest.get("projectId") == PROJECT and manifest.get("hostId") == HOST and
        manifest.get("workerPrincipal") == PRINCIPAL and
        manifest.get("ownerEmail") == row.get("owner_email") and
        manifest.get("ownerSubject") == row.get("owner_subject") and
        manifest.get("ownerAuthSupabaseId") == row.get("owner_auth_supabase_id") and
        manifest.get("operations") == list(OPERATIONS)
    )
    if not required:
        raise GateDenied("OWNER_LEDGER_RECORD_BINDING_MISMATCH")
    return VerifiedDecision(
        challenge_id=challenge_id, manifest_digest=digest,
        scope=SCOPE, project=PROJECT, owner_email=row["owner_email"],
        decision="APPROVED", challenge_status="CONSUMED",
        matching_decisions=1, consumed_challenges=1, operations=OPERATIONS,
    )
