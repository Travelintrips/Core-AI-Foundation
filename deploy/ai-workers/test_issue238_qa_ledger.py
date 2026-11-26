import concurrent.futures
import os
import tempfile
import unittest
from pathlib import Path

from issue238_qa_permit import PermitDenied
from issue238_qa_ledger import reserve, finish, status


class DurableQaLedgerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "private"
        self.root.mkdir(mode=0o700)
        self.db = self.root / "qa.sqlite3"
        self.claims = {"nonce": "nonce-abc12345", "command_id": "CMD-abc12345", "job_id": "JOB-abc12345"}

    def tearDown(self):
        self.tmp.cleanup()

    def test_first_claim_and_terminal_receipt(self):
        digest = reserve(self.db, signed_claims=self.claims)
        self.assertEqual(len(digest), 64)
        self.assertEqual(status(self.db, self.claims["nonce"])["state"], "RESERVED")
        finish(self.db, nonce=self.claims["nonce"], command_id=self.claims["command_id"], receipt_digest="f"*64, state="PASS")
        self.assertEqual(status(self.db, self.claims["nonce"])["state"], "PASS")
        self.assertEqual(status(self.db, self.claims["nonce"])["receipt_digest"], "f"*64)
        self.assertEqual(self.db.stat().st_mode & 0o077, 0)

    def test_replayed_nonce_and_command_after_reopen_denied(self):
        reserve(self.db, signed_claims=self.claims)
        for claims in (dict(self.claims), {**self.claims, "command_id": "OTHER-command-123"},
                       {**self.claims, "nonce": "OTHER-nonce-123"}):
            with self.assertRaisesRegex(PermitDenied, "duplicate_nonce_or_command"):
                reserve(self.db, signed_claims=claims)

    def test_concurrent_duplicate_only_one_wins(self):
        def attempt(_):
            try:
                reserve(self.db, signed_claims=self.claims)
                return "ok"
            except PermitDenied:
                return "denied"
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
            results = list(ex.map(attempt, range(6)))
        self.assertEqual(results.count("ok"), 1)
        self.assertEqual(results.count("denied"), 5)

    def test_failure_and_unknown_are_terminal(self):
        for state in ("FAIL", "UNKNOWN"):
            with self.subTest(state=state):
                claims = {**self.claims, "nonce": "nonce-" + state + "-1234", "command_id": "CMD-" + state + "-1234"}
                reserve(self.db, signed_claims=claims)
                finish(self.db, nonce=claims["nonce"], command_id=claims["command_id"], receipt_digest="a"*64, state=state)
                self.assertEqual(status(self.db, claims["nonce"])["state"], state)
                with self.assertRaises(PermitDenied):
                    finish(self.db, nonce=claims["nonce"], command_id=claims["command_id"], receipt_digest="b"*64, state="PASS")

    def test_crash_before_finish_does_not_replay(self):
        reserve(self.db, signed_claims=self.claims)
        self.assertEqual(status(self.db, self.claims["nonce"])["state"], "RESERVED")
        with self.assertRaises(PermitDenied):
            reserve(self.db, signed_claims=self.claims)

    def test_bad_receipt_and_wrong_command_denied(self):
        reserve(self.db, signed_claims=self.claims)
        for digest in ("bad", "f"*63, "z"*64):
            with self.assertRaises(PermitDenied):
                finish(self.db, nonce=self.claims["nonce"], command_id=self.claims["command_id"], receipt_digest=digest, state="PASS")
        with self.assertRaises(PermitDenied):
            finish(self.db, nonce=self.claims["nonce"], command_id="CMD-wrong-id", receipt_digest="a"*64, state="PASS")
        self.assertEqual(status(self.db, self.claims["nonce"])["state"], "RESERVED")

    def test_public_directory_or_file_denied(self):
        self.root.chmod(0o755)
        with self.assertRaisesRegex(PermitDenied, "ledger_directory_not_private"):
            reserve(self.db, signed_claims=self.claims)
        self.root.chmod(0o700)
        reserve(self.db, signed_claims=self.claims)
        self.db.chmod(0o644)
        with self.assertRaisesRegex(PermitDenied, "ledger_file_not_private"):
            reserve(self.db, signed_claims={**self.claims, "nonce":"nonce-new1234", "command_id":"CMD-new1234"})

    def test_missing_ids_denied(self):
        for bad in (None, "", 9):
            with self.assertRaises(PermitDenied):
                reserve(self.db, signed_claims={**self.claims, "nonce": bad})

    def test_symlinked_db_path_denied(self):
        self.db.symlink_to(self.root / "other.db")
        with self.assertRaisesRegex(PermitDenied, "invalid_ledger_path"):
            reserve(self.db, signed_claims=self.claims)


if __name__ == "__main__":
    unittest.main(verbosity=2)
