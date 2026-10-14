#!/usr/bin/env python3
"""Offline, Docker-free tests for the verified image retention contract."""
from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import docker_image_retention as gc


def row(repo, tag, image_id):
    return {"repository": repo, "tag": tag, "id": image_id}


class ReceiptTests(unittest.TestCase):
    def test_initial_record_is_only_baseline(self):
        rec = gc.new_receipt("core-dev", "sha256:new", None, "a" * 40, "ci-run:123", 1234)
        self.assertEqual(rec["image_id"], "sha256:new")
        self.assertIsNone(rec["rollback_image_id"])
        self.assertEqual(rec["verified_at"], 1234)

    def test_followup_success_preserves_previous_verified_release_for_rollback(self):
        prior = gc.new_receipt("core-dev", "sha256:old", None, "a" * 40, "run-12345", 1200)
        new = gc.new_receipt("core-dev", "sha256:new", prior, "b" * 40, "run-23456", 5000)
        self.assertEqual(new["rollback_image_id"], "sha256:old")
        self.assertEqual(new["verified_at"], 5000)

    def test_repeated_verification_does_not_delay_cleanup(self):
        prior = {"image_id": "sha256:now", "rollback_image_id": "sha256:previous", "verified_at": 50}
        rec = gc.new_receipt("core-dev", "sha256:now", prior, "a" * 40, "run-33333", 9000)
        self.assertEqual(rec["verified_at"], 50)
        self.assertEqual(rec["rollback_image_id"], "sha256:previous")

    def test_rollback_changes_only_after_successful_new_receipt(self):
        previous = {"image_id": "sha256:v2", "rollback_image_id": "sha256:v1", "verified_at": 50}
        new = gc.new_receipt("core-dev", "sha256:v3", previous, "c" * 40, "run-44444", 5000)
        self.assertEqual(new["rollback_image_id"], "sha256:v2")


class HealthTests(unittest.TestCase):
    def test_unhealthy_blocks_verification(self):
        data = {"Config": {"Image": "core-ai-dev:test"},
                "State": {"Running": True, "Health": {"Status": "unhealthy"}},
                "Image": "sha256:one"}
        with patch.object(gc, "inspect_container", return_value=data):
            with self.assertRaisesRegex(gc.Refused, "healthy"):
                gc.assert_current_healthy("core-dev")

    def test_unexpected_image_repository_blocks(self):
        data = {"Config": {"Image": "redis:7-alpine"},
                "State": {"Running": True, "Health": {"Status": "healthy"}},
                "Image": "sha256:one"}
        with patch.object(gc, "inspect_container", return_value=data):
            with self.assertRaisesRegex(gc.Refused, "unexpected"):
                gc.assert_current_healthy("core-dev")

    def test_healthy_exact_repository_passes(self):
        data = {"Config": {"Image": "ghcr.io/openclaw/openclaw:2026.9.8"},
                "State": {"Running": True, "Health": {"Status": "healthy"}},
                "Image": "sha256:one"}
        with patch.object(gc, "inspect_container", return_value=data):
            self.assertEqual(gc.assert_current_healthy("openclaw")["Image"], "sha256:one")

    def test_wrong_exact_commit_fails(self):
        with self.assertRaisesRegex(gc.Refused, "commit SHA"):
            gc.verify_commit_health("core-prod", "wrong")
        self.assertIsNone(gc.verify_commit_health("openclaw", None))


class CandidateTests(unittest.TestCase):
    NOW = 1000000
    GOOD = {"image_id": "sha256:active", "rollback_image_id": "sha256:rollback",
            "repository": "core-ai-dev", "verified_at": NOW - gc.GRACE_SECONDS - 120}
    ROWS = [
        row("core-ai-dev", "current", "sha256:active"),
        row("core-ai-dev", "rollback", "sha256:rollback"),
        row("core-ai-dev", "old-one", "sha256:old-1"),
        row("core-ai-dev", "old-two", "sha256:old-2"),
        row("core-ai-dev", "referenced", "sha256:referenced"),
        row("core-ai-dev", "latest", "sha256:latest"),
        row("core-ai-dev", "prebuilt-next", "sha256:next"),
        row("postgres", "16-alpine", "sha256:postgres"),
    ]
    CREATED = {"sha256:active": 900, "sha256:rollback": 850,
               "sha256:old-1": 100, "sha256:old-2": 200,
               "sha256:referenced": 300, "sha256:latest": 350,
               "sha256:next": 1000, "sha256:postgres": 150}

    def selections(self, receipt=None, referenced=None, now=None, created=None):
        return gc.candidates_for_service(
            self.GOOD if receipt is None else receipt,
            self.ROWS,
            {"sha256:referenced"} if referenced is None else referenced,
            self.CREATED if created is None else created,
            self.NOW if now is None else now,
        )

    def test_prunes_only_old_unreferenced_non_reserved_named_service_images(self):
        self.assertEqual([x["tag"] for x in self.selections()], ["old-one", "old-two"])

    def test_protects_all_images_referenced_by_running_or_stopped_containers(self):
        protected = {"sha256:referenced", "sha256:old-1", "sha256:old-2"}
        self.assertEqual(self.selections(referenced=protected), [])

    def test_first_enrollment_does_not_remove_anything(self):
        self.assertEqual(self.selections(receipt={**self.GOOD, "rollback_image_id": None}), [])

    def test_grace_period_preserves_newly_verified_rollback_window(self):
        self.assertEqual(self.selections(now=self.GOOD["verified_at"] + gc.GRACE_SECONDS - 1), [])

    def test_missing_rollback_image_stops_all_removals(self):
        created = {k: v for k, v in self.CREATED.items() if k != "sha256:rollback"}
        self.assertEqual(self.selections(created=created), [])

    def test_newly_built_unreleased_image_stays_safe(self):
        self.assertNotIn("prebuilt-next", [x["tag"] for x in self.selections()])

    def test_images_of_other_repositories_never_affected(self):
        self.assertNotIn("16-alpine", [x["tag"] for x in self.selections()])


class SweeperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        proof = {"version": 1, "service": "core-dev",
                 "repository": "core-ai-dev", "container": "core-ai-dev",
                 "image_id": "sha256:active",
                 "rollback_image_id": "sha256:rollback",
                 "expected_sha": "a" * 40,
                 "evidence_id": "CI-success",
                 "verified_at": int(time.time()) - gc.GRACE_SECONDS - 3600}
        (self.root / "core-dev.json").write_text(json.dumps(proof))
        self.images = [
            row("core-ai-dev", "active", "sha256:active"),
            row("core-ai-dev", "rollback", "sha256:rollback"),
            row("core-ai-dev", "old", "sha256:old"),
        ]
        self.created = {"sha256:active": 300, "sha256:rollback": 200, "sha256:old": 100}

    def mocked_sweep(self, apply):
        args = SimpleNamespace(state_dir=self.root, apply=apply)
        healthy = {"Image": "sha256:active"}
        calls = []
        def cli(*argv):
            calls.append(argv)
            return ""
        def objects(*argv):
            if argv[:2] == ("image", "inspect"):
                return [{"Id": "sha256:old"}]
            raise AssertionError(argv)
        fake_fcntl = SimpleNamespace(LOCK_EX=2, flock=lambda *_args: None)
        output = io.StringIO()
        with (patch.object(gc, "list_images", return_value=self.images),
              patch.object(gc, "all_container_image_ids", return_value=set()),
              patch.object(gc, "created_seconds", side_effect=lambda x: self.created[x]),
              patch.object(gc, "assert_current_healthy", return_value=healthy),
              patch.object(gc, "verify_commit_health"),
              patch.object(gc, "docker", side_effect=cli),
              patch.object(gc, "docker_objects", side_effect=objects),
              patch.object(gc, "fcntl", fake_fcntl),
              contextlib.redirect_stdout(output)):
            gc.sweep(args)
        return calls, output.getvalue()

    def test_dry_run_never_deletes(self):
        calls, output = self.mocked_sweep(False)
        self.assertEqual(calls, [])
        self.assertIn("DRY_RUN", output)

    def test_verified_release_deletes_only_named_old_image_tag(self):
        calls, output = self.mocked_sweep(True)
        self.assertEqual(calls, [("image", "rm", "--no-prune", "core-ai-dev:old")])
        self.assertIn("REMOVED", output)

    def test_unhealthy_current_release_blocks_deletion(self):
        args = SimpleNamespace(state_dir=self.root, apply=True)
        fake_fcntl = SimpleNamespace(LOCK_EX=2, flock=lambda *_args: None)
        with (patch.object(gc, "list_images", return_value=self.images),
              patch.object(gc, "all_container_image_ids", return_value=set()),
              patch.object(gc, "created_seconds", side_effect=lambda x: self.created[x]),
              patch.object(gc, "assert_current_healthy", side_effect=gc.Refused("unhealthy")),
              patch.object(gc, "docker") as cli,
              patch.object(gc, "fcntl", fake_fcntl),
              contextlib.redirect_stdout(io.StringIO())):
            gc.sweep(args)
        cli.assert_not_called()


class DeploymentContractTests(unittest.TestCase):
    def test_postdeploy_receipt_occurs_only_after_full_worker_stack_verify(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / ".github/workflows/ai-workers-deploy.yml").read_text(encoding="utf-8")
        verify = workflow.index("bash scripts/ai-workers-healthcheck.sh")
        receipt = workflow.index("record --service openclaw --evidence")
        self.assertLess(verify, receipt)
        self.assertIn("Block VPS deployment unless DEV release evidence is verified", workflow)

    def test_no_broad_prune_or_container_volume_delete_supported(self):
        source = (Path(__file__).with_name("docker_image_retention.py")).read_text(encoding="utf-8")
        self.assertNotIn('docker("system", "prune"', source)
        self.assertNotIn('docker("container", "rm"', source)
        self.assertNotIn('docker("volume", "rm"', source)


if __name__ == "__main__":
    unittest.main()
