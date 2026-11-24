"""Source-only runner contract tests. Never invokes Docker or PostgreSQL."""
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from subprocess import CompletedProcess, TimeoutExpired

from issue238_qa_permit import PermitDenied
from issue238_qa_preflight import AuthenticatedWork, PreparedQa
from issue238_qa_executor import run_approved_qa, BASH


class ExecutorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.test_name = "issue238-pg17-lock-expiry-concurrency-qa.sh"
        self.script = self.root / self.test_name
        self.script.write_text("#!/bin/bash\ntrue\n")
        self.prepared = PreparedQa(
            command_id="command123456", job_id="job12345678",
            nonce="nonce12345678", script_name=self.test_name,
            image_id="sha256:" + "a"*64, claims_digest="b"*64)
        self.kw = dict(
            identity=AuthenticatedWork("openclaw-vps-main",
                                       "command123456", "job12345678"),
            envelope={}, public_key=object(), source_root=self.root,
            ledger_path=self.root / "ledger.sqlite",
            image_inspection=lambda: {}, authenticated_executor=True)

    def test_reject_untrusted_without_preflight_or_shell(self):
        with patch("issue238_qa_executor.prepare_qa") as check:
            with self.assertRaisesRegex(PermitDenied, "trusted_executor_required"):
                run_approved_qa(**(self.kw | {"authenticated_executor": False}))
            check.assert_not_called()

    def test_reject_source_drift_before_subprocess(self):
        with patch("issue238_qa_executor.prepare_qa", return_value=self.prepared), \
             patch("issue238_qa_executor.subprocess.run") as run:
            with self.assertRaisesRegex(PermitDenied, "source_changed_after_reservation"):
                run_approved_qa(**self.kw)
            run.assert_not_called()

    def test_success_receipt_fixed_argv_without_shell(self):
        digest = hashlib.sha256(self.script.read_bytes()).hexdigest()
        fake_runner = Mock(return_value=CompletedProcess(
            [BASH,str(self.script)],0,"PASS synthetic",""))
        with patch.dict("issue238_qa_executor.QA_MANIFEST", {self.test_name: digest}), \
             patch("issue238_qa_executor.prepare_qa", return_value=self.prepared), \
             patch("issue238_qa_executor.finish") as finish:
            out=run_approved_qa(**(self.kw | {"command_runner":fake_runner}))
            self.assertEqual(out.state,"PASS")
            self.assertEqual(out.exit_code,0)
            args,kwargs=fake_runner.call_args
            self.assertEqual(args[0],[BASH,str(self.script)])
            self.assertIs(kwargs["shell"],False)
            self.assertEqual(kwargs["env"]["ISSUE238_APPROVED_SQL_SHA256"],
                             "0c7815ee6e9ffc9950ee1d7e5680e6debf8e11cd840074dd2991ec49fe6d79c4")
            self.assertNotIn("SUPABASE_DATABASE_URL",kwargs["env"])
            finish.assert_called_once()

    def test_timeout_is_unknown_without_retry(self):
        digest=hashlib.sha256(self.script.read_bytes()).hexdigest()
        mock_run=Mock(side_effect=TimeoutExpired("fixture",240))
        with patch.dict("issue238_qa_executor.QA_MANIFEST",{self.test_name:digest}), \
             patch("issue238_qa_executor.prepare_qa",return_value=self.prepared), \
             patch("issue238_qa_executor.finish") as finish:
            out=run_approved_qa(**(self.kw | {"command_runner":mock_run}))
            self.assertEqual(out.state,"UNKNOWN")
            self.assertEqual(mock_run.call_count,1)
            self.assertEqual(finish.call_args.kwargs["state"],"UNKNOWN")

    def test_failed_process_retains_fail_receipt(self):
        digest=hashlib.sha256(self.script.read_bytes()).hexdigest()
        mock_run=Mock(return_value=CompletedProcess([],73,"","approval missing"))
        with patch.dict("issue238_qa_executor.QA_MANIFEST",{self.test_name:digest}), \
             patch("issue238_qa_executor.prepare_qa",return_value=self.prepared), \
             patch("issue238_qa_executor.finish") as finish:
            out=run_approved_qa(**(self.kw | {"command_runner":mock_run}))
            self.assertEqual((out.state,out.exit_code),("FAIL",73))
            self.assertEqual(finish.call_args.kwargs["state"],"FAIL")
