#!/usr/bin/env python3
"""Read-only public-key audit of GPT02 DEV historical signed evidence.

Verifies a *self-contained*, root-private archive: four role-specific Ed25519
signatures, exact task-bound claims, SHA256 file digests, and distinct pinned
public keys. This NEVER reads private keys, creates roles, rotates signatures,
consumes approval, or authorizes signing/dispatch.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from gpt02_issue159_sign_once import (
    APPROVAL_FIELDS, LINK_FIELDS, ISSUER_FIELDS, canonical,
)

SCHEMA = "GPT02_ISSUE159_SELF_CONTAINED_VERIFIED_ARCHIVE_V2"
ROLE_DATA = {
    "approval": ("approval-public.pem", APPROVAL_FIELDS, b""),
    "hub": ("hub-identity-public.pem", LINK_FIELDS, b"GPT02_OPERATOR_LINK_V1:hub\n"),
    "core": ("core-identity-public.pem", LINK_FIELDS, b"GPT02_OPERATOR_LINK_V1:core\n"),
    "issuer": ("issuer-public.pem", ISSUER_FIELDS, b"GPT02_ISSUER_LEASE_EVIDENCE_V1\n"),
}
HASH64 = re.compile(r"[a-f0-9]{64}\Z")


class ArchiveAuditDenied(ValueError):
    pass


def deny(code: str):
    raise ArchiveAuditDenied(code)


def _safe_file(path: Path, expected_uid: int, *, max_size: int = 20000) -> bytes:
    try:
        st = path.lstat()
    except OSError as exc:
        raise ArchiveAuditDenied("EVIDENCE_MISSING") from exc
    if (
        not stat.S_ISREG(st.st_mode)
        or st.st_uid != expected_uid
        or stat.S_IMODE(st.st_mode) != 0o600
        or not 0 < st.st_size <= max_size
    ):
        deny("EVIDENCE_OWNER_MODE_OR_TYPE_DENIED")
    return path.read_bytes()


def _archived_file(root: Path, name: str, uid: int) -> bytes:
    if (
        not isinstance(name, str)
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{2,127}", name)
        or name in {".", ".."}
        or Path(name).name != name
    ):
        deny("ARCHIVE_BASENAME_NOT_PINNED")
    return _safe_file(root / name, uid)


def _hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def audit(archive: Path, public_dir: Path, manifest_name: str,
          expected_task_id: int, *, expected_uid: int = 0) -> dict:
    if type(expected_task_id) is not int or expected_task_id <= 0:
        deny("TASK_ID_INVALID")
    try:
        root_stat = archive.lstat()
        public_stat = public_dir.lstat()
    except OSError as exc:
        raise ArchiveAuditDenied("DIRECTORY_MISSING") from exc
    if (
        not stat.S_ISDIR(root_stat.st_mode)
        or stat.S_IMODE(root_stat.st_mode) != 0o700
        or root_stat.st_uid != expected_uid
        or not stat.S_ISDIR(public_stat.st_mode)
    ):
        deny("PRIVATE_ARCHIVE_DIRECTORY_INVALID")
    raw = _archived_file(archive, manifest_name, expected_uid)
    try:
        report = json.loads(raw)
    except (ValueError, UnicodeError) as exc:
        raise ArchiveAuditDenied("ARCHIVE_MANIFEST_JSON_INVALID") from exc
    if (
        not isinstance(report, dict)
        or report.get("schema") != SCHEMA
        or report.get("environment") != "DEV"
        or report.get("historicalTaskId") != expected_task_id
        or report.get("signatureAndClaimsFilesAllInsidePrivateArchive") is not True
        or report.get("noCrossTaskEvidenceBinding") is True
        or any(report.get(k) is not False
               for k in ("authorizationGranted", "signingPermitted", "dispatchPermitted"))
        or report.get("releaseDecision") != "NO_GO"
        or not isinstance(report.get("roles"), dict)
        or set(report["roles"]) != set(ROLE_DATA)
    ):
        deny("ARCHIVE_MANIFEST_RELEASE_OR_TASK_DENIED")
    fingerprints = set()
    used_signatures = set()
    for role, (key_name, fields, domain) in ROLE_DATA.items():
        row = report["roles"][role]
        if (
            not isinstance(row, dict)
            or set(row) != {
                "taskId", "signatureFile", "signatureFileSHA256", "claimsFile",
                "claimsFileSHA256", "keyFingerprintSHA256", "signatureVerified",
            }
            or row.get("taskId") != expected_task_id
            or row.get("signatureVerified") is not True
            or any(not isinstance(row.get(k), str) or HASH64.fullmatch(row[k]) is None
                   for k in ("signatureFileSHA256", "claimsFileSHA256", "keyFingerprintSHA256"))
            or not isinstance(row.get("signatureFile"), str)
            or not row["signatureFile"].startswith(role + "_signature_")
            or row["signatureFile"] in used_signatures
        ):
            deny("ARCHIVE_ROLE_BINDING_INVALID")
        used_signatures.add(row["signatureFile"])
        signature_bytes = _archived_file(archive, row["signatureFile"], expected_uid)
        claims_bytes = _archived_file(archive, row["claimsFile"], expected_uid)
        if _hash(signature_bytes) != row["signatureFileSHA256"] or _hash(claims_bytes) != row["claimsFileSHA256"]:
            deny("ARCHIVE_SHA256_MISMATCH")
        try:
            envelope = json.loads(signature_bytes)
            source = json.loads(claims_bytes)
            claims = source.get("claims", source)
            task_id = claims.get("taskId", claims.get("hubTaskId"))
            payload = canonical(claims, fields).encode("utf-8")
        except (ValueError, KeyError, TypeError, UnicodeError) as exc:
            raise ArchiveAuditDenied("ARCHIVED_CLAIMS_INVALID") from exc
        if (
            task_id != expected_task_id
            or not isinstance(envelope, dict)
            or envelope.get("role") != role
            or envelope.get("environment") != "DEV"
            or envelope.get("algorithm") != "Ed25519"
            or envelope.get("claimsSha256") != _hash(payload)
            or envelope.get("authorizationGranted") is not False
            or envelope.get("dispatchPermitted") is not False
            or envelope.get("releaseDecision") != "NO_GO"
        ):
            deny("ARCHIVED_SIGNATURE_SCOPE_INVALID")
        public_file = public_dir / key_name
        try:
            st = public_file.lstat()
            if (not stat.S_ISREG(st.st_mode)
                    or st.st_uid != expected_uid
                    or st.st_size > 2000
                    or stat.S_IMODE(st.st_mode) & 0o022):
                deny("PUBLIC_KEY_METADATA_INVALID")
            key = serialization.load_pem_public_key(public_file.read_bytes())
            if not isinstance(key, Ed25519PublicKey):
                deny("PUBLIC_KEY_ALGORITHM_INVALID")
            fingerprint = _hash(key.public_bytes(
                serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo,
            ))
            if fingerprint != row["keyFingerprintSHA256"]:
                deny("PINNED_PUBLIC_KEY_MISMATCH")
            signature = base64.urlsafe_b64decode(envelope["signatureBase64url"] + "==")
            if len(signature) != 64:
                deny("SIGNATURE_LENGTH_INVALID")
            key.verify(signature, domain + payload)
        except ArchiveAuditDenied:
            raise
        except (OSError, KeyError, TypeError, ValueError, UnicodeError) as exc:
            raise ArchiveAuditDenied("SIGNATURE_DATA_INVALID") from exc
        except Exception as exc:
            raise ArchiveAuditDenied("PUBLIC_SIGNATURE_INVALID") from exc
        fingerprints.add(fingerprint)
    if len(fingerprints) != 4:
        deny("FOUR_DISTINCT_PUBLIC_KEYS_NOT_PROVEN")
    foreign = report.get("excludedForeignTaskApproval")
    foreign_data = _archived_file(archive, foreign, expected_uid)
    try:
        foreign_claims = json.loads(foreign_data)["claims"]
    except (KeyError, TypeError, ValueError, UnicodeError) as exc:
        raise ArchiveAuditDenied("FOREIGN_APPROVAL_INVALID") from exc
    if (
        foreign_claims.get("taskId") != report.get("excludedForeignTaskApprovalTaskId")
        or foreign_claims["taskId"] == expected_task_id
    ):
        deny("CROSS_TASK_FOREIGN_APPROVAL_NOT_EXCLUDED")
    return {
        "environment": "DEV", "historicalTaskId": expected_task_id,
        "verifiedSignatureRoles": 4, "historicalArchiveVerified": True,
        "separateForeignTaskExcluded": True, "manifestSHA256": _hash(raw),
        "privateKeyBytesRead": False, "authorizationGranted": False,
        "signingPermitted": False, "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", type=int, default=166)
    args = parser.parse_args()
    try:
        result = audit(
            Path("/opt/ai-coding-standalone-dev/gpt02_issue159_archive_20261117"),
            Path("/etc/gpt02-dev/public"),
            "task166_verified_signatures_complete_1794932531.json",
            args.task,
        )
    except ArchiveAuditDenied as exc:
        print(json.dumps({"historicalArchiveVerified": False,
                          "reason": str(exc), "releaseDecision": "NO_GO"}))
        return 3
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
