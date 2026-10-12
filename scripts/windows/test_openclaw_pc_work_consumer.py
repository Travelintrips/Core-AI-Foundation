"""Regression tests for the bounded Travelintrips SSH diagnostic."""
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

MODULE = Path(__file__).with_name("openclaw-pc-work-consumer.py")
spec = importlib.util.spec_from_file_location("pc_consumer", MODULE)
consumer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(consumer)

INSTRUCTION = ("TEST_ONLY OpenClaw PC Travelintrips SSH read-only "
               "185.124.136.115:65002 whoami hostname")


class HostingerProofTests(unittest.TestCase):
    @patch.object(consumer, "CLIENT_ID", "openclaw-pc-worker")
    @patch.object(consumer.os.path, "isfile", return_value=True)
    @patch.object(consumer.subprocess, "run")
    def test_success_requires_exact_remote_output(self, run, _exists):
        run.return_value = subprocess.CompletedProcess([], 0, "u684045296\\nid-dci-web1320.main-hosting.eu\\n", "")
        ok, output, details = consumer.execute({"instruction": INSTRUCTION})
        self.assertTrue(ok)
        self.assertEqual(details["exitCode"], 0)
        self.assertTrue(details["sshVerified"])
        self.assertIn("id-dci-web1320", output)
        self.assertFalse(run.call_args.kwargs["shell"])

    @patch.object(consumer, "CLIENT_ID", "openclaw-pc-worker")
    @patch.object(consumer.os.path, "isfile", return_value=True)
    @patch.object(consumer.subprocess, "run")
    def test_agent_claim_without_ssh_output_is_failure(self, run, _exists):
        run.return_value = subprocess.CompletedProcess([], 0, "SSH completed successfully", "")
        ok, _, details = consumer.execute({"instruction": INSTRUCTION})
        self.assertFalse(ok)
        self.assertFalse(details["sshVerified"])

    @patch.object(consumer, "CLIENT_ID", "openclaw-pc-worker")
    @patch.object(consumer.os.path, "isfile", return_value=True)
    @patch.object(consumer.subprocess, "run")
    def test_nonzero_ssh_exit_is_failure(self, run, _exists):
        run.return_value = subprocess.CompletedProcess([], 255, "", "Permission denied")
        ok, _, details = consumer.execute({"instruction": INSTRUCTION})
        self.assertFalse(ok)
        self.assertEqual(details["exitCode"], 255)


if __name__ == "__main__":
    unittest.main()
