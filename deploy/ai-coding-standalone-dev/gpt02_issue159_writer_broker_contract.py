"""Pure admission contract for a future GPT02 Issue #159 lifecycle writer broker.

This module verifies already-signed evidence only. It has no socket, database,
filesystem, key-loading, signing, task-creation, nonce-consumption or dispatch
surface. Production broker integration remains a separate reviewed change.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
from typing import Any, Mapping

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

UUID = re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")
HEX = re.compile(r"^[0-9a-f]{64}$")
B64URL = re.compile(r"^[A-Za-z0-9_-]{86}$")
NONCE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
WORKER = "openclaw-dell-chatgpt-wake-dev"
APPROVAL_FIELDS = (
    "v", "environment", "audience", "taskId", "commandId", "attemptId",
    "nonce", "operatorNamespace", "superAdminId", "companyId", "issuedAt",
    "expiresAt",
)
LINK_FIELDS = (
    "v", "environment", "audience", "linkId", "companyId", "hubTaskId",
    "hubExecutionId", "coreTaskId", "coreCommandId", "attemptId",
    "attemptNumber", "assigneeId", "accountableOwnerId",
    "hubOperatorNamespace", "hubOperatorId", "hubRole", "hubActive",
    "coreOperatorNamespace", "coreOperatorUserId", "coreRole", "coreActive",
    "corePasswordChanged", "workerId", "approvalDigest", "nonce",
    "issuedAt", "expiresAt",
)
ISSUER_FIELDS = (
    "v", "environment", "audience", "companyId", "hubTaskId",
    "hubExecutionId", "coreTaskId", "commandId", "attemptId", "workerId",
    "receiptId", "linkId", "fenceId", "approvalDigest", "nonceDigest",
    "issuerRole", "leaseEpoch", "issuedAt", "expiresAt",
)
PACKET_FIELDS = ("approval", "hubLink", "coreLink", "issuerEvidence")
ROLE_KEYS = ("approval", "hub", "core", "issuer")


class BrokerAdmissionError(ValueError):
    """Stable fail-closed admission error; never contains secret material."""


def _exact_object(value: Any, fields: tuple[str, ...], code: str) -> dict:
    if not isinstance(value, dict) or set(value) != set(fields):
        raise BrokerAdmissionError(code)
    return value


def _canonical(value: Mapping[str, Any], fields: tuple[str, ...]) -> bytes:
    # Contract fields are restricted to ASCII identifiers, UUIDs, hashes,
    # booleans, integers and bounded text. ensure_ascii=False matches TS JSON.
    return json.dumps(
        {field: value[field] for field in fields},
        ensure_ascii=False, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")


def _public_key(pem: str) -> Ed25519PublicKey:
    if not isinstance(pem, str) or len(pem) < 100 or len(pem) > 2048:
        raise BrokerAdmissionError("PUBLIC_ROOT_INVALID")
    try:
        key = serialization.load_pem_public_key(pem.encode("ascii"))
    except Exception as exc:
        raise BrokerAdmissionError("PUBLIC_ROOT_INVALID") from exc
    if not isinstance(key, Ed25519PublicKey):
        raise BrokerAdmissionError("ED25519_PUBLIC_ROOT_REQUIRED")
    return key


def _verify(role: str, claims: dict, signature: str, pem: str,
            fields: tuple[str, ...], domain: bytes = b"") -> str:
    if not isinstance(signature, str) or not B64URL.fullmatch(signature):
        raise BrokerAdmissionError("SIGNATURE_FORMAT_INVALID")
    try:
        raw = base64.urlsafe_b64decode(signature + "==")
        if len(raw) != 64:
            raise ValueError("signature length")
        _public_key(pem).verify(raw, domain + _canonical(claims, fields))
    except BrokerAdmissionError:
        raise
    except Exception as exc:
        raise BrokerAdmissionError("SIGNATURE_VERIFICATION_FAILED") from exc
    return hashlib.sha256(_canonical(claims, fields)).hexdigest()


def verify_lifecycle_evidence_packet(packet: Any, public_roots: Any,
                                     observed_at_ms: int) -> dict:
    """Verify exact four-role signatures and cross-bind claims; return no authority."""
    _exact_object(packet, PACKET_FIELDS, "PACKET_SHAPE_INVALID")
    _exact_object(public_roots, ROLE_KEYS, "PUBLIC_ROOT_SET_INVALID")
    if not isinstance(observed_at_ms, int) or observed_at_ms <= 0:
        raise BrokerAdmissionError("OBSERVATION_TIME_INVALID")

    a = _exact_object(packet["approval"], ("claims", "signature"),
                      "APPROVAL_ENVELOPE_INVALID")
    h = _exact_object(packet["hubLink"], ("claims", "signature"),
                      "HUB_LINK_ENVELOPE_INVALID")
    c = _exact_object(packet["coreLink"], ("claims", "signature"),
                      "CORE_LINK_ENVELOPE_INVALID")
    i = _exact_object(packet["issuerEvidence"], ("claims", "signature"),
                      "ISSUER_ENVELOPE_INVALID")
    ac = _exact_object(a["claims"], APPROVAL_FIELDS, "APPROVAL_CLAIMS_INVALID")
    hc = _exact_object(h["claims"], LINK_FIELDS, "HUB_LINK_CLAIMS_INVALID")
    cc = _exact_object(c["claims"], LINK_FIELDS, "CORE_LINK_CLAIMS_INVALID")
    ic = _exact_object(i["claims"], ISSUER_FIELDS, "ISSUER_CLAIMS_INVALID")

    # A four-role packet must be rooted in four distinct Ed25519 public keys;
    # domain separation alone is not a substitute for independent custody.
    fingerprints = set()
    for role in ROLE_KEYS:
        root = _public_key(public_roots[role])
        der = root.public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        fingerprints.add(hashlib.sha256(der).hexdigest())
    if len(fingerprints) != 4:
        raise BrokerAdmissionError("FOUR_INDEPENDENT_PUBLIC_ROOTS_REQUIRED")

    ad = _verify("approval", ac, a["signature"], public_roots["approval"],
                 APPROVAL_FIELDS)
    hd = _verify("hub", hc, h["signature"], public_roots["hub"], LINK_FIELDS,
                 b"GPT02_OPERATOR_LINK_V1:hub\n")
    cd = _verify("core", cc, c["signature"], public_roots["core"], LINK_FIELDS,
                 b"GPT02_OPERATOR_LINK_V1:core\n")
    _verify("issuer", ic, i["signature"], public_roots["issuer"], ISSUER_FIELDS,
            b"GPT02_ISSUER_LEASE_EVIDENCE_V1\n")

    if (ac["v"] != 2 or ac["environment"] != "DEV"
        or ac["audience"] != "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL"
        or not isinstance(ac["taskId"], int) or ac["taskId"] <= 136
        or not isinstance(ac["commandId"], str) or not UUID.fullmatch(ac["commandId"])
        or not isinstance(ac["attemptId"], str) or not UUID.fullmatch(ac["attemptId"])
        or ac["commandId"] == ac["attemptId"]
        or not isinstance(ac["nonce"], str) or not NONCE.fullmatch(ac["nonce"])
        or ac["operatorNamespace"] != "ai-task-hub.public.users"
        or not isinstance(ac["superAdminId"], str) or not ac["superAdminId"]
        or ac["superAdminId"] == "dev_approval_token"
        or ac["companyId"] != "default"
        or not isinstance(ac["issuedAt"], int) or not isinstance(ac["expiresAt"], int)
        or ac["issuedAt"] > observed_at_ms or ac["expiresAt"] <= observed_at_ms
        or ac["expiresAt"] <= ac["issuedAt"]
        or ac["expiresAt"] - ac["issuedAt"] > 300000):
        raise BrokerAdmissionError("APPROVAL_SCOPE_OR_TIME_INVALID")

    if (hc != cc or hc["v"] != 1 or hc["environment"] != "DEV"
        or hc["audience"] != "GPT02_DUAL_ACCOUNT_COMMAND_LINK"
        or hc["companyId"] != ac["companyId"] or hc["hubTaskId"] != ac["taskId"]
        or hc["coreCommandId"] != ac["commandId"] or hc["attemptId"] != ac["attemptId"]
        or hc["approvalDigest"] != ad or hc["nonce"] != ac["nonce"]
        or hc["attemptNumber"] != 1 or hc["workerId"] != WORKER
        or hc["hubRole"] != "super_admin" or hc["hubActive"] is not True
        or hc["coreRole"] not in ("owner", "admin") or hc["coreActive"] is not True
        or hc["corePasswordChanged"] is not True
        or hc["hubOperatorNamespace"] != "ai-task-hub.public.users"
        or hc["coreOperatorNamespace"] != "ai-core.ai_platform.internal_users"
        or not isinstance(hc["coreOperatorUserId"], int) or hc["coreOperatorUserId"] <= 0
        or not isinstance(hc["issuedAt"], int) or not isinstance(hc["expiresAt"], int)
        or hc["issuedAt"] < ac["issuedAt"] or hc["expiresAt"] > ac["expiresAt"]
        or hc["issuedAt"] > observed_at_ms or hc["expiresAt"] <= observed_at_ms
        or hc["expiresAt"] <= hc["issuedAt"]
        or hc["expiresAt"] - hc["issuedAt"] > 300000
        or not UUID.fullmatch(str(hc["linkId"]))
        or not UUID.fullmatch(str(hc["hubExecutionId"]))
        or not UUID.fullmatch(str(hc["coreTaskId"]))):
        raise BrokerAdmissionError("OPERATOR_LINK_BINDING_INVALID")

    if (ic["v"] != 1 or ic["environment"] != "DEV"
        or ic["audience"] != "GPT02_ISSUER_LEASE_EVIDENCE_V1"
        or ic["companyId"] != ac["companyId"] or ic["hubTaskId"] != ac["taskId"]
        or ic["hubExecutionId"] != hc["hubExecutionId"]
        or ic["coreTaskId"] != hc["coreTaskId"]
        or ic["commandId"] != ac["commandId"] or ic["attemptId"] != ac["attemptId"]
        or ic["workerId"] != WORKER or ic["linkId"] != hc["linkId"]
        or ic["approvalDigest"] != ad
        or ic["nonceDigest"] != hashlib.sha256(ac["nonce"].encode()).hexdigest()
        or ic["issuerRole"] != "dev_gpt02_issuer_evidence"
        or ic["leaseEpoch"] != 1
        or not all(UUID.fullmatch(str(ic[k])) for k in ("receiptId", "fenceId"))
        or not isinstance(ic["issuedAt"], int) or not isinstance(ic["expiresAt"], int)
        or ic["issuedAt"] > observed_at_ms or ic["expiresAt"] <= observed_at_ms
        or ic["expiresAt"] <= ic["issuedAt"]
        or ic["expiresAt"] - ic["issuedAt"] > 15000
        or ic["expiresAt"] > min(ac["expiresAt"], hc["expiresAt"])):
        raise BrokerAdmissionError("ISSUER_EVIDENCE_BINDING_INVALID")

    return {
        "environment": "DEV",
        "packetVerified": True,
        "approvalDigest": ad,
        "hubLinkDigest": hd,
        "coreLinkDigest": cd,
        "issuerEvidenceVerified": True,
        "fourDistinctRoleRootsUsed": True,
        "databaseWritePerformed": False,
        "nonceConsumed": False,
        "leaseConsumed": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }
