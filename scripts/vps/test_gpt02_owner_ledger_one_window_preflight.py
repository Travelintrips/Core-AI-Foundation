"""Isolated synthetic tests: no database, Nginx, credentials or network."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).with_name("gpt02_owner_ledger_one_window_preflight.py")
spec = importlib.util.spec_from_file_location("gpt02_preflight", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PreflightTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.nginx = root / "dev.conf"
        self.enabled = root / "enabled"
        self.enabled.mkdir()
        self.worker = root / "worker.json"
        self.dba = root / "dba.json"
        self.nginx.write_text(module.LOCATION + "\n" + module.GATE +
                              "\nproxy_pass http://127.0.0.1:18082;\n")
        for path, role in ((self.worker, None), (self.dba, module.READER)):
            receipt = dict(project=module.PROJECT, principal=module.PRINCIPAL,
                           notBefore=1000, expiresAt=10000)
            if role:
                receipt["readerRole"] = role
            path.write_text(json.dumps({"receipt": receipt, "signature": "synthetic-only"}))

    def check(self, now=5000):
        return module.inspect(self.nginx, self.enabled, self.worker, self.dba, now)

    def test_current_metadata_cannot_claim_positive_e2e(self):
        result = self.check()
        self.assertTrue(result["worker"]["current"])
        self.assertTrue(result["dba"]["current"])
        self.assertFalse(result["worker"]["signature_verified"])
        self.assertFalse(result["ready_for_positive_e2e"])
        self.assertEqual(result["action"], "RETAIN_NGINX_503_GATE")

    def test_expired_receipt(self):
        self.assertFalse(self.check(10001)["dba"]["current"])

    def test_wrong_role_rejected(self):
        doc = json.loads(self.dba.read_text())
        doc["receipt"]["readerRole"] = "gpt02_owner_ledger_reader_dev"
        self.dba.write_text(json.dumps(doc))
        self.assertFalse(self.check()["dba"]["current"])

    def test_duplicate_vhost_detected(self):
        (self.enabled / "dev-ai-task.cstlogistic.co.id.old").write_text("server {}")
        self.assertEqual(self.check()["duplicate_vhost_files"], ["dev-ai-task.cstlogistic.co.id.old"])

    def test_missing_gate(self):
        self.nginx.write_text(module.LOCATION)
        self.assertFalse(self.check()["gate_exactly_once"])

    def test_bad_json(self):
        self.worker.write_text("{bad-json")
        self.assertFalse(self.check()["worker"]["current"])


if __name__ == "__main__":
    unittest.main()
