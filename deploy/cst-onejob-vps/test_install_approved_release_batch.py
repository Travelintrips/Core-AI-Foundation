#!/usr/bin/env python3
"""Synthetic source-only tests for independently signed, eight-role release import.

All signing keys in this test are ephemeral, in-memory and unrelated to the
eight real encrypted CST-DEV private keys. No network, DEV DB or live service.
"""
import base64
import copy
import datetime
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import types
import unittest
from unittest import mock

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

PATH=pathlib.Path(__file__).with_name("install_approved_release_batch.py")
spec=importlib.util.spec_from_file_location("cst_vps_release",PATH)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class SignedBatchTests(unittest.TestCase):
    def setUp(self):
        self.now=datetime.datetime.now(datetime.timezone.utc)
        self.timestamp=self.now.timestamp()
        self.fmt=lambda d:d.strftime("%Y-%m-%dT%H:%M:%S.")+f"{d.microsecond//1000:03d}Z"
        self.issued=self.fmt(self.now-datetime.timedelta(seconds=10))
        self.expires=self.fmt(self.now+datetime.timedelta(seconds=95))
        self.root=Ed25519PrivateKey.generate()
        self.manifest={"project":m.PROJECT,"environment":"DEV",
                       "approvalStatus":"CANDIDATE_NOT_RELEASED","roles":[]}
        self.uids={}
        for i,(role,(signer,operator,_)) in enumerate(m.ROLES.items()):
            k=Ed25519PrivateKey.generate().public_key()
            der=k.public_bytes(serialization.Encoding.DER,
                               serialization.PublicFormat.SubjectPublicKeyInfo)
            pem=k.public_bytes(serialization.Encoding.PEM,
                               serialization.PublicFormat.SubjectPublicKeyInfo).decode()
            fp=hashlib.sha256(der).hexdigest()
            self.uids[signer]=11000+i
            if operator not in self.uids:
                self.uids[operator]=12000+i
            self.manifest["roles"].append({
                "role":role,"osIdentity":signer,"publicKeyPem":pem,"fingerprint":fp,
                "activated":False,"trustedForRelease":False
            })
        self.patch=mock.patch.object(m.pwd,"getpwnam",side_effect=
            lambda name:types.SimpleNamespace(pw_uid=self.uids[name]))
        self.patch.start()
        self.bundle=self.signed_batch()
    def tearDown(self):
        self.patch.stop()
    def signed_batch(self):
        rows={x["role"]:x for x in self.manifest["roles"]}
        payload={
            "schema":"cst-onejob-vps-approved-release-batch/v1",
            "project":m.PROJECT,"companyId":"1",
            "changeId":"CST-DEV-SYNTHETIC-QA-20261121",
            "jobId":483,"approvalId":"12345678-1234-1234-1234-123456789abc",
            "sourceSha":"a"*40,
            "workerName":"cst-dev-dell-onejob-20261121-12345678",
            "manifestSha256":m.MANIFEST_SHA,
            "issuedAt":self.issued,"expiresAt":self.expires,
            "permits":{}
        }
        for role,(signer,operator,purposes) in m.ROLES.items():
            claims={
                "v":1,"project":m.PROJECT,"companyId":"1","role":role,
                "purpose":purposes[0],"jobId":payload["jobId"],
                "sourceSha":payload["sourceSha"],"approvalId":payload["approvalId"],
                "workerName":payload["workerName"],
                "payloadSha256":hashlib.sha256(("synthetic-"+role).encode()).hexdigest(),
                "nonce":hashlib.sha256(("synthetic-nonce-"+role).encode()).hexdigest(),
                "operatorUid":self.uids[operator],
                "signerUid":self.uids[signer],
                "publicKeyFingerprint":rows[role]["fingerprint"],
                "issuedAt":self.issued,"expiresAt":self.expires,
            }
            payload["permits"][role]={
                "claims":claims,
                "signatureBase64":base64.b64encode(
                    self.root.sign(m.canonical_permit(claims))).decode()
            }
        return self.resign_batch(payload)
    def resign_batch(self,payload):
        return {"payload":payload,"signatureBase64":base64.b64encode(
            self.root.sign(m.canonical_batch(payload))).decode()}
    def review(self,bundle):
        return m.verify_batch(bundle,self.manifest,self.root.public_key(),
                              self.timestamp)
    def test_good_eight_roles_scope_only_not_operational_authorization(self):
        p=self.review(self.bundle)
        self.assertEqual(p["jobId"],483)
        self.assertEqual(set(p["permits"]),set(m.ROLES))
    def test_tampered_batch_denied(self):
        bad=copy.deepcopy(self.bundle)
        bad["payload"]["sourceSha"]="b"*40
        with self.assertRaises(m.GateError):
            self.review(bad)
    def test_not_all_roles_denied(self):
        bad=copy.deepcopy(self.bundle)
        bad["payload"]["permits"].pop("reviewer")
        bad=self.resign_batch(bad["payload"])
        with self.assertRaises(m.GateError):
            self.review(bad)
    def test_forged_individual_role_signature_denied(self):
        bad=copy.deepcopy(self.bundle)
        bad["payload"]["permits"]["reviewer"]["signatureBase64"] = (
            base64.b64encode(b"\0"*64).decode())
        bad=self.resign_batch(bad["payload"])
        with self.assertRaises(m.GateError):
            self.review(bad)
    def test_wrong_operator_uid_denied(self):
        bad=copy.deepcopy(self.bundle)
        bad["payload"]["permits"]["agent-qa"]["claims"]["operatorUid"]=1
        bad=self.resign_batch(bad["payload"])
        with self.assertRaises(m.GateError):
            self.review(bad)
    def test_duplicate_nonce_denied(self):
        bad=copy.deepcopy(self.bundle)
        bad["payload"]["permits"]["reviewer"]["claims"]["nonce"]=(
            bad["payload"]["permits"]["agent-coding"]["claims"]["nonce"])
        bad=self.resign_batch(bad["payload"])
        with self.assertRaises(m.GateError):
            self.review(bad)
    def test_expired_batch_denied(self):
        bad=copy.deepcopy(self.bundle)
        bad["payload"]["expiresAt"]=self.fmt(
            self.now-datetime.timedelta(seconds=1))
        bad=self.resign_batch(bad["payload"])
        with self.assertRaises(m.GateError):
            self.review(bad)
    def test_wrong_project_denied(self):
        bad=copy.deepcopy(self.bundle)
        bad["payload"]["project"]="nzdweipzckfszczzqtuw"
        bad=self.resign_batch(bad["payload"])
        with self.assertRaises(m.GateError):
            self.review(bad)
    def test_unsigned_root_not_accepted(self):
        impostor=Ed25519PrivateKey.generate().public_key()
        with self.assertRaises(m.GateError):
            m.verify_batch(self.bundle,self.manifest,impostor,self.timestamp)
    def test_synthetic_install_only_in_temp_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=pathlib.Path(tmp)
            with mock.patch.object(m,"ROOT",base),\
                 mock.patch.object(m,"APPROVED",base/"approved-public"),\
                 mock.patch.object(m,"RELEASES",base/"authorized-releases"),\
                 mock.patch.object(m.os,"chown",return_value=None):
                m.install(self.bundle,self.manifest,self.root.public_key())
            self.assertEqual(len(list((base/"approved-public").glob("*.json"))),8)
            self.assertEqual(len(list((base/"authorized-releases").glob("*.json"))),8)
            self.assertFalse((base/"approved-public"/"missing.json").exists())
    def test_write_failure_rolls_back_without_partial_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=pathlib.Path(tmp)
            original=m.write_new
            counter={"n":0}
            def fail_after_first(path,content):
                counter["n"]+=1
                if counter["n"]==2:
                    raise OSError("synthetic write failure")
                return original(path,content)
            with mock.patch.object(m,"ROOT",base),\
                 mock.patch.object(m,"APPROVED",base/"approved-public"),\
                 mock.patch.object(m,"RELEASES",base/"authorized-releases"),\
                 mock.patch.object(m.os,"chown",return_value=None),\
                 mock.patch.object(m,"write_new",side_effect=fail_after_first):
                with self.assertRaises(OSError):
                    m.install(self.bundle,self.manifest,self.root.public_key())
            self.assertFalse((base/"approved-public").exists())
            self.assertFalse((base/"authorized-releases").exists())

if __name__=="__main__":
    unittest.main()
