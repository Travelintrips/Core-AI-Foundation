import json
import os
import grp
import sqlite3
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path

from gpt02_issue159_approval_intent_reader import read_approval_intent
from gpt02_issue159_approval_reader_runtime import _Handler, _UnixServer, _read_request


class ApprovalReaderRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.db=self.root/"tasks.db"
        self.now=int(time.time()*1000)
        self.lookup={
          "claimsSha256":"a"*64,
          "taskId":140,
          "commandId":"10000000-0000-4000-8000-000000000001",
          "attemptId":"20000000-0000-4000-8000-000000000002",
          "companyId":"default",
          "superAdminId":"sup-admin-fixture",
        }
        con=sqlite3.connect(self.db)
        con.executescript("""
        CREATE TABLE admin_identities(
          user_id TEXT PRIMARY KEY, role TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE gpt02_issue159_admin_operator_links(
          auth_user_id TEXT PRIMARY KEY,
          hub_operator_id TEXT NOT NULL UNIQUE,
          email TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE gpt02_issue159_approval_intents(
          id TEXT PRIMARY KEY, task_id INTEGER NOT NULL, command_id TEXT NOT NULL,
          attempt_id TEXT NOT NULL, company_id TEXT NOT NULL, claims_sha256 TEXT NOT NULL,
          actor_id TEXT NOT NULL, auth_method TEXT NOT NULL, role_at_decision TEXT NOT NULL,
          decision TEXT NOT NULL, recorded_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL
        );
        """)
        con.execute("INSERT INTO admin_identities VALUES(?,?,?)",("auth-fixture-user","super_admin",1))
        con.execute("INSERT INTO gpt02_issue159_admin_operator_links VALUES(?,?,?,?)",
                    ("auth-fixture-user",self.lookup["superAdminId"],"fixture@example.invalid",1))
        con.execute("""INSERT INTO gpt02_issue159_approval_intents VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",(
          "30000000-0000-4000-8000-000000000003",self.lookup["taskId"],
          self.lookup["commandId"],self.lookup["attemptId"],"default","a"*64,
          self.lookup["superAdminId"],"supabase_admin_session","super_admin","APPROVE",
          self.now-1000,self.now+120000
        ))
        con.commit();con.close()
        self.socket=self.root/"run"/"approval.sock"
        self.socket.parent.mkdir(mode=0o700)

    def tearDown(self):
        if getattr(self,"server",None):
            self.server.shutdown();self.server.server_close()
        self.tmp.cleanup()

    def _start_server(self):
        _Handler.approval_reader_fn=read_approval_intent
        _Handler.db_path=str(self.db)
        _Handler.operational=False
        self.server=_UnixServer(str(self.socket),_Handler)
        gid=os.getgid()
        os.chown(self.socket,os.getuid(),gid);os.chmod(self.socket,0o660)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()

    def _post(self,lookup=None,observed=None):
        body=json.dumps({"lookup":lookup or self.lookup,"observedAt":self.now if observed is None else observed},separators=(",",":")).encode()
        request=(b"POST /approval-intent HTTP/1.1\r\nHost: localhost\r\n"
                 b"Content-Type: application/json\r\nContent-Length: "+str(len(body)).encode()+
                 b"\r\nConnection: close\r\n\r\n"+body)
        c=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);c.settimeout(3)
        try:
            c.connect(str(self.socket));c.sendall(request);data=b""
            while True:
                part=c.recv(4096)
                if not part:break
                data+=part
        finally:c.close()
        header,_,raw=data.partition(b"\r\n\r\n")
        return int(header.split()[1]),json.loads(raw)

    def test_persisted_single_super_admin_approval_is_read_only(self):
        result=read_approval_intent(str(self.db),self.lookup,self.now,operational=False)
        self.assertTrue(result["persistedTrustedReadProven"])
        self.assertTrue(result["adminApprovalMatched"])
        self.assertFalse(result["aal2SuperAdminMatched"])
        self.assertFalse(result["signingPermitted"])
        self.assertFalse(result["authorizationGranted"])
        self.assertFalse(result["dispatchPermitted"])
        self.assertEqual(result["releaseDecision"],"NO_GO")

    def test_wrong_admin_or_expired_approval_fails_closed(self):
        wrong=dict(self.lookup);wrong["superAdminId"]="other-admin"
        self.assertFalse(read_approval_intent(str(self.db),wrong,self.now,operational=False)["persistedTrustedReadProven"])
        self.assertFalse(read_approval_intent(str(self.db),self.lookup,self.now+121000,operational=False)["persistedTrustedReadProven"])

    def test_socket_returns_approval_readback_without_authority(self):
        self._start_server()
        status,out=self._post()
        self.assertEqual(status,200,out)
        self.assertTrue(out["ok"])
        self.assertTrue(out["result"]["persistedTrustedReadProven"])
        self.assertTrue(out["approvalReadOnly"])
        self.assertFalse(out["decisionCreated"])
        self.assertFalse(out["signingPermitted"])
        self.assertFalse(out["authorizationGranted"])
        self.assertFalse(out["dispatchPermitted"])
        self.assertEqual(out["releaseDecision"],"NO_GO")

    def test_socket_missing_approval_returns_404(self):
        self._start_server()
        missing=dict(self.lookup);missing["claimsSha256"]="b"*64
        status,out=self._post(missing)
        self.assertEqual(status,404,out)
        self.assertFalse(out["ok"])
        self.assertEqual(out["releaseDecision"],"NO_GO")

    def test_socket_rejects_backdated_client_observation(self):
        self._start_server()
        status,out=self._post(observed=self.now-600000)
        self.assertEqual(status,400)
        self.assertEqual(out["releaseDecision"],"NO_GO")

    def test_socket_rejects_future_client_observation(self):
        self._start_server()
        status,out=self._post(observed=self.now+600000)
        self.assertEqual(status,400)
        self.assertEqual(out["releaseDecision"],"NO_GO")

    def test_socket_rejects_disabled_supabase_operator_mapping(self):
        self._start_server()
        con=sqlite3.connect(self.db)
        con.execute("UPDATE gpt02_issue159_admin_operator_links SET enabled=0")
        con.commit()
        con.close()
        status,out=self._post()
        self.assertEqual(status,404)
        self.assertFalse(out["ok"])
        self.assertEqual(out["releaseDecision"],"NO_GO")

    def test_source_has_no_write_or_signing_surface(self):
        source=Path(__file__).parents[2]/"deploy/ai-coding-standalone-dev/gpt02_issue159_approval_reader_runtime.py"
        body=source.read_text()
        for forbidden in ("INSERT INTO","UPDATE ","DELETE FROM","sqlite3.connect","Ed25519PrivateKey","key.sign(","psycopg","dispatch("):
            self.assertNotIn(forbidden,body)


if __name__=="__main__":unittest.main()
