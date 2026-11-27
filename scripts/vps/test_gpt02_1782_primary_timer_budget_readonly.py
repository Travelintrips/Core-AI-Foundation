#!/usr/bin/env python3
"""Isolated primary timer deadline model tests; never arm real timers."""
from contextlib import redirect_stdout
import hashlib
import importlib.util
from io import StringIO
import json
from pathlib import Path
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name("gpt02_1782_primary_timer_budget_readonly.py")
spec = importlib.util.spec_from_file_location("tested_primary_timer_budget", SOURCE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class PrimaryTimerBudgetTests(unittest.TestCase):
    def test_existing_90_second_guard_with_one_minute_accuracy_is_unsafe(self):
        data = m.proposed_budget(delay_s=90, accuracy_s=60)
        self.assertFalse(data["model_within_90s"])
        self.assertEqual(data["projected_upper_s"], 203)
        self.assertFalse(data["host_scheduler_deadline_guaranteed"])
        self.assertFalse(data["actual_timer_armed_or_verified"])

    def test_explicit_accuracy_with_same_90_second_delay_is_still_unacceptable(self):
        data = m.proposed_budget(delay_s=90, accuracy_s=1)
        self.assertFalse(data["model_within_90s"])
        self.assertEqual(data["projected_upper_s"], 144)

    def test_early_30_second_one_second_accuracy_budget_only(self):
        data = m.proposed_budget(delay_s=30, accuracy_s=1)
        self.assertEqual(data["projected_upper_s"], 84)
        self.assertTrue(data["model_within_90s"])
        self.assertFalse(data["host_scheduler_deadline_guaranteed"])
        self.assertFalse(data["live_e2e_ready"])
        self.assertEqual(data["action"], "RETAIN_NGINX_503")

    def test_secondary_110s_can_never_replace_primary_deadline(self):
        for accuracy in (1, 60):
            self.assertFalse(m.proposed_budget(
                delay_s=110, accuracy_s=accuracy)["model_within_90s"])

    def test_accuracies_beyond_one_second_fail_even_if_delay_is_short(self):
        for accuracy in (2, 30, 60):
            with self.subTest(accuracy=accuracy):
                self.assertFalse(m.proposed_budget(
                    delay_s=5, accuracy_s=accuracy)["model_within_90s"])

    def test_randomized_delay_must_be_disabled(self):
        self.assertFalse(m.proposed_budget(
            delay_s=30, accuracy_s=1, randomized_delay_s=1)["model_within_90s"])

    def test_underestimated_recovery_budget_fails(self):
        self.assertFalse(m.proposed_budget(
            delay_s=30, accuracy_s=1, reload_s=35,
        )["model_within_90s"])

    def test_invalid_bool_fraction_or_negative_values_rejected(self):
        for kw in (
            {"delay_s": True, "accuracy_s": 1},
            {"delay_s": 30, "accuracy_s": True},
            {"delay_s": -1, "accuracy_s": 1},
            {"delay_s": 30, "accuracy_s": -1},
            {"delay_s": 30.1, "accuracy_s": 1},
            {"delay_s": 30, "accuracy_s": 1, "slack_s": -1},
        ):
            with self.subTest(kw=kw):
                data=m.proposed_budget(**kw)
                self.assertFalse(data["model_within_90s"])

    def test_source_shape_without_explicit_accuracy_is_no_go(self):
        source=(
            b'"systemd-run" "--on-active=" str(delay_seconds) + "s" '
            b'parser.add_argument("--delay-seconds", type=int, default=90)'
        )
        report=m.review_existing_guard_source(source)
        self.assertTrue(report["primary_guard_recognized"])
        self.assertFalse(report["accuracy_explicit_in_installed_guard"])
        self.assertTrue(report["requires_primary_guard_fix"])
        self.assertEqual(report["default_accuracy_s"],60)
        self.assertFalse(report["max_90s_live_close_verified"])

    def test_source_with_explicit_accuracy_still_needs_smaller_delay(self):
        source=(
            b'"systemd-run" "--on-active=" str(delay_seconds) + "s" '
            b'parser.add_argument("--delay-seconds", type=int, default=90) '
            b'--timer-property=AccuracySec=1s '
            b'--timer-property=RandomizedDelaySec=0'
        )
        report=m.review_existing_guard_source(source)
        self.assertTrue(report["accuracy_explicit_in_installed_guard"])
        self.assertTrue(report["requires_primary_guard_fix"])

    def test_approved_pr1855_source_pin_and_readonly_budget(self):
        source = SOURCE.with_name("gpt02_owner_ledger_nginx_restore_guard.py").read_bytes()
        self.assertEqual(hashlib.sha256(source).hexdigest(), m.GUARD_SHA)
        report = m.review_existing_guard_source(source)
        self.assertTrue(report["pr1855_timer_contract_recognized"])
        self.assertEqual(report["primary_guard_requested_delay_s"], 30)
        self.assertEqual(report["existing_guard_model"]["projected_upper_s"], 87)
        self.assertTrue(report["maintenance_job_probe_source_recognized"])
        self.assertTrue(report["existing_guard_model"]["model_within_90s"])
        self.assertFalse(report["requires_primary_guard_fix"])
        self.assertFalse(report["max_90s_live_close_verified"])
        self.assertFalse(report["owner_e2e_ready"])

    def test_pr1855_contract_drift_stays_no_go(self):
        source = SOURCE.with_name("gpt02_owner_ledger_nginx_restore_guard.py").read_bytes()
        for before, after in (
            (b'PRIMARY_RESTORE_DELAY_SECONDS = 30', b'PRIMARY_RESTORE_DELAY_SECONDS = 90'),
            (b'PRIMARY_TIMER_ACCURACY = "1s"', b'PRIMARY_TIMER_ACCURACY = "60s"'),
            (b'PRIMARY_TIMER_RANDOMIZED_DELAY = "0"', b'PRIMARY_TIMER_RANDOMIZED_DELAY = "1s"'),
            (b'    verify_armed_timer_properties(unit)', b'    pass'),
        ):
            with self.subTest(before=before):
                self.assertIn(before, source)
                report = m.review_existing_guard_source(source.replace(before, after))
                self.assertFalse(report["pr1855_timer_contract_recognized"])
                self.assertTrue(report["requires_primary_guard_fix"])
                self.assertFalse(report["owner_e2e_ready"])

    def test_new_probe_overhead_included_and_drift_rejected(self):
        source = SOURCE.with_name("gpt02_owner_ledger_nginx_restore_guard.py").read_bytes()
        self.assertEqual(m.proposed_budget(delay_s=30, accuracy_s=1,
                         job_probe_s=3)["projected_upper_s"], 87)
        for before, after in (
            (b'RECOVERY_JOB_PROBE_TIMEOUT_S = 3', b'RECOVERY_JOB_PROBE_TIMEOUT_S = 10'),
            (b'"pass_fds": (lock_fd,)', b'"pass_fds": ()'),
            (b'            verify_nginx_job_idle()', b'            pass'),
        ):
            with self.subTest(before=before):
                self.assertIn(before, source)
                report = m.review_existing_guard_source(source.replace(before, after))
                self.assertFalse(report["maintenance_job_probe_source_recognized"])
                self.assertTrue(report["requires_primary_guard_fix"])
                self.assertFalse(report["owner_e2e_ready"])

    def test_unrecognized_guard_shape_fail_closed(self):
        report=m.review_existing_guard_source(b"unrecognized code")
        self.assertFalse(report["primary_guard_recognized"])
        self.assertTrue(report["requires_primary_guard_fix"])

    def test_source_only_main_never_claims_timer_armed(self):
        with patch.object(m.os,"geteuid",return_value=0),\
             patch.object(m.os,"getegid",return_value=0),\
             patch.object(m.sys,"argv",["audit.py","--check"]),\
             patch.object(m,"audit",return_value={
                 "action":"RETAIN_NGINX_503",
                 "max_90s_live_close_verified":False,
             }):
            output=StringIO()
            with redirect_stdout(output):
                code=m.main()
        self.assertEqual(code,2)
        self.assertFalse(json.loads(output.getvalue())["max_90s_live_close_verified"])

    def test_execute_flag_does_not_call_audit(self):
        with patch.object(m.os,"geteuid",return_value=0),\
             patch.object(m.os,"getegid",return_value=0),\
             patch.object(m.sys,"argv",["audit.py","--arm"]),\
             patch.object(m,"audit",side_effect=AssertionError("MUST_NOT_RUN")):
            output=StringIO()
            with redirect_stdout(output):
                self.assertEqual(m.main(),2)
        self.assertEqual(json.loads(output.getvalue())["readiness"],"BLOCKED")

    def test_derived_source_has_no_timer_or_nginx_mutation(self):
        source=SOURCE.read_text()
        for bad in ("systemd-run", "systemctl start", "systemctl stop",
                    "subprocess.run(", "ALTER ROLE", "os.replace("):
            # Literal "systemd-run" appears in a comment/description, so
            # disallow only an invocation, not the documentary term.
            if bad == "systemd-run":
                self.assertNotIn("subprocess.run([\"systemd-run\"",source)
            else:
                self.assertNotIn(bad,source)
        self.assertIn("return 2  # NO timer arming",source)


if __name__ == "__main__":
    unittest.main()
