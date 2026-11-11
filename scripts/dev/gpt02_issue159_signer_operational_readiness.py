#!/usr/bin/env python3
"""Read-only aggregate readiness for GPT02 Issue #159 signer operations.

Combines metadata-only approval-store and private-key-custody probes. It never
reads credential bytes, signs, writes SQLite, opens signer keys, consumes a
nonce, creates a task/command, or dispatches a worker.
"""
from __future__ import annotations

import grp
import json
import os
import pwd
import stat
import socket
import subprocess
import sys
import time
from pathlib import Path

from gpt02_issue159_approval_intent_reader import read_approval_intent
from gpt02_issue159_approval_store_readiness import inspect as inspect_approval
from gpt02_issue159_private_key_custody_readiness import inspect as inspect_custody

LIVE_RUNTIME = "/opt/ai-coding-standalone-dev"
HUB_TRUST_DIR = "/etc/gpt02-dev/public"
HUB_MANIFEST = "/etc/gpt02-dev/trust-fingerprints.json"
APPROVED_CLAIMS_FILE = os.path.join(
    LIVE_RUNTIME, "gpt02_issue159_approved_claims.json"
)
SIGNER_ROLES = ("approval", "hub", "core", "issuer")
SIGNER_RUNTIME_ROOT = "/run"


def current_approval_evidence():
    """Read the exact persisted single-Super-Admin intent; expired approvals do not count."""
    try:
        st = os.lstat(APPROVED_CLAIMS_FILE)
        if (stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode)
                or st.st_uid != 0 or st.st_gid != 0
                or stat.S_IMODE(st.st_mode) != 0o600):
            return False
        payload = json.loads(Path(APPROVED_CLAIMS_FILE).read_text(encoding="utf-8"))
        claims = payload["claims"]
        lookup = {
            "claimsSha256": payload["claimsSha256"],
            "taskId": claims["taskId"],
            "commandId": claims["commandId"],
            "attemptId": claims["attemptId"],
            "companyId": claims["companyId"],
            "superAdminId": claims["superAdminId"],
        }
        result = read_approval_intent(
            os.path.join(LIVE_RUNTIME, "tasks.db"),
            lookup,
            int(time.time() * 1000),
            operational=True,
        )
        return result.get("persistedTrustedReadProven") is True
    except (OSError, ValueError, KeyError, TypeError):
        return False


def signer_runtime_mounted():
    """Metadata-only proof of active signer units and their private runtime files."""
    for role in SIGNER_ROLES:
        unit = f"gpt02-issue159-signer@{role}.service"
        try:
            active = subprocess.run(
                ["systemctl", "is-active", "--quiet", unit],
                timeout=2, check=False,
            ).returncode == 0
            user_result = subprocess.run(
                ["systemctl", "show", "-p", "User", "--value", unit],
                capture_output=True, text=True, timeout=2, check=False,
            )
            group_result = subprocess.run(
                ["systemctl", "show", "-p", "Group", "--value", unit],
                capture_output=True, text=True, timeout=2, check=False,
            )
            if user_result.returncode != 0 or group_result.returncode != 0:
                return False
            user_name = user_result.stdout.strip()
            group_name = group_result.stdout.strip()
            if user_name:
                account = pwd.getpwnam(user_name)
                expected_uid = account.pw_uid
                expected_gid = grp.getgrnam(group_name).gr_gid if group_name else account.pw_gid
            else:
                expected_uid = 0
                expected_gid = grp.getgrnam(group_name).gr_gid if group_name else 0

            runtime_dir = os.path.join(
                SIGNER_RUNTIME_ROOT, f"gpt02-issue159-signer-{role}"
            )
            runtime_stat = os.lstat(runtime_dir)
            path = os.path.join(runtime_dir, "readiness.json")
            st = os.lstat(path)
            if (not active or stat.S_ISLNK(runtime_stat.st_mode)
                    or not stat.S_ISDIR(runtime_stat.st_mode)
                    or runtime_stat.st_uid != expected_uid
                    or runtime_stat.st_gid != expected_gid
                    or stat.S_IMODE(runtime_stat.st_mode) != 0o700
                    or stat.S_ISLNK(st.st_mode)
                    or not stat.S_ISREG(st.st_mode)
                    or st.st_uid != expected_uid
                    or st.st_gid != expected_gid
                    or stat.S_IMODE(st.st_mode) != 0o600):
                return False
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            if (data.get("environment") != "DEV"
                    or data.get("role") != role
                    or data.get("algorithm") != "Ed25519"
                    or data.get("fingerprintMatched") is not True
                    or data.get("privateCredentialMounted") is not True
                    or data.get("authorizerOperational") is not False
                    or data.get("signingPermitted") is not False
                    or data.get("authorizationGranted") is not False
                    or data.get("dispatchPermitted") is not False
                    or data.get("releaseDecision") != "NO_GO"):
                return False
        except (KeyError, OSError, ValueError, subprocess.SubprocessError):
            return False
    return True



def hub_core_reader_runtime_operational():
    """Verify the live DEV Hub/Core read-only sidecar through its private Unix socket."""
    socket_path = "/run/gpt02-reader/reader.sock"
    directory_path = "/run/gpt02-reader"
    try:
        if subprocess.run(
            ["systemctl", "is-active", "--quiet", "gpt02-issue159-reader.service"],
            timeout=2, check=False,
        ).returncode != 0:
            return False
        signer_gid = grp.getgrnam("gpt02-issue159-signers").gr_gid
        directory = os.lstat(directory_path)
        endpoint = os.lstat(socket_path)
        if (stat.S_ISLNK(directory.st_mode) or not stat.S_ISDIR(directory.st_mode)
                or directory.st_gid != signer_gid
                or stat.S_IMODE(directory.st_mode) != 0o750
                or stat.S_ISLNK(endpoint.st_mode) or not stat.S_ISSOCK(endpoint.st_mode)
                or endpoint.st_uid == 0 or endpoint.st_gid != signer_gid
                or stat.S_IMODE(endpoint.st_mode) != 0o660):
            return False
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(8)
        try:
            client.connect(socket_path)
            client.sendall(
                b"GET /health HTTP/1.1\\r\\n"
                b"Host: localhost\\r\\n"
                b"Connection: close\\r\\n\\r\\n"
            )
            chunks = []
            size = 0
            while True:
                chunk = client.recv(4096)
                if not chunk:
                    break
                size += len(chunk)
                if size > 8192:
                    return False
                chunks.append(chunk)
        finally:
            client.close()
        response = b"".join(chunks)
        header, separator, body = response.partition(b"\\r\\n\\r\\n")
        if not separator or not header.startswith(b"HTTP/1.1 200 "):
            return False
        payload = json.loads(body.decode("utf-8"))
        return (
            payload.get("ok") is True
            and payload.get("environment") == "DEV"
            and payload.get("readerReady") is True
            and payload.get("hubRole") == "gpt02_hub_evidence_reader"
            and payload.get("coreRole") == "gpt02_core_evidence_reader"
            and payload.get("twoSessionsVerified") is True
            and payload.get("signingPermitted") is False
            and payload.get("dispatchPermitted") is False
        )
    except (KeyError, OSError, ValueError, socket.timeout, subprocess.SubprocessError):
        return False

def assess(approval, custody, runtime):
    blockers = []

    approval_schema_ready = (
        approval.get("reason") ==
        "ISSUE159_APPROVAL_STORE_READY_NO_SIGNING_AUTHORITY"
        and approval.get("approvalIntentSchemaExact") is True
        and approval.get("approvalIntentLookupIndexExact") is True
        and approval.get("fileSecurityVerified") is True
    )
    approval_evidence = approval.get("operationalEvidenceAvailable") is True
    approval_reader_source = runtime.get("approvalReaderSourceInstalled") is True
    approval_reader_operational = (
        approval_schema_ready
        and approval.get("trustedPersistedReadReady") is True
        and approval_reader_source
    )
    approval_writer_source = runtime.get("approvalWriterSourceInstalled") is True
    approval_writer_integrated = runtime.get("approvalWriterIntegrated") is True

    custody_baseline = (
        custody.get("reason") ==
        "CUSTODY_METADATA_BASELINE_READY_NO_SIGNING_AUTHORITY"
    )
    host_secret = (
        custody.get("hostCredentialSecret", {}).get("metadataSecure") is True
    )
    four_credentials = (
        custody.get("signerCredentialPresentCount") == 4
        and custody.get("fourSignerCredentialMetadataSecure") is True
    )

    public_trust = (
        runtime.get("hubPublicTrustDirectoryPresent") is True
        and runtime.get("hubFingerprintManifestPresent") is True
    )

    if not approval_schema_ready:
        blockers.append("APPROVAL_STORE_SCHEMA_NOT_READY")
    if not approval_evidence:
        blockers.append("REAL_SUPER_ADMIN_APPROVAL_INTENT_NOT_AVAILABLE")
    if not approval_reader_source:
        blockers.append("APPROVAL_READER_SOURCE_NOT_INSTALLED")
    if not approval_writer_source:
        blockers.append("APPROVAL_WRITER_SOURCE_NOT_INSTALLED")
    if not approval_writer_integrated:
        blockers.append("APPROVAL_INTENT_WRITER_NOT_INTEGRATED")
    if not approval_reader_operational:
        blockers.append("APPROVAL_TRUSTED_READER_NOT_OPERATIONAL")
    if not custody_baseline:
        blockers.append("SYSTEMD_CUSTODY_BASELINE_NOT_READY")
    if not host_secret:
        blockers.append("SYSTEMD_HOST_CREDENTIAL_SECRET_NOT_PROVISIONED")
    if not four_credentials:
        blockers.append("FOUR_SIGNER_CREDENTIALS_NOT_PROVISIONED")
    hub_core_reader = runtime.get("hubCoreReaderRuntimeOperational") is True
    issuer_reader = runtime.get("issuerReaderRuntimeOperational") is True
    trusted_adapters = hub_core_reader and issuer_reader
    signer_runtimes = runtime.get("fourSignerRuntimesMounted") is True
    if not hub_core_reader:
        blockers.append("HUB_CORE_TRUSTED_READER_RUNTIME_NOT_OPERATIONAL")
    if not issuer_reader:
        blockers.append("ISSUER_TRUSTED_READER_RUNTIME_NOT_OPERATIONAL")
    if not signer_runtimes:
        blockers.append("FOUR_SIGNER_RUNTIMES_NOT_MOUNTED")
    if not public_trust:
        blockers.append("OPERATIONAL_PUBLIC_TRUST_NOT_INSTALLED")

    return {
        "environment": "DEV",
        "approvalStoreSchemaReady": approval_schema_ready,
        "realSuperAdminApprovalEvidenceAvailable": approval_evidence,
        "approvalReaderSourceInstalled": approval_reader_source,
        "approvalWriterSourceInstalled": approval_writer_source,
        "approvalWriterIntegrated": approval_writer_integrated,
        "approvalTrustedReaderOperational": approval_reader_operational,
        "systemdCustodyBaselineReady": custody_baseline,
        "hostCredentialSecretSecure": host_secret,
        "fourSignerCredentialMetadataSecure": four_credentials,
        "hubOperationalPublicTrustInstalled": public_trust,
        "hubCoreReaderRuntimeOperational": hub_core_reader,
        "issuerReaderRuntimeOperational": issuer_reader,
        "hubCoreIssuerTrustedReadAdaptersOperational": trusted_adapters,
        "fourSignerRuntimesMounted": signer_runtimes,
        "blockers": blockers,
        "privateCredentialBytesRead": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "operationalSigningReady": False,
        "releaseDecision": "NO_GO",
    }


def live_runtime_metadata():
    reader_path = os.path.join(
        LIVE_RUNTIME, "gpt02_issue159_approval_intent_reader.py"
    )
    writer_path = os.path.join(
        LIVE_RUNTIME, "gpt02_issue159_approval_intent.py"
    )
    api_path = os.path.join(LIVE_RUNTIME, "approval_api.py")
    api_source = ""
    try:
        api_source = Path(api_path).read_text(encoding="utf-8")
    except OSError:
        pass
    writer_integrated = (
        "from gpt02_issue159_approval_http import handle_issue159_approval_intent"
        in api_source
        and "handle_issue159_approval_intent(" in api_source
        and "issue159_identity_verifier" in api_source
    )
    return {
        "approvalReaderSourceInstalled": os.path.isfile(reader_path),
        "approvalWriterSourceInstalled": os.path.isfile(writer_path),
        "approvalWriterIntegrated": writer_integrated,
        "hubPublicTrustDirectoryPresent": os.path.isdir(HUB_TRUST_DIR),
        "hubFingerprintManifestPresent": os.path.isfile(HUB_MANIFEST),
        "hubCoreReaderRuntimeOperational": hub_core_reader_runtime_operational(),
        "issuerReaderRuntimeOperational": False,
        "hubCoreIssuerTrustedReadAdaptersOperational": False,
        "fourSignerRuntimesMounted": signer_runtime_mounted(),
        "approvalIntentTrustedReadCurrent": current_approval_evidence(),
    }


def inspect_live():
    approval = inspect_approval("/opt/ai-coding-standalone-dev/tasks.db",
                                operational=True)
    runtime = live_runtime_metadata()
    # A row in the store is not enough: the exact approved binding must still
    # pass the pinned read-only reader and remain inside its validity window.
    approval["operationalEvidenceAvailable"] = (
        runtime["approvalIntentTrustedReadCurrent"]
    )
    return assess(
        approval,
        inspect_custody(operational=True),
        runtime,
    )


def main():
    out = inspect_live()
    print(json.dumps(out, sort_keys=True))
    return 0 if out["operationalSigningReady"] is True else 2


if __name__ == "__main__":
    sys.exit(main())
