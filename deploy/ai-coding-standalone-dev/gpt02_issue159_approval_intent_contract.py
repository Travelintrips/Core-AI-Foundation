#!/usr/bin/env python3
"""Pure GPT02 Issue #159 approval-intent producer contract.

Builds one exact self-contained intent row from canonical approval claims and a
one authenticated, enabled Super Admin session. It never writes SQLite, loads keys, signs,
creates tasks, consumes nonces, or dispatches anything.
"""
from __future__ import annotations

import hashlib
import json
import re

FIELDS = (
    "v", "environment", "audience", "taskId", "commandId", "attemptId",
    "nonce", "operatorNamespace", "superAdminId", "companyId",
    "issuedAt", "expiresAt",
)
UUID = re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")
SUBJECT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$")
NONCE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")


class ApprovalIntentContractError(RuntimeError):
    pass


def _fail(code: str):
    raise ApprovalIntentContractError(code)


def canonical_approval(claims: object) -> str:
    if not isinstance(claims, dict) or set(claims) != set(FIELDS):
        _fail("GPT02_ISSUE159_APPROVAL_FIELDS_INVALID")
    return json.dumps(
        {field: claims[field] for field in FIELDS},
        ensure_ascii=False,
        separators=(",", ":"),
    )


def validate_approval_claims(claims: object):
    canonical = canonical_approval(claims)
    c = claims
    if (
        c["v"] != 2
        or c["environment"] != "DEV"
        or c["audience"] != "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL"
        or not isinstance(c["taskId"], int)
        or c["taskId"] <= 136
        or not isinstance(c["commandId"], str)
        or not UUID.fullmatch(c["commandId"])
        or not isinstance(c["attemptId"], str)
        or not UUID.fullmatch(c["attemptId"])
        or c["commandId"] == c["attemptId"]
        or not isinstance(c["nonce"], str)
        or not NONCE.fullmatch(c["nonce"])
        or c["operatorNamespace"] != "ai-task-hub.public.users"
        or not isinstance(c["superAdminId"], str)
        or not SUBJECT.fullmatch(c["superAdminId"])
        or c["superAdminId"] == "dev_approval_token"
        or c["companyId"] != "default"
        or not isinstance(c["issuedAt"], int)
        or not isinstance(c["expiresAt"], int)
        or c["issuedAt"] < 0
        or c["expiresAt"] <= c["issuedAt"]
        or c["expiresAt"] - c["issuedAt"] > 300000
    ):
        _fail("GPT02_ISSUE159_APPROVAL_CLAIMS_INVALID")
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return {"canonicalClaims": canonical, "claimsSha256": digest}


def build_approval_intent_record(
    claims: object,
    identity: object,
    intent_id: str,
    recorded_at_ms: int,
):
    validated = validate_approval_claims(claims)
    c = claims

    if (
        not isinstance(identity, dict)
        or set(identity) != {"userId", "role", "enabled", "authMethod"}
        or identity["userId"] != c["superAdminId"]
        or identity["userId"] == "dev_approval_token"
        or identity["role"] != "super_admin"
        or identity["enabled"] is not True
        or identity["authMethod"] not in ("supabase_admin_session", "supabase_aal2")
    ):
        _fail("GPT02_ISSUE159_ADMIN_APPROVAL_REQUIRED")

    if (
        not isinstance(intent_id, str)
        or not UUID.fullmatch(intent_id)
        or not isinstance(recorded_at_ms, int)
        or recorded_at_ms < c["issuedAt"]
        or recorded_at_ms >= c["expiresAt"]
    ):
        _fail("GPT02_ISSUE159_APPROVAL_INTENT_TIME_OR_ID_INVALID")

    digest = validated["claimsSha256"]
    canonical = validated["canonicalClaims"]

    return {
        "record": {
            "id": intent_id,
            "task_id": c["taskId"],
            "command_id": c["commandId"],
            "attempt_id": c["attemptId"],
            "company_id": c["companyId"],
            "claims_sha256": digest,
            "actor_id": identity["userId"],
            "auth_method": identity["authMethod"],
            "role_at_decision": identity["role"],
            "decision": "APPROVE",
            "recorded_at_ms": recorded_at_ms,
            "expires_at_ms": c["expiresAt"],
        },
        "canonicalClaims": canonical,
        "claimsSha256": digest,
        "trustedIdentityReadProven": False,
        "writePerformed": False,
        "writePermitted": False,
        "privateKeyLoaded": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }
