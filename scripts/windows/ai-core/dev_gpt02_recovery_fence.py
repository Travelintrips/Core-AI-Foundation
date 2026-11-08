"""DEV-only recovery fence proof verifier. Not wired to the live DELL worker.

A generic bridge claimToken or unsigned JSON never authorizes recovery.
The verifier requires an Ed25519 signature by a pinned, independently supplied
server issuer key and binds all proof fields to the expected native session.
The issuer/key provisioning/transport is NOT implemented by this module.
"""
import base64
import json
import re
import time
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

DOMAIN = b"ai-core-gpt02-recovery-fence/v1\n"
PROTOCOL = "ai-core-gpt02-recovery-fence/v1"
UUID = re.compile(r"\A[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\Z")
SHA = re.compile(r"\A[0-9a-f]{64}\Z")
MAX_VALID_MS = 120_000
MAX_CLOCK_SKEW_MS = 2_000
MAX_MESSAGE_BYTES = 4096
PROOF_KEYS = frozenset((
    "protocol", "reservationId", "parentCommandId", "childCommandId",
    "humanReviewId", "jobId", "workerId", "artifactSha256",
    "fencingToken", "sequence", "issuedAtUtcMs", "expiresAtUtcMs"
))
ENVELOPE_KEYS = frozenset(("proof", "signature"))


class RecoveryFenceDenied(RuntimeError):
    pass


def _deny(code):
    raise RecoveryFenceDenied(code)


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _deny("RECOVERY_FENCE_DUPLICATE_KEY")
        result[key] = value
    return result


def _finite(_value):
    _deny("RECOVERY_FENCE_NONFINITE_NUMBER")


def _canonical(proof):
    return DOMAIN + json.dumps(proof, sort_keys=True, ensure_ascii=False,
                               separators=(",", ":"), allow_nan=False).encode("utf-8")


def _identical_keys(data, keys):
    return type(data) is dict and frozenset(data) == keys


def _integer(x, minimum, maximum):
    return type(x) is int and minimum <= x <= maximum


def decode_envelope(raw):
    if not isinstance(raw, (str, bytes)):
        _deny("RECOVERY_FENCE_INVALID_ENVELOPE")
    if isinstance(raw, str):
        try:
            raw = raw.encode("utf-8", errors="strict")
        except UnicodeError:
            _deny("RECOVERY_FENCE_INVALID_UTF8")
    if not (0 < len(raw) <= MAX_MESSAGE_BYTES):
        _deny("RECOVERY_FENCE_SIZE_LIMIT")
    try:
        envelope = json.loads(raw.decode("utf-8", errors="strict"),
                              object_pairs_hook=_object, parse_constant=_finite)
    except (UnicodeError, ValueError, RecursionError):
        _deny("RECOVERY_FENCE_INVALID_JSON")
    if not _identical_keys(envelope, ENVELOPE_KEYS):
        _deny("RECOVERY_FENCE_INVALID_ENVELOPE")
    if not _identical_keys(envelope["proof"], PROOF_KEYS):
        _deny("RECOVERY_FENCE_INVALID_PROOF")
    signature = envelope["signature"]
    if type(signature) is not str or len(signature) != 88:
        _deny("RECOVERY_FENCE_INVALID_SIGNATURE")
    try:
        decoded = base64.b64decode(signature, validate=True)
    except ValueError:
        _deny("RECOVERY_FENCE_INVALID_SIGNATURE")
    if len(decoded) != 64:
        _deny("RECOVERY_FENCE_INVALID_SIGNATURE")
    return envelope["proof"], decoded


class RecoveryFenceSession:
    """Bound to one immutable native child/worker and fencing token.

    The caller must load the pinned public key from a trusted configuration,
    not from the work message. Rechecks are required before every native action.
    A proof alone DOES NOT authorize dispatch; it must accompany an independent
    active ordinary lease, verified worker binding and server-side CAS.
    """
    def __init__(self, *, reservation_id, parent_command_id, child_command_id,
                 human_review_id, job_id, worker_id, artifact_sha256,
                 public_key_bytes, clock=time):
        self.expected = {
            "reservationId": reservation_id,
            "parentCommandId": parent_command_id,
            "childCommandId": child_command_id,
            "humanReviewId": human_review_id,
            "jobId": job_id,
            "workerId": worker_id,
            "artifactSha256": artifact_sha256,
        }
        for key in ("reservationId", "parentCommandId", "childCommandId"):
            if type(self.expected[key]) is not str or not UUID.fullmatch(self.expected[key]):
                _deny("RECOVERY_FENCE_INVALID_EXPECTED_IDENTITY")
        if (not _integer(human_review_id, 1, 2**31-1) or
                not _integer(job_id, 1, 2**31-1) or
                type(worker_id) is not str or not 1 <= len(worker_id) <= 128 or
                worker_id.strip() != worker_id or
                type(artifact_sha256) is not str or not SHA.fullmatch(artifact_sha256)):
            _deny("RECOVERY_FENCE_INVALID_EXPECTED_IDENTITY")
        if type(public_key_bytes) is not bytes or len(public_key_bytes) != 32:
            _deny("RECOVERY_FENCE_PINNED_KEY_REQUIRED")
        self.public_key = Ed25519PublicKey.from_public_bytes(public_key_bytes)
        self.clock = clock
        self.fencing_token = None
        self.sequence = -1
        self.expires_monotonic = None
        self.failed = None

    def authorize(self):
        if self.failed:
            _deny(self.failed)
        if (self.expires_monotonic is None or
                self.clock.monotonic() >= self.expires_monotonic):
            self.failed = "RECOVERY_FENCE_EXPIRED_OR_MISSING"
            _deny(self.failed)
        return True

    def apply(self, raw):
        if self.failed:
            _deny(self.failed)
        # Once a native session has a token it may not revive an expired one.
        if self.sequence >= 0:
            self.authorize()
        try:
            proof, signature = decode_envelope(raw)
            if proof["protocol"] != PROTOCOL or any(
                proof.get(key) != value or type(proof.get(key)) is not type(value)
                for key, value in self.expected.items()
            ):
                _deny("RECOVERY_FENCE_SESSION_BINDING_MISMATCH")
            fence = proof["fencingToken"]
            seq = proof["sequence"]
            issued = proof["issuedAtUtcMs"]
            expires = proof["expiresAtUtcMs"]
            if (not _integer(fence, 1, 2**63-1) or
                    not _integer(seq, 0, 2**53-1) or
                    not _integer(issued, 1, 2**53-1) or
                    not _integer(expires, 1, 2**53-1) or
                    expires <= issued or expires-issued > MAX_VALID_MS):
                _deny("RECOVERY_FENCE_INVALID_LIFETIME_OR_TOKEN")
            if ((self.fencing_token is not None and fence != self.fencing_token) or
                    seq != self.sequence + 1):
                _deny("RECOVERY_FENCE_TOKEN_OR_SEQUENCE_MISMATCH")
            try:
                self.public_key.verify(signature, _canonical(proof))
            except InvalidSignature:
                _deny("RECOVERY_FENCE_SIGNATURE_NOT_VERIFIED")
            now_ms = int(self.clock.time()*1000)
            if issued > now_ms + MAX_CLOCK_SKEW_MS or expires <= now_ms:
                _deny("RECOVERY_FENCE_STALE_OR_FUTURE")
            # The lower of wall-clock remaining and the signed lifetime is
            # converted to a monotonic deadline, never extended by processing.
            deadline = self.clock.monotonic() + (expires-now_ms)/1000
            if deadline <= self.clock.monotonic():
                _deny("RECOVERY_FENCE_ALREADY_EXPIRED")
            self.fencing_token = fence
            self.sequence = seq
            self.expires_monotonic = deadline
            return self.authorize()
        except RecoveryFenceDenied as ex:
            self.failed = str(ex)
            raise
