#!/usr/bin/env python3
"""Security-contract tests: synthetic manifests, no network, no live keys."""
import base64
import json
import os
import socket
import sys
import tempfile
import unittest
from datetime import datetime,timedelta,timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.path.insert(0,str(Path(__file__).parent))
import cst_onejob_preapproval_stage_broker as b

def when(d):
    return d.isoformat(timespec="milliseconds").replace("+00:00","Z")

class StageBrokerTests(unittest.TestCase):
    def setUp(self):
        self.now=datetime.now(timezone.utc)
        self.m=dict(zip(b.FIELDS,[
            1,"PREAPPROVAL_STAGE_ONLY",b.PROJECT,"1","a"*40,
            "cst_team_model_pilot_stage_login","8.8.8.8",b.HOST,
            b.PORT,b.SOCKET_PATH,28500,28501,28502,28501,
            987654321,when(self.now-timedelta(seconds=2)),
            when(self.now+timedelta(minutes=5)),"e"*32
        ]))

    def test_gate_a_accepts_scope_without_nonexistent_job_id(self):
        self.assertEqual(b.validate_scope(self.m,self.now),self.m)
        for k in ["jobId","ownerApprovalSha256","subscriberArmedSha256","requestId"]:
            with self.assertRaisesRegex(RuntimeError,"SCHEMA_DENIED"):
                b.validate_scope({**self.m,k:"f"*64},self.now)

    def test_wrong_project_port_host_login_scope_rejected(self):
        cases={"project":"nzdweipzckfszczzqtuw","companyId":"3",
          "stageLogin":"postgres","destinationHostname":"bad.example",
          "destinationPort":5432,"socketPath":"/run/cst-onejob-dev-db/pg-pooler.sock",
          "mode":"OPERATIONAL_CST_DEV","sourceSha":"f"*39}
        for name,value in cases.items():
            with self.subTest(name=name),self.assertRaises(RuntimeError):
                b.validate_scope({**self.m,name:value},self.now)

    def test_nonroot_peer_scope_and_expiry(self):
        cases={"brokerUid":0,"stageClientUid":28500,"stageClientGid":33,
          "networkNamespaceInode":0,"expiresAt":when(self.now+timedelta(minutes=14)),
          "issuedAt":when(self.now+timedelta(seconds=1)),
          "allowedDestinationIp":"127.0.0.1"}
        for name,value in cases.items():
            with self.subTest(name=name),self.assertRaises(RuntimeError):
                b.validate_scope({**self.m,name:value},self.now)

    def good_nft(self):
        return {"nftables":[
          {"table":{"family":"inet","name":b.NFT_TABLE,"handle":9}},
          {"chain":{"family":"inet","table":b.NFT_TABLE,"name":"output",
                    "type":"filter","hook":"output","policy":"drop","prio":0}},
          {"rule":{"family":"inet","table":b.NFT_TABLE,"chain":"output","expr":[
             {"match":{"op":"==","left":{"payload":{"protocol":"ip","field":"daddr"}},"right":"8.8.8.8"}},
             {"match":{"op":"==","left":{"payload":{"protocol":"tcp","field":"dport"}},"right":6543}},
             {"counter":{"packets":1,"bytes":80}},{"accept":None}]}},
          {"rule":{"family":"inet","table":b.NFT_TABLE,"chain":"output","expr":[
             {"counter":{"packets":1,"bytes":60}},{"drop":None}]}}
        ]}

    def test_kernel_policy_exact_allow_drop(self):
        self.assertTrue(b.kernel_egress_ready(self.m,self.good_nft()))
        for mutate in ("open","wrong_ip","wrong_port","missing_drop","extra_rule","zero_counters"):
            candidate=json.loads(json.dumps(self.good_nft()))
            if mutate=="open":candidate["nftables"][1]["chain"]["policy"]="accept"
            if mutate=="wrong_ip":candidate["nftables"][2]["rule"]["expr"][0]["match"]["right"]="1.1.1.1"
            if mutate=="wrong_port":candidate["nftables"][2]["rule"]["expr"][1]["match"]["right"]=5432
            if mutate=="missing_drop":candidate["nftables"].pop()
            if mutate=="extra_rule":candidate["nftables"].append(candidate["nftables"][3])
            if mutate=="zero_counters":candidate["nftables"][2]["rule"]["expr"][2]["counter"]["packets"]=0
            with self.subTest(mutate=mutate),self.assertRaises(RuntimeError):
                b.kernel_egress_ready(self.m,candidate)

    def test_no_namespace_policy_refuses_without_dial(self):
        with patch.object(b.os,"geteuid",return_value=0),self.assertRaisesRegex(RuntimeError,"BROKER_NAMESPACE_OR_UID"):
            b.serve_stage_once(self.m)
        with patch.object(b.os,"geteuid",return_value=28500),patch.object(b.os,"getegid",return_value=28501),patch.object(b.os,"stat",return_value=SimpleNamespace(st_ino=987654321)),patch.object(b,"kernel_egress_ready",side_effect=RuntimeError("CST_STAGE_BROKER_KERNEL_EGRESS_NOT_INSTALLED")):
            with self.assertRaisesRegex(RuntimeError,"EGRESS_NOT_INSTALLED"):
                b.serve_stage_once(self.m)

    def test_signed_technical_manifest_requires_exact_trusted_public_key(self):
        key=Ed25519PrivateKey.generate()
        public=key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo)
        pin=b.sha256(key.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)).hexdigest()
        signed=base64.b64encode(key.sign(json.dumps(self.m,separators=(",",":"),ensure_ascii=False).encode())).decode()
        with tempfile.TemporaryDirectory() as tmp:
            pub=Path(tmp)/"pub.pem";env=Path(tmp)/"envelope.json"
            pub.write_bytes(public);env.write_text(json.dumps({"manifest":self.m,"signatureBase64":signed}))
            real=b.read_regular
            def reader(path,*args):
                return real(path,*args[:1],exact_owner=None)
            with patch.object(b,"read_regular",side_effect=reader):
                self.assertEqual(b.read_signed_manifest(str(env),str(pub),pin,self.now),self.m)
                with self.assertRaisesRegex(RuntimeError,"TRUST_KEY_PIN"):
                    b.read_signed_manifest(str(env),str(pub),"0"*64,self.now)
                env.write_text(json.dumps({"manifest":{**self.m,"destinationPort":5432},"signatureBase64":signed}))
                with self.assertRaises(RuntimeError):
                    b.read_signed_manifest(str(env),str(pub),pin,self.now)

    def test_runtime_requires_externally_pinned_source_sha(self):
        source=Path(b.__file__).read_text()
        self.assertIn("--expected-source-sha",source)
        self.assertIn("PINNED_SOURCE_MISMATCH",source)
        self.assertNotIn("APPROVED_OPERATIONS_ROOT_FINGERPRINT=None",source)

    def test_expired_lease_denied_before_any_upstream_dial(self):
        called=[]
        with self.assertRaisesRegex(RuntimeError,"SESSION_LEASE_EXPIRED"):
            b.forward_stage_with_lease(None,self.m,
                dial=lambda: called.append("dial"),
                epoch=lambda: b.exact_timestamp(self.m["expiresAt"]).timestamp()+1)
        self.assertEqual(called,[])

    def test_one_session_forwards_bytes_via_mock_unix_sockets(self):
        client,client_peer=socket.socketpair()
        upstream,upstream_peer=socket.socketpair()
        try:
            client_peer.sendall(b"STAGING_QA_ONLY")
            client_peer.shutdown(socket.SHUT_WR)
            b.forward_stage_with_lease(client,self.m,dial=lambda:upstream)
            self.assertEqual(upstream_peer.recv(64),b"STAGING_QA_ONLY")
            self.assertEqual(upstream.fileno(),-1)
        finally:
            client.close()
            client_peer.close()
            upstream_peer.close()

    def test_absolute_expiry_ends_idle_session_without_tcp_access(self):
        client,client_peer=socket.socketpair()
        upstream,upstream_peer=socket.socketpair()
        ticks=[0.0]
        def advance():
            ticks[0]+=0.15
            return ticks[0]
        try:
            with self.assertRaisesRegex(RuntimeError,"SESSION_LEASE_OR_IDLE_TIMEOUT"):
                b.forward_stage_with_lease(client,self.m,dial=lambda:upstream,
                    epoch=lambda:b.exact_timestamp(self.m["expiresAt"]).timestamp()-0.8,
                    monotonic=advance)
            self.assertEqual(upstream.fileno(),-1)
        finally:
            client.close()
            client_peer.close()
            upstream_peer.close()

    def test_stop_request_aborts_active_mock_session(self):
        client,peer=socket.socketpair()
        up,other=socket.socketpair()
        try:
            dialled=[]
            with self.assertRaisesRegex(RuntimeError,"SESSION_STOP_REQUESTED"):
                b.forward_stage_with_lease(client,self.m,
                    dial=lambda:(dialled.append(True),up)[1],stopped=lambda:True)
            self.assertEqual(dialled,[],"stop must prevent upstream dial")
        finally:
            client.close()
            peer.close()
            other.close()

    def test_signal_during_open_mock_session_closes_upstream(self):
        client,peer=socket.socketpair()
        upstream,remote=socket.socketpair()
        calls=[0]
        def stopped():
            calls[0]+=1
            return calls[0]>=3
        try:
            with self.assertRaisesRegex(RuntimeError,"SESSION_STOP_REQUESTED"):
                b.forward_stage_with_lease(client,self.m,dial=lambda:upstream,stopped=stopped)
            self.assertEqual(upstream.fileno(),-1)
        finally:
            client.close()
            peer.close()
            remote.close()

    def test_never_reuses_rolling_gate_b_forwarder(self):
        source=Path(b.__file__).read_text()
        self.assertIn("forward_stage_with_lease(client,m,stopped=lambda:stop_requested)",source)
        self.assertNotIn("forward_once(client,m)",source)
        self.assertIn("absolute_end = tick()+remaining",source)

    def test_import_has_no_auto_start_or_live_broker(self):
        source=Path(b.__file__).read_text()
        self.assertIn('if __name__=="__main__":',source)
        self.assertNotIn("ALTER ROLE",source)
        self.assertNotIn("CREATE ROLE",source)
        self.assertNotIn("SUPABASE_PROD_DATABASE_URL",source)
        self.assertNotIn("password=",source)
        self.assertNotIn("service_role",source)

if __name__=="__main__":
    unittest.main(verbosity=2)
