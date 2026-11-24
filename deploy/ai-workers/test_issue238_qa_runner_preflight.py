"""Isolated synthetic-only preflight tests, never Docker or hosted database."""
import base64
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from issue238_qa_permit import (
    APPROVED_IMAGE_SHA256, APPROVED_SQL_SHA256, WORKER_ID,
    canonical_payload, PermitDenied,
)
from issue238_qa_runner_preflight import preflight


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.private = self.root / "private"
        self.private.mkdir(mode=0o700)
        self.ledger = self.private / "claims.sqlite"
        self.src = self.root / "source.sql"
        self.test_root = self.root / "scripts"
        self.test_root.mkdir()
        self.test_name = "issue238-pg17-lock-expiry-concurrency-qa.sh"
        (self.test_root / self.test_name).write_text("exit 0\n")
        self.key = Ed25519PrivateKey.generate()
        self.cmd = "command_12345678"
        self.claims = {
            "command_id": self.cmd, "job_id": "job_12345678", "nonce": "nonce_12345678",
            "worker_id": WORKER_ID, "operation": "issue238-pg17-disposable-qa",
            "environment": "dev", "project_ref": "xssrfshdrtdfupgqwfdw",
            "sql_sha256": APPROVED_SQL_SHA256,
            "image_sha256": APPROVED_IMAGE_SHA256,
            "test": self.test_name, "issued_at": 1000, "expires_at": 1100,
        }
        self.kw = {
            "authenticated_worker_id": WORKER_ID,
            "authenticated_command_id": self.cmd,
            "public_key": self.key.public_key(), "sql_source": self.src,
            "test_root": self.test_root, "ledger_path": self.ledger,
            "image_metadata": {"Id": "sha256:" + APPROVED_IMAGE_SHA256, "RepoTags": ["cst-invoice-pgcron-qa:local"]},
            "now": 1050,
        }

    def signed(self):
        return {"claims": dict(self.claims),
                "signature": base64.b64encode(
                    self.key.sign(canonical_payload(self.claims))).decode()}

    def test_bad_worker_denied_without_reservation(self):
        with self.assertRaisesRegex(PermitDenied, "unauthenticated_worker"):
            preflight(envelope=self.signed(), **(self.kw | {"authenticated_worker_id": "attacker"}))
        self.assertFalse(self.ledger.exists())

    def test_unsigned_command_identity_denied(self):
        with self.assertRaisesRegex(PermitDenied, "command_identity_mismatch"):
            preflight(envelope=self.signed(), **(self.kw | {"authenticated_command_id": "different_123456"}))
        self.assertFalse(self.ledger.exists())

    def test_unattested_image_denied(self):
        with self.assertRaisesRegex(PermitDenied, "image_metadata_missing"):
            preflight(envelope=self.signed(), **(self.kw | {"image_metadata": None}))
        self.assertFalse(self.ledger.exists())

    def test_wrong_image_denied(self):
        with self.assertRaisesRegex(PermitDenied, "qa_image_digest_mismatch"):
            preflight(envelope=self.signed(), **(self.kw | {"image_metadata": {"Id": "sha256:" + "a"*64, "RepoTags": ["cst-invoice-pgcron-qa:local"]}}))
        self.assertFalse(self.ledger.exists())

    def test_missing_source_denied(self):
        with self.assertRaisesRegex(PermitDenied, "unreviewed_sql_source"):
            preflight(envelope=self.signed(), **self.kw)
        self.assertFalse(self.ledger.exists())

    def test_unprivileged_directory_denied(self):
        self.src.write_text("not-reviewed")
        with self.assertRaises(PermitDenied):
            preflight(envelope=self.signed(), **self.kw)
        self.assertFalse(self.ledger.exists())

    def test_tamper_denied(self):
        self.claims["test"] = "unknown.sh"
        with self.assertRaisesRegex(PermitDenied, "unreviewed_test"):
            preflight(envelope=self.signed(), **self.kw)
        self.assertFalse(self.ledger.exists())

    def test_valid_signed_synthetic_source_reserves_once(self):
        import hashlib
        from unittest.mock import patch
        from issue238_qa_ledger import status
        self.src.write_text("-- synthetic source only; no SQL execution\n")
        digest = hashlib.sha256(self.src.read_bytes()).hexdigest()
        self.claims["sql_sha256"] = digest
        # CI tests use an isolated fixture hash; production pins reviewed SHA.
        with patch("issue238_qa_permit.APPROVED_SQL_SHA256", digest), \
             patch("issue238_qa_runner_preflight.APPROVED_SQL_SHA256", digest), \
             patch("issue238_qa_runner_preflight.verify_source_manifest", return_value={self.test_name: "a"*64}):
            result = preflight(envelope=self.signed(), **self.kw)
            self.assertEqual(result["state"], "RESERVED")
            self.assertEqual(result["manifest"]["script"], self.test_name)
            self.assertEqual(status(self.ledger, self.claims["nonce"])["state"], "RESERVED")
            with self.assertRaisesRegex(PermitDenied, "duplicate_nonce_or_command"):
                preflight(envelope=self.signed(), **self.kw)

    def test_signed_source_and_image_not_enough_without_real_identity(self):
        self.src.write_text("-- synthetic source only\n")
        with self.assertRaisesRegex(PermitDenied, "unauthenticated_worker"):
            preflight(envelope=self.signed(), **(self.kw | {"authenticated_worker_id": None}))
        self.assertFalse(self.ledger.exists())

    def test_no_shell_or_docker_entrypoint(self):
        import issue238_qa_runner_preflight as module
        text = Path(module.__file__).read_text()
        self.assertNotIn("subprocess", text)
        self.assertNotIn("os.system", text)
        self.assertNotIn("docker run", text)
