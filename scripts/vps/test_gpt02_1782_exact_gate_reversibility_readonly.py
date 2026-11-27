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
            "bff267b4cc76cca990f0cc03af30b3fa76604ce4e97e3340726ffce20e1c0bf4",
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
             patch.object(m, "inspect_deploy_quiescence", return_value={
                 "action": "RETAIN_NGINX_503", "ready_to_arm": False,
                 "live_e2e_ready": False, "dev_ci_watcher_paused": False,
                 "dev_ci_watcher_service_idle": False,
                 "public_custody_current": True, "rollback_timer_idle": True,
                 "unresolved": ["DEV_CI_WATCHER_NOT_PAUSED",
                                "FRESH_ONE_USE_OWNER_AUTHORIZATION_NOT_VERIFIED"],
             }), \
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

    def test_watcher_active_snapshot_remains_no_go_despite_exact_reversibility(self):
        result = {"byte_reversibility": "PASS", "ready_to_open": False}
        v10 = {
            "action": "RETAIN_NGINX_503", "ready_to_arm": False,
            "live_e2e_ready": False, "dev_ci_watcher_paused": False,
            "dev_ci_watcher_service_idle": False,
            "public_custody_current": True, "rollback_timer_idle": True,
            "unresolved": ["DEV_CI_WATCHER_NOT_PAUSED"],
        }
        snapshot = m.add_quiescence_snapshot(result, v10)
        self.assertFalse(snapshot["dev_ci_watcher_paused_snapshot"])
        self.assertIn("DEV_CI_WATCHER_NOT_PAUSED", snapshot["v10_unresolved"])
        self.assertFalse(snapshot["ready_to_open"])
        self.assertEqual(snapshot["action"], "RETAIN_NGINX_503")

    def test_expired_custody_snapshot_cannot_be_called_ready(self):
        snapshot = m.add_quiescence_snapshot({}, {
            "action": "RETAIN_NGINX_503", "ready_to_arm": False,
            "live_e2e_ready": False, "dev_ci_watcher_paused": True,
            "dev_ci_watcher_service_idle": True,
            "public_custody_current": False, "rollback_timer_idle": True,
            "unresolved": ["CUSTODY_OR_CLOSED_SITE_NOT_CURRENT"],
        })
        self.assertFalse(snapshot["public_custody_current_snapshot"])
        self.assertIn("CUSTODY_OR_CLOSED_SITE_NOT_CURRENT", snapshot["v10_unresolved"])
        self.assertFalse(snapshot["ready_to_open"])

    def test_forged_v10_ready_to_arm_is_rejected(self):
        for forged in (
            {"action": "RETAIN_NGINX_503", "ready_to_arm": True,
             "live_e2e_ready": False, "unresolved": []},
            {"action": "RETAIN_NGINX_503", "ready_to_arm": False,
             "live_e2e_ready": True, "unresolved": []},
            {"action": "OPEN_GATE", "ready_to_arm": False,
             "live_e2e_ready": False, "unresolved": []},
        ):
            with self.subTest(forged=forged), self.assertRaises(m.NotApproved):
                m.add_quiescence_snapshot({}, forged)

    def test_invalid_or_unbounded_unresolved_reasons_are_rejected(self):
        for reasons in (["bad-lower-case"], ["FRESH;SYSTEMCTL_STOP"],
                        ["X" * 81], ["X"] * 13, "WRONG_TYPE"):
            with self.subTest(reasons=reasons), self.assertRaises(m.NotApproved):
                m.add_quiescence_snapshot({}, {
                    "action": "RETAIN_NGINX_503", "ready_to_arm": False,
                    "live_e2e_ready": False, "unresolved": reasons,
                })

    def test_unavailable_v10_snapshot_cannot_produce_byte_pass(self):
        helper = {"GATE": GATE, "COMMENT": COMMENT, "checked": lambda v: v == BASE,
                  "permitted_open_to_closed": exact_restore}
        with patch.object(m.os, "geteuid", return_value=0), \
             patch.object(m.os, "getegid", return_value=0), \
             patch.object(m.sys, "argv", ["simulator", "--check"]), \
             patch.object(m, "pinned_guard_source", return_value=helper), \
             patch.object(m, "checked_file", return_value=BASE), \
             patch.object(m, "inspect_deploy_quiescence",
                          side_effect=RuntimeError("UNAVAILABLE")):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = m.main()
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(out.getvalue())["readiness"], "BLOCKED")
        self.assertEqual(json.loads(out.getvalue())["action"], "RETAIN_NGINX_503")

    def test_no_mutating_watcher_calls_in_source(self):
        text = SRC.read_text()
        self.assertIn("v10.read_unit_state", text)
        self.assertIn("v10.root_guard_verified", text)
        self.assertIn("v10.public_inspect", text)
        for forbidden in ("systemctl stop", "systemctl start", "systemd-run",
                          "subprocess.run(", "os.replace(", "flock(", "ALTER ROLE"):
            self.assertNotIn(forbidden, text)

    def test_post_rollback_all_facts_only_suggest_operator_review(self):
        facts={k: True for k in m.RECOVERY_REVIEW_TRUE_FIELDS}
        facts["dedicated_reader_active_sessions"]=0
        report=m.assess_watcher_recovery_contract(facts)
        self.assertEqual(report["recovery_review"],"CANDIDATE_ONLY")
        self.assertEqual(report["missing"],[])
        self.assertFalse(report["review_is_live_attestation"])
        self.assertFalse(report["watcher_resumed"])
        self.assertFalse(report["nginx_reloaded"])
        self.assertEqual(report["action"],"NO_HOST_OPERATION")

    def test_every_required_post_rollback_fact_cannot_be_omitted(self):
        good={k:True for k in m.RECOVERY_REVIEW_TRUE_FIELDS}
        good["dedicated_reader_active_sessions"]=0
        for field in m.RECOVERY_REVIEW_TRUE_FIELDS:
            with self.subTest(field=field):
                facts={k:v for k,v in good.items() if k!=field}
                result=m.assess_watcher_recovery_contract(facts)
                self.assertEqual(result["recovery_review"],"BLOCKED")
                self.assertIn(field,result["missing"])
                self.assertFalse(result["watcher_resumed"])

    def test_http503_plain_text_or_nginx_not_reloaded_blocks_watcher_recovery(self):
        good={k:True for k in m.RECOVERY_REVIEW_TRUE_FIELDS}
        good["dedicated_reader_active_sessions"]=0
        for field in ("loopback_http503_json_no_store","nginx_syntax_pass",
                      "nginx_config_exact_restored","no_unknown_shared_nginx_edits"):
            with self.subTest(field=field):
                result=m.assess_watcher_recovery_contract({**good,field:False})
                self.assertIn(field,result["missing"])

    def test_remaining_guard_timer_or_backup_blocks_resumption(self):
        good={k:True for k in m.RECOVERY_REVIEW_TRUE_FIELDS}
        good["dedicated_reader_active_sessions"]=0
        for field in ("guard_rollback_timer_inactive",
                      "guard_backup_cleaned_after_verification"):
            with self.subTest(field=field):
                self.assertEqual(m.assess_watcher_recovery_contract(
                    {**good,field:False})["recovery_review"],"BLOCKED")

    def test_live_reader_session_or_missing_expiry_blocks_resumption(self):
        good={k:True for k in m.RECOVERY_REVIEW_TRUE_FIELDS}
        for sessions in (1,-1,None,True,"0"):
            with self.subTest(sessions=sessions):
                result=m.assess_watcher_recovery_contract(
                    {**good,"dedicated_reader_active_sessions":sessions})
                self.assertIn("dedicated_reader_active_sessions_zero",result["missing"])
        good["dedicated_reader_active_sessions"]=0
        self.assertIn("dedicated_reader_expired",
                      m.assess_watcher_recovery_contract(
                          {**good,"dedicated_reader_expired":False})["missing"])

    def test_deployment_still_running_cannot_be_marked_resumed(self):
        good={k:True for k in m.RECOVERY_REVIEW_TRUE_FIELDS}
        good["dedicated_reader_active_sessions"]=0
        for field in ("shared_dev_release_service_idle",
                      "watcher_timer_currently_inactive",
                      "watcher_timer_was_active_before_test"):
            with self.subTest(field=field):
                result=m.assess_watcher_recovery_contract({**good,field:False})
                self.assertEqual(result["recovery_review"],"BLOCKED")
                self.assertIn(field,result["missing"])

    def test_untrusted_truthy_recovery_input_is_not_accepted(self):
        good={k:True for k in m.RECOVERY_REVIEW_TRUE_FIELDS}
        good["dedicated_reader_active_sessions"]=0
        for value in ("true",1,[],{}):
            with self.subTest(value=value):
                result=m.assess_watcher_recovery_contract(
                    {**good,"loopback_http503_json_no_store":value})
                self.assertIn("loopback_http503_json_no_store",result["missing"])
                self.assertFalse(result["watcher_resumed"])

    def test_invalid_recovery_input_remains_no_host_operation(self):
        for input_value in (None,True,[],0,"bad"):
            with self.subTest(value=input_value):
                result=m.assess_watcher_recovery_contract(input_value)
                self.assertEqual(result["recovery_review"],"BLOCKED")
                self.assertFalse(result["watcher_resumed"])
                self.assertEqual(result["action"],"NO_HOST_OPERATION")

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
