"""Offline, synthetic fail-closed release classification (no network or deploy)."""
import copy
import unittest

from dev_source_only_release_gate import (
    ComparisonError, DECISION_BLOCK, DECISION_RELEASE, DECISION_SKIP,
    classify_compare, safe_path,
)

BASE = "1" * 40
HEAD = "2" * 40


def make_compare(names, status="ahead"):
    files = [{"filename": name, "status": "modified"} for name in names]
    return {
        "base_commit": {"sha": BASE},
        "head_commit": {"sha": HEAD},
        "merge_base_commit": {"sha": BASE},
        "status": status,
        "ahead_by": 1,
        "behind_by": 0,
        "total_commits": 1,
        "files": files,
    }


class GateTests(unittest.TestCase):
    def test_windows_native_source_only_skips_restart(self):
        d = make_compare([
            "scripts/windows/ai-core/dev_chatgpt_native_transport.py",
            "scripts/windows/ai-core/test_dev_chatgpt_native_transport.py",
            ".github/workflows/gpt02-dell-canonical-dev-backport.yml",
        ])
        v = classify_compare(d, BASE, HEAD)
        self.assertEqual(v["decision"], DECISION_SKIP)
        self.assertFalse(v["prod_permitted"])
        self.assertFalse(v["worker_dispatch_permitted"])

    def test_release_gate_source_code_eligible_under_strict_review(self):
        d = make_compare([
            "scripts/vps/dev_ci_watcher.py",
            "scripts/vps/dev_source_only_release_gate.py",
            "scripts/vps/test_dev_source_only_release_gate.py",
            "scripts/vps/test_dev_ci_watcher_source_only.py",
            ".github/workflows/hostinger-dev-deploy.yml",
            "scripts/windows/ai-core/gpt02-local-cache-readback.js",
        ])
        self.assertEqual(classify_compare(d, BASE, HEAD)["decision"], DECISION_SKIP)

    def test_any_api_or_frontend_change_forces_normal_release(self):
        for name in (
            "artifacts/api-server/src/app.ts",
            "deploy/hostinger-dev/Dockerfile",
            "pnpm-lock.yaml",
            "scripts/vps/deploy_dev_release.py",
            ".github/workflows/ci.yml",
        ):
            with self.subTest(name=name):
                files = make_compare(["scripts/windows/ai-core/test_dev_chatgpt_native_transport.py", name])
                self.assertEqual(classify_compare(files, BASE, HEAD)["decision"], DECISION_RELEASE)

    def test_production_files_not_allowlisted(self):
        self.assertFalse(safe_path("deploy/hostinger-prod/Dockerfile"))
        self.assertFalse(safe_path(".github/workflows/hostinger-nodejs-deploy.yml"))

    def test_renames_fail_closed_even_if_allowlisted(self):
        d = make_compare(["scripts/windows/ai-core/a.py"])
        d["files"][0]["status"] = "renamed"
        d["files"][0]["previous_filename"] = "scripts/windows/ai-core/b.py"
        with self.assertRaises(ComparisonError):
            classify_compare(d, BASE, HEAD)

    def test_truncated_300_files_fail_closed(self):
        d = make_compare([f"scripts/windows/ai-core/file_{n}.py" for n in range(300)])
        with self.assertRaisesRegex(ComparisonError, "truncated"):
            classify_compare(d, BASE, HEAD)

    def test_empty_diff_not_assumed_source_only(self):
        d = make_compare([])
        with self.assertRaisesRegex(ComparisonError, "file list"):
            classify_compare(d, BASE, HEAD)

    def test_missing_merge_base_blocks(self):
        d = make_compare(["scripts/windows/ai-core/a.py"])
        d.pop("merge_base_commit")
        with self.assertRaises(ComparisonError):
            classify_compare(d, BASE, HEAD)

    def test_non_descendant_blocks(self):
        d = make_compare(["scripts/windows/ai-core/a.py"], status="diverged")
        d["behind_by"] = 1
        with self.assertRaises(ComparisonError):
            classify_compare(d, BASE, HEAD)

    def test_incorrect_sha_blocks(self):
        d = make_compare(["scripts/windows/ai-core/a.py"])
        d["base_commit"]["sha"] = "a" * 40
        with self.assertRaises(ComparisonError):
            classify_compare(d, BASE, HEAD)

    def test_bad_sha_never_accepted(self):
        with self.assertRaises(ComparisonError):
            classify_compare(make_compare(["scripts/windows/ai-core/a.py"]),
                             "wrong", HEAD)

    def test_different_statuses_allow_source_only_add_remove(self):
        d = make_compare(["scripts/windows/ai-core/a.py", "scripts/windows/ai-core/b.py"])
        d["files"][0]["status"] = "added"
        d["files"][1]["status"] = "removed"
        self.assertEqual(classify_compare(d, BASE, HEAD)["decision"], DECISION_SKIP)

    def test_duplicates_fail_closed(self):
        d = make_compare(["scripts/windows/ai-core/a.py"] * 2)
        with self.assertRaises(ComparisonError):
            classify_compare(d, BASE, HEAD)

    def test_invalid_paths_denied_not_skipped(self):
        for name in (
            "scripts/windows/ai-core/../app.ts",
            "scripts/windows/ai-core//foo.js",
            "scripts/windows/ai-core\\bad.js",
            "scripts/windows/ai-core/./temp.py",
            "/scripts/windows/ai-core/z.py",
        ):
            with self.subTest(name=name):
                d = make_compare([name])
                with self.assertRaisesRegex(ComparisonError, "invalid Git file path"):
                    classify_compare(d, BASE, HEAD)

    def test_malformed_entries_fail_closed(self):
        for bad in (None, "a", 3):
            with self.subTest(value=bad):
                d = make_compare(["scripts/windows/ai-core/a.py"])
                d["files"][0] = bad
                with self.assertRaises(ComparisonError):
                    classify_compare(d, BASE, HEAD)

    def test_missing_commit_count_fail_closed(self):
        d = make_compare(["scripts/windows/ai-core/a.py"])
        d.pop("total_commits")
        with self.assertRaises(ComparisonError):
            classify_compare(d, BASE, HEAD)

    def test_same_sha_is_no_op(self):
        self.assertEqual(classify_compare(None, BASE, BASE)["reason"], "DEV_ALREADY_AT_EXACT_SHA")

    def test_boolean_commit_count_cannot_pass(self):
        d = make_compare(["scripts/windows/ai-core/a.py"])
        d["total_commits"] = True
        with self.assertRaises(ComparisonError):
            classify_compare(d, BASE, HEAD)


if __name__ == "__main__":
    unittest.main()
