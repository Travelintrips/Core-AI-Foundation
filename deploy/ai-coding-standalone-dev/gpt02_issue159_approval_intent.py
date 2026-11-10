"""DEV-only GPT02 Issue #159 approval-intent persistence helper.

Not imported by approval_api.py yet. No route is mounted by this change.
The caller must inject a reviewed AAL2 identity verifier. Without one, this
helper fails closed. It never signs, loads keys, creates commands, dispatches
workers, or touches PROD.
"""
from __future__ import annotations
import sqlite3
import time
import uuid

from gpt02_issue159_approval_intent_contract import (
    ApprovalIntentContractError,
    build_approval_intent_record,
)


def _denied(reason):
    return {
        "ok": False,
        "reason": reason,
        "intentRecorded": False,
        "trustedIdentityReadProven": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }


def record_issue159_approval_intent(
    access_token,
    connection,
    claims,
    identity_verifier=None,
    now_ms=None,
):
    if not isinstance(access_token, str) or not (40 <= len(access_token) <= 8192):
        return _denied("AAL2_SUPER_ADMIN_TOKEN_REQUIRED")
    if not isinstance(connection, sqlite3.Connection):
        return _denied("APPROVAL_DB_CONNECTION_REQUIRED")
    if not callable(identity_verifier):
        return _denied("AAL2_IDENTITY_VERIFIER_REQUIRED")
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    if not isinstance(now_ms, int) or now_ms <= 0:
        return _denied("APPROVAL_TIME_INVALID")

    try:
        identity = identity_verifier(access_token, connection)
    except Exception:
        return _denied("AAL2_IDENTITY_VERIFICATION_FAILED")
    if not isinstance(identity, dict):
        return _denied("AAL2_SUPER_ADMIN_IDENTITY_MISMATCH")

    intent_id = str(uuid.uuid4())
    try:
        built = build_approval_intent_record(
            claims, identity, intent_id, now_ms
        )
    except ApprovalIntentContractError as exc:
        code = str(exc)
        if code == "GPT02_ISSUE159_AAL2_SUPER_ADMIN_REQUIRED":
            return _denied("AAL2_SUPER_ADMIN_IDENTITY_MISMATCH")
        return _denied("APPROVAL_CLAIMS_INVALID")

    record = built["record"]
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            """INSERT INTO gpt02_issue159_approval_intents
            (id,task_id,command_id,attempt_id,company_id,claims_sha256,
             actor_id,auth_method,role_at_decision,decision,
             recorded_at_ms,expires_at_ms)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                record["id"], record["task_id"], record["command_id"],
                record["attempt_id"], record["company_id"],
                record["claims_sha256"], record["actor_id"],
                record["auth_method"], record["role_at_decision"],
                record["decision"], record["recorded_at_ms"],
                record["expires_at_ms"],
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
        "intentId": record["id"],
        "claimsSha256": record["claims_sha256"],
        "actorId": record["actor_id"],
        "authMethod": record["auth_method"],
        "roleAtDecision": record["role_at_decision"],
        "decision": record["decision"],
        "recordedAt": record["recorded_at_ms"],
        "expiresAt": record["expires_at_ms"],
        "intentRecorded": True,
        "trustedIdentityReadProven": True,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }
