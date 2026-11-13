#!/usr/bin/env python3
"""DEV-only one-shot detached signer for GPT02 Issue159.

Loads exactly one systemd-mounted Ed25519 private key, verifies its public
fingerprint against the pinned manifest, validates an exact role-specific
claims object, writes one detached signature result, and exits.

No network, database, task creation, nonce/lease mutation or dispatch surface.
"""
from __future__ import annotations
import argparse, base64, hashlib, json, os, re, stat, sys, time
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from gpt02_issue159_signer_approval_guard import persisted_approval_fresh, canonical_sha
from gpt02_issue159_hub_core_signer_guard import require_hub_core_facts
from gpt02_issue159_issuer_signer_guard import require_issuer_facts

ROLES=("approval","hub","core","issuer")
UUID=re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")
HEX=re.compile(r"^[0-9a-f]{64}$")
NONCE=re.compile(r"^[A-Za-z0-9_-]{32,128}$")
SUBJECT=re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$")
WORKER="openclaw-dell-chatgpt-wake-dev"

APPROVAL_FIELDS=("v","environment","audience","taskId","commandId","attemptId",
 "nonce","operatorNamespace","superAdminId","companyId","issuedAt","expiresAt")
LINK_FIELDS=("v","environment","audience","linkId","companyId","hubTaskId",
 "hubExecutionId","coreTaskId","coreCommandId","attemptId","attemptNumber",
 "assigneeId","accountableOwnerId","hubOperatorNamespace","hubOperatorId",
 "hubRole","hubActive","coreOperatorNamespace","coreOperatorUserId","coreRole",
 "coreActive","corePasswordChanged","workerId","approvalDigest","nonce",
 "issuedAt","expiresAt")
ISSUER_FIELDS=("v","environment","audience","companyId","hubTaskId",
 "hubExecutionId","coreTaskId","commandId","attemptId","workerId","receiptId",
 "linkId","fenceId","approvalDigest","nonceDigest","issuerRole","leaseEpoch",
 "issuedAt","expiresAt")

def fail(code:str):
    raise RuntimeError(code)

def exact(obj,fields):
    return isinstance(obj,dict) and set(obj)==set(fields)

def canonical(claims,fields):
    if not exact(claims,fields): fail("CLAIMS_FIELDS_INVALID")
    return json.dumps({k:claims[k] for k in fields},ensure_ascii=False,
                      separators=(",",":"),allow_nan=False)

def validate(role,claims,now_ms):
    if role=="approval":
        if not exact(claims,APPROVAL_FIELDS): fail("APPROVAL_FIELDS_INVALID")
        if (claims["v"]!=2 or claims["environment"]!="DEV" or
            claims["audience"]!="GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL" or
            not isinstance(claims["taskId"],int) or claims["taskId"]<=139 or
            not UUID.fullmatch(str(claims["commandId"])) or
            not UUID.fullmatch(str(claims["attemptId"])) or
            claims["commandId"]==claims["attemptId"] or
            not NONCE.fullmatch(str(claims["nonce"])) or
            claims["operatorNamespace"]!="ai-task-hub.public.users" or
            not SUBJECT.fullmatch(str(claims["superAdminId"])) or
            claims["companyId"]!="default"):
            fail("APPROVAL_SCOPE_INVALID")
        max_ms=300_000
        domain=b""
        fields=APPROVAL_FIELDS
    elif role in ("hub","core"):
        if not exact(claims,LINK_FIELDS): fail("LINK_FIELDS_INVALID")
        uuids=("linkId","hubExecutionId","coreTaskId","coreCommandId","attemptId")
        if (claims["v"]!=1 or claims["environment"]!="DEV" or
            claims["audience"]!="GPT02_DUAL_ACCOUNT_COMMAND_LINK" or
            claims["companyId"]!="default" or
            not isinstance(claims["hubTaskId"],int) or claims["hubTaskId"]<=139 or
            not all(UUID.fullmatch(str(claims[k])) for k in uuids) or
            claims["attemptNumber"]!=1 or
            not isinstance(claims["assigneeId"],int) or claims["assigneeId"]<=0 or
            claims["accountableOwnerId"]!=claims["hubOperatorId"] or
            claims["hubOperatorNamespace"]!="ai-task-hub.public.users" or
            not SUBJECT.fullmatch(str(claims["hubOperatorId"])) or
            claims["hubRole"]!="super_admin" or claims["hubActive"] is not True or
            claims["coreOperatorNamespace"]!="ai-core.ai_platform.internal_users" or
            not isinstance(claims["coreOperatorUserId"],int) or
            claims["coreOperatorUserId"]<=0 or
            claims["coreRole"] not in ("owner","admin") or
            claims["coreActive"] is not True or
            claims["corePasswordChanged"] is not True or
            claims["workerId"]!=WORKER or
            not HEX.fullmatch(str(claims["approvalDigest"])) or
            not NONCE.fullmatch(str(claims["nonce"]))):
            fail("LINK_SCOPE_INVALID")
        max_ms=120_000
        domain=("GPT02_OPERATOR_LINK_V1:"+role+"\n").encode()
        fields=LINK_FIELDS
    elif role=="issuer":
        if not exact(claims,ISSUER_FIELDS): fail("ISSUER_FIELDS_INVALID")
        uuids=("hubExecutionId","coreTaskId","commandId","attemptId",
               "receiptId","linkId","fenceId")
        if (claims["v"]!=1 or claims["environment"]!="DEV" or
            claims["audience"]!="GPT02_ISSUER_LEASE_EVIDENCE_V1" or
            claims["companyId"]!="default" or
            not isinstance(claims["hubTaskId"],int) or claims["hubTaskId"]<=139 or
            not all(UUID.fullmatch(str(claims[k])) for k in uuids) or
            claims["workerId"]!=WORKER or
            not HEX.fullmatch(str(claims["approvalDigest"])) or
            not HEX.fullmatch(str(claims["nonceDigest"])) or
            claims["issuerRole"]!="dev_gpt02_issuer_evidence" or
            claims["leaseEpoch"]!=1):
            fail("ISSUER_SCOPE_INVALID")
        max_ms=15_000
        domain=b"GPT02_ISSUER_LEASE_EVIDENCE_V1\n"
        fields=ISSUER_FIELDS
    else:
        fail("SIGNER_ROLE_INVALID")
    issued=claims.get("issuedAt"); expires=claims.get("expiresAt")
    if (type(issued) is not int or type(expires) is not int or
        issued<0 or expires<=issued or expires-issued>max_ms or
        now_ms<issued-1000 or now_ms>=expires):
        fail("CLAIMS_TIME_INVALID")
    payload=canonical(claims,fields).encode("utf-8")
    return domain+payload,payload

def secure_file(path:str, label:str):
    st=os.lstat(path)
    if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode):
        fail(label+"_FILE_INVALID")
    if st.st_uid not in (0, os.getuid()) or stat.S_IMODE(st.st_mode)&0o077:
        fail(label+"_FILE_SECURITY_INVALID")
    return st

def sign_detached_for_test_or_gated_cli(
    role: str, claims: dict, credentials_dir: str, output: str,
    *, now_ms: int | None = None,
) -> dict:
    """Pure signer backend. CLI must pass persisted-approval gate first.

    Unit tests supply ephemeral Ed25519 credentials and call this directly;
    there is intentionally no CLI flag to skip the live persisted gate.
    """
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    signing_bytes, canonical_bytes = validate(role, claims, now_ms)
    creds = Path(credentials_dir)
    manifest_path = creds / "manifest.json"
    key_path = creds / "private-key.pkcs8"
    # In systemd, LoadCredential owns the copy as the private service UID;
    # the source on disk remains root-private.
    secure_file(str(key_path), "PRIVATE_KEY")
    secure_file(str(manifest_path), "MANIFEST")
    key_bytes = key_path.read_bytes()
    try:
        key = serialization.load_der_private_key(key_bytes, password=None)
    finally:
        key_bytes = b""
    if not isinstance(key, Ed25519PrivateKey):
        fail("ED25519_PRIVATE_KEY_REQUIRED")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or set(manifest) != set(ROLES):
        fail("FINGERPRINT_MANIFEST_INVALID")
    der = key.public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    fingerprint = hashlib.sha256(der).hexdigest()
    if manifest.get(role) != fingerprint:
        fail("PRIVATE_PUBLIC_FINGERPRINT_MISMATCH")

    sig = base64.urlsafe_b64encode(key.sign(signing_bytes)).decode().rstrip("=")
    if len(sig) != 86:
        fail("SIGNATURE_ENCODING_INVALID")
    digest = hashlib.sha256(canonical_bytes).hexdigest()
    data = {
        "environment": "DEV", "role": role, "algorithm": "Ed25519",
        "claimsSha256": digest, "signatureBase64url": sig,
        "fingerprintMatched": True, "authorizationGranted": False,
        "dispatchPermitted": False, "releaseDecision": "NO_GO",
    }
    target = Path(output)
    tmp = target.with_name("." + target.name + ".tmp")
    if target.exists() or target.is_symlink() or tmp.exists() or tmp.is_symlink():
        fail("SIGNATURE_OUTPUT_ALREADY_EXISTS")
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                 getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as writer:
            writer.write(json.dumps(data, sort_keys=True, separators=(",", ":")) + "\n")
            writer.flush()
            os.fsync(writer.fileno())
        os.link(str(tmp), str(target))
    finally:
        tmp.unlink(missing_ok=True)
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--role", required=True, choices=ROLES)
    ap.add_argument("--claims", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()
    if os.environ.get("APP_ENV") != "development":
        fail("EXPLICIT_DEV_MODE_REQUIRED")
    if os.environ.get("GPT02_ISSUE159_SIGNING_ENABLED") != "approved-once":
        fail("EXPLICIT_ONE_SHOT_APPROVAL_SIGNING_REQUIRED")
    # No bypass flag exists. Hub/Core require two independently authenticated
    # Hub/Core read-only database logins, plus the SAME persisted approval.
    # Issuer needs a real nonce receipt and fence and remains explicitly OFF.
    creds = os.environ.get("CREDENTIALS_DIRECTORY", "")
    output_dir = os.environ.get("RUNTIME_DIRECTORY", "")
    if not creds or not output_dir:
        fail("SYSTEMD_CREDENTIAL_AND_RUNTIME_BOUNDARY_REQUIRED")
    approval_path = str(Path(creds) / "approved-claims.json")
    expected_name = (
        "approved-claims.json" if args.role == "approval"
        else "hub-core-link.json" if args.role in ("hub", "core")
        else "issuer-claims.json"
    )
    expected = str(Path(creds) / expected_name)
    destination = str(Path(output_dir) / (args.role + "-signature.json"))
    if args.claims != expected or args.output != destination:
        fail("ONE_SHOT_CREDENTIAL_OR_OUTPUT_PATH_NOT_PINNED")
    secure_file(approval_path, "APPROVED_CLAIMS")
    payload = json.loads(Path(approval_path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or set(payload) != {"claims", "claimsSha256"}:
        fail("APPROVED_CLAIMS_PAYLOAD_INVALID")
    approved = payload["claims"]
    if payload["claimsSha256"] != canonical_sha(approved):
        fail("APPROVED_CLAIMS_DIGEST_MISMATCH")
    now_ms = int(time.time() * 1000)
    validate("approval", approved, now_ms)
    if args.role == "approval":
        claims = approved
        signed_digest = persisted_approval_fresh(approved, now_ms=now_ms)
        if signed_digest != payload["claimsSha256"]:
            fail("PERSISTED_APPROVAL_DIGEST_MISMATCH")
    elif args.role in ("hub", "core"):
        secure_file(args.claims, "HUB_CORE_LINK")
        claims = json.loads(Path(args.claims).read_text(encoding="utf-8"))
        validate(args.role, claims, now_ms)
        require_hub_core_facts(args.role, claims, approved, now_ms=now_ms)
    elif args.role == "issuer":
        link_path = str(Path(creds) / "hub-core-link.json")
        secure_file(link_path, "HUB_CORE_LINK")
        secure_file(args.claims, "ISSUER_CLAIMS")
        link = json.loads(Path(link_path).read_text(encoding="utf-8"))
        claims = json.loads(Path(args.claims).read_text(encoding="utf-8"))
        validate("issuer", claims, now_ms)
        require_issuer_facts(claims, approved, link, now_ms=now_ms)
    else:
        fail("SIGNER_ROLE_NOT_SUPPORTED")
    sign_detached_for_test_or_gated_cli(
        args.role, claims, creds, args.output,
        now_ms=int(time.time() * 1000),
    )
    return 0


if __name__=="__main__":
    try: sys.exit(main())
    except Exception as exc:
        print(str(exc),file=sys.stderr)
        sys.exit(2)
