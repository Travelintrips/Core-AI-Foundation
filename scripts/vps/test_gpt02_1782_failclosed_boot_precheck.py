#!/usr/bin/env python3
"""Offline regression for exact GPT02 Owner Ledger block pin; no host/network/DB IO."""
from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("gpt02_1782_failclosed_boot_precheck.py")
SPEC = importlib.util.spec_from_file_location("gpt02_1782_scoped_gate_test", SCRIPT)
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)

PRODUCTION_PIN = "cdbd857bddb84579257182e746281f7e5f12eb1052bab1df64cc101e01a16319"
OLD_WHOLE_FILE_PIN = "ff4a9c5c3a6399898b90c8990647c9430aee5251c84eb3fe38db92ddf0621d6d"

CLOSED = (
    b"server {\n"
    b"    server_name dev-ai-task.cstlogistic.co.id;\n"
    b"    location ^~ /api/gpt02-owner-ledger/ {\n"
    b"        default_type application/json;\n"
    b"        add_header Cache-Control \"no-store\" always;\n"
    b"        if ($request_method != GET) { return 405; }\n"
    + b"        " + guard.GATE + b"\n"
    b"        limit_except GET { deny all; }\n"
    b"        proxy_pass http://127.0.0.1:18082;\n"
    b"        proxy_set_header Authorization $http_authorization;\n"
    b"    }\n\n"
    b"    # GPT02 Owner approval: DEV-only exact POST endpoints\n"
    b"    location /api/readyz { proxy_pass http://127.0.0.1:18181; }\n"
    b"    location = /api/bridge/admin/jobs { proxy_pass http://127.0.0.1:18296; }\n"
    b"}\n"
    b"server { server_name dev-ai-task.cstlogistic.co.id; }\n"
)


class ScopedGateTests(TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.active = Path(self.tmp.name) / "active.conf"
        self.backup = Path(self.tmp.name) / "rollback.conf"
        self.active.write_bytes(CLOSED)
        pos = CLOSED.index(guard.LOCATION)
        end = CLOSED.index(guard.END_MARKER, pos)
        self.protected = CLOSED[pos-4:end]
        self.assertEqual(CLOSED.count(guard.OWNER_URI), 1)
        self.p_sha = patch.object(guard, "EXPECTED_OWNER_BLOCK_SHA256", hashlib.sha256(self.protected).hexdigest())
        self.p_len = patch.object(guard, "EXPECTED_OWNER_BLOCK_BYTES", len(self.protected))
        self.p_sha.start()
        self.p_len.start()
        self.addCleanup(self.p_sha.stop)
        self.addCleanup(self.p_len.stop)

    def test_source_pin_is_actual_observed_closed_owner_route_digest(self):
        source = SCRIPT.read_text()
        self.assertIn(PRODUCTION_PIN, source)
        self.assertIn("EXPECTED_OWNER_BLOCK_BYTES = 1015", source)
        self.assertNotIn("EXPECTED_CLOSED_SHA256", source)
        self.assertNotIn(OLD_WHOLE_FILE_PIN, source)
        self.assertIn("def closed_owner_gate(data: bytes)", source)

    def test_closed_route_passes_with_unrelated_upstream_changes(self):
        self.assertEqual(guard.guarded(self.active, self.backup), ("PASS_GATE_CLOSED", 0))
        versions = [
            CLOSED.replace(b":18296;", b":18181;"),
            CLOSED.replace(b":18181;", b":18501;"),
            CLOSED.replace(b":18296;", b":18501;").replace(b":18181;", b":18300;"),
        ]
        for data in versions:
            with self.subTest(hash=hashlib.sha256(data).hexdigest()):
                self.assertNotEqual(hashlib.sha256(data).hexdigest(), hashlib.sha256(CLOSED).hexdigest())
                self.assertEqual(data[data.index(guard.LOCATION)-4:data.index(guard.END_MARKER)],
                                 self.protected)
                self.active.write_bytes(data)
                self.assertEqual(guard.guarded(self.active, self.backup), ("PASS_GATE_CLOSED", 0))

    def test_closed_route_rejects_any_change_inside_protected_block(self):
        for changed in (
            CLOSED.replace(b'\"no-store\"', b'\"public\"'),
            CLOSED.replace(b'if ($request_method != GET)', b'if ($request_method != POST)'),
            CLOSED.replace(b'proxy_pass http://127.0.0.1:18082;', b'proxy_pass http://127.0.0.1:18181;'),
            CLOSED.replace(b'limit_except GET', b'limit_except POST'),
            CLOSED.replace(b'proxy_set_header Authorization', b'proxy_set_header X-Other-Authorization'),
            CLOSED.replace(guard.GATE, b'return 200 "{}";'),
        ):
            with self.subTest(change=changed[:80]):
                self.active.write_bytes(changed)
                self.assertEqual(guard.guarded(self.active,self.backup),("BLOCK_CLOSED_OWNER_GATE_DRIFT",2))
                self.assertEqual(self.active.read_bytes(),changed)

    def test_duplicate_or_overriding_owner_location_is_rejected(self):
        for line in (
            b"    location = /api/gpt02-owner-ledger/decision/x { return 200; }\n",
            b"    location ^~ /api/gpt02-owner-ledger/ { return 200; }\n",
            b"    rewrite ^/api/gpt02-owner-ledger/ /other last;\n",
        ):
            modified = CLOSED.replace(b"    # GPT02 Owner approval:", line+b"    # GPT02 Owner approval:", 1)
            self.active.write_bytes(modified)
            self.assertEqual(guard.guarded(self.active,self.backup),("BLOCK_CLOSED_OWNER_GATE_DRIFT",2))

    def test_unknown_server_identity_and_missing_end_marker_are_rejected(self):
        cases=[
            CLOSED.replace(b"server_name dev-ai-task.cstlogistic.co.id;",b"server_name other.invalid;",1),
            CLOSED.replace(guard.END_MARKER,b"\n    # new unrelated heading"),
            CLOSED.replace(guard.LOCATION,b"location /api/gpt02-owner-ledger/ {"),
            CLOSED.replace(b"    location ^~",b"  location ^~",1),
        ]
        for case in cases:
            with self.subTest(case=case[:80]):
                self.active.write_bytes(case)
                self.assertEqual(guard.guarded(self.active,self.backup),("BLOCK_CLOSED_OWNER_GATE_DRIFT",2))

    def test_gate_removed_without_backup_fails_closed(self):
        modified=CLOSED.replace(guard.GATE,guard.COMMENT,1)
        self.active.write_bytes(modified)
        self.assertEqual(guard.guarded(self.active,self.backup),("BLOCK_MISSING_BACKUP",2))

    def test_missing_gate_without_bounded_rollback_comment_is_denied(self):
        modified=CLOSED.replace(guard.GATE,b"")
        self.active.write_bytes(modified)
        self.assertEqual(guard.guarded(self.active,self.backup),("BLOCK_CLOSED_OWNER_GATE_DRIFT",2))

    def test_untrusted_backup_cannot_restore(self):
        self.backup.write_bytes(CLOSED)
        self.backup.chmod(0o644)
        opened=CLOSED.replace(guard.GATE,guard.COMMENT,1)
        self.active.write_bytes(opened)
        self.assertEqual(guard.guarded(self.active,self.backup),("BLOCK_UNTRUSTED_BACKUP",2))
        self.assertEqual(self.active.read_bytes(),opened)

    def _trusted_backup_stat(self):
        original_stat=Path.stat
        def checked(file,*args,**kwargs):
            meta=original_stat(file,*args,**kwargs)
            if file==self.backup:
                return SimpleNamespace(st_mode=meta.st_mode,st_uid=0,st_size=meta.st_size)
            return meta
        return patch.object(Path,"stat",checked)

    def test_restore_unique_approved_comment_recovers_exact_closed_bytes(self):
        self.backup.write_bytes(CLOSED)
        self.backup.chmod(0o600)
        opened=CLOSED.replace(guard.GATE,guard.COMMENT,1)
        self.active.write_bytes(opened)
        with self._trusted_backup_stat():
            self.assertEqual(guard.guarded(self.active,self.backup),("PASS_RESTORED_GATE",0))
        self.assertEqual(self.active.read_bytes(),CLOSED)

    def test_restore_refuses_unrelated_change_after_timer_armed(self):
        self.backup.write_bytes(CLOSED)
        self.backup.chmod(0o600)
        malicious=CLOSED.replace(guard.GATE,guard.COMMENT,1).replace(b":18296;",b":18181;")
        self.active.write_bytes(malicious)
        with self._trusted_backup_stat():
            self.assertEqual(guard.guarded(self.active,self.backup),("BLOCK_UNEXPECTED_ACTIVE_CHANGE",2))
        self.assertEqual(self.active.read_bytes(),malicious)

    def test_invalid_backup_with_other_protected_block_fails_closed(self):
        self.backup.write_bytes(CLOSED.replace(b'\"no-store\"',b'\"public\"'))
        self.backup.chmod(0o600)
        self.active.write_bytes(CLOSED.replace(guard.GATE,guard.COMMENT,1))
        with self._trusted_backup_stat():
            self.assertEqual(guard.guarded(self.active,self.backup),("BLOCK_INVALID_BASELINE",2))

    def test_symlink_active_is_rejected(self):
        link=Path(self.tmp.name)/"active-link.conf"
        link.symlink_to(self.active)
        self.assertEqual(guard.guarded(link,self.backup),("BLOCK_ACTIVE_NOT_REGULAR",2))


if __name__=="__main__":
    main()
