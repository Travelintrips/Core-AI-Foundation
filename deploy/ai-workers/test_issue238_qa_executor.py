import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from issue238_qa_integrity import IMAGE_NAME, QA_MANIFEST
from issue238_qa_ledger import reserve, status
from issue238_qa_permit import APPROVED_IMAGE_SHA256, PermitDenied
from issue238_qa_preflight import PreparedQa
from issue238_qa_executor import execute_reserved_qa, SAFE_ENV


class ScopedExecutorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "qa-sources"
        self.root.mkdir(mode=0o700)
        self.state = Path(self.tmp.name) / "state"
        self.state.mkdir(mode=0o700)
        self.ledger = self.state / "claims.sqlite3"
        self.sources = {name: ("synthetic data: "+name).encode() for name in QA_MANIFEST}
        self.manifest = {name: hashlib.sha256(data).hexdigest() for name,data in self.sources.items()}
        for name,data in self.sources.items():
            (self.root/name).write_bytes(data)
        self.patches = [
            patch("issue238_qa_integrity.QA_MANIFEST", self.manifest),
            patch("issue238_qa_executor.QA_MANIFEST", self.manifest),
        ]
        for p in self.patches:
            p.start()
        self.prepared = PreparedQa("CMD-issue238-001","JOB-issue238-001","nonce-issue238-001",
                                   "issue238-pg17-lock-expiry-concurrency-qa.sh",
                                   "sha256:"+APPROVED_IMAGE_SHA256,"synthetic-digest")
        self.claims = {
            "nonce":self.prepared.nonce,"command_id":self.prepared.command_id,
            "job_id":self.prepared.job_id,
        }
        digest = hashlib.sha256(json.dumps(self.claims, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        self.prepared = PreparedQa(self.prepared.command_id,self.prepared.job_id,self.prepared.nonce,
                                   self.prepared.script_name,self.prepared.image_id,digest)
        self.runner = Mock(return_value=SimpleNamespace(returncode=0,stdout="QA-SYNTHETIC",stderr=""))
        self.image = lambda: {"Id":"sha256:"+APPROVED_IMAGE_SHA256,"RepoTags":[IMAGE_NAME]}

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def execute(self, **extra):
        return execute_reserved_qa(
            self.prepared,ledger_path=self.ledger,source_root=self.root,
            trusted_image_inspection=self.image,run_process=self.runner,**extra)

    def test_no_exec_without_persisted_reservation(self):
        with self.assertRaises(PermitDenied): self.execute()
        self.runner.assert_not_called()

    def test_success_uses_no_shell_and_synthetic_free_env(self):
        reserve(self.ledger,signed_claims=self.claims)
        result = self.execute()
        self.assertEqual(result["state"],"PASS")
        self.assertEqual(status(self.ledger,self.prepared.nonce)["state"],"PASS")
        args,kw = self.runner.call_args
        self.assertEqual(args[0][0],"/usr/bin/bash")
        self.assertEqual(Path(args[0][1]).name,self.prepared.script_name)
        self.assertFalse(kw["shell"])
        self.assertEqual(kw["timeout"],360)
        self.assertEqual(kw["env"],SAFE_ENV)
        self.assertEqual(kw["env"]["ISSUE238_DBA_DISPOSABLE_QA_APPROVED"],"YES")
        self.assertTrue(kw["capture_output"])

    def test_failed_script_records_failure_once(self):
        reserve(self.ledger,signed_claims=self.claims)
        self.runner.return_value = SimpleNamespace(returncode=23,stdout="",stderr="synthetic failure")
        self.assertEqual(self.execute()["state"],"FAIL")
        with self.assertRaises(PermitDenied): self.execute()
        self.assertEqual(self.runner.call_count,1)

    def test_tampered_script_stops_before_exec(self):
        reserve(self.ledger,signed_claims=self.claims)
        (self.root/self.prepared.script_name).write_bytes(b"tampered")
        with self.assertRaises(PermitDenied): self.execute()
        self.runner.assert_not_called()
        self.assertEqual(status(self.ledger,self.prepared.nonce)["state"],"RESERVED")

    def test_image_changed_stops_before_exec(self):
        reserve(self.ledger,signed_claims=self.claims)
        self.image = lambda: {"Id":"sha256:"+"0"*64,"RepoTags":[IMAGE_NAME]}
        with self.assertRaises(PermitDenied):
            self.execute()
        self.runner.assert_not_called()

    def test_missing_or_forged_reservation_cannot_run(self):
        reserve(self.ledger,signed_claims=self.claims)
        other = PreparedQa("CMD-other123","JOB-other123",self.prepared.nonce,
                           self.prepared.script_name,self.prepared.image_id,"bad")
        with self.assertRaises(PermitDenied):
            execute_reserved_qa(other,ledger_path=self.ledger,source_root=self.root,
                                trusted_image_inspection=self.image,run_process=self.runner)
        self.runner.assert_not_called()

    def test_reject_forged_permit_digest(self):
        reserve(self.ledger,signed_claims=self.claims)
        forged = PreparedQa(self.prepared.command_id,self.prepared.job_id,self.prepared.nonce,
                            self.prepared.script_name,self.prepared.image_id,"0"*64)
        with self.assertRaisesRegex(PermitDenied, "durable_reservation_required"):
            execute_reserved_qa(forged,ledger_path=self.ledger,source_root=self.root,
                                trusted_image_inspection=self.image,run_process=self.runner)
        self.runner.assert_not_called()

    def test_reject_out_of_scope_script(self):
        reserve(self.ledger,signed_claims=self.claims)
        invalid = PreparedQa(self.prepared.command_id,self.prepared.job_id,self.prepared.nonce,
                             "ar-enable.sh",self.prepared.image_id,self.prepared.claims_digest)
        with self.assertRaises(PermitDenied):
            execute_reserved_qa(invalid,ledger_path=self.ledger,source_root=self.root,
                                trusted_image_inspection=self.image,run_process=self.runner)
        self.runner.assert_not_called()

    def test_nondefault_timeout_rejected(self):
        reserve(self.ledger,signed_claims=self.claims)
        with self.assertRaises(PermitDenied): self.execute(max_seconds=900)
        self.runner.assert_not_called()


if __name__=="__main__":
    unittest.main(verbosity=2)
