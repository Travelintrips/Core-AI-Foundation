"""Unix peer-bound post-fence reader integration (synthetic-only, no live DB writes)."""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import socketserver
import tempfile
import threading
import unittest

from gpt02_issue159_writer_broker_contract import BrokerAdmissionError
from gpt02_issue159_writer_broker_runtime import _require_persisted_lineage
from test_gpt02_issue159_lineage_readback_contract import TrustedLineageReadbackTest


class FakeReaderHandler(socketserver.StreamRequestHandler):
    def handle(self):
        lookup = json.loads(self.rfile.readline(2049))
        self.server.requests.append(lookup)
        payload = {
            "environment": "DEV", "readOnly": True,
            "matched": len(self.server.rows) == 1,
            "rows": self.server.rows,
            "databaseWritePerformed": False,
            "signingPermitted": False,
            "authorizationGranted": False,
            "dispatchPermitted": False,
            "releaseDecision": "NO_GO",
        }
        if self.server.mutate:
            payload.update(self.server.mutate)
        self.wfile.write(json.dumps(payload, separators=(",", ":")).encode() + b"\\n")


class LineageSocketBridgeTests(unittest.TestCase):
    def setUp(self):
        self.synthetic = TrustedLineageReadbackTest()
        self.synthetic.setUp()
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name) / "socket-private"
        root.mkdir(mode=0o750)
        os.chmod(root, 0o750)
        self.path = root / "reader.sock"
        self.server = socketserver.UnixStreamServer(str(self.path), FakeReaderHandler)
        self.server.rows = [copy.deepcopy(self.synthetic.row)]
        self.server.requests = []
        self.server.mutate = {}
        os.chmod(self.path, 0o660)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def verified(self):
        fixture = self.synthetic.fixture
        return _require_persisted_lineage(
            fixture.packet, fixture.roots, fixture.link["approvalDigest"],
            str(self.path), fixture.now,
            reader_uid=os.getuid(), reader_gid=os.getgid())

    def test_bound_row_from_private_socket_verifies_but_never_authorizes(self):
        proof = self.verified()
        self.assertTrue(proof["trustedAdapterAuthenticated"])
        self.assertTrue(proof["persistedLineageMatched"])
        self.assertTrue(proof["fourSignaturesVerified"])
        self.assertTrue(proof["lineageReaderReadOnly"])
        for key in ("databaseWritePerformed", "nonceConsumed",
                    "leaseConsumed", "signingPermitted",
                    "authorizationGranted", "dispatchPermitted"):
            self.assertFalse(proof[key])
        self.assertEqual(proof["releaseDecision"], "NO_GO")
        lookup = self.server.requests[0]["lookup"]
        self.assertEqual(set(lookup), {
            "company_id", "task_id", "command_id",
            "attempt_id", "approval_digest"})
        self.assertNotIn("receipt_id", lookup)
        self.assertNotIn("fence_id", lookup)
        self.assertEqual(lookup["approval_digest"],
                         self.synthetic.fixture.link["approvalDigest"])

    def test_empty_or_inconsistent_row_is_denied(self):
        for rows in ([], [dict(self.synthetic.row, fence_id=
                                "70000000-0000-4000-8000-000000000098")]):
            with self.subTest(rows=rows):
                self.server.rows = copy.deepcopy(rows)
                with self.assertRaises(BrokerAdmissionError):
                    self.verified()

    def test_unauthorized_flags_fail_closed(self):
        self.server.mutate = {"dispatchPermitted": True}
        with self.assertRaises(BrokerAdmissionError):
            self.verified()

    def test_socket_mode_must_be_exact(self):
        os.chmod(self.path, 0o666)
        with self.assertRaisesRegex(RuntimeError, "LINEAGE_SOCKET_CUSTODY_INVALID"):
            self.verified()

    def test_peer_uid_is_pinned(self):
        fixture = self.synthetic.fixture
        with self.assertRaisesRegex(RuntimeError, "LINEAGE_SOCKET_CUSTODY_INVALID"):
            _require_persisted_lineage(
                fixture.packet, fixture.roots,
                fixture.link["approvalDigest"], str(self.path), fixture.now,
                reader_uid=os.getuid() + 1, reader_gid=os.getgid())


if __name__ == "__main__":
    unittest.main()
