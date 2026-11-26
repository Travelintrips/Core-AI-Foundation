#!/usr/bin/env python3
"""Negative and positive source-level tests. No production/database access."""
import importlib.util
import unittest
from pathlib import Path

SOURCE = Path(__file__).with_name("gpt02_relock_executor_preflight.py")
spec = importlib.util.spec_from_file_location("gpt02_executor_preflight", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def valid_fixture():
    return {
        "scope": module.SCOPE, "projectId": module.PROJECT, "hostId": module.HOST,
        "ledgerVerifiedByTrustedReader": True, "approvalDecision": "APPROVED",
        "challengeStatus": "CONSUMED", "decisionCount": 1, "consumedCount": 1,
        "manifestOperations": list(module.EXPECTED_OPERATIONS),
        "relockTimer": {"active": "inactive", "unitFile": "disabled"},
        "relockService": {"active": "inactive", "mainPid": 0},
        "canonicalExecutorInstalled": True, "oneShotServiceKind": "RELOCK_ONLY",
        "exactOwnerDigestBound": True, "oneUseNonceVerified": True,
        "encryptedCustodyReady": True, "separateExecutorAuthorization": True,
        "signingEnabled": False, "dispatchEnabled": False,
    }


class PreflightContract(unittest.TestCase):
    def test_complete_qa_fixture_passes_readiness_not_authorization(self):
        result = module.evaluate(valid_fixture())
        self.assertTrue(result["preflightPass"])
        self.assertEqual(result["releaseDecision"], "NO_GO")
        self.assertFalse(result["authorizationGranted"])
        self.assertFalse(result["executionPermitted"])
        self.assertFalse(result["signingPermitted"])
        self.assertFalse(result["dispatchPermitted"])

    def test_missing_ledger_proof_fails(self):
        fixture = valid_fixture()
        fixture["ledgerVerifiedByTrustedReader"] = False
        self.assertIn("TRUSTED_LEDGER_READBACK_REQUIRED",
                      module.evaluate(fixture)["blockingReasons"])

    def test_replayed_or_extra_decision_fails(self):
        fixture = valid_fixture()
        fixture["decisionCount"] = 2
        fixture["consumedCount"] = 2
        result = module.evaluate(fixture)
        self.assertFalse(result["preflightPass"])

    def test_timer_active_fails(self):
        fixture = valid_fixture()
        fixture["relockTimer"]["active"] = "active"
        self.assertIn("RELOCK_TIMER_ACTIVE",
                      module.evaluate(fixture)["blockingReasons"])

    def test_one_read_is_not_executor(self):
        fixture = valid_fixture()
        fixture["oneShotServiceKind"] = "SIGNED_ONE_READ_REVIEW"
        self.assertIn("HISTORIC_SIGNED_ONE_READ_IS_NOT_RELOCK_EXECUTOR",
                      module.evaluate(fixture)["blockingReasons"])

    def test_no_credentials_or_executor_fails(self):
        fixture = valid_fixture()
        fixture["encryptedCustodyReady"] = False
        fixture["canonicalExecutorInstalled"] = False
        result = module.evaluate(fixture)
        self.assertFalse(result["preflightPass"])

    def test_wrong_project_or_operations_fails(self):
        fixture = valid_fixture()
        fixture["projectId"] = "unexpected"
        fixture["manifestOperations"] = []
        result = module.evaluate(fixture)
        self.assertIn("PROJECT_MISMATCH", result["blockingReasons"])
        self.assertIn("MANIFEST_OPERATIONS_MISMATCH", result["blockingReasons"])

    def test_signer_dispatch_activation_fails(self):
        fixture = valid_fixture()
        fixture["signingEnabled"] = True
        fixture["dispatchEnabled"] = True
        self.assertIn("SIGNING_OR_DISPATCH_MUST_REMAIN_OFF",
                      module.evaluate(fixture)["blockingReasons"])

    def test_missing_custody_and_replay_proof_fails(self):
        fixture = valid_fixture()
        fixture["exactOwnerDigestBound"] = False
        fixture["oneUseNonceVerified"] = False
        fixture["separateExecutorAuthorization"] = False
        result = module.evaluate(fixture)
        self.assertFalse(result["preflightPass"])

    def test_live_snapshot_is_fail_closed(self):
        # Patch OS-facing metadata to simulate a perfectly healthy host.
        from unittest.mock import patch
        with patch.object(module, "systemd_fields",
                          side_effect=[{"active": "inactive", "unitFile": "masked"},
                                       {"active": "inactive", "mainPid": 0}]), \
             patch.object(module.subprocess, "run") as run:
            run.return_value.stdout = module.HOST + "\\n"
            result = module.evaluate(module.live_snapshot())
            self.assertFalse(result["preflightPass"])
            self.assertFalse(result["executionPermitted"])


if __name__ == "__main__":
    unittest.main()
