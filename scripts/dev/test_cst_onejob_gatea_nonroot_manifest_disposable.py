#!/usr/bin/env python3
"""Synthetic signed public manifest ACL test, no live signer, Supabase or unit."""
import base64, json, os, subprocess, sys, tempfile, unittest
from datetime import datetime, timezone, timedelta
from hashlib import sha256
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
import cst_onejob_preapproval_stage_broker as broker
SOURCE="a"*40
STAMP=lambda dt:dt.isoformat(timespec="milliseconds").replace("+00:00","Z")

class NonrootManifest(unittest.TestCase):
    def validate_as(self,uid,gid,pem,env,pin):
        cmd=["setpriv",f"--reuid={uid}",f"--regid={gid}","--clear-groups",
             sys.executable,"-B",str(ROOT/"cst_onejob_preapproval_stage_broker.py"),
             "validate","--public-key",str(pem),"--envelope",str(env),
             "--pinned-sha256",pin,"--expected-source-sha",SOURCE]
        return subprocess.run(cmd,capture_output=True,text=True,timeout=10)

    def test_signed_root_public_manifest_revalidated_by_nonroot_identity(self):
        if os.geteuid()!=0:self.skipTest("requires disposable QA root")
        key=Ed25519PrivateKey.generate()
        pub=key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo)
        pin=sha256(key.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)).hexdigest()
        now=datetime.now(timezone.utc)
        manifest=dict(zip(broker.FIELDS,[
            1,"PREAPPROVAL_STAGE_ONLY",broker.PROJECT,"1",SOURCE,
            "cst_team_model_pilot_stage_login","8.8.8.8",broker.HOST,6543,
            broker.SOCKET_PATH,28500,28501,28502,28501,os.stat("/proc/self/ns/net").st_ino,
            STAMP(now-timedelta(seconds=1)),STAMP(now+timedelta(minutes=3)),"e"*32
        ]))
        sig=base64.b64encode(key.sign(json.dumps(manifest,separators=(",",":"),ensure_ascii=False).encode())).decode()
        with tempfile.TemporaryDirectory(prefix="onejob-gatea-public-qa-") as temp:
            root=Path(temp)
            root.chmod(0o755)
            public=root/"public.pem"
            signed=root/"signed.json"
            public.write_bytes(pub)
            signed.write_text(json.dumps({"manifest":manifest,"signatureBase64":sig}))
            os.chown(public,0,0);os.chown(signed,0,0)
            public.chmod(0o644);signed.chmod(0o644)
            root_ok=self.validate_as(0,0,public,signed,pin)
            self.assertEqual(root_ok.returncode,0,root_ok.stderr[-220:])
            nonroot_ok=self.validate_as(28500,28501,public,signed,pin)
            self.assertEqual(nonroot_ok.returncode,0,nonroot_ok.stderr[-220:])
            self.assertIn('"runtimeAuthorized":false',nonroot_ok.stdout)
            signed.chmod(0o600)
            root_still_ok=self.validate_as(0,0,public,signed,pin)
            self.assertEqual(root_still_ok.returncode,0,root_still_ok.stderr[-220:])
            nonroot_denied=self.validate_as(28500,28501,public,signed,pin)
            self.assertNotEqual(nonroot_denied.returncode,0)
            signed.chmod(0o644)
            root.chmod(0o700)
            directory_denied=self.validate_as(28500,28501,public,signed,pin)
            self.assertNotEqual(directory_denied.returncode,0)
            root.chmod(0o755)
            print("CST_GATEA_NONROOT_ROOT_PUBLIC_SIGNED_ACL_PASS")
            print("CST_GATEA_ROOT_ONLY_MANIFEST_REJECTED_FOR_NONROOT_PASS")
            print("CST_GATEA_ROOT_ONLY_DIRECTORY_REJECTED_FOR_NONROOT_PASS")
            print("CST_GATEA_TEST_ONLY_EPHEMERAL_KEY_NOT_OPERATIONS_AUTHORITY")
if __name__=="__main__":unittest.main(verbosity=2)
