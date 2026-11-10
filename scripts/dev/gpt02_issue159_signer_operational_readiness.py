#!/usr/bin/env python3
"""Read-only aggregate readiness for GPT02 Issue #159 signer operations.

Combines metadata-only approval-store and private-key-custody probes. It never
reads credential bytes, signs, writes SQLite, opens signer keys, consumes a
nonce, creates a task/command, or dispatches a worker.
"""
from __future__ import annotations

import json
import os
import sys

from gpt02_issue159_approval_store_readiness import inspect as inspect_approval
from gpt02_issue159_private_key_custody_readiness import inspect as inspect_custody

LIVE_RUNTIME = "/opt/ai-coding-standalone-dev"
HUB_TRUST_DIR = "/run/credentials/gpt02-dev"
HUB_MANIFEST = "/etc/gpt02-dev/trust-fingerprints.json"


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
    approval_reader_mounted = runtime.get("approvalReaderMounted") is True
    approval_writer_mounted = runtime.get("approvalWriterMounted") is True

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
    if not approval_reader_mounted:
        blockers.append("APPROVAL_TRUSTED_READER_NOT_MOUNTED")
    if not approval_writer_mounted:
        blockers.append("APPROVAL_INTENT_WRITER_NOT_MOUNTED")
    if not custody_baseline:
        blockers.append("SYSTEMD_CUSTODY_BASELINE_NOT_READY")
    if not host_secret:
        blockers.append("SYSTEMD_HOST_CREDENTIAL_SECRET_NOT_PROVISIONED")
    if not four_credentials:
        blockers.append("FOUR_SIGNER_CREDENTIALS_NOT_PROVISIONED")
    blockers.append("HUB_CORE_ISSUER_TRUSTED_READ_ADAPTERS_NOT_OPERATIONAL")
    blockers.append("FOUR_SIGNER_RUNTIMES_NOT_MOUNTED")
    if not public_trust:
        blockers.append("OPERATIONAL_PUBLIC_TRUST_NOT_INSTALLED")

    return {
        "environment": "DEV",
        "approvalStoreSchemaReady": approval_schema_ready,
        "realAal2ApprovalEvidenceAvailable": approval_evidence,
        "approvalReaderMounted": approval_reader_mounted,
        "approvalWriterMounted": approval_writer_mounted,
        "systemdCustodyBaselineReady": custody_baseline,
        "hostCredentialSecretSecure": host_secret,
        "fourSignerCredentialMetadataSecure": four_credentials,
        "hubOperationalPublicTrustInstalled": public_trust,
        "hubCoreIssuerTrustedReadAdaptersOperational": False,
        "fourSignerRuntimesMounted": False,
        "blockers": blockers,
        "privateCredentialBytesRead": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "operationalSigningReady": False,
        "releaseDecision": "NO_GO",
    }


def live_runtime_metadata():
    return {
        "approvalReaderMounted": os.path.isfile(
            os.path.join(LIVE_RUNTIME, "gpt02_issue159_approval_intent_reader.py")
        ),
        "approvalWriterMounted": os.path.isfile(
            os.path.join(LIVE_RUNTIME, "gpt02_issue159_approval_intent.py")
        ),
        "hubPublicTrustDirectoryPresent": os.path.isdir(HUB_TRUST_DIR),
        "hubFingerprintManifestPresent": os.path.isfile(HUB_MANIFEST),
    }


def inspect_live():
    return assess(
        inspect_approval("/opt/ai-coding-standalone-dev/tasks.db",
                         operational=True),
        inspect_custody(operational=True),
        live_runtime_metadata(),
    )


def main():
    out = inspect_live()
    print(json.dumps(out, sort_keys=True))
    return 0 if out["operationalSigningReady"] is True else 2


if __name__ == "__main__":
    sys.exit(main())
