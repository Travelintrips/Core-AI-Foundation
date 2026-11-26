import base64
import copy
import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("issue238_qa_permit", HERE / "issue238_qa_permit.py")
permit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(permit)


class PermitContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.sql = self.root / "reviewed.sql"
        self.sql.write_text("synthetic fixture: NO live SQL", encoding="utf-8")
        self.sha = hashlib.sha256(self.sql.read_bytes()).hexdigest()
        self.test_root = self.root / "tests"
        self.test_root.mkdir()
        (self.test_root / "issue238-pg17-lock-expiry-concurrency-qa.sh").write_text("# synthetic test only", encoding="utf-8")
        self.key = Ed25519PrivateKey.generate()
        self.claims = {
            "command_id": "CMD-issue238-123",
            "job_id": "JOB-issue238-123",
            "nonce": "nonce-issue238-123",
            "worker_id": permit.WORKER_ID,
            "operation": permit.OPERATION,
            "environment": "dev",
            "project_ref": permit.PROJECT_REF,
            "sql_sha256": self.sha,
            "image_sha256": permit.APPROVED_IMAGE_SHA256,
            "test": "issue238-pg17-lock-expiry-concurrency-qa.sh",
            "issued_at": 100000,
            "expires_at": 100100,
        }
        self.used = set()
        self.sha_patch = patch.object(permit, "APPROVED_SQL_SHA256", self.sha)
        self.sha_patch.start()

    def tearDown(self):
        self.sha_patch.stop()
        self.tmp.cleanup()

    def sign(self, claims=None):
        claims = copy.deepcopy(self.claims if claims is None else claims)
        return {"claims": claims, "signature": base64.b64encode(self.key.sign(permit.canonical_payload(claims))).decode("ascii")}

    def verify(self, envelope):
        return permit.verify_permit(envelope, public_key=self.key.public_key(),
                                    sql_source=self.sql, test_root=self.test_root,
                                    used_nonces=self.used, now=100010)

    def test_signed_exact_scope_is_only_a_verification_result(self):
        self.assertEqual(self.verify(self.sign()).name, self.claims["test"])
        self.assertEqual(len(self.used), 1)

    def test_unsigned_and_forged_payloads_fail(self):
        with self.assertRaises(permit.PermitDenied):
            self.verify({"claims": self.claims, "signature": "not-base64!"})
        with self.assertRaises(permit.PermitDenied):
            self.verify({"claims": {**self.claims, "operation": "anything"}, "signature": self.sign()["signature"]})

    def test_reject_cross_environment_project_and_worker(self):
        for key, value in (("environment", "prod"), ("project_ref", "nzdweipzckfszczzqtuw"),
                           ("worker_id", "other-worker"), ("operation", "grant-superuser"),
                           ("image_sha256", "0"*64)):
            with self.subTest(key=key):
                self.assertRaises(permit.PermitDenied, self.verify, self.sign({**self.claims, key: value}))

    def test_reject_unlisted_or_type_confused_test(self):
        for test in ("../../bad.sh", "issue238-any-command.sh", {}, []):
            with self.subTest(test=str(test)):
                self.assertRaises(permit.PermitDenied, self.verify, self.sign({**self.claims, "test": test}))

    def test_expired_or_unbounded_permit_fails(self):
        for issued, expires in ((100000,100005),(100000,100600),(99900,100100),(100200,100220)):
            self.assertRaises(permit.PermitDenied, self.verify, self.sign({**self.claims, "issued_at": issued, "expires_at": expires}))

    def test_duplicate_nonce_denied(self):
        self.verify(self.sign())
        self.assertRaisesRegex(permit.PermitDenied, "replay", self.verify, self.sign())

    def test_changed_sql_rejected(self):
        self.sql.write_text("changed synthetic SQL", encoding="utf-8")
        self.assertRaisesRegex(permit.PermitDenied, "unreviewed_sql_source", self.verify, self.sign())

    def test_missing_or_symlinked_test_rejected(self):
        target = self.test_root / self.claims["test"]
        target.unlink()
        self.assertRaises(permit.PermitDenied, self.verify, self.sign())
        target.symlink_to(self.sql)
        self.assertRaises(permit.PermitDenied, self.verify, self.sign())

    def test_missing_fields_and_empty_authority_denied(self):
        self.assertRaises(permit.PermitDenied, self.verify, None)
        self.assertRaises(permit.PermitDenied, self.verify, {"approval": True})
        self.assertRaises(permit.PermitDenied, self.verify, self.sign({**self.claims, "command_id": "x"}))


if __name__ == "__main__":
    unittest.main(verbosity=2)
