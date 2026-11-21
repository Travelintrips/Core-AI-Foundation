#!/usr/bin/env python3
"""Synthetic-only credential ownership and relock testing; no real secret read."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SRC=Path(__file__).resolve().parents[2]/"deploy/cst-onejob-vps/owner-stage-bootstrap/stage-credential-handoff.py"
spec=importlib.util.spec_from_file_location("stage_handoff",SRC)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class CredentialHandoffQa(unittest.TestCase):
    def setUp(self):
        if os.geteuid()!=0:self.skipTest("requires isolated VPS root QA")
        self.tmp=tempfile.TemporaryDirectory(prefix="onejob-cred-qa-")
        self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name)
        os.chmod(root,0o755)
        self.src=root/"systemd-fake"
        self.src.mkdir(mode=0o700)
        self.dst=root/"nonroot-copy"
        for name in m.NAMES:
            p=self.src/name
            p.write_bytes(("QA_SYNTHETIC_ONLY_"+name+"_"+"x"*90).encode())
            p.chmod(0o400)

    def test_0400_root_input_cannot_be_read_by_stage_user_but_handoff_can(self):
        denial=subprocess.run(["setpriv","--reuid=28502","--regid=28501","--clear-groups",
            "test","-r",str(self.src/"database-url")])
        self.assertNotEqual(denial.returncode,0)
        m.prepare(self.src,self.dst,28502,28501)
        st=self.dst.stat()
        self.assertEqual((st.st_uid,st.st_gid,st.st_mode&0o777),(28502,28501,0o700))
        for name in m.NAMES:
            cred=self.dst/name
            self.assertEqual((cred.stat().st_uid,cred.stat().st_gid,cred.stat().st_mode&0o777),
                              (28502,28501,0o400))
            allowed=subprocess.run(["setpriv","--reuid=28502","--regid=28501",
                "--clear-groups","test","-r",str(cred)])
            self.assertEqual(allowed.returncode,0)
        with self.assertRaisesRegex(RuntimeError,"TARGET_ALREADY_EXISTS"):
            m.prepare(self.src,self.dst,28502,28501)
        m.cleanup(self.dst,28502,28501)
        self.assertFalse(self.dst.exists())

    def test_systemd_precreated_empty_runtime_directory(self):
        self.dst.mkdir(mode=0o700)
        self.assertEqual(self.dst.stat().st_uid,0)
        m.prepare(self.src,self.dst,28502,28501)
        self.assertEqual(self.dst.stat().st_uid,28502)
        m.cleanup(self.dst,28502,28501)
        self.assertFalse(self.dst.exists())

    def test_systemd_precreated_nonempty_directory_denied(self):
        self.dst.mkdir(mode=0o700)
        (self.dst/"stale").write_bytes(b"stale")
        with self.assertRaisesRegex(RuntimeError,"TARGET_ALREADY_EXISTS"):
            m.prepare(self.src,self.dst,28502,28501)

    def test_reject_symlinked_source_and_cleanup_partial_copy(self):
        first=self.src/"database-url"
        first.unlink()
        first.symlink_to(self.src/"session-secret")
        with self.assertRaises(OSError):
            m.prepare(self.src,self.dst,28502,28501)
        self.assertFalse(self.dst.exists())

    def test_reject_loose_source_file_permissions(self):
        (self.src/"database-url").chmod(0o644)
        with self.assertRaisesRegex(RuntimeError,"UNSAFE_INPUT_METADATA"):
            m.prepare(self.src,self.dst,28502,28501)
        self.assertFalse(self.dst.exists())

    def test_reject_unexpected_content_in_cleanup(self):
        m.prepare(self.src,self.dst,28502,28501)
        other=self.dst/"unexpected"
        other.write_bytes(b"not allowed")
        with self.assertRaisesRegex(RuntimeError,"TARGET_UNEXPECTED_CONTENT"):
            m.cleanup(self.dst,28502,28501)
        other.unlink()
        m.cleanup(self.dst,28502,28501)

    def test_real_docker_nonroot_mount_permissions_with_synthetic_credentials(self):
        m.prepare(self.src,self.dst,28502,28501)
        try:
            child=subprocess.run([
                "docker","run","--rm","--network","none","--read-only",
                "--cap-drop","ALL","--security-opt","no-new-privileges",
                "--tmpfs","/run:rw,nosuid,nodev,size=24m",
                "--user","28502:28501",
                "--mount",f"type=bind,src={self.dst},dst=/run/credentials/cst-onejob-owner-stage.service,readonly",
                "--entrypoint","/bin/sh","cst-onejob-stage-dev:d3cd194b",
                "-c",'''set -eu
                     test "$(id -u)" = 28502
                     test "$(id -g)" = 28501
                     for n in database-url session-secret; do
                       f="/run/credentials/cst-onejob-owner-stage.service/$n"
                       test -r "$f"
                       test "$(stat -c %u:%g:%a "$f")" = 28502:28501:400
                     done
                     echo CONTAINER_CREDENTIAL_METADATA_PASS'''
            ],capture_output=True,text=True,timeout=30)
            self.assertEqual(child.returncode,0,child.stderr[:300])
            self.assertIn("CONTAINER_CREDENTIAL_METADATA_PASS",child.stdout)
        finally:
            m.cleanup(self.dst,28502,28501)

    def test_nonroot_launcher_denied(self):
        with patch.object(m.os,"geteuid",return_value=28502):
            with self.assertRaisesRegex(RuntimeError,"ROOT_LAUNCHER_REQUIRED"):
                m.prepare(self.src,self.dst,28502,28501)

if __name__=="__main__":
    unittest.main(verbosity=2)
