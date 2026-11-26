import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

SOURCE = pathlib.Path(__file__).with_name("task190_host_readiness.py")
spec = importlib.util.spec_from_file_location("task190_readiness", SOURCE)
m = importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name] = m
spec.loader.exec_module(m)


class TestTask190HostReadiness(unittest.TestCase):
    def test_missing_live_gate_and_preparer_are_blocked(self):
        x = m.evaluate(m.Snapshot(True, True, False, False, True, True, False))
        self.assertIn("EXECUTION_GATE_SOCKET_PRESENT", x["blockers"])
        self.assertIn("SEALED_PREPARER_PRESENT", x["blockers"])
        self.assertFalse(x["canDispatch"])
        self.assertFalse(x["operationalE2ePass"])

    def test_even_all_host_fixtures_never_authorize(self):
        x = m.evaluate(m.Snapshot(True, True, True, True, True, True, True))
        self.assertEqual(x["blockers"], [])
        self.assertFalse(x["canSign"])
        self.assertFalse(x["canDispatch"])
        self.assertFalse(x["operationalE2ePass"])
        self.assertFalse(x["dbQueried"])

    def test_expired_worker_proof_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / "proof.json"
            path.write_text(json.dumps({"receipt": {
                "project": m.EXPECTED_PROJECT,
                "credentialId": m.EXPECTED_CREDENTIAL,
                "audience": "CST-DEV/GPT02/READER-CUSTODY/WORKER-ATTESTATION/v2",
                "notBefore": 100, "expiresAt": 200
            }, "signature": "s" * 86}))
            self.assertTrue(m.proof_is_current(path, 150))
            self.assertFalse(m.proof_is_current(path, 200))
            self.assertFalse(m.proof_is_current(path, 201))
            self.assertFalse(m.proof_is_current(path, 99))

    def test_wrong_identity_or_malformed_proof_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / "proof.json"
            path.write_text(json.dumps({"receipt": {
                "project": "wrong",
                "credentialId": m.EXPECTED_CREDENTIAL,
                "audience": "CST-DEV/GPT02/READER-CUSTODY/WORKER-ATTESTATION/v2",
                "notBefore": 100, "expiresAt": 200
            }, "signature": "s" * 86}))
            self.assertFalse(m.proof_is_current(path, 150))
            path.write_text("{bad json")
            self.assertFalse(m.proof_is_current(path, 150))

    def test_failure_state_never_claims_success(self):
        x = m.evaluate(m.Snapshot(False, False, False, False, False, False, False,
                                  ("HOST_PREFLIGHT_UNAVAILABLE",)))
        self.assertGreater(len(x["blockers"]), 1)
        self.assertFalse(x["canDispatch"])


if __name__ == "__main__":
    unittest.main()
