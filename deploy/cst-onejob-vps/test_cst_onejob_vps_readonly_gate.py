#!/usr/bin/env python3
"""Source-only tests: no real signer service, private key, or DB is accessed."""
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

SOURCE = pathlib.Path(__file__).with_name("cst_onejob_vps_readonly_gate.py")
spec = importlib.util.spec_from_file_location("onejob_vps_readonly_gate", SOURCE)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
# Save actual callable references: mocking the imported modules affects global
# subprocess and the production gate's file_metadata binding.
REAL_RUN = subprocess.run
REAL_FILE_METADATA = gate.file_metadata


class ReadOnlyGateTests(unittest.TestCase):
    def setUp(self):
        # Ephemeral synthetic test key never written to disk or authorized.
        pub = Ed25519PrivateKey.generate().public_key()
        der = pub.public_bytes(serialization.Encoding.DER,
                               serialization.PublicFormat.SubjectPublicKeyInfo)
        self.role = "agent-coding"
        self.pub = pub.public_bytes(serialization.Encoding.PEM,
                                    serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        self.pin = __import__("hashlib").sha256(der).hexdigest()
        self.row = {"role": self.role, "osIdentity": "cst1j-sig-coding",
                    "publicKeyPem": self.pub, "fingerprint": self.pin,
                    "encryptedFile": "/etc/credstore.encrypted/cst-onejob-agent-coding-private-key.pkcs8",
                    "activated": False, "trustedForRelease": False}
        self.socket = "/run/cst-onejob-hub-agent-coding/sign.sock"
        self.cred = self.row["encryptedFile"]
        self.condition_paths = [self.cred, gate.TRUST_ROOT,
                                "/etc/cst-onejob-dev/approved-public/agent-coding.json",
                                "/etc/cst-onejob-dev/authorized-releases/agent-coding.json"]
        self.unit = "\n".join([
            "[Unit]", *["ConditionPathExists="+p for p in self.condition_paths],
            "[Service]", "User=cst1j-sig-coding", "Group=cst1j-op-coding",
            *(f"{k}={v}" for k, v in gate.REQUIRED_UNIT.items()),
            "LoadCredentialEncrypted=private-key.pkcs8:"+self.cred,
            "RuntimeDirectory=cst-onejob-hub-agent-coding",
            "StateDirectory=cst-onejob-signer-agent-coding",
            "Environment=CST_ONEJOB_LINUX_SIGNING_ENABLED=false",
            "ExecStart=/usr/bin/python3 "+gate.SOURCE+
            " --role agent-coding --socket "+self.socket,
        ])
        self.patch1 = mock.patch.object(gate, "file_metadata", return_value=True)
        self.patch2 = mock.patch.object(gate.pathlib.Path, "read_text", return_value=self.unit)
        self.patch3 = mock.patch.object(gate.pwd, "getpwnam",
                                        return_value=types.SimpleNamespace(pw_shell="/usr/sbin/nologin"))
        self.patch4 = mock.patch.object(gate.os.path, "exists",
                                        side_effect=lambda p: p == self.cred)
        self.patch5 = mock.patch.object(gate.subprocess, "run",
                                        return_value=types.SimpleNamespace(returncode=0,stdout="inactive\n"))
        self.patch1.start();self.patch2.start();self.patch3.start();self.patch4.start();self.patch5.start()

    def tearDown(self):
        self.patch5.stop();self.patch4.stop();self.patch3.stop()
        self.patch2.stop();self.patch1.stop()

    def check(self, row=None):
        return gate.status_for_role(self.role, self.row if row is None else row)

    def test_valid_foundation_but_missing_release_roots(self):
        r = self.check()
        self.assertEqual(r["foundation"], "PASS")
        self.assertEqual(r["unsatisfiedConditions"], 3)
        self.assertEqual(len(r["_unmetPaths"]), 3)

    def test_forged_public_key_pin_rejected(self):
        r=self.check(dict(self.row, fingerprint="a"*64))
        self.assertIn("INVALID_PUBLIC_ED25519_PIN",r["errors"])

    def test_wrong_signer_identity_rejected(self):
        r=self.check(dict(self.row,osIdentity="cst1j-sig-reviewer"))
        self.assertIn("WRONG_MANIFEST_LINUX_IDENTITY",r["errors"])

    def test_unsafe_unit_identity_and_group_rejected(self):
        for term, err in [
            ("User=cst1j-sig-coding","SYSTEMD_USER_MISMATCH"),
            ("Group=cst1j-op-coding","SYSTEMD_GROUP_MISMATCH")]:
            new=self.unit.replace(term,term+"-forged")
            with mock.patch.object(gate.pathlib.Path,"read_text",return_value=new):
                self.assertIn(err,self.check()["errors"])

    def test_plaintext_credential_directive_rejected(self):
        with mock.patch.object(gate.pathlib.Path,"read_text",
                               return_value=self.unit+"\nLoadCredential=private-key.pkcs8:/tmp/unprotected"):
            self.assertIn("PLAINTEXT_CREDENTIAL_DIRECTIVE_FORBIDDEN",self.check()["errors"])

    def test_double_signing_switch_directive_rejected(self):
        with mock.patch.object(gate.pathlib.Path,"read_text",
                               return_value=self.unit+"\nEnvironment=CST_ONEJOB_LINUX_SIGNING_ENABLED=true"):
            self.assertIn("SIGNING_SWITCH_NOT_DEFAULT_OFF",self.check()["errors"])

    def test_wrong_credential_source_rejected(self):
        new=self.unit.replace(self.cred,"/etc/credstore.encrypted/reviewer-private-key.pkcs8")
        with mock.patch.object(gate.pathlib.Path,"read_text",return_value=new):
            self.assertIn("SYSTEMD_ENCRYPTED_BINDING_MISMATCH",self.check()["errors"])

    def test_missing_durable_replay_ledger_directory_denied(self):
        new=self.unit.replace("StateDirectory=cst-onejob-signer-agent-coding",
                              "StateDirectory=unrelated-replay-journal")
        with mock.patch.object(gate.pathlib.Path,"read_text",return_value=new):
            self.assertIn("DURABLE_REPLAY_STATE_DIRECTORY_MISSING",self.check()["errors"])

    def test_wrong_runtime_directory_denied(self):
        new=self.unit.replace("RuntimeDirectory=cst-onejob-hub-agent-coding",
                              "RuntimeDirectory=unrelated-socket")
        with mock.patch.object(gate.pathlib.Path,"read_text",return_value=new):
            self.assertIn("RUNTIME_DIRECTORY_NOT_MATCHING_SOCKET",self.check()["errors"])

    def test_unexpected_release_condition_rejected(self):
        new=self.unit.replace("ConditionPathExists="+gate.TRUST_ROOT,
                              "ConditionPathExists=/tmp/any-signer-root")
        with mock.patch.object(gate.pathlib.Path,"read_text",return_value=new):
            self.assertIn("EXACT_FOUR_RELEASE_CONDITIONS_REQUIRED",self.check()["errors"])

    def test_live_service_refused(self):
        with mock.patch.object(gate.subprocess,"run",
                               return_value=types.SimpleNamespace(returncode=0,stdout="active\n")):
            self.assertIn("SIGNER_SERVICE_NOT_INACTIVE",self.check()["errors"])

    def test_approval_flags_not_auto_trusted(self):
        r=self.check(dict(self.row,activated=True,trustedForRelease=True))
        self.assertIn("STAGED_MANIFEST_MUST_NOT_CLAIM_RELEASE",r["errors"])

    def test_unknown_readiness_mode_refused(self):
        p=REAL_RUN([sys.executable,str(SOURCE),"--enable-signer"],
                         capture_output=True,text=True,timeout=8)
        self.assertNotEqual(p.returncode,0)
        self.assertNotIn("releaseDecision: GO",p.stdout)

    def test_parser_does_not_hide_duplicate_security_settings(self):
        parsed=gate.parse_unit("User=user1\nUser=user2\n[Service]\nNoNewPrivileges=yes")
        self.assertFalse(gate.exact(parsed,"User","user1"))
        self.assertTrue(gate.exact(parsed,"NoNewPrivileges","yes"))

    def test_credential_symlink_is_never_treated_as_safe(self):
        with tempfile.TemporaryDirectory() as td:
            real=pathlib.Path(td)/"blob"
            real.write_bytes(b"nonsecret synthetic")
            real.chmod(0o600)
            link=pathlib.Path(td)/"link"
            link.symlink_to(real)
            self.assertFalse(REAL_FILE_METADATA(link,owner=os.getuid(),mode=0o600))


if __name__ == "__main__":
    unittest.main()
