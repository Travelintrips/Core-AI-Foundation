import base64
import copy
import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from issue238_qa_integrity import IMAGE_NAME, QA_MANIFEST
from issue238_qa_ledger import status
from issue238_qa_permit import APPROVED_IMAGE_SHA256, PermitDenied, canonical_payload
from issue238_qa_preflight import AuthenticatedWork, prepare_qa


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "source"
        self.root.mkdir(mode=0o700)
        self.state = Path(self.tmp.name) / "private"
        self.state.mkdir(mode=0o700)
        self.ledger = self.state / "claims.sqlite3"
        self.originals = {name: ("synthetic-qa-" + name).encode() for name in QA_MANIFEST}
        for name, data in self.originals.items():
            (self.root / name).write_bytes(data)
        self.manifest = {name: hashlib.sha256(data).hexdigest() for name, data in self.originals.items()}
        self.key = Ed25519PrivateKey.generate()
        self.identity = AuthenticatedWork("openclaw-vps-main", "CMD-issue238-123", "JOB-issue238-123")
        self.claims = {
            "command_id": self.identity.durable_command_id,
            "job_id": self.identity.durable_job_id,
            "nonce": "nonce-issue238-123",
            "worker_id": self.identity.authenticated_worker_id,
            "operation": "issue238-pg17-disposable-qa",
            "environment": "dev",
            "project_ref": "xssrfshdrtdfupgqwfdw",
            "sql_sha256": self.manifest["issue238-postgres17-relock.sql"],
            "image_sha256": APPROVED_IMAGE_SHA256,
            "test": "issue238-pg17-lock-expiry-concurrency-qa.sh",
            "issued_at": 200000,
            "expires_at": 200090,
        }
        self.patchers = [
            patch("issue238_qa_integrity.QA_MANIFEST", self.manifest),
            patch("issue238_qa_permit.APPROVED_SQL_SHA256", self.manifest["issue238-postgres17-relock.sql"]),
        ]
        for p in self.patchers:
            p.start()

    def tearDown(self):
        for p in reversed(self.patchers):
            p.stop()
        self.tmp.cleanup()

    def envelope(self, claims=None):
        claims = copy.deepcopy(self.claims if claims is None else claims)
        return {"claims": claims, "signature": base64.b64encode(self.key.sign(canonical_payload(claims))).decode()}

    def prepare(self, envelope=None, identity=None, inspect=None, **kwargs):
        return prepare_qa(
            identity=self.identity if identity is None else identity,
            envelope=self.envelope() if envelope is None else envelope,
            custodian_public_key=self.key.public_key(),
            source_root=self.root, ledger_path=self.ledger,
            trusted_image_inspection=inspect if inspect is not None else lambda: {
                "Id": "sha256:" + APPROVED_IMAGE_SHA256, "RepoTags": [IMAGE_NAME]},
            now=200010, expected_owner_uid=os.getuid(), **kwargs,
        )

    def test_integrated_preflight_reserves_without_executing(self):
        result = self.prepare()
        self.assertEqual(result.status, "RESERVED_NOT_EXECUTED")
        self.assertEqual(result.script_name, self.claims["test"])
        self.assertEqual(status(self.ledger, self.claims["nonce"])["state"], "RESERVED")

    def test_replay_refused_after_reopen(self):
        self.prepare()
        with self.assertRaisesRegex(PermitDenied, "duplicate_nonce_or_command"):
            self.prepare()

    def test_wrong_authenticated_worker_and_job_denied_without_reservation(self):
        for identity in (
            AuthenticatedWork("other-worker", self.identity.durable_command_id, self.identity.durable_job_id),
            AuthenticatedWork(self.identity.authenticated_worker_id, "CMD-other-123", self.identity.durable_job_id),
            AuthenticatedWork(self.identity.authenticated_worker_id, self.identity.durable_command_id, "JOB-other-123"),
        ):
            with self.subTest(identity=identity):
                with self.assertRaises(PermitDenied):
                    self.prepare(identity=identity)
                self.assertFalse(self.ledger.exists())

    def test_unsigned_tampered_scope_denied(self):
        envelope = self.envelope()
        envelope["claims"]["project_ref"] = "nzdweipzckfszczzqtuw"
        with self.assertRaises(PermitDenied):
            self.prepare(envelope=envelope)
        self.assertFalse(self.ledger.exists())

    def test_changed_source_denied_before_reservation(self):
        (self.root / "issue238-pgcron164-scheduler-crash-qa.sh").write_bytes(b"tampered")
        with self.assertRaises(PermitDenied):
            self.prepare()
        self.assertFalse(self.ledger.exists())

    def test_untrusted_image_denied_before_reservation(self):
        with self.assertRaises(PermitDenied):
            self.prepare(inspect=lambda: {"Id": "sha256:"+"0"*64, "RepoTags": [IMAGE_NAME]})
        self.assertFalse(self.ledger.exists())

    def test_missing_trusted_image_callback_denied(self):
        with self.assertRaises(PermitDenied):
            prepare_qa(identity=self.identity, envelope=self.envelope(),
                       custodian_public_key=self.key.public_key(), source_root=self.root,
                       ledger_path=self.ledger, trusted_image_inspection=None, now=200010,
                       expected_owner_uid=os.getuid())
        self.assertFalse(self.ledger.exists())

    def test_expired_permit_denied_before_reservation(self):
        with self.assertRaises(PermitDenied):
            self.prepare(envelope=self.envelope({**self.claims, "expires_at": 200009}))
        self.assertFalse(self.ledger.exists())

    def test_not_an_executable_runner(self):
        source = (Path(__file__).with_name("issue238_qa_preflight.py")).read_text()
        for command in ("subprocess.run(", "docker run", "os.system(", "pg_connect(", "cron.schedule("):
            self.assertNotIn(command, source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
