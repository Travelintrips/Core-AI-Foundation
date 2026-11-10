#!/usr/bin/env python3
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/dev/gpt02_issue159_signer_operational_readiness.py"

spec = importlib.util.spec_from_file_location("signer_readiness", SCRIPT)
readiness = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(readiness)


def approval(*, evidence=False, schema=True):
    return {
        "reason": (
            "ISSUE159_APPROVAL_STORE_READY_NO_SIGNING_AUTHORITY"
            if schema else "ISSUE159_APPROVAL_INTENT_SCHEMA_DRIFT"
        ),
        "approvalIntentSchemaExact": schema,
        "approvalIntentLookupIndexExact": schema,
        "fileSecurityVerified": schema,
        "operationalEvidenceAvailable": evidence,
        "trustedPersistedReadReady": schema,
    }


def custody(*, host_secret=False, credentials=0, baseline=True):
    return {
        "reason": (
            "CUSTODY_METADATA_BASELINE_READY_NO_SIGNING_AUTHORITY"
            if baseline else "CUSTODY_METADATA_BASELINE_NOT_READY"
        ),
        "hostCredentialSecret": {"metadataSecure": host_secret},
        "signerCredentialPresentCount": credentials,
        "fourSignerCredentialMetadataSecure": credentials == 4,
    }


def runtime(**patch):
    base = {
        "approvalReaderSourceInstalled": False,
        "approvalWriterSourceInstalled": False,
        "approvalWriterIntegrated": False,
        "hubPublicTrustDirectoryPresent": False,
        "hubFingerprintManifestPresent": False,
    }
    base.update(patch)
    return base


class SignerOperationalReadinessTest(unittest.TestCase):
    def test_current_expected_state_is_precise_no_go(self):
        out = readiness.assess(approval(), custody(), runtime())
        self.assertTrue(out["approvalStoreSchemaReady"])
        self.assertFalse(out["realAal2ApprovalEvidenceAvailable"])
        self.assertTrue(out["systemdCustodyBaselineReady"])
        self.assertFalse(out["hostCredentialSecretSecure"])
        self.assertFalse(out["fourSignerCredentialMetadataSecure"])
        self.assertIn("REAL_AAL2_APPROVAL_INTENT_NOT_AVAILABLE", out["blockers"])
        self.assertIn("APPROVAL_READER_SOURCE_NOT_INSTALLED", out["blockers"])
        self.assertIn("APPROVAL_WRITER_SOURCE_NOT_INSTALLED", out["blockers"])
        self.assertIn("APPROVAL_INTENT_WRITER_NOT_INTEGRATED", out["blockers"])
        self.assertIn("APPROVAL_TRUSTED_READER_NOT_OPERATIONAL", out["blockers"])
        self.assertIn("SYSTEMD_HOST_CREDENTIAL_SECRET_NOT_PROVISIONED", out["blockers"])
        self.assertIn("FOUR_SIGNER_CREDENTIALS_NOT_PROVISIONED", out["blockers"])
        self.assertIn("HUB_CORE_ISSUER_TRUSTED_READ_ADAPTERS_NOT_OPERATIONAL", out["blockers"])
        self.assertFalse(out["signingPermitted"])
        self.assertFalse(out["operationalSigningReady"])
        self.assertEqual(out["releaseDecision"], "NO_GO")

    def test_even_all_metadata_present_cannot_claim_operational_signing(self):
        out = readiness.assess(
            approval(evidence=True),
            custody(host_secret=True, credentials=4),
            runtime(
                approvalReaderSourceInstalled=True,
                approvalWriterSourceInstalled=True,
                approvalWriterIntegrated=True,
                hubPublicTrustDirectoryPresent=True,
                hubFingerprintManifestPresent=True,
            ),
        )
        self.assertTrue(out["realAal2ApprovalEvidenceAvailable"])
        self.assertTrue(out["hostCredentialSecretSecure"])
        self.assertTrue(out["fourSignerCredentialMetadataSecure"])
        self.assertTrue(out["hubOperationalPublicTrustInstalled"])
        self.assertTrue(out["approvalReaderSourceInstalled"])
        self.assertTrue(out["approvalWriterSourceInstalled"])
        self.assertTrue(out["approvalWriterIntegrated"])
        self.assertTrue(out["approvalTrustedReaderOperational"])
        self.assertNotIn("APPROVAL_TRUSTED_READER_NOT_OPERATIONAL", out["blockers"])
        self.assertIn(
            "HUB_CORE_ISSUER_TRUSTED_READ_ADAPTERS_NOT_OPERATIONAL",
            out["blockers"],
        )
        self.assertIn("FOUR_SIGNER_RUNTIMES_NOT_MOUNTED", out["blockers"])
        self.assertFalse(out["hubCoreIssuerTrustedReadAdaptersOperational"])
        self.assertFalse(out["fourSignerRuntimesMounted"])
        self.assertFalse(out["operationalSigningReady"])
        self.assertFalse(out["dispatchPermitted"])

    def test_schema_or_custody_drift_is_reported_separately(self):
        out = readiness.assess(
            approval(schema=False),
            custody(baseline=False),
            runtime(),
        )
        self.assertIn("APPROVAL_STORE_SCHEMA_NOT_READY", out["blockers"])
        self.assertIn("SYSTEMD_CUSTODY_BASELINE_NOT_READY", out["blockers"])
        self.assertFalse(out["approvalStoreSchemaReady"])
        self.assertFalse(out["systemdCustodyBaselineReady"])

    def test_public_trust_requires_both_directory_and_manifest(self):
        for rt in (
            runtime(hubPublicTrustDirectoryPresent=True),
            runtime(hubFingerprintManifestPresent=True),
        ):
            out = readiness.assess(approval(), custody(), rt)
            self.assertFalse(out["hubOperationalPublicTrustInstalled"])
            self.assertIn("OPERATIONAL_PUBLIC_TRUST_NOT_INSTALLED", out["blockers"])

    def test_source_has_no_mutation_signing_or_credential_read_surface(self):
        source = SCRIPT.read_text()
        for forbidden in (
            "sqlite3.connect", "INSERT INTO", "UPDATE ", "DELETE FROM",
            "systemd-creds decrypt", "createPrivateKey", "Ed25519PrivateKey",
            "sign(", "open(", '"dispatchPermitted": True',
            '"operationalSigningReady": True',
        ):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
