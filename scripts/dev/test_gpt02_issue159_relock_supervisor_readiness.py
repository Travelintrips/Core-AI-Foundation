#!/usr/bin/env python3
"""Offline checks for the existing DEV relock supervisor approval gate."""
import os
import stat
import subprocess
import unittest
from types import SimpleNamespace

from gpt02_issue159_relock_supervisor_readiness import (
    TIMER, SERVICE, independent_relock_supervisor_ready,
)

NOW_US = 2_000_000_000


class RelockSupervisorReadinessTest(unittest.TestCase):
    def setUp(self):
        self.meta = SimpleNamespace(
            st_mode=stat.S_IFREG | 0o600, st_uid=0, st_gid=0,
            st_nlink=1, st_size=256,
        )
        self.timer = {
            "LoadState": "loaded", "UnitFileState": "enabled",
            "ActiveState": "active",
        }
        self.service = {
            "LoadState": "loaded", "ConditionResult": "yes",
            "Result": "success", "ExecMainStatus": "0",
            "ActiveState": "inactive",
            "ExecMainStartTimestampMonotonic": str(NOW_US - 2_000_000),
            "ExecMainExitTimestampMonotonic": str(NOW_US - 1_000_000),
        }
        self.calls = []
        self.fail_command = False

    def runner(self, argv, **kwargs):
        self.calls.append(tuple(argv))
        if argv[:2] != ["systemctl", "show"] or kwargs != {
            "capture_output": True, "text": True, "timeout": 3,
        }:
            raise AssertionError("UNEXPECTED_OR_MUTATING_SYSTEMCTL_CALL")
        if self.fail_command:
            return subprocess.CompletedProcess(argv, 1, stdout="")
        if argv[2] == TIMER:
            values = self.timer
        elif argv[2] == SERVICE:
            values = self.service
        else:
            raise AssertionError("UNEXPECTED_SYSTEMD_UNIT")
        return subprocess.CompletedProcess(
            argv, 0, stdout="".join(
                f"{k}={v}\n" for k, v in values.items()
            ),
        )

    def probe(self, meta=None, now=NOW_US):
        return independent_relock_supervisor_ready(
            runner=self.runner,
            statter=lambda path: self.meta if meta is None else meta,
            clock_us=now,
        )

    def test_recent_successful_supervisor_allows_preflight(self):
        self.assertTrue(self.probe())
        self.assertEqual(len(self.calls), 2)
        self.assertTrue(all(cmd[:2] == ("systemctl", "show")
                            for cmd in self.calls))

    def test_timer_disabled_or_inactive_is_not_ready(self):
        for key, bad in [
            ("UnitFileState", "disabled"), ("ActiveState", "inactive"),
            ("LoadState", "not-found"),
        ]:
            with self.subTest(key=key):
                self.timer[key] = bad
                self.calls.clear()
                self.assertFalse(self.probe())
                self.assertEqual(len(self.calls), 1)
                self.timer = {
                    "LoadState": "loaded", "UnitFileState": "enabled",
                    "ActiveState": "active",
                }

    def test_skipped_oneshot_with_stale_success_cannot_pass(self):
        # Exact observed VPS failure: systemctl start 0 but no invocation.
        self.service["ConditionResult"] = "no"
        self.assertFalse(self.probe())

    def test_no_successful_execution_timestamp_is_rejected(self):
        for key in ("ExecMainStartTimestampMonotonic",
                    "ExecMainExitTimestampMonotonic"):
            old = self.service[key]
            for bad in ("0", "", "nan", "-1"):
                with self.subTest(key=key, bad=bad):
                    self.service[key] = bad
                    self.assertFalse(self.probe())
            self.service[key] = old

    def test_expired_or_future_success_is_rejected(self):
        self.assertFalse(self.probe(now=NOW_US + 21_000_001))
        self.assertFalse(self.probe(now=NOW_US - 3_000_000))

    def test_failure_or_unhealthy_service_does_not_count(self):
        for key, bad in [
            ("Result", "exit-code"), ("ExecMainStatus", "3"),
            ("ActiveState", "failed"), ("LoadState", "not-found"),
        ]:
            with self.subTest(key=key):
                old = self.service[key]
                self.service[key] = bad
                self.assertFalse(self.probe())
                self.service[key] = old

    def test_insecure_credential_inode_is_rejected_before_systemctl(self):
        for changes in [
            {"st_uid": 1000}, {"st_gid": 1000},
            {"st_mode": stat.S_IFLNK | 0o600},
            {"st_mode": stat.S_IFREG | 0o644},
            {"st_nlink": 2}, {"st_size": 0}, {"st_size": 16385},
        ]:
            with self.subTest(changes=changes):
                self.calls.clear()
                fake = SimpleNamespace(**{**vars(self.meta), **changes})
                self.assertFalse(self.probe(meta=fake))
                self.assertFalse(self.calls)

    def test_missing_or_unreadable_credentials_deny_without_side_effect(self):
        for error in (FileNotFoundError("no credential"),
                      PermissionError("denied")):
            with self.subTest(error=str(error)):
                self.calls.clear()
                self.assertFalse(independent_relock_supervisor_ready(
                    runner=self.runner,
                    statter=lambda _: (_ for _ in ()).throw(error),
                    clock_us=NOW_US,
                ))
                self.assertFalse(self.calls)

    def test_command_errors_and_malformed_data_fail_closed(self):
        self.fail_command = True
        self.assertFalse(self.probe())
        self.fail_command = False
        for field in ("Result", "ConditionResult", "ActiveState"):
            old = self.service.pop(field)
            self.assertFalse(self.probe())
            self.service[field] = old

    def test_no_systemctl_start_or_credential_decryption_available(self):
        self.assertTrue(self.probe())
        all_args = " ".join(" ".join(cmd) for cmd in self.calls)
        for forbidden in (" start ", " enable ", " decrypt ",
                          " ALTER ", " GRANT ", " dispatch "):
            self.assertNotIn(forbidden, all_args)


if __name__ == "__main__":
    unittest.main()
