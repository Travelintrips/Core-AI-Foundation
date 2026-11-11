#!/usr/bin/env python3
"""Read-only aggregate readiness for GPT02 Issue #159 signer operations.

Combines metadata-only approval-store and private-key-custody probes. It never
reads credential bytes, signs, writes SQLite, opens signer keys, consumes a
nonce, creates a task/command, or dispatches a worker.
"""
from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import time
from pathlib import Path

from gpt02_issue159_approval_intent_reader import read_approval_intent
from gpt02_issue159_approval_store_readiness import inspect as inspect_approval
from gpt02_issue159_private_key_custody_readiness import inspect as inspect_custody

LIVE_RUNTIME = "/opt/ai-coding-standalone-dev"
HUB_TRUST_DIR = "/run/credentials/gpt02-dev"
HUB_MANIFEST = "/etc/gpt02-dev/trust-fingerprints.json"
APPROVED_CLAIMS_FILE = os.path.join(
    LIVE_RUNTIME, "gpt02_issue159_approved_claims.json"
)
SIGNER_ROLES = ("approval", "hub", "core", "issuer")


def current_approval_evidence():
    """Read the exact persisted AAL2 intent; expired approvals do not count."""
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
    """Metadata-only proof that all four systemd signer units are mounted."""
    for role in SIGNER_ROLES:
        unit = f"gpt02-issue159-signer@{role}.service"
        try:
            active = subprocess.run(
                ["systemctl", "is-active", "--quiet", unit],
                timeout=2, check=False,
            ).returncode == 0
            path = f"/run/gpt02-issue159-signer-{role}/readiness.json"
            st = os.lstat(path)
            if (not active or stat.S_ISLNK(st.st_mode)
                    or not stat.S_ISREG(st.st_mode)
                    or st.st_uid != 0 or st.st_gid != 0
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
        except (OSError, ValueError, subprocess.SubprocessError):
            return False
    return True


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
        blockers.append("REAL_AAL2_APPROVAL_INTENT_NOT_AVAILABLE")
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
    trusted_adapters = runtime.get("hubCoreIssuerTrustedReadAdaptersOperational") is True
    signer_runtimes = runtime.get("fourSignerRuntimesMounted") is True
    if not trusted_adapters:
        blockers.append("HUB_CORE_ISSUER_TRUSTED_READ_ADAPTERS_NOT_OPERATIONAL")
    if not signer_runtimes:
        blockers.append("FOUR_SIGNER_RUNTIMES_NOT_MOUNTED")
    if not public_trust:
        blockers.append("OPERATIONAL_PUBLIC_TRUST_NOT_INSTALLED")

    return {
        "environment": "DEV",
        "approvalStoreSchemaReady": approval_schema_ready,
        "realAal2ApprovalEvidenceAvailable": approval_evidence,
        "approvalReaderSourceInstalled": approval_reader_source,
        "approvalWriterSourceInstalled": approval_writer_source,
        "approvalWriterIntegrated": approval_writer_integrated,
        "approvalTrustedReaderOperational": approval_reader_operational,
        "systemdCustodyBaselineReady": custody_baseline,
        "hostCredentialSecretSecure": host_secret,
        "fourSignerCredentialMetadataSecure": four_credentials,
        "hubOperationalPublicTrustInstalled": public_trust,
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
