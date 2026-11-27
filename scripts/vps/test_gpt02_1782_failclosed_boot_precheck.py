#!/usr/bin/env python3
"""Offline boot-guard contract: full Nginx SHA, only four exact cutover choices.

All tests use disposable files, mock backup ownership, no network or systemctl.
"""
from __future__ import annotations

import hashlib
import importlib.util
from itertools import product
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("gpt02_1782_failclosed_boot_precheck.py")
SPEC = importlib.util.spec_from_file_location("gpt02_1782_cutover_allowlist_test", SCRIPT)
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)

EXPECTED_REAL_BASELINE = "e34dde83f676dec15d27b56241b830cbffe7cb3ba0b07e6699f011d48fb651ed"

CLOSED = (
    b"server {\n"
    b"    server_name dev-ai-task.cstlogistic.co.id;\n"
    b"    location ^~ /api/gpt02-owner-ledger/ {\n"
    b"      add_header Cache-Control \"no-store\" always;\n"
    b"      if ($request_method != GET) { return 405; }\n"
    + b"      " + guard.GATE + b"\n"
    b"      limit_except GET { deny all; }\n"
    b"      proxy_pass http://127.0.0.1:18082;\n"
    b"      proxy_set_header Authorization $http_authorization;\n"
    b"    }\n"
    b"    location = /api/gpt02-owner-approval/prepare {\n"
    b"      proxy_pass http://127.0.0.1:18082;\n"
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
        marker, old_proxy = guard.ALLOWED_UPSTREAM_TRANSITIONS[index]
        assert data.count(marker) == 1, marker
        start = data.index(marker)
        end = data.index(b"\n    }", start)
        assert end != -1
        block = data[start:end]
        assert block.count(old_proxy) == 1
        block = block.replace(old_proxy, guard.NEW_PROXY, 1)
        data = data[:start] + block + data[end:]
    return data


class WholeVhostAllowlistedCutoverTests(TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.active = Path(self.tmp.name) / "active.conf"
        self.backup = Path(self.tmp.name) / "backup.conf"
        self.base_sha = guard.ORIGINAL_CLOSED_SHA256
        guard.ORIGINAL_CLOSED_SHA256 = hashlib.sha256(CLOSED).hexdigest()
        self.addCleanup(lambda: setattr(guard, "ORIGINAL_CLOSED_SHA256", self.base_sha))
        self.active.write_bytes(CLOSED)

    def test_real_original_whole_file_sha_and_only_four_exact_mutations_are_pinned(self):
        source = SCRIPT.read_text()
        self.assertIn(EXPECTED_REAL_BASELINE, source)
        self.assertEqual(len(guard.ALLOWED_UPSTREAM_TRANSITIONS), 4)
        self.assertNotIn("EXPECTED_OWNER_BLOCK_SHA256", source)
        self.assertNotIn("EXPECTED_CLOSED_SHA256", source)
        self.assertIn("hashlib.sha256(original).hexdigest() == ORIGINAL_CLOSED_SHA256", source)

    def test_pr252_snapshots_are_exact_independently_reviewed_digests(self):
        self.assertEqual(guard.PR252_CLOSED_SNAPSHOTS, frozenset((
            "df256e23dae4cf20dbd23c33f3c259e341d86719363ccd1e0b0b80a3dff6777c",
            "1d8b8fd3492845c6fd0586d0fc43ff9fb366f5f62772eb4d968c84e0c3b31846",
        )))

    def test_snapshot_branch_accepts_only_the_exact_full_bytes(self):
        reviewed = CLOSED + b"# synthetic reviewed frontend change\n"
        with patch.object(guard, "PR252_CLOSED_SNAPSHOTS",
                          frozenset((hashlib.sha256(reviewed).hexdigest(),))):
            self.assertTrue(guard.canonical_closed(reviewed))
            for changed in (reviewed + b"# drift\n",
                            reviewed.replace(guard.GATE, guard.COMMENT, 1),
                            reviewed.replace(b'no-store', b'public', 1)):
                self.assertFalse(guard.canonical_closed(changed))
            self.active.write_bytes(reviewed)
            before = self.active.stat()
            self.assertEqual(guard.guarded(self.active, self.backup),
                             ("PASS_GATE_CLOSED", 0))
            self.assertEqual(before.st_ino, self.active.stat().st_ino)

    def test_even_pinned_bytes_must_keep_the_unique_closed_gate(self):
        invalid = (CLOSED.replace(guard.GATE, guard.COMMENT, 1),
                   CLOSED + guard.GATE,
                   CLOSED.replace(guard.LOCATION, b"location /wrong {", 1),
                   CLOSED.replace(guard.PROXY, b"proxy_pass http://127.0.0.1:19999;", 2))
        for data in invalid:
            with self.subTest(digest=hashlib.sha256(data).hexdigest()), patch.object(
                    guard, "PR252_CLOSED_SNAPSHOTS",
                    frozenset((hashlib.sha256(data).hexdigest(),))):
                # Keep basic structural gate checks BEFORE the full-file digest branch.
                self.assertFalse(guard.canonical_closed(data))

    def test_all_sixteen_approved_cutover_combinations_still_keep_full_file_integrity(self):
        for choices in product((False, True), repeat=4):
            with self.subTest(choices=choices):
                subset = {i for i, flag in enumerate(choices) if flag}
                changed = switched(CLOSED, subset)
                self.active.write_bytes(changed)
                self.assertEqual(
                    guard.guarded(self.active, self.backup),
                    ("PASS_GATE_CLOSED", 0),
                )
                self.assertTrue(guard.canonical_closed(changed))

    def test_any_change_to_owner_ledger_block_is_denied(self):
        for altered in (
            CLOSED.replace(guard.GATE, b"return 200 '{}';"),
            CLOSED.replace(b'"no-store"', b'"public"'),
            CLOSED.replace(b'if ($request_method != GET)', b'if ($request_method != POST)'),
            CLOSED.replace(b'limit_except GET', b'limit_except POST'),
            CLOSED.replace(b'proxy_pass http://127.0.0.1:18082;', b'proxy_pass http://127.0.0.1:18181;', 1),
            CLOSED.replace(b'proxy_set_header Authorization', b'proxy_set_header X-Fake-Authorization'),
        ):
            with self.subTest(hash=hashlib.sha256(altered).hexdigest()):
                self.active.write_bytes(altered)
                self.assertFalse(guard.canonical_closed(altered))
                self.assertNotEqual(guard.guarded(self.active, self.backup)[1], 0)

    def test_even_unrelated_changes_other_than_four_preapproved_proxies_are_denied(self):
        cases = [
            CLOSED.replace(b"server_name dev-ai-task.cstlogistic.co.id", b"server_name attacker.invalid"),
            CLOSED.replace(b"server {\n", b"server {\n  return 200;\n", 1),
            CLOSED.replace(b"server {\n", b"server {\n  error_page 503 = /fallback;\n", 1),
            CLOSED.replace(b"    location / {", b"    location /new-admin {", 1),
            CLOSED.replace(b"      limit_except GET", b"      limit_except POST", 1),
            CLOSED + b"# ANY OTHER ADDITION\n",
        ]
        for altered in cases:
            with self.subTest(hash=hashlib.sha256(altered).hexdigest()):
                self.assertFalse(guard.canonical_closed(altered))

    def test_new_or_unknown_upstream_outside_four_exact_choices_is_denied(self):
        cases = [
            CLOSED.replace(b":18296;", b":18444;", 1),
            CLOSED.replace(b":18501;", b":18502;", 1),
            CLOSED.replace(b":18296;", b":18181;\n      proxy_pass http://127.0.0.1:18296;", 1),
            CLOSED.replace(b"location = /api/bridge/admin/jobs {", b"location = /api/bridge/admin/jobs_extra {", 1),
        ]
        for altered in cases:
            with self.subTest(hash=hashlib.sha256(altered).hexdigest()):
                self.assertFalse(guard.canonical_closed(altered))

    def test_duplicate_or_shadowing_gpt02_location_denied(self):
        for additional in (
            b"\n    location = /api/gpt02-owner-ledger/decision/x { return 200; }\n",
            b"\n    location ^~ /api/gpt02-owner-ledger/ { return 200; }\n",
            b"\n    rewrite ^/api/gpt02-owner-ledger /fake last;\n",
        ):
            altered = CLOSED.replace(b"    location / {", additional+b"    location / {", 1)
            self.assertFalse(guard.canonical_closed(altered))

    def test_missing_gate_or_explicit_bounded_open_comment_is_denied_without_backup(self):
        for altered in (CLOSED.replace(guard.GATE, b""), CLOSED.replace(guard.GATE, guard.COMMENT)):
            self.active.write_bytes(altered)
            self.assertFalse(guard.canonical_closed(altered))
            self.assertEqual(guard.guarded(self.active, self.backup)[1], 2)
            self.assertEqual(self.active.read_bytes(), altered)

    def test_backup_rejected_if_world_readable_or_not_a_covered_original(self):
        self.backup.write_bytes(CLOSED)
        self.backup.chmod(0o644)
        opened = CLOSED.replace(guard.GATE, guard.COMMENT, 1)
        self.active.write_bytes(opened)
        self.assertEqual(guard.guarded(self.active, self.backup), ("BLOCK_UNTRUSTED_BACKUP", 2))
        self.backup.write_bytes(CLOSED.replace(b'"no-store"', b'"public"'))
        self.backup.chmod(0o600)
        with self._root_backup_stat():
            self.assertEqual(guard.guarded(self.active, self.backup), ("BLOCK_INVALID_BASELINE", 2))

    def _root_backup_stat(self):
        old_stat = Path.stat
        def as_root(file, *args, **kwargs):
            meta = old_stat(file, *args, **kwargs)
            if file == self.backup:
                return SimpleNamespace(
                    st_mode=meta.st_mode, st_uid=0, st_gid=0,
                    st_size=meta.st_size, st_nlink=1,
                )
            return meta
        return patch.object(Path, "stat", as_root)

    def test_exact_one_gate_comment_restored_from_trusted_backup(self):
        original = switched(CLOSED, {0,1,2,3})
        self.backup.write_bytes(original)
        self.backup.chmod(0o600)
        opened = original.replace(guard.GATE, guard.COMMENT, 1)
        self.active.write_bytes(opened)
        with self._root_backup_stat():
            self.assertEqual(guard.guarded(self.active, self.backup), ("PASS_RESTORED_GATE", 0))
        self.assertEqual(self.active.read_bytes(), original)

    def test_concurrent_unrelated_deployment_during_open_window_cannot_overwrite_new_routes(self):
        original = switched(CLOSED, {0,1,2})
        self.backup.write_bytes(original)
        self.backup.chmod(0o600)
        opened = original.replace(guard.GATE, guard.COMMENT, 1)
        newer = switched(opened, {3})
        self.active.write_bytes(newer)
        with self._root_backup_stat():
            self.assertEqual(guard.guarded(self.active, self.backup),
                             ("BLOCK_UNEXPECTED_ACTIVE_CHANGE", 2))
        self.assertEqual(self.active.read_bytes(), newer)

    def test_symlink_or_large_active_file_rejected(self):
        link = Path(self.tmp.name) / "active-link.conf"
        link.symlink_to(self.active)
        self.assertEqual(guard.guarded(link, self.backup), ("BLOCK_ACTIVE_NOT_REGULAR", 2))
        self.active.write_bytes(CLOSED+b"x"*200001)
        self.assertEqual(guard.guarded(self.active, self.backup), ("BLOCK_ACTIVE_SIZE", 2))


if __name__ == "__main__":
    main()
