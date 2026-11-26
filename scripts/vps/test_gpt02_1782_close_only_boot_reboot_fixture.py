#!/usr/bin/env python3
"""Offline GPT02 boot-after-restart semantics. Only TEMPORARY fixture files.

These tests model a boot/start sequence by calling the EXISTING pinned pure
precheck on synthetic file paths; they do NOT restart the VPS or Nginx.
"""
import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SRC=Path(__file__).with_name("gpt02_1782_failclosed_boot_precheck.py")
spec=importlib.util.spec_from_file_location("gpt02_boot_recovery_fixture",SRC)
boot=importlib.util.module_from_spec(spec)
spec.loader.exec_module(boot)

CLOSED=b"server {\nlocation ^~ /api/gpt02-owner-ledger/ {\n"+boot.GATE+b"\n}\n}\n"
OPEN=CLOSED.replace(boot.GATE,boot.COMMENT,1)


class BootRestartFixtureTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name)
        self.active=root/"dev-ai-task.cstlogistic.co.id"
        self.backup=root/"gpt02-approved-backup.conf"
        self.active.write_bytes(CLOSED)
        self.allowed=patch.object(boot,"canonical_closed",
                                  side_effect=lambda data:data==CLOSED)
        self.allowed.start()
        self.addCleanup(self.allowed.stop)

    def test_repo_boot_guard_is_exact_installed_root_source(self):
        self.assertEqual(
            hashlib.sha256(SRC.read_bytes()).hexdigest(),
            "26ea880f87b4eed5dea9cda0bd907b03711262abe470cde65b6c2e8e4b4b0e32",
        )

    def test_boot_with_closed_gate_and_no_backup_passes_without_write(self):
        before=self.active.stat()
        result,code=boot.guarded(self.active,self.backup)
        self.assertEqual((result,code),("PASS_GATE_CLOSED",0))
        self.assertEqual(self.active.read_bytes(),CLOSED)
        self.assertEqual(self.active.stat().st_ino,before.st_ino)

    def test_start_after_open_with_exact_0600_backup_restores_fixture(self):
        self.backup.write_bytes(CLOSED)
        self.backup.chmod(0o600)
        self.active.write_bytes(OPEN)
        result,code=boot.guarded(self.active,self.backup)
        self.assertEqual((result,code),("PASS_RESTORED_GATE",0))
        self.assertEqual(self.active.read_bytes(),CLOSED)
        self.assertEqual(self.backup.read_bytes(),CLOSED)

    def test_start_after_open_without_rollback_backup_is_blocked(self):
        self.active.write_bytes(OPEN)
        result,code=boot.guarded(self.active,self.backup)
        self.assertEqual((result,code),("BLOCK_MISSING_BACKUP",2))
        self.assertEqual(self.active.read_bytes(),OPEN)

    def test_start_after_unrecognized_nginx_change_is_blocked(self):
        self.active.write_bytes(OPEN+b"\n# unknown deployment")
        self.backup.write_bytes(CLOSED)
        self.backup.chmod(0o600)
        result,code=boot.guarded(self.active,self.backup)
        self.assertEqual((result,code),("BLOCK_UNEXPECTED_ACTIVE_CHANGE",2))
        self.assertEqual(self.active.read_bytes(),OPEN+b"\n# unknown deployment")

    def test_start_with_untrusted_backup_mode_is_blocked(self):
        self.active.write_bytes(OPEN)
        self.backup.write_bytes(CLOSED)
        self.backup.chmod(0o644)
        result,code=boot.guarded(self.active,self.backup)
        self.assertEqual((result,code),("BLOCK_UNTRUSTED_BACKUP",2))
        self.assertEqual(self.active.read_bytes(),OPEN)

    def test_start_with_invalid_backup_bytes_is_blocked(self):
        self.active.write_bytes(OPEN)
        self.backup.write_bytes(CLOSED+b"\n# drift")
        self.backup.chmod(0o600)
        result,code=boot.guarded(self.active,self.backup)
        self.assertEqual((result,code),("BLOCK_INVALID_BASELINE",2))
        self.assertEqual(self.active.read_bytes(),OPEN)

    def test_start_with_backup_symlink_is_blocked(self):
        underlying=Path(self.temp.name)/"underlying"
        underlying.write_bytes(CLOSED)
        underlying.chmod(0o600)
        self.backup.symlink_to(underlying)
        self.active.write_bytes(OPEN)
        result,code=boot.guarded(self.active,self.backup)
        self.assertEqual((result,code),("BLOCK_MISSING_BACKUP",2))
        self.assertEqual(self.active.read_bytes(),OPEN)

    def test_start_with_active_symlink_is_blocked(self):
        target=Path(self.temp.name)/"target"
        target.write_bytes(CLOSED)
        self.active.unlink()
        self.active.symlink_to(target)
        result,code=boot.guarded(self.active,self.backup)
        self.assertEqual((result,code),("BLOCK_ACTIVE_NOT_REGULAR",2))
        self.assertEqual(target.read_bytes(),CLOSED)

    def test_start_with_double_opening_comment_refuses_restore(self):
        self.active.write_bytes(OPEN+b"\n"+boot.COMMENT)
        self.backup.write_bytes(CLOSED)
        self.backup.chmod(0o600)
        result,code=boot.guarded(self.active,self.backup)
        self.assertEqual((result,code),("BLOCK_UNEXPECTED_ACTIVE_CHANGE",2))

    def test_primary_and_secondary_are_independent_source_units(self):
        primary=Path(__file__).with_name("gpt02_owner_ledger_nginx_restore_guard.py")
        secondary=Path(__file__).with_name("gpt02_1782_close_only_fallback.py")
        a=primary.read_text()
        b=secondary.read_text()
        self.assertIn('unit = "gpt02-1782-owner-ledger-restore"',a)
        self.assertIn('BACKUP = Path("/etc/nginx/dev-ai-task.gpt02-1782-guard-backup.conf")',b)
        self.assertIn('"--active", str(ACTIVE)',b)
        self.assertNotIn('"--arm",',b)
        # Not an actual multi-timer race test or live boot proof.

    def test_secondary_timer_is_nonpersistent_and_too_late_for_primary_90s_cap(self):
        source=(Path(__file__).parents[2]/
                "deploy/ai-coding-standalone-dev/gpt02-1782-close-only-fallback.timer")
        text=source.read_text()
        self.assertIn("OnActiveSec=110s",text)
        self.assertIn("Persistent=false",text)
        self.assertNotIn("\n[Install]",text)
        # The secondary fallback is NEVER accepted as the primary deadline.

    def test_synthetic_boot_fixture_is_not_live_systemd_validation(self):
        self.assertEqual(boot.ACTIVE,Path("/etc/nginx/sites-enabled/dev-ai-task.cstlogistic.co.id"))
        self.assertNotEqual(self.active,boot.ACTIVE)
        self.assertFalse((Path(self.temp.name)/"systemd_service_started").exists())


if __name__=="__main__":
    unittest.main()
