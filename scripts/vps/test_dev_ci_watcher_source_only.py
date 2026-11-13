"""Synthetic watcher behavior: no network, releases or host changes."""
import io
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

import dev_ci_watcher as watcher
from dev_source_only_release_gate import ComparisonError, DECISION_RELEASE, DECISION_SKIP

BASE = "1" * 40
HEAD = "2" * 40


class WatcherSourceOnlyTests(unittest.TestCase):
    def setup_mocks(self, *, local=BASE, ci=True, classification=DECISION_SKIP):
        self.stack = []
        def do_patch(name, **kwargs):
            p = patch("dev_ci_watcher." + name, **kwargs)
            mock = p.start()
            self.addCleanup(p.stop)
            return mock
        self.latest = do_patch("latest_sha", return_value=HEAD)
        self.local = do_patch("local_sha", return_value=local)
        self.ci = do_patch("ci_green", return_value=(ci, ["CI Verify", "DEV Fast Verify"] if ci else []))
        self.compare = do_patch("compare_remote", return_value={"decision": classification,
                                                                 "reason": "synthetic"})
        self.run = do_patch("subprocess.run")
        return self

    def execute(self):
        out = io.StringIO()
        with redirect_stdout(out):
            watcher.main()
        return out.getvalue()

    def test_source_only_skips_release(self):
        self.setup_mocks()
        output = self.execute()
        self.assertIn("SOURCE_ONLY_NO_RESTART", output)
        self.compare.assert_called_once_with(BASE, HEAD)
        self.run.assert_not_called()

    def test_existing_exact_sha_does_nothing(self):
        self.setup_mocks(local=HEAD)
        self.assertIn("VPS_DEV_POLL=READY", self.execute())
        self.ci.assert_not_called()
        self.compare.assert_not_called()
        self.run.assert_not_called()

    def test_ci_not_green_does_not_touch_release(self):
        self.setup_mocks(ci=False)
        self.assertIn("WAITING_CI", self.execute())
        self.compare.assert_not_called()
        self.run.assert_not_called()

    def test_app_change_keeps_normal_release(self):
        self.setup_mocks(classification=DECISION_RELEASE)
        self.local.side_effect = [BASE, HEAD]
        output = self.execute()
        self.assertIn("RELEASING", output)
        self.run.assert_called_once()
        self.assertEqual(self.run.call_args.args[0][-1], HEAD)

    def test_unverified_git_evidence_does_not_release(self):
        self.setup_mocks()
        self.compare.side_effect = ComparisonError("unverifiable")
        with self.assertRaises(ComparisonError):
            self.execute()
        self.run.assert_not_called()

    def test_invalid_classification_does_not_release(self):
        self.setup_mocks(classification="UNRECOGNIZED")
        with self.assertRaisesRegex(RuntimeError, "did not authorize"):
            self.execute()
        self.run.assert_not_called()

    def test_unhealthy_baseline_preserves_existing_recovery_behavior(self):
        self.setup_mocks(local=None, classification=DECISION_RELEASE)
        self.local.side_effect = [None, HEAD]
        self.assertIn("RELEASING", self.execute())
        self.compare.assert_not_called()
        self.run.assert_called_once()


if __name__ == "__main__":
    unittest.main()
