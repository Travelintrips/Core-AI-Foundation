#!/usr/bin/env python3
"""Read-only CST-DEV eight-signer host readiness. NEVER loads/decrypts private keys.

Only actions: read public manifest/source/unit metadata and lstat encrypted files.
Never creates release roots or marks operational E2E as PASS.
"""
import argparse
import hashlib
import json
import os
import pathlib
import pwd
import stat
import subprocess
import sys

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

PROJECT = "xssrfshdrtdfupgqwfdw"
HOST = "srv1792369"
SOURCE = "/opt/cst-onejob-dev/bin/cst_onejob_vps_signer.py"
SOURCE_SHA = "cb24077b4ae31c1de24f365046a274d74e7249a3b05ab46dcb2d5880cef31702"
MANIFEST = "/etc/cst-onejob-dev/staged-public/manifest.json"
ROLE_USERS = {
    "qa-evidence": "cst1j-sig-qa-evidence",
    "subscriber-ack": "cst1j-sig-subscriber",
    "core-reconciliation": "cst1j-sig-core",
    "agent-coding": "cst1j-sig-coding",
    "agent-infrastructure": "cst1j-sig-infra",
    "agent-security": "cst1j-sig-security",
    "agent-qa": "cst1j-sig-agentqa",
    "reviewer": "cst1j-sig-reviewer",
}
ROLE_GROUPS = {
    "qa-evidence": "cst1j-op-qa",
    "subscriber-ack": "cst-onejob-subscriber",
    "core-reconciliation": "cst1j-op-core",
    "agent-coding": "cst1j-op-coding",
    "agent-infrastructure": "cst1j-op-infra",
    "agent-security": "cst1j-op-security",
    "agent-qa": "cst1j-op-agentqa",
    "reviewer": "cst1j-op-reviewer",
}
REQUIRED_UNIT = {
    "NoNewPrivileges": "yes",
    "ProtectSystem": "strict",
    "ProtectHome": "yes",
    "PrivateTmp": "yes",
    "PrivateNetwork": "yes",
    "UMask": "0077",
    "RestrictAddressFamilies": "AF_UNIX",
}
TRUST_ROOT = "/etc/cst-onejob-dev/operator-trust/release-public.pem"


def file_metadata(path, owner=0, mode=None, size_min=1, size_max=65536):
    try:
        s = os.lstat(path)
    except (OSError, ValueError):
        return False
    return (
        stat.S_ISREG(s.st_mode) and s.st_uid == owner and
        (mode is None or stat.S_IMODE(s.st_mode) == mode) and
        size_min <= s.st_size <= size_max and s.st_nlink == 1
    )


def sha_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for part in iter(lambda: f.read(8192), b""):
            h.update(part)
    return h.hexdigest()


def parse_unit(text):
    """Systemd unit subset. Duplicate security settings are rejected."""
    out = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(("#", ";", "[")):
            continue
        key, sep, value = line.partition("=")
        if not sep:
            continue
        out.setdefault(key, []).append(value.strip())
    return out


def exact(data, key, value):
    return data.get(key) == [value]


def status_for_role(role, row):
    errors = []
    p = row.get("publicKeyPem")
    fingerprint = row.get("fingerprint")
    try:
        pub = serialization.load_pem_public_key(p.encode("ascii"))
        assert isinstance(pub, Ed25519PublicKey)
        der = pub.public_bytes(serialization.Encoding.DER,
                               serialization.PublicFormat.SubjectPublicKeyInfo)
        assert hashlib.sha256(der).hexdigest() == fingerprint
    except (AssertionError, AttributeError, TypeError, ValueError, UnicodeError):
        errors.append("INVALID_PUBLIC_ED25519_PIN")
    if row.get("osIdentity") != ROLE_USERS[role]:
        errors.append("WRONG_MANIFEST_LINUX_IDENTITY")
    credential = row.get("encryptedFile")
    expected_cred = "/etc/credstore.encrypted/cst-onejob-" + role + "-private-key.pkcs8"
    if credential != expected_cred or not file_metadata(expected_cred, mode=0o600, size_max=8192):
        errors.append("ENCRYPTED_CREDENTIAL_METADATA_MISMATCH")
    unit_file = "/etc/systemd/system/cst-onejob-signer-" + role + ".service"
    if not file_metadata(unit_file, mode=0o644, size_max=16384):
        errors.append("SYSTEMD_UNIT_METADATA_INVALID")
        return {"role": role, "foundation": "FAIL", "errors": errors, "unsatisfiedConditions": 4}
    try:
        unit = parse_unit(pathlib.Path(unit_file).read_text())
    except (OSError, UnicodeError):
        errors.append("SYSTEMD_UNIT_NOT_READABLE")
        return {"role": role, "foundation": "FAIL", "errors": errors, "unsatisfiedConditions": 4}
    if not exact(unit, "User", ROLE_USERS[role]):
        errors.append("SYSTEMD_USER_MISMATCH")
    if not exact(unit, "Group", ROLE_GROUPS[role]):
        errors.append("SYSTEMD_GROUP_MISMATCH")
    for key, value in REQUIRED_UNIT.items():
        if not exact(unit, key, value):
            errors.append("SYSTEMD_HARDENING_" + key)
    if not exact(unit, "LoadCredentialEncrypted", "private-key.pkcs8:" + expected_cred):
        errors.append("SYSTEMD_ENCRYPTED_BINDING_MISMATCH")
    if unit.get("LoadCredential"):
        errors.append("PLAINTEXT_CREDENTIAL_DIRECTIVE_FORBIDDEN")
    if not exact(unit, "Environment", "CST_ONEJOB_LINUX_SIGNING_ENABLED=false"):
        errors.append("SIGNING_SWITCH_NOT_DEFAULT_OFF")
    args = unit.get("ExecStart", [])
    socket = {
        "qa-evidence": "/run/cst-onejob-qa/sign.sock",
        "subscriber-ack": "/run/cst-onejob-subscriber/sign.sock",
        "core-reconciliation": "/run/cst-onejob-core-reconciliation/sign.sock",
        "reviewer": "/run/cst-onejob-hub-reviewer/sign.sock",
    }.get(role, "/run/cst-onejob-hub-" + role + "/sign.sock")
    expected_command = (
        "/usr/bin/python3 " + SOURCE + " --role " + role + " --socket " + socket)
    if not exact(unit, "RuntimeDirectory", pathlib.Path(socket).parent.name):
        errors.append("RUNTIME_DIRECTORY_NOT_MATCHING_SOCKET")
    if not exact(unit, "StateDirectory", "cst-onejob-signer-" + role):
        errors.append("DURABLE_REPLAY_STATE_DIRECTORY_MISSING")
    if args != [expected_command]:
        errors.append("EXECSTART_WRONG_SOURCE_ROLE_OR_SOCKET")
    try:
        user = pwd.getpwnam(ROLE_USERS[role])
        if user.pw_shell != "/usr/sbin/nologin":
            errors.append("SIGNER_ACCOUNT_HAS_INTERACTIVE_SHELL")
    except KeyError:
        errors.append("SIGNER_IDENTITY_MISSING")
    conditions = unit.get("ConditionPathExists", [])
    approved = "/etc/cst-onejob-dev/approved-public/" + role + ".json"
    authorized = "/etc/cst-onejob-dev/authorized-releases/" + role + ".json"
    expected_conditions = {expected_cred, TRUST_ROOT, approved, authorized}
    if len(conditions) != 4 or set(conditions) != expected_conditions:
        errors.append("EXACT_FOUR_RELEASE_CONDITIONS_REQUIRED")
    unmet_paths = []
    for item in expected_conditions:
        if not os.path.exists(item):
            unmet_paths.append(item)
    # Refuse any unexpected extra conditions regardless of file existence.
    if any(not item.startswith("/") or ".." in item.split("/") for item in conditions):
        errors.append("INVALID_CONDITION_PATH")
    # A live service would not be a safe dormant-candidate baseline.
    active = subprocess.run(["systemctl", "show", "cst-onejob-signer-" + role + ".service",
                             "-p", "ActiveState", "--value", "--no-pager"],
                            text=True, capture_output=True, timeout=4)
    if active.returncode != 0 or active.stdout.strip() != "inactive":
        errors.append("SIGNER_SERVICE_NOT_INACTIVE")
    if row.get("activated") is not False or row.get("trustedForRelease") is not False:
        errors.append("STAGED_MANIFEST_MUST_NOT_CLAIM_RELEASE")
    return {
        "role": role, "foundation": "PASS" if not errors else "FAIL",
        "errors": sorted(set(errors)), "unsatisfiedConditions": len(unmet_paths),
        "_unmetPaths": unmet_paths,
    }


def host_readonly():
    result = {
        "project": PROJECT, "host": HOST, "mode": "READ_ONLY",
        "releaseDecision": "NO_GO", "queueTransitionAuthorized": False,
        "signingEnabled": False, "signaturesIssued": 0,
        "livePrivateKeyOpened": False, "privateCredentialContentsRead": False,
        "approvalOrReleaseWritten": False, "prodChanged": False,
        "googleKmsRequired": False,
    }
    if os.uname().nodename.split(".")[0] != HOST:
        return {**result, "status": "DENIED_WRONG_HOST"}
    if not file_metadata(MANIFEST, mode=0o600, size_max=65536):
        return {**result, "status": "DENIED_MANIFEST_METADATA"}
    try:
        manifest = json.loads(pathlib.Path(MANIFEST).read_text())
    except (ValueError, OSError):
        return {**result, "status": "DENIED_MANIFEST_INVALID"}
    if (manifest.get("project") != PROJECT or manifest.get("environment") != "DEV" or
            manifest.get("host") != HOST or manifest.get("approvalStatus") != "CANDIDATE_NOT_RELEASED" or
            manifest.get("privateKeyMaterialInManifest") is not False):
        return {**result, "status": "DENIED_MANIFEST_SCOPE"}
    creds_dir = "/etc/credstore.encrypted"
    try:
        directory = os.lstat(creds_dir)
        creds_dir_ok = stat.S_ISDIR(directory.st_mode) and directory.st_uid == 0 and (
            stat.S_IMODE(directory.st_mode) == 0o700)
    except OSError:
        creds_dir_ok = False
    if not creds_dir_ok:
        return {**result, "status": "DENIED_CREDENTIAL_PARENT_SECURITY"}
    roles = manifest.get("roles", [])
    if (not isinstance(roles, list) or len(roles) != 8 or
            {r.get("role") for r in roles if isinstance(r, dict)} != set(ROLE_USERS)):
        return {**result, "status": "DENIED_EIGHT_ROLE_INVENTORY"}
    rows = [status_for_role(r["role"], r) for r in roles]
    fingerprints = [r.get("fingerprint") for r in roles]
    unique_public_pins = len(set(fingerprints)) == 8
    source_ok = file_metadata(SOURCE, mode=0o644, size_max=65536) and sha_file(SOURCE) == SOURCE_SHA
    if not source_ok or not unique_public_pins:
        rows.append({"role": "_integrity", "foundation": "FAIL",
                     "errors": ([] if source_ok else ["SIGNER_SOURCE_SHA_OR_METADATA_INVALID"]) +
                     ([] if unique_public_pins else ["DUPLICATE_PUBLIC_PIN"])})
    total_unmet = sum(r.get("unsatisfiedConditions", 0) for r in rows)
    distinct_unmet = set(path for row in rows for path in row.pop("_unmetPaths", []))
    foundation = all(r["foundation"] == "PASS" for r in rows)
    result.update({
        "status": "FOUNDATION_PASS_RELEASE_PENDING" if foundation else "FOUNDATION_INTEGRITY_FAILED",
        "rolesChecked": len(roles), "foundationRolesPassed": sum(
            r["foundation"] == "PASS" for r in rows if r["role"] != "_integrity"),
        "distinctPublicPins": len(set(fingerprints)),
        "blockingConditionCount": total_unmet,
        "distinctUnsignedReleasePaths": len(distinct_unmet),
        "operatorReleaseRootPresent": file_metadata(TRUST_ROOT, mode=0o644),
        "manifestApprovalStatus": manifest.get("approvalStatus"),
        "roleChecks": rows,
    })
    # No check of manifest / unit files authorizes live signing or E2E.
    return result


def main():
    a = argparse.ArgumentParser(description="CST-DEV eight signer public-only readiness")
    a.add_argument("--host-readonly", action="store_true")
    args = a.parse_args()
    if not args.host_readonly:
        a.error("explicit --host-readonly is required; no provisioning modes")
    report = host_readonly()
    print(json.dumps(report, separators=(",", ":"), sort_keys=True))
    return 0 if report["status"] == "FOUNDATION_PASS_RELEASE_PENDING" else 2


if __name__ == "__main__":
    sys.exit(main())
