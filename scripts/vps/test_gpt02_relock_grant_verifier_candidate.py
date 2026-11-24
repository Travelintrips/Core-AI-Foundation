#!/usr/bin/env python3
"""Ephemeral in-memory signing fixtures only: never an authorized Owner grant."""
import base64
import importlib.util
import json
import sys
import unittest
import uuid
from dataclasses import replace
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

root = Path(__file__).parent
for name in ("gpt02_relock_once_candidate", "gpt02_relock_grant_verifier_candidate"):
    spec = importlib.util.spec_from_file_location(name, root / (name + ".py"))
    m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
o = sys.modules["gpt02_relock_once_candidate"]
v = sys.modules["gpt02_relock_grant_verifier_candidate"]
NOW = 1795500000000
ID = "9c4f21e1-48af-4f7f-9830-931b84e3e846"
DIGEST = "d0f7ec8715502e62" + "a" * 48


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def owner():
    return o.VerifiedDecision(ID, DIGEST, o.SCOPE, o.PROJECT, "owner@example.test",
                              "APPROVED", "CONSUMED", 1, 1, o.OPERATIONS)


def payload():
    return {"version": 1, "scope": o.SCOPE, "projectId": o.PROJECT,
            "hostId": o.HOST, "principal": o.PRINCIPAL, "challengeId": ID,
            "manifestSha256": DIGEST, "operations": list(o.OPERATIONS),
            "executorNonce": str(uuid.uuid4()),
            "issuedAtMs": NOW-1000, "expiresAtMs": NOW+60000}


def sign(private, data):
    raw = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    signature = private.sign(v.ENVELOPE_DOMAIN + raw)
    return {"payloadB64u": b64(raw), "signatureB64u": b64(signature)}


class VerifyTests(unittest.TestCase):
    def setUp(self):
        self.priv = Ed25519PrivateKey.generate()
        self.key = self.priv.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
        self.owner = owner()

    def check_denied(self, envelope, key=None, decision=None, now=NOW):
        with self.assertRaises(o.GateDenied):
            v.verify_signed_executor_grant(
                envelope, key if key is not None else self.key,
                decision if decision is not None else self.owner, now
            )

    def test_valid_cryptographic_envelope_only_yields_checked_grant(self):
        g = v.verify_signed_executor_grant(sign(self.priv, payload()), self.key, self.owner, NOW)
        self.assertEqual(g.manifest_digest, DIGEST)
        self.assertEqual(g.operations, o.OPERATIONS)
        self.assertTrue(g.grant_active)

    def test_tampered_payload_rejected(self):
        env = sign(self.priv, payload())
        bad = payload()
        bad["projectId"] = "prod"
        env["payloadB64u"] = b64(json.dumps(bad, sort_keys=True, separators=(",", ":")).encode())
        self.check_denied(env)

    def test_wrong_trust_anchor_rejected(self):
        self.check_denied(sign(self.priv, payload()), Ed25519PrivateKey.generate().public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw))

    def test_expired_and_long_lived_grants_rejected(self):
        bad = payload()
        bad["expiresAtMs"] = NOW - 1
        self.check_denied(sign(self.priv, bad))
        bad = payload()
        bad["expiresAtMs"] = NOW + 900000
        self.check_denied(sign(self.priv, bad))

    def test_owner_digest_or_status_mismatch(self):
        env = sign(self.priv, payload())
        self.check_denied(env, decision=replace(self.owner, manifest_digest="b" * 64))
        self.check_denied(env, decision=replace(self.owner, challenge_status="PENDING"))

    def test_wrong_scope_or_principal_rejected(self):
        for field, value in (("scope", "GPT02_TASK183"), ("principal", "fake-worker"),
                             ("operations", ["DISPATCH"]), ("hostId", "production")):
            bad = payload()
            bad[field] = value
            with self.subTest(field=field):
                self.check_denied(sign(self.priv, bad))

    def test_unexpected_fields_and_noncanonical_json_rejected(self):
        bad = payload()
        bad["allowAnything"] = True
        self.check_denied(sign(self.priv, bad))
        raw = json.dumps(payload(), separators=(",", ":")).encode()
        self.check_denied({"payloadB64u": b64(raw),
                           "signatureB64u": b64(self.priv.sign(v.ENVELOPE_DOMAIN + raw))})

    def test_invalid_encoding_and_signature(self):
        self.check_denied({"payloadB64u": "bad?", "signatureB64u": "bad?"})
        env = sign(self.priv, payload())
        env["signatureB64u"] = b64(bytes(64))
        self.check_denied(env)

    def test_replay_not_authorized_by_verifier(self):
        env = sign(self.priv, payload())
        x = v.verify_signed_executor_grant(env, self.key, self.owner, NOW)
        y = v.verify_signed_executor_grant(env, self.key, self.owner, NOW)
        self.assertEqual(x.executor_nonce, y.executor_nonce)
        # Verifying a signature does NOT consume a nonce or authorize execution.
        self.assertEqual(x, y)


if __name__ == "__main__":
    unittest.main()
