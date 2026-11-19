"""Offline, non-authorizing staged admission for GPT02 DEV.

Never connects to a database, signs, consumes a nonce or grants dispatch.
The caller must independently establish persisted Super Admin approval and
obtain receipt/fence lineage from the trusted writer, not request JSON.
"""
from __future__ import annotations

import hashlib
import re
from typing import Any

from gpt02_issue159_writer_broker_contract import (
    APPROVAL_FIELDS, LINK_FIELDS, BrokerAdmissionError, UUID, NONCE,
    WORKER, _canonical, _exact_object, _public_key, _verify,
    verify_lifecycle_evidence_packet,
)
from cryptography.hazmat.primitives import serialization

_ROLE_FIELDS = ("approval", "hub", "core", "issuer")


def verify_pre_consumption_packet(packet: Any, roots: Any, observed_at_ms: int) -> dict:
    """Verify three signatures before a receipt/fence can exist. NO AUTHORITY."""
    _exact_object(packet, ("approval", "hubLink", "coreLink"), "STAGE_ONE_PACKET_INVALID")
    _exact_object(roots, _ROLE_FIELDS, "PUBLIC_ROOT_SET_INVALID")
    if type(observed_at_ms) is not int or observed_at_ms <= 0:
        raise BrokerAdmissionError("OBSERVATION_TIME_INVALID")
    fingerprints = set()
    for role in _ROLE_FIELDS:
        key = _public_key(roots[role])
        der = key.public_bytes(serialization.Encoding.DER,
                               serialization.PublicFormat.SubjectPublicKeyInfo)
        fingerprints.add(hashlib.sha256(der).hexdigest())
    if len(fingerprints) != 4:
        raise BrokerAdmissionError("FOUR_INDEPENDENT_PUBLIC_ROOTS_REQUIRED")
    a = _exact_object(packet["approval"], ("claims", "signature"), "APPROVAL_ENVELOPE_INVALID")
    h = _exact_object(packet["hubLink"], ("claims", "signature"), "HUB_ENVELOPE_INVALID")
    c = _exact_object(packet["coreLink"], ("claims", "signature"), "CORE_ENVELOPE_INVALID")
    ac = _exact_object(a["claims"], APPROVAL_FIELDS, "APPROVAL_CLAIMS_INVALID")
    hc = _exact_object(h["claims"], LINK_FIELDS, "HUB_CLAIMS_INVALID")
    cc = _exact_object(c["claims"], LINK_FIELDS, "CORE_CLAIMS_INVALID")
    ad = _verify("approval", ac, a["signature"], roots["approval"], APPROVAL_FIELDS)
    hd = _verify("hub", hc, h["signature"], roots["hub"], LINK_FIELDS,
                 b"GPT02_OPERATOR_LINK_V1:hub\n")
    cd = _verify("core", cc, c["signature"], roots["core"], LINK_FIELDS,
                 b"GPT02_OPERATOR_LINK_V1:core\n")
    if (ac["v"] != 2 or ac["environment"] != "DEV"
            or ac["audience"] != "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL"
            or type(ac["taskId"]) is not int or ac["taskId"] <= 139
            or not isinstance(ac["commandId"], str) or not UUID.fullmatch(ac["commandId"])
            or not isinstance(ac["attemptId"], str) or not UUID.fullmatch(ac["attemptId"])
            or ac["commandId"] == ac["attemptId"]
            or not isinstance(ac["nonce"], str) or not NONCE.fullmatch(ac["nonce"])
            or ac["operatorNamespace"] != "ai-task-hub.public.users"
            or not isinstance(ac["superAdminId"], str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}", ac["superAdminId"])
            or ac["superAdminId"] == "dev_approval_token"
            or ac["companyId"] != "default"
            or type(ac["issuedAt"]) is not int or type(ac["expiresAt"]) is not int
            or not ac["issuedAt"] <= observed_at_ms < ac["expiresAt"]
            or not 0 < ac["expiresAt"] - ac["issuedAt"] <= 300000):
        raise BrokerAdmissionError("APPROVAL_SCOPE_OR_TIME_INVALID")
    if (hc != cc or hc["v"] != 1 or hc["environment"] != "DEV"
            or hc["audience"] != "GPT02_DUAL_ACCOUNT_COMMAND_LINK"
            or hc["companyId"] != ac["companyId"] or hc["hubTaskId"] != ac["taskId"]
            or hc["coreCommandId"] != ac["commandId"]
            or hc["attemptId"] != ac["attemptId"]
            or hc["approvalDigest"] != ad or hc["nonce"] != ac["nonce"]
            or hc["hubOperatorId"] != ac["superAdminId"]
            or hc["attemptNumber"] != 1 or hc["workerId"] != WORKER
            or hc["hubOperatorNamespace"] != "ai-task-hub.public.users"
            or hc["hubRole"] != "super_admin" or hc["hubActive"] is not True
            or hc["coreOperatorNamespace"] != "ai-core.ai_platform.internal_users"
            or hc["coreRole"] not in ("owner", "admin")
            or hc["coreActive"] is not True
            or hc["corePasswordChanged"] is not True
            or type(hc["coreOperatorUserId"]) is not int or hc["coreOperatorUserId"] <= 0
            or type(hc["assigneeId"]) is not int or hc["assigneeId"] <= 0
            or type(hc["issuedAt"]) is not int or type(hc["expiresAt"]) is not int
            or not ac["issuedAt"] <= hc["issuedAt"] <= observed_at_ms < hc["expiresAt"] <= ac["expiresAt"]
            or not 0 < hc["expiresAt"] - hc["issuedAt"] <= 120000
            or any(not isinstance(hc[k], str) or not UUID.fullmatch(hc[k])
                   for k in ("linkId", "hubExecutionId", "coreTaskId"))):
        raise BrokerAdmissionError("LINK_SCOPE_OR_TIME_INVALID")
    return {
        "stage": "PRE_CONSUMPTION_VERIFICATION_ONLY", "environment": "DEV",
        "approvalDigest": ad, "hubLinkDigest": hd, "coreLinkDigest": cd,
        "threeSignaturesVerified": True, "persistedAdminApprovalReadBack": False,
        "databaseWritePerformed": False, "nonceConsumed": False,
        "leaseConsumed": False, "signingPermitted": False,
        "authorizationGranted": False, "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }


def verify_post_fence_packet(packet: Any, roots: Any, observed_at_ms: int,
                             trusted_receipt_id: str, trusted_fence_id: str) -> dict:
    """Verify all four roles and match issued receipt/fence from a trusted readback.

    Those IDs must be supplied out-of-band by the trusted writer. This pure
    function alone cannot prove the source is trusted and authorizes nothing.
    """
    if any(not isinstance(v, str) or not UUID.fullmatch(v)
           for v in (trusted_receipt_id, trusted_fence_id)):
        raise BrokerAdmissionError("TRUSTED_LINEAGE_REQUIRED")
    result = verify_lifecycle_evidence_packet(packet, roots, observed_at_ms)
    claims = packet["issuerEvidence"]["claims"]
    if (claims["receiptId"] != trusted_receipt_id
            or claims["fenceId"] != trusted_fence_id):
        raise BrokerAdmissionError("ISSUER_TRUSTED_LINEAGE_MISMATCH")
    return {**result, "stage": "POST_FENCE_VERIFICATION_ONLY",
            "trustedLineageIdsMatched": True}
