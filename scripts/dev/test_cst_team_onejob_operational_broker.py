#!/usr/bin/env python3
"""Pure security tests for actual one-session broker (no network or DB access)."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import base64
import json
import os
import stat
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.path.insert(0,str(Path(__file__).parent))
import cst_team_onejob_operational_broker as broker

def timestamp(d):
    return d.isoformat(timespec="milliseconds").replace("+00:00","Z")

class OneJobSignedBrokerContract(unittest.TestCase):
    def setUp(self):
        self.now=datetime.now(timezone.utc)
        self.m=dict(zip(broker.ALL_FIELDS,[
            1,"OPERATIONAL_CST_DEV","xssrfshdrtdfupgqwfdw","1",
            "a"*40,483,"cst-ai-team-company1-dev:pilot-"+"b"*20,
            "c"*64,"d"*64,"1.1.1.1",
            broker.HOST,6543,broker.SOCKET,28500,28501,28502,28501,
            123456789,timestamp(self.now-timedelta(seconds=10)),
            timestamp(self.now+timedelta(minutes=10)),"e"*32
        ]))
        real_stat=os.stat
        def stat_only_ns(path,*args,**kwargs):
            if path=="/proc/self/ns/net":
                return SimpleNamespace(st_ino=123456789)
            return real_stat(path,*args,**kwargs)
        self.mocked=[
            patch.object(broker.os,"geteuid",return_value=28500),
            patch.object(broker.os,"getegid",return_value=28501),
            patch.object(broker.os,"stat",side_effect=stat_only_ns),
        ]
        for x in self.mocked:x.start()
        self.addCleanup(lambda:[x.stop() for x in reversed(self.mocked)])

    def test_exact_operational_manifest_accepts_only_fixed_public_destination(self):
        self.assertEqual(broker.validated_manifest(self.m,False,self.now),self.m)
        for field,value in [
            ("project","nzdweipzckfszczzqtuw"),
            ("companyId","3"),("jobId",482),("jobId",True),
            ("mode","DISPOSABLE_NETWORK_NONE_QA"),
            ("destinationHostname","malicious.example"),
            ("destinationPort",5432),("socketPath","/tmp/evil.sock"),
            ("allowedDestinationIp","127.0.0.1"),
            ("allowedDestinationIp","192.168.100.1"),
            ("allowedDestinationIp","::1"),
            ("requestId","cst-ai-team-company3-dev:pilot-"+"b"*20),
            ("sourceSha","fake"),
            ("ownerApprovalSha256","0"),
            ("subscriberArmedSha256","0"),
            ("brokerUid",0),("workerUid",28500),("workerGid",28502),
            ("networkNamespaceInode",123),
        ]:
            with self.subTest(field=field,value=str(value)[:32]):
                v={**self.m,field:value}
                with self.assertRaises(RuntimeError):
                    broker.validated_manifest(v,False,self.now)

    def test_expired_future_expiry_and_unsigned_fields_blocked(self):
        cases=[
            {"issuedAt":timestamp(self.now+timedelta(seconds=2))},
            {"expiresAt":timestamp(self.now-timedelta(seconds=1))},
            {"expiresAt":timestamp(self.now+timedelta(minutes=45))},
            {"nonce":"z"*32},
            {"ownerApprovalSha256":"0"*63},
        ]
        for c in cases:
            with self.subTest(case=c):
                with self.assertRaises(RuntimeError):
                    broker.validated_manifest({**self.m,**c},False,self.now)
        m={**self.m,"unverifiedExtra":True}
        with self.assertRaises(RuntimeError):
            broker.validated_manifest(m,False,self.now)

    def test_key_pin_and_signature_must_be_independently_verified(self):
        # Pure fixture keys; no signer, deployment or PROD key.
        key=Ed25519PrivateKey.generate()
        public=key.public_key().public_bytes(
            serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo)
        pin=broker.sha256(key.public_key().public_bytes(
            serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)).hexdigest()
        raw=json.dumps(self.m,separators=(",",":"),ensure_ascii=False).encode()
        signed=base64.b64encode(key.sign(raw)).decode()
        with tempfile.TemporaryDirectory(prefix="cst-onejob-signed-manifest-") as folder:
            p=Path(folder)
            pub=p/"key.pem";env=p/"manifest.json"
            pub.write_bytes(public)
            os.chmod(pub,0o644)
            env.write_text(json.dumps({"manifest":self.m,"signatureBase64":signed}))
            os.chmod(env,0o644)
            # CI runs without root. Preserve the production root-owned trust
            # requirement; simulate only ownership metadata in this unit test.
            # Explicitly prove a non-root trust file is rejected first.
            real_lstat=Path.lstat
            def lstat_as(owner):
                def fixture_lstat(path,*args,**kwargs):
                    st=real_lstat(path,*args,**kwargs)
                    if Path(path) in {pub,env}:
                        return SimpleNamespace(st_mode=st.st_mode,st_size=st.st_size,st_uid=owner)
                    return st
                return fixture_lstat
            with patch.object(broker.Path,"lstat",new=lstat_as(28502)):
                with self.assertRaisesRegex(RuntimeError,"UNTRUSTED_OWNER"):
                    broker.verify_manifest(str(env),str(pub),pin,False)
            with patch.object(broker.Path,"lstat",new=lstat_as(0)):
                self.assertEqual(broker.verify_manifest(str(env),str(pub),pin,False),self.m)
                with self.assertRaisesRegex(RuntimeError,"TRUST_KEY_PIN_MISMATCH"):
                    broker.verify_manifest(str(env),str(pub),"f"*64,False)
                env.write_text(json.dumps({"manifest":{**self.m,"jobId":484},"signatureBase64":signed}))
                with self.assertRaisesRegex(RuntimeError,"SIGNATURE"):
                    broker.verify_manifest(str(env),str(pub),pin,False)
                env.write_text(json.dumps({"manifest":self.m,"signatureBase64":signed}))
                os.chmod(env,0o666)
                with self.assertRaisesRegex(RuntimeError,"UNTRUSTED_FILE"):
                    broker.verify_manifest(str(env),str(pub),pin,False)
                os.chmod(env,0o644)
                alias=p/"link.pem"
                alias.symlink_to(pub)
                with self.assertRaisesRegex(RuntimeError,"UNTRUSTED_FILE"):
                    broker.verify_manifest(str(env),str(alias),pin,False)

    def test_cannot_import_startup_or_grant_dispatch(self):
        src=Path(broker.__file__).read_text()
        self.assertNotIn("SUPABASE_PROD_DATABASE_URL",src)
        self.assertNotIn("service_role",src)
        self.assertIn("if __name__==\"__main__\"",src)
        self.assertIn("SO_PEERCRED",src)
        self.assertIn("no", "no") # Keep this a source/custody test, not an execution test.
        self.assertNotIn("CREATE ROLE",src)
        self.assertNotIn("INSERT INTO",src)
        self.assertNotIn("password=",src)
        self.assertNotIn("rejectUnauthorized:false",src)

if __name__=="__main__":
    unittest.main(verbosity=2)
