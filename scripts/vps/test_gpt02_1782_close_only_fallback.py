#!/usr/bin/env python3
"""Synthetic close-only recovery tests; NEVER run Nginx/DB/systemd."""
import contextlib
import importlib.util
from io import StringIO
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SRC = Path(__file__).with_name("gpt02_1782_close_only_fallback.py")
spec = importlib.util.spec_from_file_location("gpt02_closeonly_test", SRC)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

GATE = b'return 503 \'{"error":"GPT02_LEDGER_READER_NOT_PROVISIONED"}\';'
COMMENT = b'# GPT02-1782 bounded Owner GET test: automatic rollback armed'
CLOSED = b"server { location ^~ /api/gpt02-owner-ledger/ {\n" + GATE + b"\n} }\n"
OPEN = CLOSED.replace(GATE, COMMENT, 1)


def fake_guard():
    def checked(value):
        return value == CLOSED
    def restore(value):
        if value != OPEN:
            raise ValueError("UNAPPROVED_OPEN_SITE")
        return CLOSED
    return {"checked": checked, "permitted_open_to_closed": restore}


class RecoveryTests(unittest.TestCase):
    def test_closed_no_backup_needs_only_effective_http503(self):
        self.assertEqual(m.recovery_plan(fake_guard(), CLOSED, None),
                         "CLOSED_NO_BACKUP_VERIFY_EFFECTIVE_503")

    def test_opened_with_exact_backup_is_restorable(self):
        self.assertEqual(m.recovery_plan(fake_guard(), OPEN, CLOSED),
                         "OPEN_SITE_RESTORE_APPROVED_GUARD")

    def test_closed_with_backup_requires_reload_verification(self):
        self.assertEqual(m.recovery_plan(fake_guard(), CLOSED, CLOSED),
                         "CLOSED_WITH_BACKUP_RELOAD_AND_VERIFY")

    def test_site_open_with_missing_backup_is_blocked(self):
        with self.assertRaisesRegex(m.RecoveryBlocked, "WITHOUT_APPROVED_BACKUP"):
            m.recovery_plan(fake_guard(), OPEN, None)

    def test_unknown_nginx_edit_fails_closed(self):
        with self.assertRaisesRegex(m.RecoveryBlocked, "NOT_EXACTLY_RESTORABLE"):
            m.recovery_plan(fake_guard(), OPEN+b"\n#unknown", CLOSED)

    def test_duplicate_comment_or_partial_open_is_blocked(self):
        with self.assertRaises(m.RecoveryBlocked):
            m.recovery_plan(fake_guard(), OPEN+b"\n"+COMMENT, CLOSED)

    def test_wrong_backup_or_wrong_original_is_blocked(self):
        with self.assertRaises(m.RecoveryBlocked):
            m.recovery_plan(fake_guard(), OPEN, CLOSED+b"\n#drift")
        with self.assertRaisesRegex(m.RecoveryBlocked, "MISMATCH"):
            m.recovery_plan(fake_guard(), CLOSED, b"wrong")

    def test_forged_missing_active_gate_is_blocked(self):
        with self.assertRaises(m.RecoveryBlocked):
            m.recovery_plan(fake_guard(), b"server {}\n", CLOSED)

    def test_guard_command_uses_explicit_sites_enabled_target(self):
        with patch.object(m.subprocess, "run") as run:
            run.return_value.returncode=0
            self.assertTrue(m.run_existing_restore())
        args=run.call_args.args[0]
        self.assertEqual(args[:3],
                         ["/usr/bin/python3",str(m.GUARD),"--restore"])
        self.assertEqual(args[args.index("--active")+1],str(m.ACTIVE))
        self.assertIn("/sites-enabled/",str(m.ACTIVE))
        self.assertEqual(args[args.index("--backup")+1],str(m.BACKUP))
        self.assertNotIn("/sites-available/",str(m.ACTIVE))
        self.assertNotIn("--arm",args)

    def test_deny_when_existing_restore_reports_failure(self):
        with patch.object(m, "capture_evidence", return_value=("OPEN_SITE_RESTORE_APPROVED_GUARD",OPEN)),\
             patch.object(m,"run_existing_restore",return_value=False):
            with self.assertRaisesRegex(m.RecoveryBlocked, "EXISTING_RESTORE_GUARD_FAILED"):
                m.close_only()

    def test_closed_without_backup_cannot_cause_reload(self):
        with patch.object(m,"capture_evidence",
                          return_value=("CLOSED_NO_BACKUP_VERIFY_EFFECTIVE_503",CLOSED)),\
             patch.object(m,"run_existing_restore",
                          side_effect=AssertionError("MUST_NOT_RELOAD")),\
             patch.object(m,"verify_live_503",return_value=True):
            result=m.close_only()
        self.assertEqual(result["recovery"],"EXACT_CLOSED_503_VERIFIED")
        self.assertFalse(result["existing_guard_invoked"])
        self.assertFalse(result["watcher_timer_resumed"])
        self.assertFalse(result["reader_sessions_verified"])
        self.assertFalse(result["owner_http404_e2e_verified"])

    def test_opened_and_restored_requires_live_503(self):
        seq=[("OPEN_SITE_RESTORE_APPROVED_GUARD",OPEN),
             ("CLOSED_WITH_BACKUP_RELOAD_AND_VERIFY",CLOSED)]
        with patch.object(m,"capture_evidence",side_effect=seq),\
             patch.object(m,"run_existing_restore",return_value=True) as restore,\
             patch.object(m,"verify_live_503",return_value=True):
            result=m.close_only()
        restore.assert_called_once_with()
        self.assertTrue(result["existing_guard_invoked"])
        self.assertEqual(result["active_target"],"sites-enabled")
        self.assertEqual(result["action"],"KEEP_GATE_CLOSED")

    def test_live_503_is_mandatory_after_guard_success(self):
        with patch.object(m,"capture_evidence",
                          return_value=("CLOSED_WITH_BACKUP_RELOAD_AND_VERIFY",CLOSED)),\
             patch.object(m,"run_existing_restore",return_value=True),\
             patch.object(m,"verify_live_503",return_value=False):
            with self.assertRaisesRegex(m.RecoveryBlocked,"EFFECTIVE_HTTPS_503_NOT_VERIFIED"):
                m.close_only()

    def test_503_wire_requires_json_and_no_store(self):
        base=(b'HTTP/1.1 503 Service Unavailable\r\n'
              b'Cache-Control: no-store\r\nContent-Type: application/json\r\n'
              b'\r\n{"error":"GPT02_LEDGER_READER_NOT_PROVISIONED"}')
        def run(response):
            with patch.object(m.subprocess,"run") as cmd:
                cmd.return_value=SimpleNamespace(returncode=0,stdout=response)
                return m.verify_live_503()
        self.assertTrue(run(base))
        self.assertFalse(run(base.replace(b'no-store',b'public')))
        self.assertFalse(run(base.replace(b'503 Service',b'404 Not')))
        self.assertFalse(run(base.replace(b'application/json',b'text/html')))
        self.assertFalse(run(base.replace(b'GPT02_LEDGER_READER_NOT_PROVISIONED',b'PASS')))
        self.assertFalse(run(b'<html>503</html>'))

    def test_unexpected_open_site_after_recovery_is_blocked(self):
        with patch.object(m,"capture_evidence",
                          side_effect=[("OPEN_SITE_RESTORE_APPROVED_GUARD",OPEN),
                                       ("OPEN_SITE_RESTORE_APPROVED_GUARD",OPEN)]),\
             patch.object(m,"run_existing_restore",return_value=True):
            with self.assertRaisesRegex(m.RecoveryBlocked,"SITE_NOT_CLOSED_AFTER_RESTORE"):
                m.close_only()

    def test_initially_closed_site_changed_after_check_is_rejected(self):
        with patch.object(m,"capture_evidence",
                          side_effect=[("CLOSED_NO_BACKUP_VERIFY_EFFECTIVE_503",CLOSED),
                                       ("CLOSED_NO_BACKUP_VERIFY_EFFECTIVE_503",CLOSED+b"#extra")]):
            with self.assertRaisesRegex(m.RecoveryBlocked,"CLOSED_SITE_CHANGED"):
                m.close_only()

    def test_nonroot_and_invalid_cli_never_run_guard(self):
        for argv,uid,gid in (
            (["x","--close-only"],1000,1000),
            (["x","--execute"],0,0),
            (["x","--arm"],0,0),
        ):
            with self.subTest(argv=argv),patch.object(m.os,"geteuid",return_value=uid),\
                 patch.object(m.os,"getegid",return_value=gid),\
                 patch.object(m.sys,"argv",argv),\
                 patch.object(m,"close_only",side_effect=AssertionError("NOT_ALLOWED")):
                with contextlib.redirect_stdout(StringIO()):
                    self.assertEqual(m.main(),2)

    def test_closeonly_needs_explicit_systemd_scope_not_bare_cli(self):
        with patch.object(m.os,"geteuid",return_value=0),\
             patch.object(m.os,"getegid",return_value=0),\
             patch.object(m.sys,"argv",["x","--close-only"]),\
             patch.dict(m.os.environ,{"GPT02_CLOSE_ONLY_RECOVERY_ENABLED":"false"},
                        clear=True),\
             patch.object(m,"close_only",side_effect=AssertionError("NOT_ALLOWED")):
            with contextlib.redirect_stdout(StringIO()):
                self.assertEqual(m.main(),2)

    def test_check_mode_never_calls_restore(self):
        with patch.object(m.os,"geteuid",return_value=0),\
             patch.object(m.os,"getegid",return_value=0),\
             patch.object(m.sys,"argv",["x","--check"]),\
             patch.object(m,"capture_evidence",
                          return_value=("OPEN_SITE_RESTORE_APPROVED_GUARD",OPEN)),\
             patch.object(m,"run_existing_restore",side_effect=AssertionError("NO_RESTORE")):
            buf=StringIO()
            with contextlib.redirect_stdout(buf):
                result=m.main()
        self.assertEqual(result,2)
        report=json.loads(buf.getvalue())
        self.assertEqual(report["plan"],"OPEN_SITE_RESTORE_APPROVED_GUARD")
        self.assertFalse(report["restoration_executed"])

    def test_closeonly_never_grants_reader_watcher_or_owner(self):
        with patch.object(m,"capture_evidence",
                          return_value=("CLOSED_NO_BACKUP_VERIFY_EFFECTIVE_503",CLOSED)),\
             patch.object(m,"verify_live_503",return_value=True):
            report=m.close_only()
        for key in ("watcher_timer_resumed","reader_sessions_verified",
                    "owner_http404_e2e_verified","owner_authorization_granted"):
            self.assertIs(report[key],False)

    def test_no_open_gate_or_reader_issuer_in_source(self):
        source=SRC.read_text()
        for forbidden in ("ALTER ROLE", "systemctl start", "systemctl stop",
                          "systemd-run", "os.replace(", "nginx -s reload",
                          "psycopg.connect(", "POST /api/"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden,source)
        self.assertIn('"--active", str(ACTIVE)',source)
        self.assertIn("SYSTEMD_APPROVAL_REQUIRED",source)


if __name__ == "__main__":
    unittest.main()
