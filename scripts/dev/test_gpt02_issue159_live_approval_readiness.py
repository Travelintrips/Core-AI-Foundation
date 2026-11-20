"""Offline tests for a read-only, fail-closed approval inventory gate."""
from __future__ import annotations
import sqlite3
import tempfile
import unittest
from pathlib import Path

import importlib.util

_SOURCE = Path(__file__).with_name("gpt02_issue159_live_approval_readiness.READONLY.py")
_SPEC = importlib.util.spec_from_file_location("gpt02_issue159_approval_readiness_gate", _SOURCE)
assert _SPEC is not None and _SPEC.loader is not None
_MOD = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MOD)
readiness = _MOD.readiness

NOW = 1_800_000_000_000


class ApprovalReadinessTest(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        self.root = Path(td.name)
        self.db = self.root / "synthetic.sqlite"
        self.pending = self.root / "pending.json"
        with sqlite3.connect(self.db) as con:
            con.execute("CREATE TABLE gpt02_issue159_approval_intents("
                        "task_id INTEGER, decision TEXT, "
                        "recorded_at_ms INTEGER, expires_at_ms INTEGER)")

    def check(self, now=NOW):
        return readiness(str(self.db), str(self.pending),
                         now_ms=now, operational=False)

    def assert_no_authority(self, result):
        for field in ("credentialIssuancePermitted", "signingPermitted",
                      "authorizationGranted", "dispatchPermitted"):
            self.assertIs(result[field], False)
        self.assertEqual(result["releaseDecision"], "NO_GO")

    def test_empty_approval_store(self):
        r = self.check()
        self.assertEqual(r["unexpiredApprovalIntents"], 0)
        self.assertEqual(r["reason"], "NO_UNEXPIRED_PERSISTED_APPROVAL")
        self.assert_no_authority(r)

    def test_expired_or_future_approval_is_not_fresh(self):
        with sqlite3.connect(self.db) as con:
            con.executemany(
                "INSERT INTO gpt02_issue159_approval_intents VALUES (?,?,?,?)",
                [(170, "APPROVE", NOW-300_000, NOW),
                 (172, "APPROVE", NOW+10, NOW+240_000),
                 (174, "DENY", NOW-10, NOW+240_000)])
        r = self.check()
        self.assertEqual(r["unexpiredApprovalIntents"], 0)
        self.assert_no_authority(r)

    def test_unexpired_approval_remains_no_go_without_signed_scope(self):
        with sqlite3.connect(self.db) as con:
            con.execute("INSERT INTO gpt02_issue159_approval_intents "
                        "VALUES (170,'APPROVE',?,?)", (NOW-10, NOW+100))
        r = self.check()
        self.assertEqual(r["unexpiredApprovalIntents"], 1)
        self.assertEqual(r["reason"], "EXACT_SIGNED_SCOPE_AND_CONSUMPTION_UNPROVEN")
        self.assert_no_authority(r)

    def test_missing_db_fails_closed(self):
        self.db.unlink()
        r = self.check()
        self.assertFalse(r["approvalStoreReadable"])
        self.assert_no_authority(r)

    def test_unpinned_paths_not_operational(self):
        r = readiness(str(self.db), str(self.pending), now_ms=NOW,
                      operational=True)
        self.assertEqual(r["reason"], "UNPINNED_LIVE_PATH")
        self.assert_no_authority(r)

    def test_invalid_clock_denied(self):
        r = self.check(now=0)
        self.assertEqual(r["reason"], "SERVER_CLOCK_INVALID")
        self.assert_no_authority(r)


if __name__ == "__main__":
    unittest.main()
