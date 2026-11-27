#!/usr/bin/env python3
"""Synthetic tests only: original GPT02 rollback plus all four allowed DEV cutovers.

No network, Nginx reload, systemd timer, credentials or database are accessed.
"""
from __future__ import annotations
from contextlib import contextmanager
from itertools import product
import hashlib
import os
import subprocess
import sys
import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import gpt02_1782_failclosed_boot_precheck as boot

SOURCE = Path(__file__).with_name("gpt02_owner_ledger_nginx_restore_guard.py")
spec = importlib.util.spec_from_file_location("gpt02_guard_tested", SOURCE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

BASELINE = (
    b"server {\n"
    b"    server_name dev-ai-task.cstlogistic.co.id;\n"
    b"    location ^~ /api/gpt02-owner-ledger/ {\n"
    b"      add_header Cache-Control \"no-store\" always;\n"
    b"      if ($request_method != GET) { return 405; }\n"
    + b"      " + mod.GATE + b"\n"
    b"      limit_except GET { deny all; }\n"
    b"      proxy_pass http://127.0.0.1:18082;\n"
    b"      proxy_set_header Authorization $http_authorization;\n"
    b"    }\n"
    b"    location = /api/bridge/admin/jobs {\n"
    b"      limit_except GET { deny all; }\n"
    b"      proxy_pass http://127.0.0.1:18296;\n"
    b"    }\n"
    b"    location = /api/bridge/admin/sessions {\n"
    b"      limit_except GET { deny all; }\n"
    b"      proxy_pass http://127.0.0.1:18296;\n"
    b"    }\n"
    b"    location ^~ /api/bridge/admin/jobs/ {\n"
    b"      limit_except GET { deny all; }\n"
    b"      proxy_pass http://127.0.0.1:18296;\n"
    b"    }\n"
    b"    location / {\n"
    b"      proxy_pass http://127.0.0.1:18501;\n"
    b"    }\n"
    b"}\n"
)

def switched(data: bytes, indices: set[int]) -> bytes:
    for index in sorted(indices):
        marker, prior = boot.ALLOWED_UPSTREAM_TRANSITIONS[index]
        assert data.count(marker) == 1
        start = data.index(marker)
        end = data.index(b"\n    }", start)
        assert end >= 0
        block = data[start:end]
        assert block.count(prior) == 1
        data = data[:start] + block.replace(prior, boot.NEW_PROXY, 1) + data[end:]
    return data

class GuardTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.active = self.root / "active.conf"
        self.backup = self.root / "backup.conf"
        self.active.write_bytes(BASELINE)
        old_sha = boot.ORIGINAL_CLOSED_SHA256
        fixture_sha = hashlib.sha256(BASELINE).hexdigest()
        boot.ORIGINAL_CLOSED_SHA256 = fixture_sha
        self.addCleanup(lambda: setattr(boot, "ORIGINAL_CLOSED_SHA256", old_sha))
        # Verified boot bytes are compiled into an isolated namespace. The
        # disposable fixture must configure THAT namespace as well; the real
        # pin in source and root installation stays untouched.
        verified_globals = mod.canonical_closed.__globals__
        verified_pin = verified_globals["ORIGINAL_CLOSED_SHA256"]
        verified_globals["ORIGINAL_CLOSED_SHA256"] = fixture_sha
        self.addCleanup(lambda: verified_globals.__setitem__(
            "ORIGINAL_CLOSED_SHA256", verified_pin))

    @contextmanager
    def root_backup_metadata(self):
        old_stat = Path.stat
        def f(path, *args, **kwargs):
            item = old_stat(path, *args, **kwargs)
            if path == self.backup:
                return SimpleNamespace(
                    st_mode=item.st_mode, st_uid=0, st_gid=0,
                    st_nlink=1, st_size=item.st_size
                )
            return item
        with patch.object(Path, "stat", f):
            yield

    def prepare_closed(self, data=BASELINE):
        self.active.write_bytes(data)
        self.assertEqual(mod.prepare(self.active, self.backup), mod.digest(data))
        self.backup.chmod(0o600)
        self.assertEqual(self.backup.read_bytes(), data)

    def test_original_restore_uses_same_whole_file_integrity_gate_as_boot_guard(self):
        self.assertTrue(mod.checked(BASELINE))
        self.assertTrue(mod.canonical_closed(BASELINE))
        self.assertEqual(mod.canonical_closed(BASELINE), boot.canonical_closed(BASELINE))
        self.assertFalse(mod.checked(BASELINE + b"unexpected"))

    def test_runtime_uses_the_existing_hyphen_named_boot_script_not_uninstalled_underscore_module(self):
        path, is_live = mod.boot_source_path(mod.LIVE_RESTORE)
        self.assertEqual(path, Path("/usr/local/sbin/gpt02-1782-failclosed-boot-precheck.py"))
        self.assertTrue(is_live)
        local, is_live = mod.boot_source_path(SOURCE)
        self.assertEqual(local, SOURCE.with_name("gpt02_1782_failclosed_boot_precheck.py"))
        self.assertFalse(is_live)

    def test_verified_helper_is_byte_pinned_and_does_not_start_the_boot_script(self):
        pinned = SOURCE.with_name("gpt02_1782_failclosed_boot_precheck.py")
        helper = mod.load_pinned_boot_canonical(pinned, live=False)
        helper.__globals__["ORIGINAL_CLOSED_SHA256"] = hashlib.sha256(BASELINE).hexdigest()
        self.assertTrue(helper(BASELINE))
        self.assertFalse(helper(BASELINE+b"unexpected"))
        self.assertEqual(mod.BOOT_SOURCE_SHA256, hashlib.sha256(pinned.read_bytes()).hexdigest())

    def test_rejects_wrong_or_old_boot_script_sha_before_parsing_or_exec(self):
        path = self.root / "old-boot-source.py"
        path.write_bytes(SOURCE.with_name("gpt02_1782_failclosed_boot_precheck.py").read_bytes()+b"\n# unapproved edit\n")
        with self.assertRaisesRegex(RuntimeError, "BOOT_MODULE_SHA_NOT_APPROVED"):
            mod.load_pinned_boot_canonical(path, live=False)

    def test_rejects_boot_helper_symlink_missing_path_and_bad_root_file_mode(self):
        existing = SOURCE.with_name("gpt02_1782_failclosed_boot_precheck.py")
        symlink = self.root / "boot-link.py"
        symlink.symlink_to(existing)
        with self.assertRaisesRegex(RuntimeError, "BOOT_MODULE_UNAVAILABLE"):
            mod.load_pinned_boot_canonical(symlink, live=False)
        with self.assertRaisesRegex(RuntimeError, "BOOT_MODULE_UNAVAILABLE"):
            mod.load_pinned_boot_canonical(self.root/"does-not-exist.py", live=False)
        temp = self.root/"boot-root-mode.py"
        temp.write_bytes(existing.read_bytes())
        temp.chmod(0o644)
        with self.assertRaisesRegex(RuntimeError, "BOOT_MODULE_ROOT0700_REQUIRED"):
            mod.load_pinned_boot_canonical(temp, live=True)

    def test_prepare_requires_full_canonical_closed_baseline_not_just_a_visible_gate(self):
        candidate = BASELINE.replace(b'"no-store"', b'"public"')
        self.active.write_bytes(candidate)
        with self.assertRaisesRegex(mod.GuardError, "BASELINE_GATE_INVALID"):
            mod.prepare(self.active, self.backup)
        self.assertFalse(self.backup.exists())

    def test_prepare_preserves_exact_original_digest_and_does_not_open_gate(self):
        self.prepare_closed()
        self.assertEqual(self.active.read_bytes(), BASELINE)
        self.assertEqual(self.backup.read_bytes(), BASELINE)

    def test_all_sixteen_approved_concurrent_cutovers_restore_exact_gate_without_reverting_upstreams(self):
        original = BASELINE
        self.prepare_closed(original)
        for choices in product((False, True), repeat=4):
            with self.subTest(choices=choices):
                subset = {index for index, flag in enumerate(choices) if flag}
                changed_closed = switched(original, subset)
                opened = changed_closed.replace(mod.GATE, mod.COMMENT, 1)
                self.assertNotIn(mod.GATE, opened)
                self.active.write_bytes(opened)
                with self.root_backup_metadata(), patch.object(mod, "run_maintenance") as maintenance, \
                     patch.object(mod, "verify_public_gate_closed") as status:
                    outcome = mod.restore(
                        self.active, self.backup, ["nginx", "-t"], ["systemctl", "reload", "nginx"]
                    )
                    self.assertEqual(outcome, "RESTORED_GATE_CLOSED_VERIFIED")
                    maintenance.assert_called_once()
                    status.assert_called_once()
                self.assertEqual(self.active.read_bytes(), changed_closed)
                self.assertTrue(boot.canonical_closed(self.active.read_bytes()))
                self.assertEqual(self.backup.read_bytes(), original)

    def test_already_closed_with_any_allowed_cutover_does_not_reload_nginx(self):
        self.prepare_closed(BASELINE)
        for choices in product((False, True), repeat=4):
            changed = switched(BASELINE, {i for i, flag in enumerate(choices) if flag})
            self.active.write_bytes(changed)
            with self.root_backup_metadata(), patch.object(mod, "run_maintenance") as maintenance, \
                 patch.object(mod, "verify_public_gate_closed") as status:
                self.assertEqual(mod.restore(self.active, self.backup, [], []),
                                 "ALREADY_CLOSED_RELOADED_VERIFIED")
                maintenance.assert_called_once()
                status.assert_called_once()

    def test_http503_without_json_or_no_store_fails_verification(self):
        valid=(
            b"HTTP/1.1 503 Service Temporarily Unavailable\r\n"
            b"Content-Type: application/json\r\n"
            b"Cache-Control: no-store\r\n"
            b"\r\n"
            b'{"error":"GPT02_LEDGER_READER_NOT_PROVISIONED"}'
        )
        cases=[
            valid.replace(b"503 ", b"200 ",1),
            valid.replace(b"Cache-Control: no-store\r\n", b""),
            valid.replace(b"application/json",b"text/html"),
            valid.replace(b"GPT02_LEDGER_READER_NOT_PROVISIONED", b"other"),
            b"garbage",
        ]
        for response in cases:
            with self.subTest(response=response[:80]), patch.object(mod.subprocess,"run") as run:
                run.return_value.returncode=0
                run.return_value.stdout=response
                with self.assertRaisesRegex(mod.GuardError,"PUBLIC_GATE_NOT_VERIFIED_503"):
                    mod.verify_public_gate_closed()
        with patch.object(mod.subprocess,"run") as run:
            run.return_value.returncode=0
            run.return_value.stdout=valid
            mod.verify_public_gate_closed()
            args=run.call_args.args[0]
            self.assertIn("--resolve",args)
            self.assertIn("dev-ai-task.cstlogistic.co.id:443:127.0.0.1",args)
            self.assertNotIn("-H",args)
            self.assertNotIn("--header",args)
            self.assertNotIn("--data",args)

    def test_reloaded_already_closed_state_with_failed_public_check_is_not_a_false_pass(self):
        self.prepare_closed()
        self.active.write_bytes(switched(BASELINE,{0,2}))
        with self.root_backup_metadata(),patch.object(mod,"run_maintenance") as maintenance,\
             patch.object(mod,"verify_public_gate_closed",side_effect=mod.GuardError("PUBLIC_GATE_NOT_VERIFIED_503")):
            with self.assertRaisesRegex(mod.GuardError,"PUBLIC_GATE_NOT_VERIFIED_503"):
                mod.restore(self.active,self.backup,["nginx","-t"],["systemctl","reload","nginx"])
            maintenance.assert_called_once()
        self.assertTrue(boot.canonical_closed(self.active.read_bytes()))

    def test_nonallowlisted_concurrent_edit_still_refuses_to_overwrite(self):
        self.prepare_closed()
        changes = [
            BASELINE.replace(b"no-store", b"public"),
            BASELINE.replace(b":18296;", b":18444;", 1),
            BASELINE.replace(b"if ($request_method != GET)", b"if ($request_method != POST)"),
            BASELINE + b"\n# concurrent unapproved edit\n",
            BASELINE.replace(b"proxy_set_header Authorization", b"proxy_set_header X-Bogus"),
        ]
        for changed in changes:
            with self.subTest(hash=hashlib.sha256(changed).hexdigest()):
                opened = changed.replace(mod.GATE, mod.COMMENT, 1)
                self.active.write_bytes(opened)
                with self.root_backup_metadata(), patch.object(mod, "run_maintenance") as maintenance:
                    with self.assertRaisesRegex(mod.GuardError, "UNEXPECTED_NGINX_CHANGE_REFUSED"):
                        mod.restore(self.active, self.backup, [], [])
                    maintenance.assert_not_called()
                self.assertEqual(self.active.read_bytes(), opened)

    def test_open_gate_without_exact_comment_or_with_duplicate_comment_refuses_restore(self):
        self.prepare_closed()
        cases = [
            BASELINE.replace(mod.GATE, b""),
            BASELINE.replace(mod.GATE, b"return 200 '{}';"),
            BASELINE.replace(mod.GATE, mod.COMMENT + b"\n" + mod.COMMENT),
            BASELINE.replace(mod.GATE, mod.COMMENT).replace(b"limit_except GET", b"limit_except POST"),
        ]
        for candidate in cases:
            with self.subTest(length=len(candidate)):
                self.active.write_bytes(candidate)
                with self.root_backup_metadata(), patch.object(mod, "run_maintenance") as maintenance:
                    with self.assertRaisesRegex(mod.GuardError, "UNEXPECTED_NGINX_CHANGE_REFUSED"):
                        mod.restore(self.active, self.backup, [], [])
                    maintenance.assert_not_called()

    def test_wrong_backup_content_denied(self):
        self.backup.write_bytes(BASELINE.replace(b"no-store", b"public"))
        self.backup.chmod(0o600)
        self.active.write_bytes(BASELINE.replace(mod.GATE, mod.COMMENT, 1))
        with self.root_backup_metadata():
            with self.assertRaisesRegex(mod.GuardError, "UNTRUSTED_BACKUP_GATE"):
                mod.restore(self.active, self.backup, [], [])

    def test_backup_not_root_or_not_mode_0600_denied(self):
        self.prepare_closed()
        self.active.write_bytes(BASELINE.replace(mod.GATE, mod.COMMENT, 1))
        with self.assertRaisesRegex(mod.GuardError, "INVALID_BACKUP"):
            mod.restore(self.active, self.backup, [], [])
        self.backup.chmod(0o644)
        with self.root_backup_metadata():
            with self.assertRaisesRegex(mod.GuardError, "INVALID_BACKUP"):
                mod.restore(self.active, self.backup, [], [])

    def test_refuse_arming_with_open_or_unknown_gate(self):
        candidate = BASELINE.replace(mod.GATE, mod.COMMENT, 1)
        self.active.write_bytes(candidate)
        with self.assertRaisesRegex(mod.GuardError, "BASELINE_GATE_INVALID"):
            mod.prepare(self.active, self.backup)

    def test_backup_symlink_and_active_symlink_denied(self):
        self.backup.symlink_to(self.active)
        with self.assertRaisesRegex(mod.GuardError, "BACKUP_EXISTS"):
            mod.prepare(self.active, self.backup)
        self.backup.unlink()
        link = self.root / "active-link.conf"
        link.symlink_to(self.active)
        with self.assertRaisesRegex(mod.GuardError, "ACTIVE_NOT_REGULAR"):
            mod.prepare(link, self.backup)

    def test_default_active_path_uses_installed_sites_enabled_not_sites_available(self):
        self.assertEqual(
            mod.NGINX,
            Path("/etc/nginx/sites-enabled/dev-ai-task.cstlogistic.co.id"),
        )
        self.assertEqual(mod.NGINX, boot.ACTIVE)
        self.assertNotIn("/sites-available/", str(mod.NGINX))

    def test_arm_early_30_seconds_with_explicit_accuracy_and_no_gate_open(self):
        unit = "gpt02-1782-owner-ledger-restore"
        properties = (b"ActiveState=active\nAccuracyUSec=1s\n"
                      b"RandomizedDelayUSec=0\nUnit=" + unit.encode() + b".service\n")
        with patch.object(mod, "trusted_script", return_value=True), \
             patch.object(mod.subprocess, "run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = properties
            answer = mod.arm(self.active, self.backup, 30, SOURCE)
            self.assertIn("WATCHDOG_ARMED_EARLY_WITH_VERIFIED_ACCURACY", answer)
            scheduled = run.call_args_list[0].args[0]
            self.assertIn("--on-active=30s", scheduled)
            self.assertIn("--timer-property=AccuracySec=1s", scheduled)
            self.assertIn("--timer-property=RandomizedDelaySec=0", scheduled)
            self.assertNotIn("--on-active=90s", scheduled)
            confirm = run.call_args_list[1].args[0]
            self.assertEqual(confirm[:3],
                             ["systemctl", "show", unit + ".timer"])
            self.assertIn("--property=AccuracyUSec", confirm)
            self.assertIn("--property=RandomizedDelayUSec", confirm)
            self.assertIn("--property=Unit", confirm)
        self.assertEqual(self.active.read_bytes(), BASELINE)
        self.assertEqual(self.backup.read_bytes(), BASELINE)

    def test_arm_rejects_all_non_30_second_delays_including_old_90(self):
        for delay in (0, 29, 31, 90, 91, 181, 600):
            with self.subTest(delay=delay):
                with self.assertRaisesRegex(mod.GuardError, "WATCHDOG_DURATION_INVALID"):
                    mod.arm(self.active, self.backup, delay, SOURCE)
        self.assertFalse(self.backup.exists())

    def test_arm_timer_schedule_failure_does_not_open_gate(self):
        with patch.object(mod, "trusted_script", return_value=True), \
             patch.object(mod.subprocess, "run") as run:
            run.return_value.returncode = 1
            with self.assertRaisesRegex(mod.GuardError, "WATCHDOG_SCHEDULE_FAILED"):
                mod.arm(self.active, self.backup, 30, SOURCE)
        self.assertEqual(self.active.read_bytes(), BASELINE)
        self.assertTrue(self.backup.exists())


    def test_timer_properties_reject_default_one_minute_accuracy(self):
        unit = "gpt02-1782-owner-ledger-restore"
        baseline = (
            "ActiveState=active\nAccuracyUSec=1s\nRandomizedDelayUSec=0\n"
            "Unit=" + unit + ".service\n"
        ).encode()
        invalid = [
            baseline.replace(b"AccuracyUSec=1s", b"AccuracyUSec=1min"),
            baseline.replace(b"AccuracyUSec=1s", b"AccuracyUSec=30s"),
            baseline.replace(b"RandomizedDelayUSec=0", b"RandomizedDelayUSec=5s"),
            baseline.replace(b"ActiveState=active", b"ActiveState=inactive"),
            baseline.replace(b"Unit=" + unit.encode(), b"Unit=other-unit"),
            baseline + b"AccuracyUSec=1s\n",
            baseline.replace(b"RandomizedDelayUSec=0\n", b""),
            b"UNEXPECTED_SYSTEMD_STATE",
            b"\xff\xff",
        ]
        for contents in invalid:
            with self.subTest(payload=contents[:90]), patch.object(mod.subprocess,"run") as run:
                run.return_value.returncode=0
                run.return_value.stdout=contents
                with self.assertRaisesRegex(mod.GuardError,"WATCHDOG_PROPERTIES_UNVERIFIED"):
                    mod.verify_armed_timer_properties(unit)

    def test_timer_property_check_rejects_systemctl_failure_or_huge_output(self):
        unit="gpt02-1782-owner-ledger-restore"
        for code,payload in ((1,b""),(0,b"A"*4097)):
            with self.subTest(code=code),patch.object(mod.subprocess,"run") as run:
                run.return_value.returncode=code
                run.return_value.stdout=payload
                with self.assertRaisesRegex(mod.GuardError,"WATCHDOG_PROPERTIES_UNVERIFIED"):
                    mod.verify_armed_timer_properties(unit)

    def test_arm_rejects_unsafe_actual_timer_properties_before_nginx_changes(self):
        with patch.object(mod, "trusted_script", return_value=True), \
             patch.object(mod.subprocess, "run") as run:
            run.return_value.returncode=0
            run.return_value.stdout=(
                b"ActiveState=active\nAccuracyUSec=1min\n"
                b"RandomizedDelayUSec=0\n"
                b"Unit=gpt02-1782-owner-ledger-restore.service\n"
            )
            with self.assertRaisesRegex(mod.GuardError,"WATCHDOG_PROPERTIES_UNVERIFIED"):
                mod.arm(self.active,self.backup,30,SOURCE)
        self.assertEqual(self.active.read_bytes(),BASELINE)
        self.assertEqual(self.backup.read_bytes(),BASELINE)

    def test_timer_contract_is_early_but_not_real_time_guarantee(self):
        self.assertEqual(mod.PRIMARY_RESTORE_DELAY_SECONDS,30)
        self.assertEqual(mod.PRIMARY_TIMER_ACCURACY,"1s")
        self.assertEqual(mod.PRIMARY_TIMER_RANDOMIZED_DELAY,"0")
        modeled=30+1+20+20+7+6
        self.assertEqual(modeled,84)
        self.assertLess(modeled,90)
        self.assertIn("Scheduling latency remains unbounded", SOURCE.read_text())

class SerializedRecoveryTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.backup = Path(tmp.name) / "sealed-fixture.conf"
        self.backup.write_bytes(b"synthetic closed backup")
        self.backup.chmod(0o600)
        self.active = Path(tmp.name) / "fixture-active.conf"

    def acquire(self, path=None):
        return mod._acquire_backup_lock(path or self.backup,
            expected_uid=os.geteuid(), expected_gid=os.getegid())

    def test_second_recovery_denied_and_release_allows_next(self):
        fd = self.acquire()
        try:
            with self.assertRaisesRegex(mod.GuardError, "ALREADY_IN_PROGRESS"):
                self.acquire()
        finally:
            os.close(fd)
        os.close(self.acquire())

    def test_holder_crash_releases_fixture_backup_lock(self):
        proc = subprocess.Popen([sys.executable, "-u", "-c",
            "import fcntl,sys,time; f=open(sys.argv[1],'rb'); "
            "fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB); "
            "print('LOCKED',flush=True); time.sleep(30)",
            str(self.backup)], stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(proc.stdout.readline().strip(), "LOCKED")
            with self.assertRaisesRegex(mod.GuardError, "ALREADY_IN_PROGRESS"):
                self.acquire()
            proc.kill()
            proc.wait(timeout=5)
            os.close(self.acquire())
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)
            proc.stdout.close()

    def test_bad_backup_mode_symlink_and_hardlink_rejected(self):
        self.backup.chmod(0o644)
        with self.assertRaisesRegex(mod.GuardError, "UNTRUSTED"):
            self.acquire()
        self.backup.chmod(0o600)
        link = self.backup.with_name("link")
        link.symlink_to(self.backup)
        with self.assertRaisesRegex(mod.GuardError, "UNAVAILABLE"):
            self.acquire(link)
        link.unlink()
        os.link(self.backup, link)
        with self.assertRaisesRegex(mod.GuardError, "UNTRUSTED"):
            self.acquire()
        link.unlink()
        os.close(self.acquire())

    def test_missing_backup_never_created(self):
        self.backup.unlink()
        with self.assertRaisesRegex(mod.GuardError, "UNAVAILABLE"):
            self.acquire()
        self.assertFalse(self.backup.exists())

    def test_serialized_cli_holds_lock_through_existing_restore(self):
        real_identity = mod._backup_lock_identity
        uid, gid = os.geteuid(), os.getegid()
        def identity(fd, path, **_):
            return real_identity(fd, path, expected_uid=uid, expected_gid=gid)
        # Keep actual lock acquisition on both independent file descriptors.
        # Only map ownership checks to the non-root fixture UID/GID.
        def restore(*_, lock_fd=None):
            self.assertIsInstance(lock_fd, int)
            self.assertGreater(os.fstat(lock_fd).st_size, 0)
            with self.assertRaisesRegex(mod.GuardError, "ALREADY_IN_PROGRESS"):
                self.acquire()
            return "RESTORED_GATE_CLOSED_VERIFIED"
        with patch.object(mod, "_backup_lock_identity", side_effect=identity), \
             patch.object(mod, "restore", side_effect=restore) as original:
            self.assertEqual(mod.restore_serialized(self.active, self.backup, [], []),
                             "RESTORED_GATE_CLOSED_VERIFIED")
            original.assert_called_once_with(self.active, self.backup, [], [],
                                             lock_fd=original.call_args.kwargs["lock_fd"])
        os.close(self.acquire())

    def test_serialized_failure_releases_lock(self):
        real_identity = mod._backup_lock_identity
        # Exercise the real acquire/finally/close path, not a pre-acquired fd.
        with patch.object(mod, "_backup_lock_identity",
                side_effect=lambda fd, path, **_: real_identity(fd, path,
                    expected_uid=os.geteuid(), expected_gid=os.getegid())), \
             patch.object(mod, "restore", side_effect=mod.GuardError("fixture")):
            with self.assertRaisesRegex(mod.GuardError, "fixture"):
                mod.restore_serialized(self.active, self.backup, [], [])
        os.close(self.acquire())

    def test_contended_cli_never_calls_restore(self):
        with patch.object(mod, "_acquire_backup_lock",
                          side_effect=mod.GuardError("RECOVERY_ALREADY_IN_PROGRESS")), \
             patch.object(mod, "restore") as restore:
            with self.assertRaisesRegex(mod.GuardError, "ALREADY_IN_PROGRESS"):
                mod.restore_serialized(self.active, self.backup, [], [])
            restore.assert_not_called()

    def test_maintenance_inherits_real_backup_lock_and_checks_pid1_job(self):
        fd = self.acquire()
        try:
            responses = [
                SimpleNamespace(returncode=0),
                SimpleNamespace(returncode=0, stdout=b"Job=\\n"),
                SimpleNamespace(returncode=0),
            ]
            with patch.object(mod.subprocess, "run", side_effect=responses) as run:
                mod.run_maintenance(["fixture-test"], ["fixture-reload"], lock_fd=fd)
            self.assertEqual(run.call_count, 3)
            self.assertEqual(run.call_args_list[0].kwargs["pass_fds"], (fd,))
            self.assertEqual(run.call_args_list[1].args[0],
                             ["systemctl", "show", "nginx.service", "--property=Job"])
            self.assertEqual(run.call_args_list[1].kwargs["timeout"], 3)
            self.assertEqual(run.call_args_list[2].kwargs["pass_fds"], (fd,))
        finally:
            os.close(fd)

    def test_pending_or_unverified_pid1_job_never_invokes_reload(self):
        fd = self.acquire()
        try:
            for response in (
                SimpleNamespace(returncode=0, stdout=b"Job=123\\n"),
                SimpleNamespace(returncode=0, stdout=b""),
                SimpleNamespace(returncode=0, stdout=b"Job=\\nJob=\\n"),
                SimpleNamespace(returncode=1, stdout=b"Job=\\n"),
            ):
                with self.subTest(response=response), patch.object(
                    mod.subprocess, "run", side_effect=[SimpleNamespace(returncode=0), response]
                ) as run:
                    with self.assertRaisesRegex(mod.GuardError, "NGINX_JOB_PENDING_OR_UNVERIFIED"):
                        mod.run_maintenance(["fixture-test"], ["fixture-reload"], lock_fd=fd)
                    self.assertEqual(run.call_count, 2)
        finally:
            os.close(fd)

    def test_pid1_probe_timeout_never_invokes_reload(self):
        fd = self.acquire()
        try:
            with patch.object(mod.subprocess, "run", side_effect=[
                SimpleNamespace(returncode=0), subprocess.TimeoutExpired("fixture", 3)
            ]) as run:
                with self.assertRaises(subprocess.TimeoutExpired):
                    mod.run_maintenance(["fixture-test"], ["fixture-reload"], lock_fd=fd)
                self.assertEqual(run.call_count, 2)
        finally:
            os.close(fd)

    def test_inherited_fixture_child_retains_lock_after_parent_death(self):
        parent_code = (
            "import fcntl,os,subprocess,sys; "
            "fd=os.open(sys.argv[1],os.O_RDONLY|os.O_CLOEXEC); "
            "fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB); "
            "p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(20)'],"
            "pass_fds=(fd,),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); "
            "print(p.pid,flush=True); p.wait()"
        )
        import signal
        import time
        proc = subprocess.Popen([sys.executable, "-u", "-c", parent_code, str(self.backup)],
                                stdout=subprocess.PIPE, text=True, start_new_session=True)
        try:
            child = int(proc.stdout.readline().strip())
            proc.kill()
            proc.wait(timeout=5)
            os.kill(child, 0)
            with self.assertRaisesRegex(mod.GuardError, "ALREADY_IN_PROGRESS"):
                self.acquire()
        finally:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            proc.wait(timeout=5)
            proc.stdout.close()
        deadline = time.monotonic() + 3
        while True:
            try:
                fd = self.acquire()
            except mod.GuardError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.05)
            else:
                os.close(fd)
                break

    def test_cli_uses_only_serialized_restore(self):
        with patch.object(mod.os, "geteuid", return_value=0), \
             patch.object(mod.sys, "argv", ["guard.py", "--restore"]), \
             patch.object(mod, "restore_serialized", return_value="fixture") as locked, \
             patch.object(mod, "restore") as raw:
            self.assertEqual(mod.main(), 0)
            locked.assert_called_once()
            raw.assert_not_called()


if __name__ == "__main__":
    unittest.main()
