"""DEV-only persisted approval provenance for GPT02 Issue #159.

This module is deliberately NOT imported by approval_api.py yet.
It records no signature, consumes no nonce, creates no command, and grants no
dispatch authority. Its only purpose is to make AAL2/Super-Admin approval
provenance and exact canonical claim binding durable and append-only.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import uuid
from collections import OrderedDict
from typing import Any

APPROVAL_FIELDS = (
    "v", "environment", "audience", "taskId", "commandId", "attemptId",
    "nonce", "operatorNamespace", "superAdminId", "companyId",
    "issuedAt", "expiresAt",
)

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$"
)
NONCE_RE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
SUBJECT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$")
HEX_RE = re.compile(r"^[0-9a-f]{64}$")

TABLE = "gpt02_issue159_approval_decisions"


def _fail(code: str) -> None:
    raise ValueError(code)


def canonical_issue159_approval(claims: Any) -> str:
    if not isinstance(claims, dict):
        _fail("GPT02_ISSUE159_APPROVAL_FIELDS_INVALID")
    if len(claims) != len(APPROVAL_FIELDS) or any(
        field not in claims for field in APPROVAL_FIELDS
    ):
        _fail("GPT02_ISSUE159_APPROVAL_FIELDS_INVALID")
    ordered = OrderedDict((field, claims[field]) for field in APPROVAL_FIELDS)
    return json.dumps(
        ordered,
        ensure_ascii=False,
        separators=(",", ":"),
    )


def approval_claims_sha256(claims: Any) -> str:
    canonical = canonical_issue159_approval(claims)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def validate_issue159_approval_claims(claims: Any, observed_at_ms: int) -> None:
    canonical_issue159_approval(claims)
    if (
        claims["v"] != 2
        or claims["environment"] != "DEV"
        or claims["audience"] != "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL"
        or not isinstance(claims["taskId"], int)
        or isinstance(claims["taskId"], bool)
        or claims["taskId"] <= 136
        or claims["operatorNamespace"] != "ai-task-hub.public.users"
        or claims["companyId"] != "default"
        or not isinstance(claims["superAdminId"], str)
        or not SUBJECT_RE.fullmatch(claims["superAdminId"])
        or not isinstance(claims["commandId"], str)
        or not UUID_RE.fullmatch(claims["commandId"])
        or not isinstance(claims["attemptId"], str)
        or not UUID_RE.fullmatch(claims["attemptId"])
        or claims["commandId"] == claims["attemptId"]
        or not isinstance(claims["nonce"], str)
        or not NONCE_RE.fullmatch(claims["nonce"])
        or not isinstance(claims["issuedAt"], int)
        or isinstance(claims["issuedAt"], bool)
        or not isinstance(claims["expiresAt"], int)
        or isinstance(claims["expiresAt"], bool)
        or not isinstance(observed_at_ms, int)
        or isinstance(observed_at_ms, bool)
        or claims["issuedAt"] < 0
        or claims["issuedAt"] > observed_at_ms + 5_000
        or claims["expiresAt"] <= observed_at_ms
        or claims["expiresAt"] <= claims["issuedAt"]
        or claims["expiresAt"] - claims["issuedAt"] > 300_000
    ):
        _fail("GPT02_ISSUE159_APPROVAL_CLAIMS_INVALID")


def validate_aal2_super_admin_identity(identity: Any, super_admin_id: str) -> None:
    if not isinstance(identity, dict) or set(identity) != {
        "user_id", "role", "auth_method"
    }:
        _fail("GPT02_ISSUE159_AAL2_IDENTITY_REQUIRED")
    if (
        identity["auth_method"] != "supabase_aal2"
        or identity["role"] != "super_admin"
        or identity["user_id"] != super_admin_id
        or identity["user_id"] == "dev_approval_token"
        or not isinstance(identity["user_id"], str)
        or not SUBJECT_RE.fullmatch(identity["user_id"])
    ):
        _fail("GPT02_ISSUE159_AAL2_SUPER_ADMIN_REQUIRED")


def ensure_issue159_approval_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE} (
          id TEXT PRIMARY KEY,
          task_id INTEGER NOT NULL,
          command_id TEXT NOT NULL,
          attempt_id TEXT NOT NULL,
          operator_namespace TEXT NOT NULL,
          super_admin_id TEXT NOT NULL,
          company_id TEXT NOT NULL,
          claims_sha256 TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          auth_method TEXT NOT NULL CHECK(auth_method='supabase_aal2'),
          role_at_decision TEXT NOT NULL CHECK(role_at_decision='super_admin'),
          decision TEXT NOT NULL CHECK(decision='APPROVE'),
          created_at_ms INTEGER NOT NULL CHECK(created_at_ms > 0),
          UNIQUE(task_id, command_id, attempt_id, claims_sha256)
        )
        """
    )
    connection.execute(
        f"""
        CREATE TRIGGER IF NOT EXISTS {TABLE}_no_update
        BEFORE UPDATE ON {TABLE}
        BEGIN
          SELECT RAISE(ABORT, 'GPT02_ISSUE159_APPROVAL_IMMUTABLE');
        END
        """
    )
    connection.execute(
        f"""
        CREATE TRIGGER IF NOT EXISTS {TABLE}_no_delete
        BEFORE DELETE ON {TABLE}
        BEGIN
          SELECT RAISE(ABORT, 'GPT02_ISSUE159_APPROVAL_IMMUTABLE');
        END
        """
    )
    connection.commit()


def record_issue159_approval(
    connection: sqlite3.Connection,
    *,
    claims: Any,
    identity: Any,
    observed_at_ms: int,
) -> dict[str, Any]:
    validate_issue159_approval_claims(claims, observed_at_ms)
    validate_aal2_super_admin_identity(identity, claims["superAdminId"])
    ensure_issue159_approval_schema(connection)

    digest = approval_claims_sha256(claims)
    if not HEX_RE.fullmatch(digest):
        _fail("GPT02_ISSUE159_APPROVAL_DIGEST_INVALID")

    decision_id = str(uuid.uuid4())
    cursor = connection.execute(
        f"""
        INSERT OR IGNORE INTO {TABLE}
          (id, task_id, command_id, attempt_id, operator_namespace,
           super_admin_id, company_id, claims_sha256, actor_id,
           auth_method, role_at_decision, decision, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'supabase_aal2',
                'super_admin', 'APPROVE', ?)
        """,
        (
            decision_id,
            claims["taskId"],
            claims["commandId"],
            claims["attemptId"],
            claims["operatorNamespace"],
            claims["superAdminId"],
            claims["companyId"],
            digest,
            identity["user_id"],
            observed_at_ms,
        ),
    )
    inserted = cursor.rowcount == 1

    row = connection.execute(
        f"""
        SELECT id, task_id, command_id, attempt_id, operator_namespace,
               super_admin_id, company_id, claims_sha256, actor_id,
               auth_method, role_at_decision, decision, created_at_ms
        FROM {TABLE}
        WHERE task_id=? AND command_id=? AND attempt_id=? AND claims_sha256=?
        """,
        (
            claims["taskId"],
            claims["commandId"],
            claims["attemptId"],
            digest,
        ),
    ).fetchone()
    if row is None:
        _fail("GPT02_ISSUE159_APPROVAL_NOT_PERSISTED")
    connection.commit()

    return {
        "approval_id": row[0],
        "task_id": row[1],
        "command_id": row[2],
        "attempt_id": row[3],
        "claims_sha256": row[7],
        "actor_id": row[8],
        "auth_method": row[9],
        "role_at_decision": row[10],
        "decision": row[11],
        "created_at_ms": row[12],
        "inserted": inserted,
        "signingExecuted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }
