#!/usr/bin/env python3
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
PROBE = ROOT / "scripts/dev/gpt02_issue159_private_key_custody_readiness.py"

spec = importlib.util.spec_from_file_location("custody_probe", PROBE)
probe = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(probe)


class PrivateKeyCustodyReadinessTest(unittest.TestCase):
    def layout(self, *, four=False, bad_mode=False):
        root = tempfile.TemporaryDirectory(prefix="issue159-custody-")
        self.addCleanup(root.cleanup)
        store = Path(root.name) / "credstore.encrypted"
        store.mkdir(mode=0o700)
        os.chmod(store, 0o700)
        secret = Path(root.name) / "credential.secret"
        secret.write_bytes(b"metadata-test-only")
        os.chmod(secret, 0o600)
        if four:
            for role, name in probe.NAMES.items():
                p = store / name
                p.write_bytes(("ciphertext-" + role).encode())
                os.chmod(p, 0o644 if bad_mode and role == "issuer" else 0o600)
        return store, secret

    def test_empty_secure_store_is_baseline_ready_but_not_operational(self):
        store, secret = self.layout()
        with patch.object(probe, "_systemd_version", return_value=255),              patch.object(probe.shutil, "which", return_value="/usr/bin/systemd-creds"):
            out = probe.inspect(str(store), str(secret), operational=False)
        self.assertEqual(
            out["reason"], "CUSTODY_METADATA_BASELINE_READY_NO_SIGNING_AUTHORITY"
        )
        self.assertEqual(out["signerCredentialPresentCount"], 0)
        self.assertFalse(out["fourSignerCredentialMetadataSecure"])
        self.assertFalse(out["privateCredentialBytesRead"])
        self.assertFalse(out["hostMetadataIndependentlyAttested"])
        self.assertFalse(out["operationalCustodyReady"])
        self.assertFalse(out["signingPermitted"])
        self.assertFalse(out["authorizationGranted"])
        self.assertFalse(out["dispatchPermitted"])
        self.assertEqual(out["releaseDecision"], "NO_GO")

    def test_four_secure_file_metadata_still_never_grants_authority(self):
        store, secret = self.layout(four=True)
        with patch.object(probe, "_systemd_version", return_value=255),              patch.object(probe.shutil, "which", return_value="/usr/bin/systemd-creds"):
            out = probe.inspect(str(store), str(secret), operational=False)
        self.assertEqual(out["signerCredentialPresentCount"], 4)
        self.assertTrue(out["fourSignerCredentialMetadataSecure"])
        self.assertFalse(out["privateCredentialBytesRead"])
        self.assertFalse(out["hostMetadataIndependentlyAttested"])
        self.assertFalse(out["signerRuntimeMounted"])
        self.assertFalse(out["operationalCustodyReady"])
        self.assertFalse(out["signingPermitted"])

    def test_insecure_file_metadata_or_old_systemd_fails_baseline(self):
        store, secret = self.layout(four=True, bad_mode=True)
        with patch.object(probe, "_systemd_version", return_value=255),              patch.object(probe.shutil, "which", return_value="/usr/bin/systemd-creds"):
            out = probe.inspect(str(store), str(secret), operational=False)
        self.assertEqual(out["reason"], "CUSTODY_METADATA_BASELINE_NOT_READY")

        store2, secret2 = self.layout()
        with patch.object(probe, "_systemd_version", return_value=251),              patch.object(probe.shutil, "which", return_value="/usr/bin/systemd-creds"):
            out = probe.inspect(str(store2), str(secret2), operational=False)
        self.assertEqual(out["reason"], "CUSTODY_METADATA_BASELINE_NOT_READY")

    def test_operational_paths_are_pinned(self):
        store, secret = self.layout()
        out = probe.inspect(str(store), str(secret), operational=True)
        self.assertEqual(out["reason"], "OPERATIONAL_CUSTODY_PATH_NOT_PINNED")
        self.assertFalse(out["operationalCustodyReady"])
        self.assertFalse(out["signingPermitted"])

    def test_source_never_reads_or_decrypts_credential_bytes(self):
        source = PROBE.read_text()
        for forbidden in (
            "systemd-creds cat", "systemd-creds decrypt", "systemd-creds setup",
            "createPrivateKey", "Ed25519PrivateKey", "sign(",
            "open(path", "Path(path).read", '"privateCredentialBytesRead": True',
        ):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
