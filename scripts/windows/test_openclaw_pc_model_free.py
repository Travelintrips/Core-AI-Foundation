"""Model-free, fail-closed PC command regression tests."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

path = Path(__file__).with_name("openclaw-pc-work-consumer.py")
spec = importlib.util.spec_from_file_location("model_free_consumer", path)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class ModelFreeExecutionTests(unittest.TestCase):
    @patch.object(worker, "CLIENT_ID", "openclaw-pc-worker")
    @patch.object(worker.socket, "gethostname", return_value="Travelintrips")
    @patch.object(worker.subprocess, "run", side_effect=AssertionError("must not invoke a model"))
    def test_hostname_has_machine_proof_without_agent(self, run, _host):
        for instruction in ("hostname", "baca hostname PC Travelintrips", "cek hostname PC Travelintrips."):
            ok, response, details = worker.execute({"instruction": instruction})
            self.assertTrue(ok)
            self.assertEqual(response, "Travelintrips")
            self.assertEqual(details["hostname"], "Travelintrips")
            self.assertTrue(details["verified"])
            self.assertFalse(details["modelInvoked"])
            self.assertEqual(details["mode"], "model-free-hostname")
        run.assert_not_called()

    @patch.object(worker, "CLIENT_ID", "openclaw-pc-worker-2")
    @patch.object(worker.subprocess, "run", side_effect=AssertionError("must not invoke a model"))
    def test_wrong_worker_fails_closed(self, run):
        ok, _, proof = worker.execute({"instruction": "hostname"})
        self.assertFalse(ok)
        self.assertEqual(proof["reason"], "worker_target_mismatch")
        run.assert_not_called()

    @patch.object(worker, "CLIENT_ID", "openclaw-pc-worker")
    @patch.object(worker.subprocess, "run", side_effect=AssertionError("must not invoke a model"))
    def test_untrusted_extra_text_cannot_execute(self, run):
        for instruction in ("hostname && delete all", "hostname; powershell", "open browser and log in"):
            ok, _, proof = worker.execute({"instruction": instruction})
            self.assertFalse(ok)
            self.assertEqual(proof["reason"], "requires_ai_core_routing")
        run.assert_not_called()

    @patch.object(worker, "CLIENT_ID", "openclaw-pc-worker")
    @patch.object(worker.socket, "gethostname", return_value="WRONG-PC")
    def test_result_must_match_travelintrips(self, _host):
        ok, _, proof = worker.execute({"instruction": "hostname"})
        self.assertFalse(ok)
        self.assertFalse(proof["verified"])

    def test_callback_receipt_requires_command_status_and_persisted_id(self):
        command_id = "c" * 36
        proof = {"commandId": command_id, "status": "COMPLETED",
                 "response": {"id": "11111111-1111-4111-8111-111111111111"}}
        self.assertTrue(worker.verified_server_callback_receipt(proof, command_id, "COMPLETED"))
        self.assertFalse(worker.verified_server_callback_receipt({**proof, "response": {}}, command_id, "COMPLETED"))
        self.assertFalse(worker.verified_server_callback_receipt(proof, "different", "COMPLETED"))
        self.assertFalse(worker.verified_server_callback_receipt(proof, command_id, "FAILED"))


if __name__ == "__main__":
    unittest.main()
