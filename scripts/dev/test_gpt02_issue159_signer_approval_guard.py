"""Isolated tests for the existing one-shot approval signer trust gate.

Never loads production private keys or uses actual approval decisions. The
one-shot CLI remains non-operational until a fresh persisted admin approval.
"""
from __future__ import annotations
import copy
import grp
import json
import os
from pathlib import Path
import socketserver
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import gpt02_issue159_signer_approval_guard as gate


class FakeApprovalReader(socketserver.StreamRequestHandler):
    def handle(self):
        request = self.rfile.readline(100)
        if request != b"POST /approval-intent HTTP/1.1\r\n":
            return
        headers = {}
        while True:
            line = self.rfile.readline(4096)
            if line == b"\r\n":
                break
            key, _, value = line.partition(b":")
            headers[key.lower().strip()] = value.strip()
        length = int(headers[b"content-length"])
        msg = json.loads(self.rfile.read(length))
        self.server.lookups.append(msg)
        digest = msg["lookup"]["claimsSha256"]
        decision = {
            "claimsSha256": digest,
            "actorId": msg["lookup"]["superAdminId"],
            "decision": "APPROVE",
            "roleAtDecision": "super_admin",
            "authMethod": "supabase_admin_session",
            "recordedAt": int(time.time()*1000) - 1000,
        }
        decision.update(self.server.decision_override)
        response = {
            "ok": True, "environment": "DEV",
            "approvalReadOnly": True, "decisionCreated": False,
            "signingPermitted": False, "authorizationGranted": False,
            "dispatchPermitted": False, "releaseDecision": "NO_GO",
            "result": {
                "persistedTrustedReadProven": True,
                "approvalBindingMatched": True,
                "adminApprovalMatched": True,
                "decision": decision, "releaseDecision": "NO_GO",
            },
        }
        response.update(self.server.response_override)
        body = json.dumps(response, separators=(",", ":")).encode()
        self.wfile.write(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
            b"Content-Length: " + str(len(body)).encode()
            + b"\r\nConnection: close\r\n\r\n" + body)


class PersistedApprovalGateTest(unittest.TestCase):
    def setUp(self):
        self.now = int(time.time()*1000)
        self.claims = {
            "v": 2, "environment": "DEV",
            "audience": "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
            "taskId": 200,
            "commandId": "11111111-1111-4111-8111-111111111111",
            "attemptId": "22222222-2222-4222-8222-222222222222",
            "nonce": "A"*40,
            "operatorNamespace": "ai-task-hub.public.users",
            "superAdminId": "google_fixture_admin",
            "companyId": "default",
            "issuedAt": self.now - 2000,
            "expiresAt": self.now + 90000,
        }
        self.temp = tempfile.TemporaryDirectory()
        directory = Path(self.temp.name)/"reader"
        directory.mkdir()
        directory.chmod(0o750)
        self.sock = directory/"approval.sock"
        self.server = socketserver.UnixStreamServer(str(self.sock),FakeApprovalReader)
        self.sock.chmod(0o660)
        self.server.lookups = []
        self.server.decision_override = {}
        self.server.response_override = {}
        self.thread = threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def check(self, claims=None):
        group = type("Group", (), {"gr_gid": os.getgid()})()
        with patch.object(grp,"getgrnam",return_value=group):
            return gate.persisted_approval_fresh(
                self.claims if claims is None else claims,
                socket_path=str(self.sock), now_ms=self.now,
                reader_uid=os.getuid())

    def test_trusted_persisted_approval_readback(self):
        digest=self.check()
        self.assertEqual(digest,gate.canonical_sha(self.claims))
        self.assertEqual(len(self.server.lookups),1)
        lookup=self.server.lookups[0]["lookup"]
        self.assertEqual(set(lookup),{
            "claimsSha256","taskId","commandId","attemptId",
            "companyId","superAdminId"})
        self.assertEqual(lookup["taskId"],200)
        self.assertNotIn("approved",lookup)

    def test_expired_approval_fails_before_request(self):
        claims=copy.deepcopy(self.claims)
        claims["expiresAt"]=self.now-1
        with self.assertRaisesRegex(RuntimeError,"APPROVAL_SIGNER_INSUFFICIENT_VALIDITY"):
            self.check(claims)
        self.assertEqual(self.server.lookups,[])

    def test_approval_too_close_to_expiry_denied(self):
        claims=copy.deepcopy(self.claims)
        claims["expiresAt"]=self.now+29000
        with self.assertRaisesRegex(RuntimeError,"APPROVAL_SIGNER_INSUFFICIENT_VALIDITY"):
            self.check(claims)

    def test_stored_wrong_digest_denied(self):
        self.server.decision_override={"claimsSha256":"f"*64}
        with self.assertRaisesRegex(RuntimeError,"APPROVAL_READER_TRUSTED_BINDING_REQUIRED"):
            self.check()

    def test_stored_reject_decision_denied(self):
        self.server.decision_override={"decision":"REJECT"}
        with self.assertRaisesRegex(RuntimeError,"APPROVAL_READER_TRUSTED_BINDING_REQUIRED"):
            self.check()

    def test_mismatched_admin_denied(self):
        self.server.decision_override={"actorId":"other_admin"}
        with self.assertRaisesRegex(RuntimeError,"APPROVAL_READER_TRUSTED_BINDING_REQUIRED"):
            self.check()

    def test_fake_writer_authorization_denied(self):
        self.server.response_override={"dispatchPermitted":True}
        with self.assertRaisesRegex(RuntimeError,"APPROVAL_READER_TRUSTED_BINDING_REQUIRED"):
            self.check()

    def test_untrusted_socket_mode_denied(self):
        self.sock.chmod(0o666)
        with self.assertRaisesRegex(RuntimeError,"APPROVAL_READER_CUSTODY_DENIED"):
            self.check()

    def test_wrong_peer_owner_denied(self):
        group=type("Group", (), {"gr_gid": os.getgid()})()
        with patch.object(grp,"getgrnam",return_value=group):
            with self.assertRaisesRegex(RuntimeError,"APPROVAL_READER_CUSTODY_DENIED"):
                gate.persisted_approval_fresh(
                    self.claims, socket_path=str(self.sock),
                    now_ms=self.now,reader_uid=os.getuid()+1)


if __name__=="__main__":
    unittest.main()
