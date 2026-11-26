#!/usr/bin/env python3
"""End-to-end integration with synthetic ledger, Ed25519 & temporary SQLite.

No real signer, live DB, executor permit, host/systemd or prod access.
"""
import importlib.util
import json
import sqlite3
import sys
import tempfile
import unittest
import uuid
from dataclasses import replace
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

root=Path(__file__).parent
names=("gpt02_relock_once_candidate","gpt02_owner_ledger_reader_candidate",
       "gpt02_relock_grant_verifier_candidate",
       "gpt02_relock_nonce_custody_candidate",
       "gpt02_relock_verified_chain_candidate",
       "test_gpt02_owner_ledger_reader_candidate",
       "test_gpt02_relock_grant_verifier_candidate",
       "test_gpt02_relock_once_candidate")
for name in names:
    if name not in sys.modules:
        spec=importlib.util.spec_from_file_location(name,root/(name+".py"))
        mod=importlib.util.module_from_spec(spec)
        sys.modules[name]=mod
        spec.loader.exec_module(mod)
o=sys.modules["gpt02_relock_once_candidate"]
n=sys.modules["gpt02_relock_nonce_custody_candidate"]
chain=sys.modules["gpt02_relock_verified_chain_candidate"]
ledger_test=sys.modules["test_gpt02_owner_ledger_reader_candidate"]
signature_test=sys.modules["test_gpt02_relock_grant_verifier_candidate"]
once_test=sys.modules["test_gpt02_relock_once_candidate"]


class VerifiedChainTests(unittest.TestCase):
    def setUp(self):
        self.row=ledger_test.make_row()
        self.private=Ed25519PrivateKey.generate()
        self.public=self.private.public_key().public_bytes(
            serialization.Encoding.Raw,serialization.PublicFormat.Raw)
        self.now=signature_test.NOW
        self.grant_payload=signature_test.payload()
        self.grant_payload["manifestSha256"]=self.row["manifest_sha256"]
        self.grant_payload["challengeId"]=self.row["challenge_id"]
        self.envelope=signature_test.sign(self.private,self.grant_payload)
        self.tmp=tempfile.TemporaryDirectory()
        self.conn=sqlite3.connect(str(Path(self.tmp.name)/"qa.sqlite3"),
                                  isolation_level=None,timeout=1)
        self.conn.execute("""CREATE TABLE gpt02_oneuse_claims(
            nonce TEXT PRIMARY KEY,challenge_id TEXT NOT NULL,
            manifest_digest TEXT NOT NULL,status TEXT NOT NULL)""")
        self.custodian=n.SQLiteNonceCustodyCandidate(self.conn)

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def reader(self,rows=None,key=None,envelope=None):
        return chain.VerifiedRelockDecisionAndGrant(
            read_only_ledger=ledger_test.FakeTrustedRead([self.row] if rows is None else rows),
            challenge_id=self.row["challenge_id"],
            load_pinned_executor_root=lambda: self.public if key is None else key,
            load_signed_grant_envelope=lambda: self.envelope if envelope is None else envelope,
            clock_ms=lambda: self.now)

    def test_end_to_end_synthetic_one_shot_with_durable_claim(self):
        relock=once_test.FakeRelock(once_test.state(False),once_test.state(True))
        result=o.run_once(self.reader(),self.custodian,relock)
        self.assertEqual(result["status"],"RELOCK_READBACK_PASS")
        self.assertEqual(result["releaseDecision"],"NO_GO")
        self.assertFalse(result["authorizationGranted"])
        self.assertFalse(result["signingPermitted"])
        self.assertFalse(result["dispatchPermitted"])
        self.assertEqual(relock.actions,1)
        self.assertEqual(self.conn.execute("SELECT status FROM gpt02_oneuse_claims").fetchone(),
                         ("RELOCK_READBACK_PASS",))

    def test_replay_cannot_repeat_executor_action(self):
        o.run_once(self.reader(),self.custodian,
                   once_test.FakeRelock(once_test.state(False),once_test.state(True)))
        repeat=once_test.FakeRelock(once_test.state(False),once_test.state(True))
        with self.assertRaisesRegex(o.GateDenied,"EXECUTOR_NONCE_REPLAY"):
            o.run_once(self.reader(),self.custodian,repeat)
        self.assertEqual(repeat.actions,0)

    def test_forged_ledger_denies_before_nonce_claim(self):
        row=dict(self.row);row["decision"]="REJECTED"
        relock=once_test.FakeRelock(once_test.state(False),once_test.state(True))
        with self.assertRaises(o.GateDenied):
            o.run_once(self.reader(rows=[row]),self.custodian,relock)
        self.assertEqual(relock.actions,0)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM gpt02_oneuse_claims").fetchone()[0],0)

    def test_wrong_pinned_key_fails_before_nonce_claim(self):
        wrong=Ed25519PrivateKey.generate().public_key().public_bytes(
            serialization.Encoding.Raw,serialization.PublicFormat.Raw)
        relock=once_test.FakeRelock(once_test.state(False),once_test.state(True))
        with self.assertRaisesRegex(o.GateDenied,"INVALID_EXECUTOR_SIGNATURE"):
            o.run_once(self.reader(key=wrong),self.custodian,relock)
        self.assertEqual(relock.actions,0)

    def test_tampered_signing_envelope_fails_before_claim(self):
        changed=dict(self.grant_payload);changed["principal"]="other"
        # Signature legitimately matches the test-only key; scope still fails.
        forged=signature_test.sign(self.private,changed)
        relock=once_test.FakeRelock(once_test.state(False),once_test.state(True))
        with self.assertRaises(o.GateDenied):
            o.run_once(self.reader(envelope=forged),self.custodian,relock)
        self.assertEqual(relock.actions,0)

    def test_partial_failure_writes_terminal_receipt_and_never_replays(self):
        failing=once_test.FakeRelock(once_test.state(False),once_test.state(True),error=True)
        with self.assertRaises(RuntimeError):
            o.run_once(self.reader(),self.custodian,failing)
        self.assertEqual(self.conn.execute("SELECT status FROM gpt02_oneuse_claims").fetchone(),
                         ("FAILED_RECONCILIATION_REQUIRED",))
        with self.assertRaisesRegex(o.GateDenied,"EXECUTOR_NONCE_REPLAY"):
            o.run_once(self.reader(),self.custodian,
                       once_test.FakeRelock(once_test.state(False),once_test.state(True)))


if __name__=="__main__":
    unittest.main()
