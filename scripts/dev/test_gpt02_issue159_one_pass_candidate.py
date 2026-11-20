#!/usr/bin/env python3
"""One-pass GPT02 candidate CLI contract (no DB, signer, network or subprocess)."""
import importlib.util
from pathlib import Path
import os
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name("gpt02_issue159_one_pass_candidate.py")
spec = importlib.util.spec_from_file_location("one_pass_qa", SOURCE)
qa = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(qa)


class OnePassCandidateContract(unittest.TestCase):
    def test_never_authorizes_live_execution(self):
        self.assertEqual(qa.ENVIRONMENT, "CST-DEV")
        self.assertEqual(qa.PROJECT, "xssrfshdrtdfupgqwfdw")
        self.assertEqual(len(qa.SQL_REQUIRED), 6)
        self.assertGreaterEqual(len(qa.EXTERNAL_GATES), 6)
        source=SOURCE.read_text()
        for text in ("liveReleaseDecision","NO_GO_NEVER_AUTHORIZES",
                     "credentialIssuancePermitted","signingPermitted",
                     "dispatchPermitted","prodTouchedByThisRunner"):
            self.assertIn(text,source)
        self.assertNotIn("apply_migration(",source)
        self.assertNotIn("ALTER ROLE ",source)
        self.assertNotIn("CREATE ROLE ",source)

    def test_one_pass_covers_original_hub_core_and_failure_paths(self):
        root=Path("/fixture-only")
        stages=qa.tests(root,root,root,full=True)
        names=[row[0] for row in stages]
        self.assertEqual(len(names),len(set(names)))
        for name in (
            "CORE_FOUR_SIGNED_VERIFIER",
            "CORE_PINNED_ONESHOT_BROKER",
            "CORE_THREE_DOMAIN_ISSUER_STARTUP",
            "HUB_ONE_OWNER_PREISSUER",
            "HUB_GUARDED_OWNER_HTTP",
            "ORIGINAL_FINAL_ACK_CONTRACT",
            "HUB_NATIVE_TWO_TLS_PRESIGN",
            "HUB_POSTAUTH_DUAL_DATABASE_TLS",
            "HUB_REAL_RESTRICTED_ATTESTOR_ISSUER",
            "DB_SIX_MIGRATIONS_EXISTING_CATALOG",
            "DB_DUAL_GRANTOR_RESTORATION",
            "DB_EXACT_FIVE_TABLE_RLS",
            "DB_SIGNED_SCOPE_ISSUANCE",
            "DB_ONE_USE_CONSUMPTION",
            "DB_CANONICAL_REVOCATION_GUARD",
            "DB_CRASH_SAFE_WATCHDOG",
            "DB_FINALLY_RELOCK",
        ):
            self.assertIn(name,names)
        self.assertEqual(len(qa.tests(root,root,root,full=False)),6)

    def test_no_dsn_or_private_keys_in_child_process(self):
        fake={
            "PATH":"/usr/bin","HOME":"/home/fixture","DATABASE_URL":"bad",
            "PGPASSWORD":"bad","SUPABASE_SERVICE_ROLE_KEY":"bad",
            "GITHUB_TOKEN":"bad","SESSION_SECRET":"bad","ACCESS_TOKEN":"bad",
        }
        with patch.dict(os.environ,fake,clear=True):
            child=qa.scrubbed_env(Path("/core"),Path("/pr196"))
        self.assertEqual(child["PATH"],"/usr/bin")
        self.assertEqual(child["GPT02_PR196_REFERENCE"],"/pr196")
        self.assertEqual(child["GPT02_ISSUE159_SOURCE_ONLY_QA"],"1")
        self.assertIn("/core/deploy/ai-coding-standalone-dev",child["PYTHONPATH"])
        for secret in ("DATABASE_URL","PGPASSWORD","SUPABASE_SERVICE_ROLE_KEY",
                       "GITHUB_TOKEN","SESSION_SECRET","ACCESS_TOKEN"):
            self.assertNotIn(secret,child)

    def test_pin_enforces_exact_original_hub_commit(self):
        self.assertRegex(qa.PINNED_HUB_SHA,r"^[0-9a-f]{40}$")
        self.assertEqual(len(qa.PR196_PINNED_BLOBS),4)
        for sha in qa.PR196_PINNED_BLOBS.values():
            self.assertRegex(sha,r"^[0-9a-f]{40}$")

    def test_bad_command_does_not_become_pass(self):
        with patch.object(qa.subprocess,"run") as run:
            run.return_value.returncode=6
            run.return_value.stdout="internal fixture secret should not be copied"
            run.return_value.stderr="internal fixture secret should not be copied"
            ok,elapsed,reason=qa.run_checked(["unused"],Path("/tmp"))
        self.assertFalse(ok)
        self.assertEqual(reason,"EXIT_6")
        self.assertGreaterEqual(elapsed,0)
        self.assertNotIn("secret",reason)

    def test_unexpected_timeout_does_not_become_pass(self):
        from subprocess import TimeoutExpired
        with patch.object(qa.subprocess,"run",side_effect=TimeoutExpired(
            cmd=["fixture"],timeout=1)):
            ok,_,reason=qa.run_checked(["fixture"],Path("/tmp"))
        self.assertFalse(ok)
        self.assertEqual(reason,"TEST_TIMEOUT")


if __name__=="__main__":
    unittest.main()
