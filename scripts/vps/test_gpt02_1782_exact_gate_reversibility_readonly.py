#!/usr/bin/env python3
"""Offline no-credential GPT02-1782 reversible one-line simulation tests."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SRC = Path(__file__).with_name("gpt02_1782_exact_gate_reversibility_readonly.py")
spec = importlib.util.spec_from_file_location("gpt02_v10_reversible", SRC)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

GATE = b"""return 503 '{"error":"GPT02_LEDGER_READER_NOT_PROVISIONED"}';"""
COMMENT = b"# GPT02-1782 bounded Owner GET test: automatic rollback armed"
BASE = b"server {\nlocation ^~ /api/gpt02-owner-ledger/ {\n" + GATE + b"\n}\n}\n"


def exact_restore(value: bytes) -> bytes:
    if value.count(COMMENT) != 1 or value.count(GATE):
        raise ValueError("NOT_EXACT")
    restored = value.replace(COMMENT, GATE, 1)
    if restored != BASE:
        raise ValueError("NOT_CANONICAL")
    return restored


class GateReversibilityTests(unittest.TestCase):
    def review(self, data=BASE, **overrides):
        return m.examine_bytes(
            data, gate=GATE, comment=COMMENT,
            is_closed=overrides.get("is_closed", lambda v: v == BASE),
            close_opened=overrides.get("close_opened", exact_restore),
        )

    def test_exact_one_line_opens_in_memory_and_restores_byte_identical(self):
        report = self.review()
        self.assertEqual(report["approved_closed_sha256"], hashlib.sha256(BASE).hexdigest())
        self.assertNotEqual(report["simulated_open_sha256"], report["approved_closed_sha256"])
        self.assertEqual(report["approved_closed_length"] - len(GATE) + len(COMMENT),
                         report["simulated_open_length"])
        self.assertTrue(report["guard_restores_byte_identical"])
        self.assertFalse(report["nginx_config_written"])
        self.assertFalse(report["nginx_reloaded"])
        self.assertFalse(report["rollback_timer_armed"])
        self.assertFalse(report["reader_lease_extended"])
        self.assertFalse(report["owner_http404_observed"])
        self.assertFalse(report["ready_to_open"])
        self.assertFalse(report["live_e2e_ready"])
        self.assertEqual(report["action"], "RETAIN_NGINX_503")

    def test_gate_absent_cannot_pass(self):
        with self.assertRaises(m.NotApproved):
            self.review(BASE.replace(GATE, b""))

    def test_gate_duplicate_cannot_pass(self):
        with self.assertRaises(m.NotApproved):
            self.review(BASE.replace(GATE, GATE + b"\n" + GATE))

    def test_already_opened_cannot_pass(self):
        with self.assertRaises(m.NotApproved):
            self.review(BASE.replace(GATE, COMMENT))

    def test_existing_unapproved_comment_cannot_pass(self):
        with self.assertRaises(m.NotApproved):
            self.review(BASE + b"\n" + COMMENT)

    def test_unknown_unrelated_nginx_change_is_rejected(self):
        with self.assertRaises(m.NotApproved):
            self.review(BASE + b"\nserver { return 200; }")

    def test_reversal_to_wrong_original_is_rejected(self):
        with self.assertRaises(m.NotApproved):
            self.review(close_opened=lambda _: BASE + b"\n# drift")

    def test_restorer_raises_on_unexpected_change(self):
        with self.assertRaises(ValueError):
            self.review(close_opened=lambda _: exact_restore(BASE))

    def test_open_bytes_must_not_be_canonical_closed(self):
        with self.assertRaises(m.NotApproved):
            self.review(is_closed=lambda _: True)

    def test_root_restore_source_pin_matches_merged_source_file(self):
        actual = SRC.with_name("gpt02_owner_ledger_nginx_restore_guard.py").read_bytes()
        self.assertEqual(hashlib.sha256(actual).hexdigest(), m.RESTORE_SHA256)

    def test_root_boot_source_pin_matches_merged_source_file(self):
        actual = SRC.with_name("gpt02_1782_failclosed_boot_precheck.py").read_bytes()
        self.assertEqual(
            hashlib.sha256(actual).hexdigest(),
            "26ea880f87b4eed5dea9cda0bd907b03711262abe470cde65b6c2e8e4b4b0e32",
        )

    def test_tampered_restore_guard_cannot_be_loaded_or_executed(self):
        with patch.object(m, "checked_file", return_value=b"not-the-approved-script"):
            with self.assertRaisesRegex(m.NotApproved, "SHA_DRIFT"):
                m.pinned_guard_source()

    def test_bad_symlink_is_refused_before_file_read(self):
        with tempfile.TemporaryDirectory() as directory:
            ordinary = Path(directory) / "ordinary"
            link = Path(directory) / "link"
            ordinary.write_bytes(BASE)
            link.symlink_to(ordinary)
            with self.assertRaisesRegex(m.NotApproved, "FILE_UNAVAILABLE"):
                m.checked_file(link, max_bytes=200000)

    def test_nonroot_returns_blocked_before_read(self):
        with patch.object(m.os, "geteuid", return_value=1001), \
             patch.object(m, "pinned_guard_source", side_effect=AssertionError("must not run")):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = m.main()
        self.assertEqual(code, 2)
        self.assertFalse(json.loads(output.getvalue())["ready_to_open"])

    def test_execute_argument_is_not_supported_even_for_root(self):
        with patch.object(m.os, "geteuid", return_value=0), \
             patch.object(m.os, "getegid", return_value=0), \
             patch.object(m.sys, "argv", ["simulator", "--execute"]), \
             patch.object(m, "pinned_guard_source", side_effect=AssertionError("must not run")):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = m.main()
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output.getvalue())["action"], "RETAIN_NGINX_503")

    def test_all_green_synthetic_root_simulation_still_no_go(self):
        helper = {
            "GATE": GATE,
            "COMMENT": COMMENT,
            "checked": lambda v: v == BASE,
            "permitted_open_to_closed": exact_restore,
        }
        with patch.object(m.os, "geteuid", return_value=0), \
             patch.object(m.os, "getegid", return_value=0), \
             patch.object(m.sys, "argv", ["simulator", "--check"]), \
             patch.object(m, "pinned_guard_source", return_value=helper), \
             patch.object(m, "checked_file", return_value=BASE):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = m.main()
        data = json.loads(out.getvalue())
        self.assertEqual(code, 2)
        self.assertEqual(data["byte_reversibility"], "PASS")
        self.assertEqual(data["readiness"], "SOURCE_SIMULATION_ONLY")
        self.assertEqual(data["action"], "RETAIN_NGINX_503")
        self.assertFalse(data["ready_to_open"])

    def test_unknown_cli_or_private_executor_is_absent(self):
        source = SRC.read_text()
        for forbidden in (
            "os.replace(", "os.system(", "systemd-run", "systemctl stop",
            "systemctl start", "subprocess.run(", "psycopg.connect(",
            "ALTER ROLE", "nginx -s reload", "--execute\", action",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)
        self.assertIn("return 2  # ALWAYS NO-GO", source)


if __name__ == "__main__":
    unittest.main()
