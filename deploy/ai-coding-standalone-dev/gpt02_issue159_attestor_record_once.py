#!/usr/bin/env python3
"""GPT02 DEV Issue159: single authorized attestor RPC adapter.

Existing evidence sources: approved Super Admin claims, independently proven
Hub/Core link, existing one-shot Ed25519 signer outputs, and the existing
peer-authenticated verifier. Calls only EXISTING record_linked_approval RPC.
No issuer, nonce consume, fence creation, lease, worker wake or dispatch.

Operational execution stays disabled unless a separately provisioned
dedicated attestor database login and explicit one-shot service authorization
are present. No fake signature or caller-supplied 'approved' flags.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
from typing import Any

from gpt02_issue159_writer_broker_contract import (
    APPROVAL_FIELDS, LINK_FIELDS, _canonical,
)
from gpt02_issue159_attestor_preflight import verify_stage_before_attestor

ROLE = "dev_gpt02_attestor_evidence"
PROJECT = "xssrfshdrtdfupgqwfdw"
POOLER = "aws-1-ap-southeast-2.pooler.supabase.com"
APP_ROOT = Path("/opt/ai-coding-standalone-dev")
APPROVED = APP_ROOT / "gpt02_issue159_approved_claims.json"
LINK = APP_ROOT / "gpt02_issue159_hub_core_link_claims.json"
SIGNATURES = {
    "approval": Path("/run/gpt02-issue159-sign-once-approval/approval-signature.json"),
    "hub": Path("/run/gpt02-issue159-sign-once-hub/hub-signature.json"),
    "core": Path("/run/gpt02-issue159-sign-once-core/core-signature.json"),
}
DSN_FILE = Path("/run/credentials/gpt02-issue159-attestor-record-once.service/attestor-dsn")


def pinned_dev_writer_endpoint(values: dict) -> bool:
    """Two exact CST-DEV endpoints, paired with their respective login format."""
    return (
        (values.get("user"), values.get("host")) in {
            (f"{ROLE}.{PROJECT}", POOLER),
            (ROLE, f"db.{PROJECT}.supabase.co"),
        }
        and not values.get("hostaddr") and not values.get("service")
    )
MAX_DATA = 16_384
B64URL = re.compile(r"^[A-Za-z0-9_-]{86}$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")


class AttestorDenied(RuntimeError):
    pass


def deny(code: str):
    raise AttestorDenied(code)


def require_private(path: Path, *, root_only: bool, size_limit=MAX_DATA) -> bytes:
    st = path.lstat()
    if (not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode)
            or st.st_size < 4 or st.st_size > size_limit
            or stat.S_IMODE(st.st_mode) & 0o077
            or (root_only and (st.st_uid != 0 or st.st_gid != 0))):
        deny("ATTESTOR_EVIDENCE_CUSTODY_INVALID")
    # Output signatures are written by separately isolated systemd DynamicUser
    # signer instances: require actual output UID match private runtime owner.
    if not root_only:
        parent = path.parent
        parent_lstat = parent.lstat()
        if stat.S_ISLNK(parent_lstat.st_mode):
            expected = f"/run/private/{parent.name}"
            if os.path.realpath(parent) != expected:
                deny("ATTESTOR_SIGNER_DIRECTORY_INVALID")
        dir_stat = parent.stat()
        if (not stat.S_ISDIR(dir_stat.st_mode)
                or stat.S_IMODE(dir_stat.st_mode) != 0o700
                or st.st_uid != dir_stat.st_uid or st.st_uid == 0):
            deny("ATTESTOR_SIGNER_OWNER_INVALID")
    return path.read_bytes()


def record_signature(value: Any, role: str, canonical_digest: str) -> str:
    if (not isinstance(value, dict)
            or set(value) != {
                "environment", "role", "algorithm", "claimsSha256",
                "signatureBase64url", "fingerprintMatched",
                "authorizationGranted", "dispatchPermitted",
                "releaseDecision",
            } or value["environment"] != "DEV" or value["role"] != role
            or value["algorithm"] != "Ed25519"
            or value["claimsSha256"] != canonical_digest
            or not isinstance(value["signatureBase64url"], str)
            or not B64URL.fullmatch(value["signatureBase64url"])
            or value["fingerprintMatched"] is not True
            or value["authorizationGranted"] is not False
            or value["dispatchPermitted"] is not False
            or value["releaseDecision"] != "NO_GO"):
        deny("ATTESTOR_SIGNER_RESULT_INVALID")
    return value["signatureBase64url"]


def validate_and_verify(
    approved_payload: dict, link: dict, sigs: dict[str, dict],
    *, now_ms: int | None = None,
    verify_fn=verify_stage_before_attestor,
) -> tuple[dict, dict]:
    """Pure binder with mandatory trusted existing verifier readback."""
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    if (type(approved_payload) is not dict
            or set(approved_payload) != {"claims", "claimsSha256"}
            or type(approved_payload["claims"]) is not dict
            or type(link) is not dict or type(sigs) is not dict
            or set(sigs) != {"approval", "hub", "core"}):
        deny("ATTESTOR_PACKET_INPUT_SHAPE_INVALID")
    approval = approved_payload["claims"]
    if (set(approval) != set(APPROVAL_FIELDS) or set(link) != set(LINK_FIELDS)
            or type(now_ms) is not int or now_ms <= 0
            or type(approval.get("expiresAt")) is not int
            or type(link.get("expiresAt")) is not int
            or min(approval["expiresAt"], link["expiresAt"]) - now_ms < 30_000):
        deny("ATTESTOR_PACKET_EXPIRED_OR_MALFORMED")
    approval_digest = hashlib.sha256(_canonical(approval, APPROVAL_FIELDS)).hexdigest()
    link_digest = hashlib.sha256(_canonical(link, LINK_FIELDS)).hexdigest()
    if approved_payload["claimsSha256"] != approval_digest:
        deny("ATTESTOR_APPROVAL_DIGEST_MISMATCH")
    if (approval.get("commandId") != link.get("coreCommandId")
            or approval.get("attemptId") != link.get("attemptId")
            or approval.get("taskId") != link.get("hubTaskId")
            or approval.get("companyId") != link.get("companyId")
            or approval.get("superAdminId") != link.get("hubOperatorId")
            or approval.get("nonce") != link.get("nonce")
            or link.get("approvalDigest") != approval_digest):
        deny("ATTESTOR_HUB_CORE_BINDING_INVALID")
    packet = {
        "approval": {"claims": approval,
                     "signature": record_signature(sigs["approval"], "approval", approval_digest)},
        "hubLink": {"claims": link,
                    "signature": record_signature(sigs["hub"], "hub", link_digest)},
        "coreLink": {"claims": link,
                     "signature": record_signature(sigs["core"], "core", link_digest)},
    }
    # A signature string matching a digest is NOT proof. Only the existing,
    # peer-authenticated Ed25519 verifier plus persisted admin reader proves it.
    trusted = verify_fn(packet, now_ms=now_ms)
    if (not isinstance(trusted, dict)
            or trusted.get("threeSignaturesVerified") is not True
            or trusted.get("persistedAdminApprovalReadBack") is not True
            or trusted.get("verifierPeerAuthenticated") is not True
            or trusted.get("approvalDigest") != approval_digest
            or trusted.get("hubLinkDigest") != link_digest
            or trusted.get("databaseWritePerformed") is not False
            or trusted.get("recordLinkedApprovalExecuted") is not False
            or trusted.get("signingPermitted") is not False
            or trusted.get("authorizationGranted") is not False
            or trusted.get("dispatchPermitted") is not False
            or trusted.get("releaseDecision") != "NO_GO"):
        deny("ATTESTOR_TRUSTED_VERIFIER_NOT_PROVEN")
    if min(approval["expiresAt"], link["expiresAt"]) - int(time.time() * 1000) < 30_000:
        deny("ATTESTOR_PACKET_EXPIRED_AFTER_VERIFICATION")
    return packet, trusted


def record_existing_rpc_once(connection, packet: dict, trusted: dict) -> bool:
    """One RPC call only, within dedicated attestor DB transaction.

    No caller data is allowed to select a different table/function or change
    the session identity; no direct writes or worker operations.
    """
    if trusted.get("threeSignaturesVerified") is not True or (
            trusted.get("persistedAdminApprovalReadBack") is not True
            or trusted.get("verifierPeerAuthenticated") is not True
            or trusted.get("releaseDecision") != "NO_GO"):
        deny("ATTESTOR_WRITE_BEFORE_VERIFICATION_DENIED")
    approval = packet["approval"]
    hub = packet["hubLink"]
    core = packet["coreLink"]
    if hub["claims"] != core["claims"]:
        deny("ATTESTOR_LINK_SIGNATURE_BINDING_DENIED")
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout='8000ms'")
            cursor.execute("SELECT session_user,current_user,current_database(),"
                           "current_setting('transaction_read_only')")
            identity = cursor.fetchone()
            if identity != (ROLE, ROLE, "postgres", "off"):
                deny("ATTESTOR_DATABASE_SESSION_IDENTITY_DENIED")
            cursor.execute(
                "SELECT gpt02_private.record_linked_approval("
                "%s::jsonb,%s,%s,%s::jsonb,%s,%s,%s)",
                (
                    json.dumps(approval["claims"], separators=(",", ":"), allow_nan=False),
                    approval["signature"], trusted["approvalDigest"],
                    json.dumps(hub["claims"], separators=(",", ":"), allow_nan=False),
                    hub["signature"], core["signature"], trusted["hubLinkDigest"],
                ),
            )
            if cursor.fetchone() != (True,):
                deny("ATTESTOR_RECORD_RPC_NO_ACK")
        connection.commit()
        return True
    except Exception:
        connection.rollback()
        raise


def main() -> int:
    if (os.geteuid() != 0 or os.environ.get("APP_ENV") != "development"
            or os.environ.get("GPT02_ATTESTOR_RECORD_ONCE") != "explicit-approved"):
        deny("ATTESTOR_ONE_SHOT_RUNTIME_NOT_AUTHORIZED")
    if any(not SIGNATURES[x].is_file() for x in ("approval","hub","core")):
        deny("ATTESTOR_THREE_SIGNER_EVIDENCE_REQUIRED")
    approved = json.loads(require_private(APPROVED, root_only=True))
    link = json.loads(require_private(LINK, root_only=True))
    sigs = {
        role: json.loads(require_private(path, root_only=False))
        for role, path in SIGNATURES.items()
    }
    packet, proof = validate_and_verify(approved, link, sigs)
    # The dedicated credential is intentionally absent until authorized DEV
    # deployment. Never fall back to postgres/service_role.
    dsn_raw = require_private(DSN_FILE, root_only=True, size_limit=4096)
    from psycopg.conninfo import conninfo_to_dict
    import psycopg
    dsn = dsn_raw.decode("utf-8").strip()
    props = conninfo_to_dict(dsn)
    if (not pinned_dev_writer_endpoint(props)
            or props.get("dbname") != "postgres"
            or str(props.get("port")) != "5432"
            or props.get("sslmode") != "verify-full"
            or props.get("sslrootcert") != "/etc/gpt02-dev/supabase-root-ca-2021.crt"
            or not props.get("password")):
        deny("ATTESTOR_DEV_DATABASE_CREDENTIAL_SCOPE_INVALID")
    with psycopg.connect(dsn,connect_timeout=5,autocommit=False) as connection:
        record_existing_rpc_once(connection, packet, proof)
    print("GPT02_DEV_ATTESTOR_RECORD_EXISTING_RPC_SUCCESS")
    print("task_id", packet["approval"]["claims"]["taskId"])
    print("signing_permitted", False)
    print("dispatch_permitted", False)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print("GPT02_DEV_ATTESTOR_DENIED:", type(exc).__name__, file=sys.stderr)
        sys.exit(2)
