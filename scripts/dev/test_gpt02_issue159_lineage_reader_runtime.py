"""Synthetic tests of the staged, non-deployed private lineage reader runtime."""
import json
import os
import socket
import stat
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from gpt02_issue159_lineage_reader_runtime import (
    _credential_path, _Handler, _UnixServer, read_verified_lineage,
)


class _Info:
    user = "dev_gpt02_lineage_login"


class _Connection:
    def __init__(self, rows=()):
        self.info = _Info()
        self.autocommit = False
        self.rows = rows
        self.rollback_count = 0

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def rollback(self):
        self.rollback_count += 1

    def cursor(self):
        conn = self
        class Cursor:
            description = [type("Column", (), {"name": x})()
                           for x in __import__(
                               "gpt02_issue159_lineage_readback_contract"
                           ).ROW_FIELDS]
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def execute(self, sql, params=None):
                if sql.startswith("SET TRANSACTION READ ONLY"):
                    conn.ro = True
                if sql.startswith("SELECT") and not getattr(conn, "ro", False):
                    raise AssertionError("WRITEABLE_CONTEXT")
            def fetchmany(self, n):
                assert n == 3
                return conn.rows
        return Cursor()


class LineageRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.lookup = {
            "company_id": "default", "task_id": 140,
            "command_id": "10000000-0000-4000-8000-000000000001",
            "attempt_id": "20000000-0000-4000-8000-000000000002",
            "approval_digest": "a"*64,
        }

    def test_readonly_connection_has_no_authority(self):
        conn = _Connection()
        res = read_verified_lineage(self.lookup, connect=lambda: conn)
        self.assertEqual(res["rows"], [])
        self.assertFalse(res["matched"])
        self.assertFalse(res["databaseWritePerformed"])
        self.assertFalse(res["dispatchPermitted"])
        self.assertEqual(res["releaseDecision"], "NO_GO")
        self.assertEqual(conn.rollback_count, 1)

    def test_wrong_database_identity_rejected(self):
        conn = _Connection()
        conn.info = type("Info", (), {"user": "postgres"})()
        with self.assertRaisesRegex(RuntimeError, "LINEAGE_DB_IDENTITY_MISMATCH"):
            read_verified_lineage(self.lookup, connect=lambda: conn)

    def test_credential_is_mandatory_and_private(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "ENCRYPTED_CREDENTIAL_REQUIRED"):
                _credential_path()
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/"lineage-reader-dsn"
            p.write_text("synthetic")
            p.chmod(0o644)
            with mock.patch.dict(os.environ, {"CREDENTIALS_DIRECTORY": tmp}):
                with self.assertRaisesRegex(RuntimeError, "WORLD_ACCESS_DENIED"):
                    _credential_path()
            p.chmod(0o600)
            with mock.patch.dict(os.environ, {"CREDENTIALS_DIRECTORY": tmp}):
                self.assertEqual(_credential_path(), p)

    def test_no_arbitrary_receipt_fence_or_approved_flags(self):
        for name in ("receipt_id", "fence_id", "approved", "dispatchPermitted"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                read_verified_lineage({**self.lookup, name: True}, connect=_Connection)

    def test_socket_rejects_unapproved_unix_peer(self):
        with tempfile.TemporaryDirectory() as tmp:
            address=str(Path(tmp)/"reader.sock")
            former_uid=_Handler.allowed_uid
            former_fn=_Handler.read_fn
            try:
                _Handler.allowed_uid = os.getuid()+123
                _Handler.read_fn=staticmethod(lambda lookup: (_ for _ in ()).throw(
                    AssertionError("MUST_NOT_READ_DB")))
                with _UnixServer(address, _Handler) as server:
                    thread=threading.Thread(target=server.handle_request,daemon=True)
                    thread.start()
                    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
                        client.settimeout(2)
                        client.connect(address)
                        client.sendall(json.dumps({"lookup":self.lookup}).encode()+b"\n")
                        data=client.recv(2048)
                    thread.join(2)
                result=json.loads(data)
                self.assertEqual(result["reason"],"LINEAGE_LOOKUP_REJECTED")
                self.assertEqual(result["releaseDecision"],"NO_GO")
            finally:
                _Handler.allowed_uid=former_uid
                _Handler.read_fn=former_fn

    def test_socket_accepted_peer_only_receives_readonly_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            address=str(Path(tmp)/"reader.sock")
            former_uid=_Handler.allowed_uid
            former_fn=_Handler.read_fn
            try:
                _Handler.allowed_uid = os.getuid()
                _Handler.read_fn=staticmethod(
                    lambda lookup: read_verified_lineage(lookup,connect=_Connection))
                with _UnixServer(address, _Handler) as server:
                    thread=threading.Thread(target=server.handle_request,daemon=True)
                    thread.start()
                    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
                        client.settimeout(2)
                        client.connect(address)
                        client.sendall(json.dumps({"lookup":self.lookup}).encode()+b"\n")
                        data=client.recv(2048)
                    thread.join(2)
                result=json.loads(data)
                self.assertTrue(result["readOnly"])
                self.assertEqual(result["rows"],[])
                self.assertFalse(result["dispatchPermitted"])
            finally:
                _Handler.allowed_uid=former_uid
                _Handler.read_fn=former_fn


if __name__=="__main__":
    unittest.main()
