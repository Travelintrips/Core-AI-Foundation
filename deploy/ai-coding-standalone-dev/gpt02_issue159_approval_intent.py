"""DEV-only GPT02 Issue #159 AAL2 approval-intent persistence helper.

Not imported by approval_api.py yet. No route is mounted by this change.
The helper verifies the Supabase AAL2 identity through admin_identity() itself,
then records one self-contained Issue159 approval intent. It never signs,
loads keys, creates commands, dispatches workers, or touches PROD.
"""
from __future__ import annotations
import hashlib
import json
import re
import sqlite3
import time
import uuid

from admin_identity import admin_identity

FIELDS = (
    "v","environment","audience","taskId","commandId","attemptId","nonce",
    "operatorNamespace","superAdminId","companyId","issuedAt","expiresAt",
)
UUID = re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")
SUBJECT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$")
NONCE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")

def _denied(reason):
    return {
        "ok": False,
        "reason": reason,
        "intentRecorded": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }

def canonical_issue159_approval_claims(claims):
    if not isinstance(claims, dict) or set(claims) != set(FIELDS):
        raise ValueError("GPT02_ISSUE159_APPROVAL_FIELDS_INVALID")
    return json.dumps(
        {name: claims[name] for name in FIELDS},
        ensure_ascii=False, separators=(",", ":"), allow_nan=False,
    )

def _claims_valid(c, now_ms):
    return (
        c.get("v") == 2 and
        c.get("environment") == "DEV" and
        c.get("audience") == "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL" and
        isinstance(c.get("taskId"), int) and c["taskId"] > 136 and
        isinstance(c.get("commandId"), str) and UUID.fullmatch(c["commandId"]) and
        isinstance(c.get("attemptId"), str) and UUID.fullmatch(c["attemptId"]) and
        c["commandId"] != c["attemptId"] and
        isinstance(c.get("nonce"), str) and NONCE.fullmatch(c["nonce"]) and
        c.get("operatorNamespace") == "ai-task-hub.public.users" and
        isinstance(c.get("superAdminId"), str) and SUBJECT.fullmatch(c["superAdminId"]) and
        c["superAdminId"] != "dev_approval_token" and
        c.get("companyId") == "default" and
        isinstance(c.get("issuedAt"), int) and isinstance(c.get("expiresAt"), int) and
        c["issuedAt"] >= 0 and c["issuedAt"] <= now_ms + 5000 and
        c["expiresAt"] > now_ms and c["expiresAt"] > c["issuedAt"] and
        c["expiresAt"] - c["issuedAt"] <= 300000
    )

def record_issue159_approval_intent(access_token, connection, claims, now_ms=None):
    if not isinstance(access_token, str) or not (40 <= len(access_token) <= 8192):
        return _denied("AAL2_SUPER_ADMIN_TOKEN_REQUIRED")
    if not isinstance(connection, sqlite3.Connection):
        return _denied("APPROVAL_DB_CONNECTION_REQUIRED")
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    if not isinstance(now_ms, int) or now_ms <= 0:
        return _denied("APPROVAL_TIME_INVALID")

    try:
        canonical = canonical_issue159_approval_claims(claims)
    except (ValueError, TypeError):
        return _denied("APPROVAL_CLAIMS_INVALID")
    if not _claims_valid(claims, now_ms):
        return _denied("APPROVAL_CLAIMS_INVALID")

    identity = admin_identity(access_token, connection)
    if (
        not isinstance(identity, dict) or
        identity.get("role") != "super_admin" or
        identity.get("user_id") != claims["superAdminId"] or
        identity.get("user_id") == "dev_approval_token"
    ):
        return _denied("AAL2_SUPER_ADMIN_IDENTITY_MISMATCH")

    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    intent_id = str(uuid.uuid4())
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            """INSERT INTO gpt02_issue159_approval_intents
            (id,task_id,command_id,attempt_id,company_id,claims_sha256,
             actor_id,auth_method,role_at_decision,decision,
             recorded_at_ms,expires_at_ms)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                intent_id, claims["taskId"], claims["commandId"],
                claims["attemptId"], claims["companyId"], digest,
                identity["user_id"], "supabase_aal2", "super_admin", "APPROVE",
                now_ms, claims["expiresAt"],
            ),
        )
        connection.commit()
    except sqlite3.IntegrityError:
        try:
            connection.rollback()
        except sqlite3.Error:
            pass
        return _denied("APPROVAL_INTENT_REPLAY_OR_CONFLICT")
    except sqlite3.Error:
        try:
            connection.rollback()
        except sqlite3.Error:
            pass
        return _denied("APPROVAL_INTENT_WRITE_FAILED")

    return {
        "ok": True,
        "reason": "AAL2_APPROVAL_INTENT_RECORDED_NO_SIGNING_AUTHORITY",
        "intentId": intent_id,
        "claimsSha256": digest,
        "actorId": identity["user_id"],
        "authMethod": "supabase_aal2",
        "roleAtDecision": "super_admin",
        "decision": "APPROVE",
        "recordedAt": now_ms,
        "expiresAt": claims["expiresAt"],
        "intentRecorded": True,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }
