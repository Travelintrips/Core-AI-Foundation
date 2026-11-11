#!/usr/bin/env python3
import grp
import importlib.util
import json
import os
import pwd
import socket
import stat
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

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
        "hubCoreReaderRuntimeOperational": False,
        "issuerReaderRuntimeOperational": False,
        "hubCoreIssuerTrustedReadAdaptersOperational": False,
        "fourSignerRuntimesMounted": False,
        "fourSignerTrustedReaderConnectivityVerified": False,
        "fourSignerAuthorizersOperational": False,
        "approvalIntentTrustedReadCurrent": False,
    }
    base.update(patch)
    return base


class SignerOperationalReadinessTest(unittest.TestCase):
    def test_current_expected_state_is_precise_no_go(self):
        out = readiness.assess(approval(), custody(), runtime())
        self.assertTrue(out["approvalStoreSchemaReady"])
        self.assertFalse(out["realAdminApprovalEvidenceAvailable"])
        self.assertTrue(out["systemdCustodyBaselineReady"])
        self.assertFalse(out["hostCredentialSecretSecure"])
        self.assertFalse(out["fourSignerCredentialMetadataSecure"])
        self.assertIn("REAL_ADMIN_APPROVAL_INTENT_NOT_AVAILABLE", out["blockers"])
        self.assertIn("APPROVAL_READER_SOURCE_NOT_INSTALLED", out["blockers"])
        self.assertIn("APPROVAL_WRITER_SOURCE_NOT_INSTALLED", out["blockers"])
        self.assertIn("APPROVAL_INTENT_WRITER_NOT_INTEGRATED", out["blockers"])
        self.assertIn("APPROVAL_TRUSTED_READER_NOT_OPERATIONAL", out["blockers"])
        self.assertIn("SYSTEMD_HOST_CREDENTIAL_SECRET_NOT_PROVISIONED", out["blockers"])
        self.assertIn("FOUR_SIGNER_CREDENTIALS_NOT_PROVISIONED", out["blockers"])
        self.assertIn("HUB_CORE_TRUSTED_READER_RUNTIME_NOT_OPERATIONAL", out["blockers"])
        self.assertIn("ISSUER_TRUSTED_READER_RUNTIME_NOT_OPERATIONAL", out["blockers"])
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
                hubCoreReaderRuntimeOperational=True,
                issuerReaderRuntimeOperational=False,
                fourSignerRuntimesMounted=True,
            ),
        )
        self.assertTrue(out["realAdminApprovalEvidenceAvailable"])
        self.assertTrue(out["hostCredentialSecretSecure"])
        self.assertTrue(out["fourSignerCredentialMetadataSecure"])
        self.assertTrue(out["hubOperationalPublicTrustInstalled"])
        self.assertTrue(out["approvalReaderSourceInstalled"])
        self.assertTrue(out["approvalWriterSourceInstalled"])
        self.assertTrue(out["approvalWriterIntegrated"])
        self.assertTrue(out["approvalTrustedReaderOperational"])
        self.assertNotIn("APPROVAL_TRUSTED_READER_NOT_OPERATIONAL", out["blockers"])
        self.assertTrue(out["hubCoreReaderRuntimeOperational"])
        self.assertIn("ISSUER_TRUSTED_READER_RUNTIME_NOT_OPERATIONAL", out["blockers"])
        self.assertFalse(out["hubCoreIssuerTrustedReadAdaptersOperational"])
        self.assertTrue(out["fourSignerRuntimesMounted"])
        self.assertIn("FOUR_SIGNER_READER_CONNECTIVITY_NOT_VERIFIED", out["blockers"])
        self.assertIn("FOUR_SIGNER_AUTHORIZERS_NOT_INTEGRATED", out["blockers"])
        self.assertNotIn("FOUR_SIGNER_RUNTIMES_NOT_MOUNTED", out["blockers"])
        self.assertFalse(out["operationalSigningReady"])
        self.assertFalse(out["dispatchPermitted"])

    def test_signer_mount_pass_does_not_remove_trusted_reader_blocker(self):
        out = readiness.assess(
            approval(evidence=True),
            custody(host_secret=True, credentials=4),
            runtime(
                approvalReaderSourceInstalled=True,
                approvalWriterSourceInstalled=True,
                approvalWriterIntegrated=True,
                hubPublicTrustDirectoryPresent=True,
                hubFingerprintManifestPresent=True,
                fourSignerRuntimesMounted=True,
            ),
        )
        self.assertTrue(out["fourSignerRuntimesMounted"])
        self.assertFalse(out["hubCoreReaderRuntimeOperational"])
        self.assertFalse(out["issuerReaderRuntimeOperational"])
        self.assertIn("HUB_CORE_TRUSTED_READER_RUNTIME_NOT_OPERATIONAL", out["blockers"])
        self.assertIn("ISSUER_TRUSTED_READER_RUNTIME_NOT_OPERATIONAL", out["blockers"])
        self.assertFalse(out["hubCoreIssuerTrustedReadAdaptersOperational"])
        self.assertFalse(out["signingPermitted"])
        self.assertFalse(out["authorizationGranted"])
        self.assertFalse(out["dispatchPermitted"])
        self.assertEqual(out["releaseDecision"], "NO_GO")

    def test_hub_core_reader_runtime_requires_live_private_socket_health(self):
        with tempfile.TemporaryDirectory(prefix="gpt02-reader-health-") as root:
            directory = Path(root) / "gpt02-reader"
            directory.mkdir(mode=0o750)
            os.chmod(directory, 0o750)
            endpoint = directory / "reader.sock"
            server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            server.bind(str(endpoint))
            os.chmod(endpoint, 0o660)
            if os.getuid() == 0:
                nobody = pwd.getpwnam("nobody")
                os.chown(endpoint, nobody.pw_uid, os.getgid())
            body = json.dumps({
                "ok": True, "environment": "DEV", "readerReady": True,
                "hubRole": "gpt02_hub_evidence_reader",
                "coreRole": "gpt02_core_evidence_reader",
                "twoSessionsVerified": True,
                "signingPermitted": False, "dispatchPermitted": False,
            }).encode()
            response = (
                b"HTTP/1.1 200 OK\r\n"
                + f"content-length: {len(body)}\r\n".encode()
                + b"connection: close\r\n\r\n" + body
            )
            server.listen(1)

            def serve():
                conn, _ = server.accept()
                with conn:
                    request = conn.recv(2048)
                    if b"GET /health HTTP/1.1\r\n" in request:
                        conn.sendall(response)
                server.close()

            thread = threading.Thread(target=serve, daemon=True)
            thread.start()
            with patch.object(readiness, "HUB_CORE_READER_SOCKET_DIR", str(directory)), \
                 patch.object(readiness, "HUB_CORE_READER_SOCKET", str(endpoint)), \
                 patch.object(readiness.grp, "getgrnam", return_value=SimpleNamespace(gr_gid=os.getgid())), \
                 patch.object(readiness.subprocess, "run", return_value=SimpleNamespace(returncode=0)):
                self.assertTrue(readiness.hub_core_reader_runtime_operational())
            thread.join(timeout=2)

    def test_issuer_reader_source_has_exact_dynamicuser_mapping_allowlist(self):
        source = SCRIPT.read_text()
        self.assertIn('os.path.realpath(directory_path) != "/run/private/gpt02-issuer-reader"', source)
        self.assertIn('ISSUER_READER_SOCKET_DIR = "/run/gpt02-issuer-reader"', source)
        self.assertIn('endpoint.st_gid != signer_gid', source)
        self.assertIn('payload.get("tlsVerified") is True', source)

    def test_signer_runtime_mount_uses_exact_systemd_service_owner(self):
        user = pwd.getpwuid(os.getuid())
        group = grp.getgrgid(os.getgid())
        with tempfile.TemporaryDirectory(prefix="gpt02-signer-runtime-") as root:
            readiness.SIGNER_RUNTIME_ROOT = root
            payload = {
                "environment": "DEV",
                "algorithm": "Ed25519",
                "fingerprintMatched": True,
                "privateCredentialMounted": True,
                "hubCoreReaderOperational": True,
                "issuerReaderOperational": True,
                "trustedReaderConnectivityVerified": True,
                "authorizerOperational": False,
                "signingPermitted": False,
                "authorizationGranted": False,
                "dispatchPermitted": False,
                "releaseDecision": "NO_GO",
            }
            for role in readiness.SIGNER_ROLES:
                directory = Path(root) / f"gpt02-issue159-signer-{role}"
                directory.mkdir(mode=0o700)
                os.chmod(directory, 0o700)
                payload["role"] = role
                path = directory / "readiness.json"
                path.write_text(json.dumps(payload))
                os.chmod(path, 0o600)

            def systemctl(args, **kwargs):
                if args[1] == "is-active":
                    return SimpleNamespace(returncode=0, stdout="")
                if args[1] == "show" and args[2] == "-p" and args[3] == "User":
                    return SimpleNamespace(returncode=0, stdout=user.pw_name + "\n")
                if args[1] == "show" and args[2] == "-p" and args[3] == "Group":
                    return SimpleNamespace(returncode=0, stdout=group.gr_name + "\n")
                return SimpleNamespace(returncode=1, stdout="")

            with patch.object(readiness.subprocess, "run", side_effect=systemctl):
                self.assertTrue(readiness.signer_runtime_mounted())

            def wrong_owner(args, **kwargs):
                result = systemctl(args, **kwargs)
                if args[1] == "show" and args[3] == "User":
                    return SimpleNamespace(returncode=0, stdout="missing-gpt02-service-user\n")
                return result

            with patch.object(readiness.subprocess, "run", side_effect=wrong_owner):
                self.assertFalse(readiness.signer_runtime_mounted())

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
