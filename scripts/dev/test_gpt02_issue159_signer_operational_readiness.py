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
        "issuerReaderBundleVerified": False,
        "authorizerAdaptersInstalled": False,
        "approvalIntentTrustedReadCurrent": False,
    }
    base.update(patch)
    return base


class SignerOperationalReadinessTest(unittest.TestCase):
    def test_authorizer_adapter_source_contracts_are_verified(self):
        markers = {
            "APPROVAL_API_SOURCE": [
                "issue159_identity_verifier",
                "handle_issue159_approval_intent(",
                "authMethod':'supabase_admin_session'",
            ],
            "APPROVAL_READER_SOURCE": [
                "def read_approval_intent(",
                'r["role_at_decision"] != "super_admin"',
                'r["decision"] != "APPROVE"',
                'r["auth_method"] not in ("supabase_admin_session", "supabase_aal2")',
            ],
            "HUB_CORE_AUTHORIZER_SOURCE": [
                "function mapFacts(",
                "SUPER_ADMIN_ASSIGNMENT_AUDIT_MISMATCH",
                "SIGNED_LINK_LEDGER_DIGEST_MISMATCH",
                "IMMUTABLE_PREPARATION_CONFIGURATION_MISMATCH",
            ],
        }
        with tempfile.TemporaryDirectory(prefix="gpt02-authorizer-sources-") as root:
            for name, values in markers.items():
                path = Path(root) / name
                path.write_text("\n".join(values), encoding="utf-8")
                setattr(readiness, name, path)
            bundle = Path(root) / "issuer-reader-runtime.mjs"
            bundle.write_text(
                "inspectGpt02Issue159IssuerAuthorizerEvidence(input) "
                "inspectGpt02Issue159IssuerAuthorizerEvidence({ "
                "GPT02_ISSUE159_NONCE_RECEIPT_BINDING_MISMATCH "
                "GPT02_ISSUE159_FENCE_BINDING_MISMATCH "
                "GPT02_ISSUE159_ISSUER_EVIDENCE_EXPIRED_OR_UNBOUND",
                encoding="utf-8",
            )
            with patch.object(readiness, "ISSUER_READER_BUNDLE", bundle), \
                 patch.object(readiness, "issuer_reader_bundle_matches_running_process", return_value=True):
                self.assertTrue(readiness.authorizer_adapters_installed())
                bundle.write_text("missing deployed adapter", encoding="utf-8")
                self.assertFalse(readiness.authorizer_adapters_installed())

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

    def test_authorizer_adapters_operational_requires_all_trusted_paths_but_not_a_live_approval(self):
        out = readiness.assess(
            approval(evidence=False),
            custody(host_secret=True, credentials=4),
            runtime(
                approvalReaderSourceInstalled=True,
                approvalWriterSourceInstalled=True,
                approvalWriterIntegrated=True,
                hubPublicTrustDirectoryPresent=True,
                hubFingerprintManifestPresent=True,
                hubCoreReaderRuntimeOperational=True,
                issuerReaderRuntimeOperational=True,
                fourSignerRuntimesMounted=True,
                fourSignerTrustedReaderConnectivityVerified=True,
                issuerReaderBundleVerified=True,
                authorizerAdaptersInstalled=True,
            ),
        )
        self.assertTrue(out["issuerReaderBundleVerified"])
        self.assertTrue(out["fourSignerAuthorizersOperational"])
        self.assertNotIn("FOUR_SIGNER_AUTHORIZERS_NOT_INTEGRATED", out["blockers"])
        self.assertIn("REAL_ADMIN_APPROVAL_INTENT_NOT_AVAILABLE", out["blockers"])
        self.assertFalse(out["signingPermitted"])
        self.assertFalse(out["authorizationGranted"])
        self.assertFalse(out["dispatchPermitted"])
        self.assertEqual(out["releaseDecision"], "NO_GO")

    def test_authorizer_adapter_blocker_remains_when_one_trusted_path_is_missing(self):
        out = readiness.assess(
            approval(evidence=False),
            custody(host_secret=True, credentials=4),
            runtime(
                approvalReaderSourceInstalled=True,
                approvalWriterSourceInstalled=True,
                approvalWriterIntegrated=True,
                hubPublicTrustDirectoryPresent=True,
                hubFingerprintManifestPresent=True,
                hubCoreReaderRuntimeOperational=True,
                issuerReaderRuntimeOperational=True,
                fourSignerRuntimesMounted=True,
                fourSignerTrustedReaderConnectivityVerified=True,
                issuerReaderBundleVerified=False,
                authorizerAdaptersInstalled=False,
            ),
        )
        self.assertFalse(out["issuerReaderBundleVerified"])
        self.assertFalse(out["fourSignerAuthorizersOperational"])
        self.assertIn("FOUR_SIGNER_AUTHORIZERS_NOT_INTEGRATED", out["blockers"])
        self.assertIn("REAL_ADMIN_APPROVAL_INTENT_NOT_AVAILABLE", out["blockers"])
        self.assertFalse(out["signingPermitted"])
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
            if os.getuid() == 0:
                nobody = pwd.getpwnam("nobody")
                os.chown(directory, nobody.pw_uid, os.getgid())
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

    def test_hub_core_reader_accepts_only_exact_dynamicuser_systemd_alias(self):
        source = SCRIPT.read_text()
        start = source.index("def hub_core_reader_runtime_operational():")
        end = source.index("def issuer_reader_runtime_operational():", start)
        function = source[start:end]
        self.assertIn('os.path.realpath(directory_path) != "/run/private/gpt02-reader"', function)
        self.assertIn("entry.st_uid != 0 or entry.st_gid != 0", function)
        self.assertIn("directory.st_gid != signer_gid", function)
        self.assertIn("endpoint.st_gid != signer_gid", function)
        self.assertIn('payload.get("readerReady") is True', function)
        self.assertNotIn("client.settimeout(35)", function)

    def test_issuer_reader_source_has_exact_dynamicuser_mapping_allowlist(self):
        source = SCRIPT.read_text()
        self.assertIn('os.path.realpath(directory_path) != "/run/private/gpt02-issuer-reader"', source)
        self.assertIn('ISSUER_READER_SOCKET_DIR = "/run/gpt02-issuer-reader"', source)
        self.assertIn('endpoint.st_gid != signer_gid', source)
        self.assertIn('payload.get("tlsVerified") is True', source)

    def test_issuer_health_probe_uses_http_crlf_not_literal_backslashes(self):
        source = SCRIPT.read_text()
        start = source.index('def issuer_reader_runtime_operational():')
        end = source.index('def authorizer_adapters_installed(', start)
        function = source[start:end]
        slash = chr(92)
        self.assertIn('b"GET /health HTTP/1.1' + slash + 'r' + slash + 'n"', function)
        self.assertNotIn(slash + slash + 'r' + slash + slash + 'n', function)
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

    def test_signer_runtime_mount_uses_dynamicuser_runtime_directory_owner(self):
        group_name = "gpt02-issue159-signers"
        with tempfile.TemporaryDirectory(prefix="gpt02-dynamic-signer-") as root:
            readiness.SIGNER_RUNTIME_ROOT = root
            runtime_uid = pwd.getpwnam("nobody").pw_uid if os.getuid() == 0 else os.getuid()
            gid = os.getgid()
            for role in readiness.SIGNER_ROLES:
                directory = Path(root) / f"gpt02-issue159-signer-{role}"
                directory.mkdir(mode=0o700)
                os.chmod(directory, 0o700)
                payload = {
                    "environment": "DEV",
                    "role": role,
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
                path = directory / "readiness.json"
                path.write_text(json.dumps(payload))
                os.chmod(path, 0o600)
                if os.getuid() == 0:
                    os.chown(directory, runtime_uid, gid)
                    os.chown(path, runtime_uid, gid)

            def dynamic_systemctl(args, **kwargs):
                if args[1] == "is-active":
                    return SimpleNamespace(returncode=0, stdout="")
                if args[1] == "show" and args[2] == "-p" and args[3] == "User":
                    return SimpleNamespace(returncode=0, stdout="")
                if args[1] == "show" and args[2] == "-p" and args[3] == "Group":
                    return SimpleNamespace(returncode=0, stdout=group_name)
                return SimpleNamespace(returncode=1, stdout="")

            with patch.object(readiness.subprocess, "run", side_effect=dynamic_systemctl):
                with patch.object(readiness.grp, "getgrnam", return_value=SimpleNamespace(gr_gid=gid)):
                    self.assertTrue(readiness.signer_runtime_mounted())

    def test_signer_runtime_mount_accepts_only_exact_systemd_runtime_symlinks(self):
        group_name = "gpt02-issue159-signers"
        with tempfile.TemporaryDirectory(prefix="gpt02-dynamic-signer-link-") as root:
            readiness.SIGNER_RUNTIME_ROOT = root
            private = Path(root) / "private"
            private.mkdir(mode=0o700)
            runtime_uid = pwd.getpwnam("nobody").pw_uid if os.getuid() == 0 else os.getuid()
            gid = os.getgid()
            link_paths = {}
            for role in readiness.SIGNER_ROLES:
                target = private / f"gpt02-issue159-signer-{role}"
                target.mkdir(mode=0o700)
                os.chmod(target, 0o700)
                payload = {
                    "environment": "DEV",
                    "role": role,
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
                ready = target / "readiness.json"
                ready.write_text(json.dumps(payload))
                os.chmod(ready, 0o600)
                if os.getuid() == 0:
                    os.chown(target, runtime_uid, gid)
                    os.chown(ready, runtime_uid, gid)
                link = Path(root) / target.name
                link.symlink_to(target, target_is_directory=True)
                link_paths[str(link)] = "/run/private/" + target.name

            def dynamic_systemctl(args, **kwargs):
                if args[1] == "is-active":
                    return SimpleNamespace(returncode=0, stdout="")
                if args[1] == "show" and args[2] == "-p" and args[3] == "User":
                    return SimpleNamespace(returncode=0, stdout="")
                if args[1] == "show" and args[2] == "-p" and args[3] == "Group":
                    return SimpleNamespace(returncode=0, stdout=group_name)
                return SimpleNamespace(returncode=1, stdout="")

            real_lstat = os.lstat
            def systemd_lstat(value):
                key = str(value)
                if key in link_paths:
                    return SimpleNamespace(st_mode=stat.S_IFLNK | 0o777, st_uid=0, st_gid=0)
                return real_lstat(value)

            real_realpath = os.path.realpath
            def systemd_realpath(value):
                return link_paths.get(str(value), real_realpath(value))

            with patch.object(readiness.subprocess, "run", side_effect=dynamic_systemctl):
                with patch.object(readiness.grp, "getgrnam", return_value=SimpleNamespace(gr_gid=gid)):
                    with patch.object(readiness.os, "lstat", side_effect=systemd_lstat):
                        with patch.object(readiness.os.path, "realpath", side_effect=systemd_realpath):
                            self.assertTrue(readiness.signer_runtime_mounted())

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



class IssuerReaderBundleRuntimeBindingTest(unittest.TestCase):
    def setUp(self):
        self.original_bundle = readiness.ISSUER_READER_BUNDLE
        self.temp = tempfile.TemporaryDirectory(prefix="gpt02-issuer-bundle-")
        self.bundle = Path(self.temp.name) / "gpt02-issuer-reader-runtime.mjs"
        self.bundle.write_text("// deployed issuer reader bundle", encoding="utf-8")
        readiness.ISSUER_READER_BUNDLE = self.bundle

    def tearDown(self):
        readiness.ISSUER_READER_BUNDLE = self.original_bundle
        self.temp.cleanup()

    def check_binding(self, *, bundle_mtime_ns, command_path=None):
        real_lstat = os.lstat
        real_read_bytes = Path.read_bytes
        real_read_text = Path.read_text

        def fake_lstat(path):
            if os.fspath(path) == str(self.bundle):
                return SimpleNamespace(
                    st_mode=stat.S_IFREG | 0o755,
                    st_uid=0,
                    st_gid=0,
                    st_mtime_ns=bundle_mtime_ns,
                )
            return real_lstat(path)

        def fake_read_bytes(path):
            if str(path) == "/proc/4242/cmdline":
                target = command_path if command_path is not None else str(self.bundle)
                return b"/usr/bin/node\0" + os.fsencode(target) + b"\0"
            return real_read_bytes(path)

        def fake_read_text(path, *args, **kwargs):
            if str(path) == "/proc/4242/stat":
                rest = ["S"] + ["0"] * 18 + ["5000"]
                return "4242 (node runtime) " + " ".join(rest)
            if str(path) == "/proc/uptime":
                return "1000.00 0.00"
            return real_read_text(path, *args, **kwargs)

        def fake_run(args, **kwargs):
            if args[:3] == ["systemctl", "is-active", "--quiet"]:
                return SimpleNamespace(returncode=0, stdout="")
            if args[:4] == ["systemctl", "show", "-p", "MainPID"]:
                return SimpleNamespace(returncode=0, stdout="4242\n")
            return SimpleNamespace(returncode=1, stdout="")

        with patch.object(readiness.os, "lstat", side_effect=fake_lstat), \
             patch.object(readiness.Path, "read_bytes", new=fake_read_bytes), \
             patch.object(readiness.Path, "read_text", new=fake_read_text), \
             patch.object(readiness.subprocess, "run", side_effect=fake_run), \
             patch.object(readiness.os, "sysconf", return_value=100), \
             patch.object(readiness.time, "time", return_value=2000.0):
            return readiness.issuer_reader_bundle_matches_running_process()

    def test_accepts_only_bundle_loaded_before_running_process_start(self):
        self.assertTrue(self.check_binding(bundle_mtime_ns=1_040_000_000_000))
        self.assertFalse(self.check_binding(bundle_mtime_ns=1_060_000_000_000))

    def test_rejects_process_running_a_different_bundle_path(self):
        self.assertFalse(
            self.check_binding(
                bundle_mtime_ns=1_040_000_000_000,
                command_path="/opt/old/gpt02-issuer-reader-runtime.mjs",
            )
        )

    def test_authorizer_probe_uses_deployed_bundle_and_live_process_attestation(self):
        with tempfile.TemporaryDirectory(prefix="gpt02-authorizer-sources-") as root:
            root_path = Path(root)
            approval_api = root_path / "approval_api.py"
            approval_reader = root_path / "approval_reader.py"
            hub_core = root_path / "hub_core.mjs"
            bundle = root_path / "issuer-reader-runtime.mjs"
            approval_api.write_text(
                "issue159_identity_verifier handle_issue159_approval_intent( "
                "authMethod':'supabase_admin_session'",
                encoding="utf-8",
            )
            approval_reader.write_text(
                'def read_approval_intent( r["role_at_decision"] != "super_admin" '
                'r["decision"] != "APPROVE" '
                'r["auth_method"] not in ("supabase_admin_session", "supabase_aal2")',
                encoding="utf-8",
            )
            hub_core.write_text(
                "function mapFacts( SUPER_ADMIN_ASSIGNMENT_AUDIT_MISMATCH "
                "SIGNED_LINK_LEDGER_DIGEST_MISMATCH "
                "IMMUTABLE_PREPARATION_CONFIGURATION_MISMATCH",
                encoding="utf-8",
            )
            bundle.write_text(
                "inspectGpt02Issue159IssuerAuthorizerEvidence(input) "
                "inspectGpt02Issue159IssuerAuthorizerEvidence({ "
                "GPT02_ISSUE159_NONCE_RECEIPT_BINDING_MISMATCH "
                "GPT02_ISSUE159_FENCE_BINDING_MISMATCH "
                "GPT02_ISSUE159_ISSUER_EVIDENCE_EXPIRED_OR_UNBOUND",
                encoding="utf-8",
            )
            with patch.object(readiness, "APPROVAL_API_SOURCE", approval_api), \
                 patch.object(readiness, "APPROVAL_READER_SOURCE", approval_reader), \
                 patch.object(readiness, "HUB_CORE_AUTHORIZER_SOURCE", hub_core), \
                 patch.object(readiness, "ISSUER_READER_BUNDLE", bundle), \
                 patch.object(readiness, "issuer_reader_bundle_matches_running_process", return_value=True):
                self.assertTrue(readiness.authorizer_adapters_installed())
                bundle.write_text(
                    "inspectGpt02Issue159IssuerAuthorizerEvidence(input) "
                    "inspectGpt02Issue159IssuerAuthorizerEvidence({ "
                    "GPT02_ISSUE159_NONCE_RECEIPT_BINDING_MISMATCH",
                    encoding="utf-8",
                )
                self.assertFalse(readiness.authorizer_adapters_installed())


if __name__ == "__main__":
    unittest.main()
