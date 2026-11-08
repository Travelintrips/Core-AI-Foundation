"""Synthetic proof contract; NEVER executes a native worker or real command."""
import base64
import json
import unittest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from dev_gpt02_recovery_fence import (
    PROTOCOL, RecoveryFenceDenied, RecoveryFenceSession, _canonical,
)

PARENT="83db99f5-cbda-4e60-be71-3090fb411bbb"
CHILD="41aa961d-ac1e-4e12-a2c8-28ed07ff97cc"
RESERVATION="22aa961d-ac1e-4e12-a2c8-28ed07ff97cc"

class Clock:
    def __init__(self): self.mono=50.; self.wall=1700000000.
    def monotonic(self): return self.mono
    def time(self): return self.wall
    def advance(self, x): self.mono+=x;self.wall+=x

class Tests(unittest.TestCase):
    def setUp(self):
        self.clock=Clock()
        self.key=Ed25519PrivateKey.generate()
        self.keybytes=self.key.public_key().public_bytes(
            serialization.Encoding.Raw,serialization.PublicFormat.Raw)
        self.kw=dict(
            reservation_id=RESERVATION,parent_command_id=PARENT,
            child_command_id=CHILD,human_review_id=6,job_id=135,
            worker_id="gpt02-dell-worker",artifact_sha256="f"*64,
            public_key_bytes=self.keybytes,clock=self.clock)
        self.session=RecoveryFenceSession(**self.kw)
        self.proof=dict(protocol=PROTOCOL,reservationId=RESERVATION,
            parentCommandId=PARENT,childCommandId=CHILD,humanReviewId=6,
            jobId=135,workerId="gpt02-dell-worker",artifactSha256="f"*64,
            fencingToken=1,sequence=0,
            issuedAtUtcMs=int(self.clock.time()*1000),
            expiresAtUtcMs=int(self.clock.time()*1000)+30000)

    def envelope(self,p=None,key=None):
        proof=self.proof if p is None else p
        signature=(key or self.key).sign(_canonical(proof))
        return json.dumps(dict(proof=proof,signature=base64.b64encode(signature).decode()))

    def test_valid_signed_proof_and_renewal(self):
        self.assertTrue(self.session.apply(self.envelope()))
        self.clock.advance(15)
        renewal={**self.proof,"sequence":1,"issuedAtUtcMs":int(self.clock.time()*1000),
                 "expiresAtUtcMs":int(self.clock.time()*1000)+30000}
        self.assertTrue(self.session.apply(self.envelope(renewal)))
        self.clock.advance(29)
        self.assertTrue(self.session.authorize())
        self.clock.advance(1)
        with self.assertRaisesRegex(RecoveryFenceDenied,"EXPIRED"):
            self.session.authorize()

    def test_no_proof_never_authorizes(self):
        with self.assertRaisesRegex(RecoveryFenceDenied,"MISSING"):
            self.session.authorize()
        with self.assertRaises(RecoveryFenceDenied):
            self.session.apply(self.envelope())

    def test_wrong_signature_is_terminal(self):
        with self.assertRaisesRegex(RecoveryFenceDenied,"SIGNATURE"):
            self.session.apply(self.envelope(key=Ed25519PrivateKey.generate()))
        with self.assertRaises(RecoveryFenceDenied):
            self.session.apply(self.envelope())

    def test_replay_sequence_token_and_context_fail_closed(self):
        for patch in ({"sequence":1},{"fencingToken":0},{"fencingToken":True},
                      {"childCommandId":PARENT},{"reservationId":PARENT},
                      {"workerId":"another"},{"artifactSha256":"e"*64},
                      {"expiresAtUtcMs":self.proof["issuedAtUtcMs"]+121000}):
            with self.subTest(patch=patch):
                session=RecoveryFenceSession(**self.kw)
                with self.assertRaises(RecoveryFenceDenied):
                    session.apply(self.envelope({**self.proof,**patch}))

    def test_later_token_can_never_take_over_running_native_session(self):
        self.session.apply(self.envelope())
        updated={**self.proof,"sequence":1,"fencingToken":2}
        with self.assertRaisesRegex(RecoveryFenceDenied,"TOKEN_OR_SEQUENCE"):
            self.session.apply(self.envelope(updated))

    def test_no_renewal_after_expiration(self):
        self.session.apply(self.envelope())
        self.clock.advance(30)
        renewal={**self.proof,"sequence":1,"issuedAtUtcMs":int(self.clock.time()*1000),
                 "expiresAtUtcMs":int(self.clock.time()*1000)+10000}
        with self.assertRaisesRegex(RecoveryFenceDenied,"EXPIRED"):
            self.session.apply(self.envelope(renewal))

    def test_reject_forged_duplicate_keys_and_oversize(self):
        raw=self.envelope()
        attacks=[raw.replace('"signature":','"signature":"forged","signature":'),
                 raw.replace('"proof":','"unknown":false,"proof":'),
                 raw+' '*(4097-len(raw)), '{"proof":NaN,"signature":"x"}']
        for payload in attacks:
            with self.subTest(payload=payload[:24]):
                session=RecoveryFenceSession(**self.kw)
                with self.assertRaises(RecoveryFenceDenied):
                    session.apply(payload)

    def test_expired_and_future_clock_are_denied(self):
        for delta in (-40000,40000):
            session=RecoveryFenceSession(**self.kw)
            proof={**self.proof,"issuedAtUtcMs":self.proof["issuedAtUtcMs"]+delta,
                   "expiresAtUtcMs":self.proof["expiresAtUtcMs"]+delta}
            with self.assertRaisesRegex(RecoveryFenceDenied,"STALE_OR_FUTURE"):
                session.apply(self.envelope(proof))

if __name__=="__main__":unittest.main()
