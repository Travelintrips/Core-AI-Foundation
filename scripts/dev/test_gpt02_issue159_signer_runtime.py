import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
import hashlib
import importlib.util
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / "deploy/ai-coding-standalone-dev/gpt02_issue159_signer_runtime.py"
UNIT = ROOT / "deploy/ai-coding-standalone-dev/gpt02-issue159-signer@.service"
APPROVAL_READER_UNIT = ROOT / "deploy/ai-coding-standalone-dev/gpt02-issue159-approval-reader.service"
ISSUER_RUNTIME = ROOT / "scripts/dev/gpt02-issuer-reader-runtime.ts"
ROLES = ("approval", "hub", "core", "issuer")


def fixture(root: Path):
    creds = root / "creds"
    runtime = root / "run"
    creds.mkdir()
    runtime.mkdir()
    keys = {}
    manifest = {}
    for role in ROLES:
        key = Ed25519PrivateKey.generate()
        keys[role] = key
        der = key.public_key().public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        manifest[role] = hashlib.sha256(der).hexdigest()
    (creds / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return creds, runtime, keys, manifest


class RuntimeBoundaryTest(unittest.TestCase):
    def run_once(self, role, creds, runtime):
        env = dict(os.environ)
        env.update({
            "GPT02_ISSUE159_SIGNER_ROLE": role,
            "GPT02_ISSUE159_SIGNING_ENABLED": "false",
            "CREDENTIALS_DIRECTORY": str(creds),
            "RUNTIME_DIRECTORY": str(runtime),
        })
        return subprocess.run(
            [sys.executable, str(RUNTIME), "--once"],
            env=env, capture_output=True, text=True, timeout=5,
        )

    def test_each_role_matches_reviewed_public_fingerprint_but_stays_no_go(self):
        for role in ROLES:
            with self.subTest(role=role), tempfile.TemporaryDirectory() as td:
                root = Path(td)
                creds, runtime, keys, manifest = fixture(root)
                private_der = keys[role].private_bytes(
                    serialization.Encoding.DER,
                    serialization.PrivateFormat.PKCS8,
                    serialization.NoEncryption(),
                )
                (creds / "private-key.pkcs8").write_bytes(private_der)
                result = self.run_once(role, creds, runtime)
                self.assertEqual(result.returncode, 0, result.stderr)
                data = json.loads((runtime / "readiness.json").read_text())
                self.assertEqual(data["role"], role)
                self.assertTrue(data["fingerprintMatched"])
                self.assertTrue(data["privateCredentialMounted"])
                self.assertFalse(data["businessEvidenceRead"])
                self.assertFalse(data["hubCoreReaderOperational"])
                self.assertFalse(data["issuerReaderOperational"])
                self.assertFalse(data["approvalReaderOperational"])
                self.assertFalse(data["trustedReaderConnectivityVerified"])
                self.assertFalse(data["authorizerOperational"])
                self.assertFalse(data["signingPermitted"])
                self.assertFalse(data["authorizationGranted"])
                self.assertFalse(data["dispatchPermitted"])
                self.assertEqual(data["releaseDecision"], "NO_GO")

    def test_wrong_key_or_signing_enable_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            creds, runtime, keys, manifest = fixture(root)
            wrong = Ed25519PrivateKey.generate().private_bytes(
                serialization.Encoding.DER,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
            (creds / "private-key.pkcs8").write_bytes(wrong)
            result = self.run_once("issuer", creds, runtime)
            self.assertEqual(result.returncode, 2)
            self.assertIn("GPT02_ISSUE159_PRIVATE_PUBLIC_FINGERPRINT_MISMATCH", result.stderr)
            self.assertFalse((runtime / "readiness.json").exists())

            private_der = keys["issuer"].private_bytes(
                serialization.Encoding.DER,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
            (creds / "private-key.pkcs8").write_bytes(private_der)
            env = dict(os.environ, GPT02_ISSUE159_SIGNER_ROLE="issuer",
                       GPT02_ISSUE159_SIGNING_ENABLED="true",
                       CREDENTIALS_DIRECTORY=str(creds),
                       RUNTIME_DIRECTORY=str(runtime))
            result = subprocess.run([sys.executable, str(RUNTIME), "--once"],
                                    env=env, capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 2)
            self.assertIn("GPT02_ISSUE159_SIGNING_MUST_REMAIN_DISABLED", result.stderr)

    def test_issuer_probe_uses_valid_random_readonly_negative_lineage(self):
        spec = importlib.util.spec_from_file_location("signer_runtime", RUNTIME)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        payload = module._issuer_probe_payload()
        claims = payload["claims"]
        self.assertEqual(set(payload), {"claims", "observedAt"})
        self.assertEqual(claims["audience"], "GPT02_ISSUER_LEASE_EVIDENCE_V1")
        self.assertEqual(claims["environment"], "DEV")
        self.assertEqual(claims["issuerRole"], "dev_gpt02_issuer_evidence")
        self.assertEqual(len({
            claims[k] for k in (
                "hubExecutionId", "coreTaskId", "commandId", "attemptId",
                "receiptId", "linkId", "fenceId",
            )
        }), 7)
        self.assertEqual(claims["issuedAt"], payload["observedAt"] - 1000)
        self.assertEqual(claims["expiresAt"], payload["observedAt"] + 5000)

        hub_response = (400, {
            "code": "UNTRUSTED_TASK_IDENTITY",
            "signingPermitted": False,
            "dispatchPermitted": False,
        })
        issuer_response = (409, {
            "ok": False,
            "environment": "DEV",
            "result": {
                "reason": "ISSUER_LEDGER_MISSING_OR_NOT_UNIQUE",
                "readOnlySessionVerified": True,
                "issuerLedgerMatched": False,
                "persistedTrustedReadProven": False,
                "signingPermitted": False,
                "authorizationGranted": False,
                "dispatchPermitted": False,
                "commandCreated": False,
                "releaseDecision": "NO_GO",
            },
            "signingPermitted": False,
            "authorizationGranted": False,
            "dispatchPermitted": False,
            "releaseDecision": "NO_GO",
        })
        approval_response = (409, {
            "environment": "DEV", "ok": False, "persistedTrustedReadProven": False,
            "result": {
                "reason": "APPROVAL_INTENT_NOT_UNIQUE_OR_MISSING",
                "approvalBindingMatched": False, "adminApprovalMatched": False,
            },
            "signingPermitted": False, "authorizationGranted": False,
            "dispatchPermitted": False, "releaseDecision": "NO_GO",
        })
        with patch.object(module, "_issuer_probe_payload", return_value=payload), \
             patch.object(module, "_unix_json_request", side_effect=[hub_response, issuer_response, approval_response]) as request:
            result = module._probe_trusted_readers()
        self.assertTrue(result["hubCoreReaderOperational"])
        self.assertTrue(result["issuerReaderOperational"])
        self.assertTrue(result["approvalReaderOperational"])
        self.assertTrue(result["trustedReaderConnectivityVerified"])
        self.assertTrue(result["authorizerOperational"])
        self.assertEqual(request.call_args_list[1].args[2], payload)
        self.assertEqual(request.call_args_list[2].args[0], "/run/gpt02-approval-reader/reader.sock")

    def test_approval_probe_uses_valid_random_negative_admin_lookup(self):
        spec = importlib.util.spec_from_file_location("signer_runtime_approval_probe", RUNTIME)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        payload = module._approval_probe_payload()
        self.assertEqual(set(payload), {"lookup", "observedAtMs"})
        self.assertEqual(set(payload["lookup"]), {
            "claimsSha256", "taskId", "commandId", "attemptId", "companyId", "superAdminId",
        })
        self.assertEqual(payload["lookup"]["taskId"], 2_147_483_647)
        self.assertEqual(payload["lookup"]["companyId"], "default")
        self.assertEqual(len(payload["lookup"]["claimsSha256"]), 64)
        self.assertNotEqual(payload["lookup"]["commandId"], payload["lookup"]["attemptId"])

    def test_approval_reader_negative_probe_is_part_of_authorizer_readiness(self):
        spec = importlib.util.spec_from_file_location("signer_runtime_approval_check", RUNTIME)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        hub_response = (400, {"code": "UNTRUSTED_TASK_IDENTITY", "signingPermitted": False, "dispatchPermitted": False})
        issuer_response = (409, {"ok": False, "environment": "DEV", "result": {
            "reason": "ISSUER_LEDGER_MISSING_OR_NOT_UNIQUE", "readOnlySessionVerified": True,
            "issuerLedgerMatched": False, "persistedTrustedReadProven": False,
            "signingPermitted": False, "authorizationGranted": False,
            "dispatchPermitted": False, "releaseDecision": "NO_GO",
        }, "signingPermitted": False, "authorizationGranted": False,
            "dispatchPermitted": False, "releaseDecision": "NO_GO"})
        approval_response = (409, {"environment": "DEV", "ok": False,
            "persistedTrustedReadProven": False, "result": {
                "reason": "APPROVAL_INTENT_NOT_UNIQUE_OR_MISSING",
                "approvalBindingMatched": False, "adminApprovalMatched": False,
            }, "signingPermitted": False, "authorizationGranted": False,
            "dispatchPermitted": False, "releaseDecision": "NO_GO"})
        with patch.object(module, "_unix_json_request", side_effect=[hub_response, issuer_response, approval_response]) as request:
            result = module._probe_trusted_readers()
        self.assertTrue(result["hubCoreReaderOperational"])
        self.assertTrue(result["issuerReaderOperational"])
        self.assertTrue(result["approvalReaderOperational"])
        self.assertTrue(result["trustedReaderConnectivityVerified"])
        self.assertTrue(result["authorizerOperational"])
        self.assertEqual(request.call_args_list[2].args[0], "/run/gpt02-approval-reader/reader.sock")
    def test_runtime_source_has_no_signing_network_db_or_secret_output_surface(self):
        source = RUNTIME.read_text()
        for forbidden in (
            ".sign(", "http://", "https://", "requests.",
            "sqlite3", "psycopg", "subprocess", "print(key", "private_bytes(",
            '"dispatchPermitted": true', '"signingPermitted": true',
            "socket.AF_INET", "socket.AF_INET6", "socket.listen(",
        ):
            self.assertNotIn(forbidden, source, forbidden)
        self.assertIn("socket.AF_UNIX", source)
        self.assertIn("client.settimeout(35)", source)
        self.assertIn('os.path.realpath(parent_path) != "/run/private/gpt02-issuer-reader"', source)
        self.assertIn('socket_path == "/run/gpt02-approval-reader/reader.sock"', source)

    def test_issuer_runtime_accepts_only_safe_systemd_dynamicuser_mapping(self):
        source = ISSUER_RUNTIME.read_text()
        self.assertIn("resolved !== expected", source)
        self.assertIn('path.join("/run/private", path.basename(parent))', source)
        self.assertIn("[0o700, 0o755].includes(privateRootMode)", source)
        self.assertIn("(privateRootMode & 0o022) !== 0", source)
        self.assertIn("privateRoot.uid !== 0 || privateRoot.gid !== 0", source)
    def test_approval_reader_unit_is_read_only_root_scoped_and_unix_only(self):
        unit = APPROVAL_READER_UNIT.read_text()
        for required in (
            "User=root",
            "Group=gpt02-issue159-signers",
            "RuntimeDirectory=gpt02-approval-reader",
            "RuntimeDirectoryMode=0750",
            "PrivateNetwork=yes",
            "RestrictAddressFamilies=AF_UNIX",
            "ReadOnlyPaths=/opt/ai-coding-standalone-dev/tasks.db",
            "ReadWritePaths=/run/gpt02-approval-reader",
            "NoNewPrivileges=yes",
            "CapabilityBoundingSet=",
        ):
            self.assertIn(required, unit)
        self.assertNotIn("ReadWritePaths=/opt", unit)
    def test_systemd_unit_mounts_only_encrypted_private_credential_and_manifest(self):
        unit = UNIT.read_text()
        for required in (
            "DynamicUser=yes",
            "GPT02_ISSUE159_SIGNING_ENABLED=false",
            "LoadCredentialEncrypted=private-key.pkcs8:/etc/credstore.encrypted/gpt02-issue159-%i-private-key.pkcs8",
            "LoadCredential=manifest.json:/etc/gpt02-dev/trust-fingerprints.json",
            "PrivateNetwork=yes",
            "ProtectSystem=strict",
            "ProtectHome=yes",
            "CapabilityBoundingSet=",
            "RestrictAddressFamilies=AF_UNIX",
            "SupplementaryGroups=gpt02-issue159-signers",
            "BindReadOnlyPaths=/run/gpt02-reader",
            "BindReadOnlyPaths=/run/gpt02-issuer-reader",
            "BindReadOnlyPaths=/run/gpt02-approval-reader",
            "ConditionPathExists=/run/gpt02-reader/reader.sock",
            "ConditionPathExists=/run/gpt02-issuer-reader/reader.sock",
            "ConditionPathExists=/run/gpt02-approval-reader/reader.sock",
            "Requires=gpt02-issue159-issuer-reader.service gpt02-issue159-approval-reader.service",
            "PartOf=gpt02-issue159-issuer-reader.service gpt02-issue159-approval-reader.service",
            "MemoryDenyWriteExecute=yes",
        ):
            self.assertIn(required, unit, required)
        for forbidden in (
            "EnvironmentFile=", "AI_TASK", "SUPABASE_DATABASE_URL",
            "ExecStartPre=systemd-creds decrypt", "ReadWritePaths=/etc",
        ):
            self.assertNotIn(forbidden, unit, forbidden)


if __name__ == "__main__":
    unittest.main()
