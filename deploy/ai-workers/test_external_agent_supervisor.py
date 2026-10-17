import importlib.util
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

os.environ.setdefault("AI_CORE_EXTERNAL_AGENT_CLIENT_ID", "test-dev-worker")
os.environ.setdefault("AI_CORE_EXTERNAL_AGENT_RUNTIME", "openclaw")
spec = importlib.util.spec_from_file_location("supervisor", Path(__file__).with_name("external-agent-supervisor.py"))
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)


class ConsumerRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.work = {"commandId": "command-1", "claimToken": "private-test-claim", "instruction": "test only"}

    def test_claim_empty_and_rejected_are_distinct(self):
        with patch.object(s, "_ai_core", return_value=(204, {})):
            self.assertIsNone(s.claim_work())
        for status in (401, 429, 500):
            with patch.object(s, "_ai_core", return_value=(status, {})):
                with self.assertRaises(RuntimeError):
                    s.claim_work()
        with patch.object(s, "_ai_core", return_value=(200, {})):
            with self.assertRaises(RuntimeError):
                s.claim_work()

    def test_result_rejection_cannot_be_success(self):
        with patch.object(s, "_ai_core", return_value=(503, {})):
            with self.assertRaises(RuntimeError):
                s.report_result(self.work, True, "output", {})

    def test_restart_preserves_exact_result_and_retries_only_delivery(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(s, "STATE_DIR", directory):
            pending = {"clientId": s.CLIENT_ID, "runtime": s.RUNTIME, "work": self.work,
                       "ok": True, "message": "real output", "details": {"evidenceStage": "JOB_COMPLETED"}}
            s.save_state("pending-result.json", pending)
            self.assertEqual((Path(directory) / "pending-result.json").stat().st_mode & 0o777, 0o600)
            restored = s.load_pending()
            self.assertEqual(restored, pending)
            with patch.object(s, "_ai_core", side_effect=[(503, {}), (200, {"ok": True})]) as api, patch.object(s, "execute") as execute:
                with self.assertRaises(RuntimeError):
                    s.deliver_pending(restored)
                self.assertEqual(s.load_pending(), pending)
                s.deliver_pending(s.load_pending())
                self.assertIsNone(s.load_pending())
                execute.assert_not_called()
                self.assertEqual(api.call_args_list[0], api.call_args_list[1])

    def test_foreign_outbox_is_not_delivered(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(s, "STATE_DIR", directory):
            s.save_state("pending-result.json", {"clientId": "different-worker", "runtime": s.RUNTIME})
            with self.assertRaises(RuntimeError):
                s.load_pending()

    def test_health_detects_stale_and_pending_delivery(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(s, "STATE_DIR", directory):
            self.assertEqual(s.healthcheck(), 1)
            s.mark_health("idle")
            self.assertEqual(s.healthcheck(), 0)
            s.mark_health("delivery_pending")
            self.assertEqual(s.healthcheck(), 1)
            s.save_state("health.json", {"state": "idle", "updatedAt": time.time() - 9999})
            self.assertEqual(s.healthcheck(), 1)

    def test_http_200_failed_incomplete_or_empty_response_is_rejected(self):
        with patch.object(s, "OPENCLAW_TOKEN", "test-token"):
            for result in ({"status": "failed"}, {"status": "incomplete", "output_text": "partial"}, {"status": "completed"}, {}):
                with patch.object(s, "_request", return_value=(200, result)):
                    with self.assertRaises(s.ExternalAgentExecutionError):
                        s.run_openclaw(self.work)

    def test_completed_response_retains_correlation_without_claiming_e2e(self):
        with patch.object(s, "OPENCLAW_TOKEN", "test-token"), patch.object(s, "_request", return_value=(200, {"id": "resp-1", "status": "completed", "output_text": "real output"})):
            message, details = s.run_openclaw(self.work)
        self.assertEqual(message, "real output")
        self.assertEqual(details["commandId"], "command-1")
        self.assertEqual(details["responseId"], "resp-1")
        self.assertEqual(details["evidenceStage"], "JOB_COMPLETED")


if __name__ == "__main__":
    unittest.main()
