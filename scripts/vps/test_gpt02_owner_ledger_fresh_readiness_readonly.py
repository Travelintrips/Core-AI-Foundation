#!/usr/bin/env python3
"""Isolated GPT02-1782 public custody checks: synthetic keys/proofs, no host IO."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

SCRIPT = Path(__file__).with_name("gpt02_owner_ledger_fresh_readiness_readonly.py")
spec = importlib.util.spec_from_file_location("tested_gpt02_fresh_readiness", SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
NOW = 1_800_000_000_000
CREDENTIAL_ID = "11111111-2222-4333-8444-555555555555"
RECEIPT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
BINDING = "a" * 64


def json_bytes(document):
    return json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf8")


def key_pair():
    key = Ed25519PrivateKey.generate()
    der = key.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
    return key, der


def signed(key, receipt):
    signature = base64.urlsafe_b64encode(key.sign(json_bytes(receipt))).decode().rstrip("=")
    return json_bytes({"receipt": receipt, "signature": signature})


def fixture():
    worker_key, worker_der = key_pair()
    issuer_key, issuer_der = key_pair()
    env = {
        "APP_ENV": "development", "NODE_ENV": "development",
        "SUPABASE_URL_DEV": "https://xssrfshdrtdfupgqwfdw.supabase.co",
        "GPT02_DEV_CUSTODY_DBA_PREPARATION_ENABLED": "false",
    }
    for prefix, der in (("ATTESTOR", worker_der), ("ISSUER", issuer_der)):
        keyname = f"GPT02_DEV_CUSTODY_{prefix}_PUBLIC_KEY_SPKI_"
        env[keyname + "B64"] = base64.b64encode(der).decode()
        env[keyname + "SHA256"] = hashlib.sha256(der).hexdigest()
    w = {
        **m.WORKER_TARGET,
        "credentialId": CREDENTIAL_ID,
        "credentialBinding": BINDING,
        "issuer": "CST_DEV_AGENT_CREDENTIAL_ADMIN",
        "notBefore": NOW - 60_000,
        "expiresAt": NOW + 600_000,
    }
    digest = hashlib.sha256(json_bytes(w)).hexdigest()
    d = {
        **m.DBA_TARGET,
        "credentialId": CREDENTIAL_ID,
        "credentialBinding": BINDING,
        "workerAttestationSha256": digest,
        "receiptId": RECEIPT_ID,
        "notBefore": NOW - 10_000,
        "expiresAt": NOW + 480_000,
    }
    return dict(env=env, worker_key=worker_key, issuer_key=issuer_key,
                worker=w, dba=d)


def evaluate(f, now=NOW):
    env = ("\n".join(f"{k}={v}" for k, v in f["env"].items()) + "\n").encode()
    worker = signed(f["worker_key"], f["worker"])
    dba = signed(f["issuer_key"], f["dba"])
    return m.verify_public_custody(env, worker, dba, now)


class FreshPublicCustodyTests(unittest.TestCase):
    def test_fresh_v2_pins_signatures_and_cross_receipt_lineage_are_valid_but_not_owner_approval(self):
        r = evaluate(fixture())
        self.assertTrue(all(r.values()))
        self.assertNotIn("reader_login_verified", r)
        self.assertNotIn("owner_fresh_one_use_authorization_verified", r)

    def test_expired_v9_like_signed_receipts_fail_freshness_even_if_signatures_verify(self):
        f = fixture()
        r = evaluate(f, NOW + 900_000)
        self.assertTrue(r["worker_signature_valid"])
        self.assertTrue(r["issuer_signature_valid"])
        self.assertFalse(r["worker_current_4min"])
        self.assertFalse(r["issuer_current_4min"])
        self.assertFalse(r["public_custody_current"])

    def test_remaining_less_than_four_minutes_fails_closed(self):
        f = fixture()
        self.assertFalse(evaluate(f, NOW + 400_000)["issuer_current_4min"])
        self.assertFalse(evaluate(f, NOW + 600_000)["public_custody_current"])

    def test_rejects_wrong_project_principal_reader_scope_and_v1_audiences(self):
        for target, patch in [
            ("worker", {"project": "nzdweipzckfszczzqtuw"}),
            ("worker", {"principal": "openclaw-pc-worker"}),
            ("worker", {"scope": "TASK190_RECOVERY"}),
            ("worker", {"audience": "CST-DEV/GPT02/READER-CUSTODY/WORKER-ATTESTATION/v1"}),
            ("dba", {"readerRole": "gpt02_owner_ledger_reader_dev"}),
            ("dba", {"runtimeCredentialPath": "/tmp/test.json"}),
            ("dba", {"project": "nzdweipzckfszczzqtuw"}),
            ("dba", {"audience": "CST-DEV/GPT02/READER-CUSTODY/DBA-RECEIPT/v1"}),
        ]:
            with self.subTest(target=target,patch=patch):
                f=fixture()
                f[target].update(patch)
                self.assertFalse(evaluate(f)["public_custody_current"])

    def test_wrong_generation_digest_credential_or_issuer_role_is_rejected(self):
        for target, patch in [
            ("worker", {"credentialId": "not-a-uuid"}),
            ("worker", {"credentialBinding": "0" * 64}),
            ("dba", {"credentialId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"}),
            ("dba", {"credentialBinding": "b" * 64}),
            ("dba", {"workerAttestationSha256": "1" * 64}),
            ("dba", {"receiptId": "not-a-uuid"}),
            ("dba", {"notBefore": NOW - 90_000}),
            ("dba", {"expiresAt": NOW + 700_000}),
        ]:
            with self.subTest(target=target,patch=patch):
                f=fixture()
                f[target].update(patch)
                self.assertFalse(evaluate(f)["public_custody_current"])

    def test_wrong_or_reused_public_keys_deny(self):
        f=fixture()
        f["env"]["GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256"]="0"*64
        self.assertFalse(evaluate(f)["public_custody_current"])
        f=fixture()
        for suffix in ("B64","SHA256"):
            f["env"]["GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_"+suffix]=f["env"]["GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_"+suffix]
        self.assertFalse(evaluate(f)["public_custody_current"])

    def test_tampered_signed_receipt_denies_without_disclosing_private_data(self):
        f=fixture()
        worker=signed(f["worker_key"], f["worker"])
        dba=signed(f["issuer_key"], f["dba"])
        env=("\n".join(f"{k}={v}" for k,v in f["env"].items())+"\n").encode()
        tampered=json.loads(worker)
        tampered["receipt"]["expiresAt"]+=1
        result=m.verify_public_custody(env,json_bytes(tampered),dba,NOW)
        self.assertFalse(result["worker_signature_valid"])
        self.assertFalse(result["public_custody_current"])
        self.assertNotIn(tampered["signature"], repr(result))
        self.assertNotIn(BINDING,repr(result))

    def test_duplicate_or_extra_key_and_noncanonical_signature_are_denied(self):
        f=fixture()
        valid=signed(f["worker_key"],f["worker"])
        data=json.loads(valid)
        candidates=[
            valid[:-1]+b',"receipt":{}}',
            json_bytes({**data,"extra":"bad"}),
            json_bytes({"receipt":{**f["worker"],"extra":"bad"},"signature":data["signature"]}),
            json_bytes({"receipt":f["worker"],"signature":data["signature"]+"="}),
            b"not-json",
            b"\xff",
        ]
        env=("\n".join(f"{k}={v}" for k,v in f["env"].items())+"\n").encode()
        dba=signed(f["issuer_key"],f["dba"])
        for candidate in candidates:
            with self.subTest(candidate=candidate[:30]):
                self.assertFalse(m.verify_public_custody(env,candidate,dba,NOW)["public_custody_current"])

    def test_only_metadata_public_custody_current_does_not_activate_preparation(self):
        f=fixture()
        f["env"]["GPT02_DEV_CUSTODY_DBA_PREPARATION_ENABLED"]="true"
        result=evaluate(f)
        self.assertTrue(result["public_custody_current"])
        self.assertFalse(result["dba_preparation_off"])


class CanonicalInstalledBootTests(unittest.TestCase):
    def test_merged_pr1851_boot_source_hash_pinned_and_any_tamper_refused(self):
        source=SOURCE.with_name("gpt02_1782_failclosed_boot_precheck.py").read_bytes()
        self.assertEqual(hashlib.sha256(source).hexdigest(),m.BOOT_SHA)
        self.assertFalse(m._pinned_canonical_closed(b"not-an-approved-nginx-site",source))
        self.assertFalse(m._pinned_canonical_closed(b"anything",source+b"\n# tamper"))
        self.assertFalse(m._pinned_canonical_closed(b"anything",b"wrong-helper"))

    def test_fixture_requires_entire_canonical_site_not_just_closed_owner_line(self):
        site=(
            b"server {\n"
            b"    location ^~ /api/gpt02-owner-ledger/ {\n"
            +b"    "+m.GATE+b"\n"
            +b"    proxy_pass http://127.0.0.1:18082;\n"
            +b"    }\n"
            b"    location = /api/bridge/admin/jobs {\n"
            b"    proxy_pass http://127.0.0.1:18296;\n"
            b"    }\n"
            b"    location = /api/bridge/admin/sessions {\n"
            b"    proxy_pass http://127.0.0.1:18296;\n"
            b"    }\n"
            b"    location ^~ /api/bridge/admin/jobs/ {\n"
            b"    proxy_pass http://127.0.0.1:18296;\n"
            b"    }\n"
            b"    location / {\n"
            b"    proxy_pass http://127.0.0.1:18501;\n"
            b"    }\n"
            b"}\n"
        )
        base=SOURCE.with_name("gpt02_1782_failclosed_boot_precheck.py").read_bytes()
        original=b"e34dde83f676dec15d27b56241b830cbffe7cb3ba0b07e6699f011d48fb651ed"
        self.assertEqual(base.count(original),1)
        pinned=base.replace(original,hashlib.sha256(site).hexdigest().encode(),1)
        with patch.object(m,"BOOT_SHA",hashlib.sha256(pinned).hexdigest()):
            self.assertTrue(m._pinned_canonical_closed(site,pinned))
            self.assertFalse(m._pinned_canonical_closed(site+b"\n# unapproved-other-route",pinned))
            self.assertFalse(m._pinned_canonical_closed(site.replace(m.GATE,b"return 200;",1),pinned))
            bridge=site.replace(b"proxy_pass http://127.0.0.1:18296;",
                                b"proxy_pass http://127.0.0.1:18181;")
            self.assertTrue(m._pinned_canonical_closed(bridge,pinned))


class ClosedGateTests(unittest.TestCase):
    def setUp(self):
        self.vhost=(
            b"server {\n location ^~ /api/gpt02-owner-ledger/ {\n"+
            b"  "+m.GATE+b"\n  "+m.PROXY+b"\n }\n"+
            b" location / { proxy_pass http://127.0.0.1:18181; }\n}\n"
        )
        self.boot=b"approved-bounded-boot-script"
        self.patch_canonical=patch.object(m,"_pinned_canonical_closed",
                            side_effect=lambda site, source: site == self.vhost and source == self.boot)
        self.patch_b=patch.object(m,"BOOT_SHA",hashlib.sha256(self.boot).hexdigest())
        self.patch_canonical.start();self.patch_b.start()
        self.addCleanup(self.patch_canonical.stop);self.addCleanup(self.patch_b.stop)

    def test_strict_closed_vhost_and_boot_hash(self):
        result=m.verify_closed_files(self.vhost,self.boot,True)
        self.assertTrue(all(result.values()))
        self.assertFalse(m.verify_closed_files(self.vhost,self.boot,False)["rollback_backup_absent"])
        self.assertFalse(m.verify_closed_files(self.vhost+b"unknown-change",self.boot,True)["closed_vhost_sha"])
        self.assertFalse(m.verify_closed_files(self.vhost,self.boot+b"unknown",True)["boot_guard_sha"])

    def test_missing_duplicated_or_open_gate_is_blocked(self):
        for vhost in (
            self.vhost.replace(m.GATE,b""),
            self.vhost.replace(m.GATE,m.COMMENT),
            self.vhost.replace(m.GATE,m.GATE+b"\n"+m.GATE),
            self.vhost.replace(m.LOCATION,b"location /wrong/ {"),
        ):
            with self.subTest(length=len(vhost)):
                self.assertFalse(m.verify_closed_files(vhost,self.boot,True)["exactly_one_closed_gate"])

    def test_readonly_inspect_never_claims_e2e_pass_even_if_all_public_proofs_are_current(self):
        f=fixture()
        payloads={
            m.VHOST:self.vhost,m.BOOT:self.boot,
            m.CONFIG:("\n".join(f"{k}={v}" for k,v in f["env"].items())+"\n").encode(),
            m.WORKER:signed(f["worker_key"],f["worker"]),
            m.DBA:signed(f["issuer_key"],f["dba"]),
        }
        with patch.object(m.os,"geteuid",return_value=0),\
             patch.object(m.os,"getegid",return_value=0),\
             patch.object(m.sys,"argv",["safe-preflight.py"]),\
             patch.object(m.os.path,"lexists",return_value=False),\
             patch.object(m,"_root_file",side_effect=lambda path,*_:payloads[path]):
            result=m.inspect(NOW)
        self.assertEqual(result["readiness"],"PUBLIC_EVIDENCE_CURRENT_ONLY")
        self.assertFalse(result["reader_login_verified"])
        self.assertFalse(result["worker_token_authenticated"])
        self.assertFalse(result["owner_fresh_one_use_authorization_verified"])
        self.assertFalse(result["live_negative_http404_verified"])
        self.assertFalse(result["live_e2e_ready"])
        self.assertEqual(result["action"],"RETAIN_NGINX_503")

    def test_wrong_cli_arguments_and_nonroot_cannot_read_protected_inputs(self):
        with patch.object(m.os,"geteuid",return_value=1234),\
             patch.object(m,"_root_file",side_effect=AssertionError("forbidden")):
            self.assertEqual(m.inspect(NOW)["readiness"],"BLOCKED")
        with patch.object(m.os,"geteuid",return_value=0),\
             patch.object(m.os,"getegid",return_value=0),\
             patch.object(m.sys,"argv",["preflight.py","--execute"]),\
             patch.object(m,"_root_file",side_effect=AssertionError("forbidden")):
            self.assertEqual(m.inspect(NOW)["readiness"],"BLOCKED")

if __name__=="__main__":
    unittest.main()
