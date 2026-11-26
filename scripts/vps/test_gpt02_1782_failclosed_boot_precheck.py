#!/usr/bin/env python3
"""Pure-fixture regression for GPT02-1782 fail-closed Nginx boot hook.

No service, credentials, sudo, root privileges, port opens or live vhost edits.
"""
from __future__ import annotations
import hashlib
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main
from unittest.mock import patch
from types import SimpleNamespace

SCRIPT=Path(__file__).with_name("gpt02_1782_failclosed_boot_precheck.py")
SPEC=importlib.util.spec_from_file_location("gpt02_1782_failclosed_boot_precheck_tested", SCRIPT)
guard=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)

OLD_PIN="e34dde83f676dec15d27b56241b830cbffe7cb3ba0b07e6699f011d48fb651ed"
CURRENT_PIN="ff4a9c5c3a6399898b90c8990647c9430aee5251c84eb3fe38db92ddf0621d6d"
DEPLOYED_HOOK_SHA="7b83dbaf7adf114a2d72f932ff6eec2cfd24965f2b38880f29c0f2a09819ac46"
PIN_ONLY_CANDIDATE_SHA="0c7a67958476235ab7ae27d359b9aa1e38bf3638e30162bd23e1502b9f6e3fd5"

# This synthetic fixture deliberately contains only the exact gate location,
# original upstream for Owner Ledger, and unrelated DEV default upstream.
CLOSED=(
    b"server {\n"
    b"    location ^~ /api/gpt02-owner-ledger/ {\n"
    b"      add_header Cache-Control \"no-store\" always;\n"
    +b"      "+guard.GATE+b"\n"
    b"      proxy_pass http://127.0.0.1:18082;\n"
    b"    }\n"
    b"    location / {\n"
    b"      proxy_pass http://127.0.0.1:18181;\n"
    b"    }\n}\n"
)

class GuardBaselineTests(TestCase):
    def setUp(self):
        self.tmp=TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.active=Path(self.tmp.name)/"active.conf"
        self.backup=Path(self.tmp.name)/"backup.conf"
        self.active.write_bytes(CLOSED)
        self.original_sha=guard.EXPECTED_CLOSED_SHA256
        guard.EXPECTED_CLOSED_SHA256=hashlib.sha256(CLOSED).hexdigest()
        self.addCleanup(lambda: setattr(guard,"EXPECTED_CLOSED_SHA256",self.original_sha))

    def test_only_pinned_digest_changed_from_previously_deployed_script(self):
        source=SCRIPT.read_bytes()
        self.assertEqual(guard.EXPECTED_CLOSED_SHA256,hashlib.sha256(CLOSED).hexdigest())
        self.assertEqual(hashlib.sha256(source).hexdigest(),PIN_ONLY_CANDIDATE_SHA)
        self.assertEqual(source.count(CURRENT_PIN.encode()),1)
        self.assertEqual(hashlib.sha256(source.replace(CURRENT_PIN.encode(),OLD_PIN.encode(),1)).hexdigest(),DEPLOYED_HOOK_SHA)
        self.assertEqual(OLD_PIN, "e34dde83f676dec15d27b56241b830cbffe7cb3ba0b07e6699f011d48fb651ed")
        self.assertEqual(CURRENT_PIN,"ff4a9c5c3a6399898b90c8990647c9430aee5251c84eb3fe38db92ddf0621d6d")

    def test_exact_closed_gate_is_accepted(self):
        self.assertEqual(guard.guarded(self.active,self.backup),("PASS_GATE_CLOSED",0))

    def test_unrelated_config_change_without_new_pin_is_blocked(self):
        modified=CLOSED.replace(b":18181",b":18501")
        self.assertEqual(modified.count(guard.GATE),1)
        self.active.write_bytes(modified)
        self.assertEqual(guard.guarded(self.active,self.backup),("BLOCK_CLOSED_BASELINE_DRIFT",2))
        self.assertEqual(self.active.read_bytes(),modified)

    def test_gate_removed_without_backup_fails_closed(self):
        self.active.write_bytes(CLOSED.replace(guard.GATE,guard.COMMENT,1))
        self.assertEqual(guard.guarded(self.active,self.backup),("BLOCK_MISSING_BACKUP",2))

    def test_untrusted_backup_cannot_restore_open_gate(self):
        self.backup.write_bytes(CLOSED)
        self.backup.chmod(0o644)
        opened=CLOSED.replace(guard.GATE,guard.COMMENT,1)
        self.active.write_bytes(opened)
        state,code=guard.guarded(self.active,self.backup)
        self.assertEqual((state,code),("BLOCK_UNTRUSTED_BACKUP",2))
        self.assertEqual(self.active.read_bytes(),opened)

    def test_approved_backup_restores_exact_one_gate_mutation(self):
        self.backup.write_bytes(CLOSED)
        self.backup.chmod(0o600)
        opened=CLOSED.replace(guard.GATE,guard.COMMENT,1)
        self.active.write_bytes(opened)
        original_stat=Path.stat
        def trusted_backup_stat(file,*args,**kwargs):
            st=original_stat(file,*args,**kwargs)
            if file==self.backup:
                return SimpleNamespace(st_mode=st.st_mode,st_uid=0,st_size=st.st_size)
            return st
        with patch.object(Path,"stat",trusted_backup_stat):
            self.assertEqual(guard.guarded(self.active,self.backup),("PASS_RESTORED_GATE",0))
        self.assertEqual(self.active.read_bytes(),CLOSED)

    def test_approved_backup_refuses_extra_unauthorized_change(self):
        self.backup.write_bytes(CLOSED)
        self.backup.chmod(0o600)
        malicious=CLOSED.replace(guard.GATE,guard.COMMENT,1).replace(b":18181",b":18501")
        self.active.write_bytes(malicious)
        original_stat=Path.stat
        def trusted_backup_stat(file,*args,**kwargs):
            st=original_stat(file,*args,**kwargs)
            if file==self.backup:
                return SimpleNamespace(st_mode=st.st_mode,st_uid=0,st_size=st.st_size)
            return st
        with patch.object(Path,"stat",trusted_backup_stat):
            self.assertEqual(guard.guarded(self.active,self.backup),("BLOCK_UNEXPECTED_ACTIVE_CHANGE",2))
        self.assertEqual(self.active.read_bytes(),malicious)

    def test_symlink_active_is_rejected(self):
        real=self.active
        link=Path(self.tmp.name)/"active-link.conf"
        link.symlink_to(real)
        self.assertEqual(guard.guarded(link,self.backup),("BLOCK_ACTIVE_NOT_REGULAR",2))

if __name__=="__main__":
    main()
