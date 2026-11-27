#!/usr/bin/env python3
"""Offline, no-network, no-secret GPT02 v10 Owner Ledger operator readiness tests."""
import hashlib
import importlib.util
import json
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch

SRC = Path(__file__).with_name("gpt02_1782_negative_window_v10_readonly.py")
spec = importlib.util.spec_from_file_location("gpt02_v10_inert", SRC)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

PUBLIC = {
    "readiness": "PUBLIC_EVIDENCE_CURRENT_ONLY",
    "public_custody_current": True,
    "worker_current_4min": True,
    "issuer_current_4min": True,
    "issuer_worker_binding_valid": True,
    "boot_guard_sha": True,
    "closed_vhost_sha": True,
    "exactly_one_closed_gate": True,
    "rollback_backup_absent": True,
    "dba_preparation_off": True,
    "live_e2e_ready": False,
    "action": "RETAIN_NGINX_503",
}
BASE = {m.WATCHER_TIMER: "inactive", m.WATCHER_SERVICE: "inactive",
        m.ROLLBACK_TIMER: "inactive"}


class InertWindowTests(TestCase):
    def test_restore_pin_matches_approved_pr1859_source(self):
        source = SRC.with_name("gpt02_owner_ledger_nginx_restore_guard.py").read_bytes()
        self.assertEqual(hashlib.sha256(source).hexdigest(), m.RESTORE_SHA256)
        self.assertNotEqual(m.RESTORE_SHA256, "e8e874d3d05de88f405d7584ede63a51539ad1e986aed2a2c620773ea2e92448")
        self.assertNotEqual(m.RESTORE_SHA256, "64d22f49263fe44e80809b3ba61f4020bc8bd84509723e957065cb1fccabcf13")
        self.assertNotEqual(m.RESTORE_SHA256, "3851912fcb62423b3f54630e901b6ffda8824009f8e4460a0fdb1ecbf5b486e9")
        self.assertEqual(m.RESTORE_SHA256, "d9756ebc6eabac279cdd1459e7da7b1b66465442f120d1914da0bda8fede1ee4")

    def test_all_public_green_and_watcher_paused_never_claims_live_go(self):
        report = m.evaluate(PUBLIC, True, BASE)
        self.assertTrue(report["public_custody_current"])
        self.assertTrue(report["dev_ci_watcher_paused"])
        self.assertTrue(report["root_restore_guard_sha"])
        self.assertTrue(report["rollback_timer_idle"])
        self.assertFalse(report["ready_to_arm"])
        self.assertFalse(report["live_e2e_ready"])
        self.assertEqual(report["readiness"], "BLOCKED")
        self.assertEqual(report["action"], "RETAIN_NGINX_503")
        self.assertIn("FRESH_ONE_USE_OWNER_AUTHORIZATION_NOT_VERIFIED", report["unresolved"])
        self.assertIn("LIVE_DEDICATED_READER_LEASE_AND_LOGIN_NOT_VERIFIED", report["unresolved"])

    def test_active_3_minute_dev_deployment_timer_blocks(self):
        units = {**BASE, m.WATCHER_TIMER: "active"}
        report = m.evaluate(PUBLIC, True, units)
        self.assertFalse(report["dev_ci_watcher_paused"])
        self.assertTrue(report["dev_ci_watcher_timer_active"])
        self.assertIn("DEV_CI_WATCHER_NOT_PAUSED", report["unresolved"])

    def test_active_or_failed_deployment_service_also_blocks(self):
        for state in ("active", "activating", "failed", "deactivating", "not-found"):
            with self.subTest(state=state):
                report = m.evaluate(PUBLIC, True, {**BASE, m.WATCHER_SERVICE: state})
                self.assertFalse(report["dev_ci_watcher_paused"])
                self.assertIn("DEV_CI_WATCHER_NOT_PAUSED", report["unresolved"])

    def test_active_or_failed_prior_restore_timer_blocks(self):
        for state in ("active", "failed", "activating"):
            with self.subTest(state=state):
                report = m.evaluate(PUBLIC, True, {**BASE, m.ROLLBACK_TIMER: state})
                self.assertFalse(report["rollback_timer_idle"])
                self.assertIn("RESTORE_TIMER_NOT_IDLE", report["unresolved"])

    def test_expired_public_dba_receipt_blocks_despite_valid_worker(self):
        expired = {**PUBLIC, "issuer_current_4min": False,
                   "readiness": "BLOCKED", "public_custody_current": False}
        report = m.evaluate(expired, True, BASE)
        self.assertFalse(report["public_custody_current"])
        self.assertIn("CUSTODY_OR_CLOSED_SITE_NOT_CURRENT", report["unresolved"])

    def test_changed_nginx_or_boot_sha_blocks(self):
        for key in ("boot_guard_sha", "closed_vhost_sha", "exactly_one_closed_gate",
                    "rollback_backup_absent", "dba_preparation_off",
                    "issuer_worker_binding_valid"):
            with self.subTest(key=key):
                broken = {**PUBLIC, key: False}
                self.assertFalse(m.evaluate(broken, True, BASE)["public_custody_current"])
        self.assertIn("ROOT_RESTORE_GUARD_SHA_UNVERIFIED",
                      m.evaluate(PUBLIC, False, BASE)["unresolved"])

    def test_denies_unknown_systemd_units_before_subprocess(self):
        with patch.object(m.subprocess, "run", side_effect=AssertionError("executed")):
            with self.assertRaisesRegex(m.ReadonlyDenied, "UNKNOWN_UNIT"):
                m.read_unit_state("nginx.service")

    def test_systemd_state_is_observed_without_control_or_mutation(self):
        for state in ("active", "inactive", "failed", "not-found"):
            with self.subTest(state=state), patch.object(m.subprocess, "run") as run:
                run.return_value.returncode = 0
                run.return_value.stdout = (state + "\n").encode()
                self.assertEqual(m.read_unit_state(m.WATCHER_TIMER), state)
                args = run.call_args.args[0]
                self.assertEqual(args[:2], ["systemctl", "show"])
                self.assertEqual(args[2], m.WATCHER_TIMER)
                self.assertNotIn("start", args)
                self.assertNotIn("stop", args)
                self.assertNotIn("restart", args)

    def test_unrecognized_systemd_response_denies(self):
        with patch.object(m.subprocess, "run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = b"unknown-state\n"
            with self.assertRaisesRegex(m.ReadonlyDenied, "UNRECOGNIZED"):
                m.read_unit_state(m.WATCHER_TIMER)

    def test_nonroot_or_cli_execute_never_reads_protected_inputs(self):
        with patch.object(m.os, "geteuid", return_value=500), \
             patch.object(m, "public_inspect", side_effect=AssertionError("called")):
            self.assertFalse(m.inspect()["live_e2e_ready"])
        with patch.object(m.os, "geteuid", return_value=0), \
             patch.object(m.os, "getegid", return_value=0), \
             patch.object(m.sys, "argv", ["v10.py", "--execute"]), \
             patch.object(m, "public_inspect", side_effect=AssertionError("called")):
            self.assertEqual(m.inspect()["action"], "RETAIN_NGINX_503")

    def test_root_introspection_is_still_no_go_even_if_all_metadata_pass(self):
        with patch.object(m.os, "geteuid", return_value=0), \
             patch.object(m.os, "getegid", return_value=0), \
             patch.object(m.sys, "argv", ["v10.py"]), \
             patch.object(m, "public_inspect", return_value=PUBLIC), \
             patch.object(m, "root_guard_verified", return_value=True), \
             patch.object(m, "read_unit_state", side_effect=lambda name: BASE[name]):
            report = m.inspect()
        self.assertFalse(report["live_e2e_ready"])
        self.assertEqual(report["readiness"], "BLOCKED")
        self.assertTrue(report["public_custody_current"])

    def test_no_operator_executor_or_silent_authorization_source(self):
        text = SRC.read_text()
        for forbidden in ("os.replace(", "os.system(", "ALTER ROLE",
                          "systemctl start", "systemctl stop", "systemd-run",
                          "nginx -s reload", "psycopg.connect(", "requests.post(",
                          "ready_to_arm\": True", "live_e2e_ready\": True"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, text)
        self.assertIn("return 2  # Inert preflight", text)


if __name__ == "__main__":
    main()
