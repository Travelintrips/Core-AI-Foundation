#!/usr/bin/env python3
"""No-clobber regression for the existing DEV GPT02 Hub/Core operator link.

All artifacts are synthetic private temp files. No systemd, hosted DB, signer
keys, approvals, worker commands, or dispatch are used.
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import gpt02_issue159_auto_chain as chain


class OperatorLinkOneUseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gpt02-link-no-clobber-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.link = self.root / "gpt02_issue159_hub_core_link_claims.json"
        self.tmp = self.root / ".gpt02_issue159_hub_core_link_claims.json.auto.tmp"
        self.patch_app = patch.object(chain, "APP", self.root)
        self.patch_link = patch.object(chain, "LINK", self.link)
        self.patch_app.start()
        self.patch_link.start()
        self.addCleanup(self.patch_link.stop)
        self.addCleanup(self.patch_app.stop)
        self.claims = {
            "environment": "DEV",
            "hubTaskId": 200,
            "linkId": "11111111-1111-4111-8111-111111111111",
            "dispatchPermitted": False,
            "releaseDecision": "NO_GO",
        }

    def test_writes_a_new_private_link_without_mutating_claims(self):
        original = dict(self.claims)
        chain._write_link(self.claims)
        self.assertEqual(json.loads(self.link.read_text()), original)
        self.assertEqual(self.claims, original)
        self.assertEqual(self.link.stat().st_mode & 0o777, 0o600)
        self.assertFalse(self.tmp.exists())

    def test_existing_verified_link_is_never_overwritten(self):
        before = b"opaque-preserved-prior-task-link"
        self.link.write_bytes(before)
        with self.assertRaisesRegex(chain.AutoChainError, "LINK_OUTPUT_OCCUPIED"):
            chain._write_link(self.claims)
        self.assertEqual(self.link.read_bytes(), before)
        self.assertFalse(self.tmp.exists())

    def test_existing_temporary_file_is_never_deleted(self):
        before = b"opaque-prior-temporary-evidence"
        self.tmp.write_bytes(before)
        with self.assertRaisesRegex(chain.AutoChainError, "LINK_TEMP_OCCUPIED"):
            chain._write_link(self.claims)
        self.assertEqual(self.tmp.read_bytes(), before)
        self.assertFalse(self.link.exists())

    def test_symlinked_verified_link_is_treated_as_occupied(self):
        external = self.root / "unrelated"
        external.write_bytes(b"do-not-overwrite")
        self.link.symlink_to(external)
        with self.assertRaisesRegex(chain.AutoChainError, "LINK_OUTPUT_OCCUPIED"):
            chain._write_link(self.claims)
        self.assertEqual(external.read_bytes(), b"do-not-overwrite")

    def test_symlinked_temporary_output_is_treated_as_occupied(self):
        external = self.root / "unrelated"
        external.write_bytes(b"do-not-delete")
        self.tmp.symlink_to(external)
        with self.assertRaisesRegex(chain.AutoChainError, "LINK_TEMP_OCCUPIED"):
            chain._write_link(self.claims)
        self.assertTrue(self.tmp.is_symlink())
        self.assertEqual(external.read_bytes(), b"do-not-delete")

    def test_two_parallel_publishers_can_publish_only_once(self):
        gate = threading.Barrier(2, timeout=5)

        def run(hub_task):
            gate.wait()
            try:
                chain._write_link({**self.claims, "hubTaskId": hub_task})
                return "published"
            except chain.AutoChainError as exc:
                self.assertIn(str(exc), (
                    "VERIFIED_OPERATOR_LINK_TEMP_OCCUPIED",
                    "VERIFIED_OPERATOR_LINK_OUTPUT_OCCUPIED",
                ))
                return "rejected"

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(run, (200, 201)))
        self.assertCountEqual(outcomes, ["published", "rejected"])
        self.assertIn(json.loads(self.link.read_text())["hubTaskId"], (200, 201))
        self.assertFalse(self.tmp.exists())

    def test_invalid_link_input_fails_without_output(self):
        with self.assertRaisesRegex(chain.AutoChainError, "LINK_INVALID"):
            chain._write_link(None)
        self.assertFalse(self.tmp.exists())
        self.assertFalse(self.link.exists())

    def test_os_link_failure_does_not_leave_temp_or_overwrite(self):
        with patch.object(chain.os, "link", side_effect=OSError("simulated-fs-failure")):
            with self.assertRaises(OSError):
                chain._write_link(self.claims)
        self.assertFalse(self.tmp.exists())
        self.assertFalse(self.link.exists())


if __name__ == "__main__":
    unittest.main()
