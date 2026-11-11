"""HTTP adapter contract for DEV GPT02 Issue #159 approval intent.

This module is route-ready but not a signer. The caller must provide the
existing SQLite connection and authenticated admin identity verifier. Feature is disabled
unless explicitly enabled by the host approval API.
"""
from __future__ import annotations
import json

from gpt02_issue159_approval_intent import record_issue159_approval_intent


def _response(status, body):
    return status, body


def handle_issue159_approval_intent(
    authorization_header,
    raw_body,
    connection,
    identity_verifier,
    *,
    enabled=False,
    now_ms=None,
):
    if enabled is not True:
        return _response(404, {"error": "not_found"})
    if not isinstance(authorization_header, str) or not authorization_header.startswith("Bearer "):
        return _response(401, {"error": "unauthorized"})
    token = authorization_header[7:]
    if not token:
        return _response(401, {"error": "unauthorized"})
    if not isinstance(raw_body, (bytes, bytearray)) or not (2 <= len(raw_body) <= 8192):
        return _response(400, {"error": "invalid_size"})
    try:
        data = json.loads(bytes(raw_body).decode("utf-8"))
    except (UnicodeError, ValueError, TypeError):
        return _response(400, {"error": "invalid_json"})
    if not isinstance(data, dict) or set(data) != {"claims"}:
        return _response(400, {"error": "invalid_request"})

    result = record_issue159_approval_intent(
        token,
        connection,
        data["claims"],
        identity_verifier=identity_verifier,
        now_ms=now_ms,
    )
    if result.get("ok") is True:
        return _response(201, {
            "intentId": result["intentId"],
            "claimsSha256": result["claimsSha256"],
            "actorId": result["actorId"],
            "authMethod": result["authMethod"],
            "roleAtDecision": result["roleAtDecision"],
            "decision": result["decision"],
            "recordedAt": result["recordedAt"],
            "expiresAt": result["expiresAt"],
            "signingPermitted": False,
            "authorizationGranted": False,
            "dispatchPermitted": False,
            "releaseDecision": "NO_GO",
        })

    reason = result.get("reason")
    if reason in {
        "ADMIN_SESSION_TOKEN_REQUIRED",
        "ADMIN_IDENTITY_MISMATCH",
        "ADMIN_IDENTITY_VERIFICATION_FAILED",
    }:
        return _response(403, {"error": "active_super_admin_required"})
    if reason == "APPROVAL_INTENT_REPLAY_OR_CONFLICT":
        return _response(409, {"error": "approval_intent_conflict"})
    if reason in {"APPROVAL_CLAIMS_INVALID", "APPROVAL_TIME_INVALID"}:
        return _response(400, {"error": "invalid_claims"})
    return _response(503, {"error": "approval_intent_unavailable"})
