#!/usr/bin/env python3
"""Isolated contract tests: all dependencies are fakes; no live mutations."""
import dataclasses
import importlib.util
import unittest
from pathlib import Path

p = Path(__file__).with_name("gpt02_relock_once_candidate.py")
spec = importlib.util.spec_from_file_location("gpt02_once", p)
m = importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name] = m
spec.loader.exec_module(m)

DIGEST = "d0f7ec8715502e62" + "a" * 48
ID = "9c4f21e1-48af-4f7f-9830-931b84e3e846"


def decision():
    return m.VerifiedDecision(ID, DIGEST, m.SCOPE, m.PROJECT, "owner@example.test",
                              "APPROVED", "CONSUMED", 1, 1, m.OPERATIONS)


def grant():
    return m.VerifiedExecutorGrant(ID, DIGEST, "nonce-once-qa", m.SCOPE, m.PROJECT,
                                   m.HOST, m.PRINCIPAL, m.OPERATIONS, True)


def state(ok):
    return m.RelockState(
        four_roles_match=ok, sessions_remaining=0, open_watchdog_rows=0,
        timer_inactive_disabled=ok, service_inactive=ok, service_main_pid=0,
        credential_metadata_match=ok
    )


class FakeLedger:
    def __init__(self, d=None, g=None):
        self.d = decision() if d is None else d
        self.g = grant() if g is None else g
    def verify_recorded_owner_decision(self):
        return self.d
    def verify_separate_executor_grant(self, d):
        return self.g


class FakeCustodian:
    def __init__(self, claims=True):
        self.claims = claims
        self.called = 0
        self.receipts = []
        self.used_nonces = set()
    def claim_executor_nonce_once(self, g):
        self.called += 1
        if g.executor_nonce in self.used_nonces:
            raise m.GateDenied("EXECUTOR_NONCE_REPLAY")
        if not self.claims:
            return ""
        self.used_nonces.add(g.executor_nonce)
        return "claim-only-in-qa"
    def record_terminal_receipt(self, claim, result):
        self.receipts.append((claim, result))


class FakeRelock:
    def __init__(self, first, after=None, error=False):
        self.first = first
        self.after = after or first
        self.reads = 0
        self.actions = 0
        self.error = error
    def read_state(self):
        self.reads += 1
        return self.first if self.reads == 1 else self.after
    def apply_exact_relock_operations(self, g, claim):
        self.actions += 1
        if self.error:
            raise RuntimeError("SIMULATED_PARTIAL_FAILURE")


class CandidateTests(unittest.TestCase):
    def test_fully_already_locked_is_read_only(self):
        c, r = FakeCustodian(), FakeRelock(state(True))
        result = m.run_once(FakeLedger(), c, r)
        self.assertEqual(result["status"], "ALREADY_RELOCKED_READ_ONLY")
        self.assertFalse(result["executionPerformed"])
        self.assertEqual(c.called, 0)
        self.assertEqual(r.actions, 0)

    def test_isolated_candidate_transitions_only_with_adapters(self):
        c, r = FakeCustodian(), FakeRelock(state(False), state(True))
        result = m.run_once(FakeLedger(), c, r)
        self.assertEqual(result["status"], "RELOCK_READBACK_PASS")
        self.assertEqual(c.called, 1)
        self.assertEqual(r.actions, 1)
        self.assertEqual(c.receipts[0][1], "RELOCK_READBACK_PASS")
        self.assertFalse(result["dispatchPermitted"])

    def test_mismatched_digest_denied_before_claim(self):
        c, r = FakeCustodian(), FakeRelock(state(False), state(True))
        with self.assertRaises(m.GateDenied):
            m.run_once(FakeLedger(g=dataclasses.replace(grant(), manifest_digest="0"*64)), c, r)
        self.assertEqual(c.called, 0)

    def test_mismatched_project_and_principal_denied(self):
        for patch in ({"project": "prod"}, {"principal": "fake-worker"},
                      {"scope": "TASK183"}):
            with self.subTest(patch=patch):
                c, r = FakeCustodian(), FakeRelock(state(False), state(True))
                with self.assertRaises(m.GateDenied):
                    m.run_once(FakeLedger(g=dataclasses.replace(grant(), **patch)), c, r)
                self.assertEqual(r.actions, 0)

    def test_missing_executor_grant_denied(self):
        c, r = FakeCustodian(), FakeRelock(state(False), state(True))
        with self.assertRaises(m.GateDenied):
            m.run_once(FakeLedger(g=dataclasses.replace(grant(), grant_active=False)), c, r)
        self.assertEqual(c.called, 0)

    def test_more_than_one_decision_denied(self):
        c, r = FakeCustodian(), FakeRelock(state(False), state(True))
        with self.assertRaises(m.GateDenied):
            m.run_once(FakeLedger(d=dataclasses.replace(decision(), matching_decisions=2)), c, r)
        self.assertEqual(c.called, 0)

    def test_missing_nonce_claim_denied(self):
        c, r = FakeCustodian(claims=False), FakeRelock(state(False), state(True))
        with self.assertRaises(m.GateDenied):
            m.run_once(FakeLedger(), c, r)
        self.assertEqual(r.actions, 0)

    def test_second_attempt_with_same_nonce_is_rejected(self):
        c = FakeCustodian()
        first = FakeRelock(state(False), state(True))
        m.run_once(FakeLedger(), c, first)
        second = FakeRelock(state(False), state(True))
        with self.assertRaisesRegex(m.GateDenied, "EXECUTOR_NONCE_REPLAY"):
            m.run_once(FakeLedger(), c, second)
        self.assertEqual(second.actions, 0)
        self.assertEqual(c.called, 2)

    def test_partial_failure_requires_reconciliation(self):
        c, r = FakeCustodian(), FakeRelock(state(False), state(True), error=True)
        with self.assertRaises(RuntimeError):
            m.run_once(FakeLedger(), c, r)
        self.assertEqual(c.receipts[0][1], "FAILED_RECONCILIATION_REQUIRED")
        self.assertEqual(c.called, 1)

    def test_failed_readback_requires_reconciliation(self):
        c, r = FakeCustodian(), FakeRelock(state(False), state(False))
        with self.assertRaises(m.GateDenied):
            m.run_once(FakeLedger(), c, r)
        self.assertEqual(c.receipts[0][1], "FAILED_RECONCILIATION_REQUIRED")

    def test_sessions_must_be_zero(self):
        c, r = FakeCustodian(), FakeRelock(dataclasses.replace(state(False), sessions_remaining=1))
        with self.assertRaises(m.GateDenied):
            m.run_once(FakeLedger(), c, r)
        self.assertEqual(c.called, 0)
        self.assertEqual(r.actions, 0)

    def test_wrong_operations_denied(self):
        c, r = FakeCustodian(), FakeRelock(state(False))
        with self.assertRaises(m.GateDenied):
            m.run_once(FakeLedger(g=dataclasses.replace(grant(), operations=("SIGN_AND_DISPATCH",))), c, r)
        self.assertEqual(r.actions, 0)


if __name__ == "__main__":
    unittest.main()
