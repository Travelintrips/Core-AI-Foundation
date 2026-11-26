#!/usr/bin/env python3
"""CST-DEV GPT02-1782 public custody and CLOSED Nginx readiness, READ ONLY.

A replacement for the expired v9 *diagnostic*, not an Owner authorization or
one-shot operator. Never authenticates a reader, opens Nginx, arms a timer,
changes a lease, reads sealed credentials, or issues an attestation/receipt.
A valid public proof is NOT current worker-token or Owner-session validation.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat, load_der_public_key

PROJECT = "xssrfshdrtdfupgqwfdw"
PRINCIPAL = "openclaw-vps-main"
ROLE = "gpt02_owner_ledger_reader_1782_dev"
SCOPE = "GPT02_READER_CREDENTIAL_CUSTODY_CST_DEV"
READER_PATH = "/run/credentials/gpt02-owner-ledger-reader/reader.json"
BOOT_SHA = "26ea880f87b4eed5dea9cda0bd907b03711262abe470cde65b6c2e8e4b4b0e32"
# PR #1851 owns the full-file canonical Nginx integrity rule. This read-only
# diagnostic invokes only that PINNED boot source's pure canonical_closed check.
# No duplicated or separately relaxed upstream allowlist is maintained here.
GATE = b"""return 503 '{"error":"GPT02_LEDGER_READER_NOT_PROVISIONED"}';"""
LOCATION = b"location ^~ /api/gpt02-owner-ledger/ {"
PROXY = b"proxy_pass http://127.0.0.1:18082;"
COMMENT = b"# GPT02-1782 bounded Owner GET test: automatic rollback armed"
MIN_REMAINING_MS = 4 * 60_000
MAX_WINDOW_MS = 24 * 60 * 60_000
MAX_SAFE_INTEGER = (1 << 53) - 1
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
SHA = re.compile(r"^[0-9a-f]{64}$")
SIG = re.compile(r"^[A-Za-z0-9_-]{86}$")
BASE64 = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")

WORKER_TARGET = {
    "audience": "CST-DEV/GPT02/READER-CUSTODY/WORKER-ATTESTATION/v2",
    "project": PROJECT, "scope": SCOPE, "principal": PRINCIPAL,
    "service": "openclaw-vps-dev-consumer",
}
DBA_TARGET = {
    "audience": "CST-DEV/GPT02/READER-CUSTODY/DBA-RECEIPT/v2",
    "project": PROJECT, "scope": SCOPE, "principal": PRINCIPAL,
    "readerRole": ROLE, "runtimeCredentialPath": READER_PATH,
    "issuer": "CST_DEV_READER_CREDENTIAL_CUSTODIAN",
}
WORKER_FIELDS = (*WORKER_TARGET, "credentialId", "credentialBinding", "issuer", "notBefore", "expiresAt")
DBA_FIELDS = (*DBA_TARGET, "credentialId", "credentialBinding", "workerAttestationSha256",
              "receiptId", "notBefore", "expiresAt")
PIN_NAMES = (
    "GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64",
    "GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256",
    "GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64",
    "GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256",
)
ALLOWED_ENV_NAMES = frozenset((*PIN_NAMES, "APP_ENV", "NODE_ENV", "SUPABASE_URL_DEV",
                                "GPT02_DEV_CUSTODY_DBA_PREPARATION_ENABLED"))

# All paths are fixed. No CLI override can introduce a credential source.
VHOST = Path("/etc/nginx/sites-enabled/dev-ai-task.cstlogistic.co.id")
BOOT = Path("/usr/local/sbin/gpt02-1782-failclosed-boot-precheck.py")
BACKUP = Path("/etc/nginx/dev-ai-task.gpt02-1782-guard-backup.conf")
CONFIG = Path("/etc/gpt02-dev/reader-custodian.env")
WORKER = Path("/run/credentials/gpt02-reader-custody/worker-attestation.json")
DBA = Path("/run/credentials/gpt02-reader-custody/issuer-receipt.json")


class PublicProofRejected(Exception):
    pass


def _unique(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise PublicProofRejected()
        result[name] = value
    return result


def _no_constant(_value):
    raise PublicProofRejected()


def _json_bytes(data: bytes) -> dict:
    doc = json.loads(data.decode("utf-8", "strict"), object_pairs_hook=_unique,
                     parse_constant=_no_constant)
    if type(doc) is not dict:
        raise PublicProofRejected()
    return doc


def _parse_pins(data: bytes) -> tuple[dict, bool]:
    values = {}
    for line in data.decode("utf-8", "strict").splitlines():
        if not line or line.startswith("#"):
            continue
        if "=" not in line or line != line.strip():
            raise PublicProofRejected()
        name, value = line.split("=", 1)
        if name in values or name not in ALLOWED_ENV_NAMES or value != value.strip():
            raise PublicProofRejected()
        values[name] = value
    if (values.get("APP_ENV") != "development" or
        values.get("NODE_ENV") != "development" or
        values.get("SUPABASE_URL_DEV") != f"https://{PROJECT}.supabase.co" or
        any(k not in values for k in PIN_NAMES) or
        values.get("GPT02_DEV_CUSTODY_DBA_PREPARATION_ENABLED") not in ("true", "false")):
        raise PublicProofRejected()
    return values, values["GPT02_DEV_CUSTODY_DBA_PREPARATION_ENABLED"] == "false"


def _trust(values: dict, authority: str) -> Ed25519PublicKey:
    prefix = f"GPT02_DEV_CUSTODY_{authority}_PUBLIC_KEY_SPKI_"
    encoded, digest = values[prefix + "B64"], values[prefix + "SHA256"]
    if (len(encoded) != 60 or not BASE64.fullmatch(encoded) or
        not SHA.fullmatch(digest)):
        raise PublicProofRejected()
    der = base64.b64decode(encoded, validate=True)
    if base64.b64encode(der).decode() != encoded:
        raise PublicProofRejected()
    if hashlib.sha256(der).hexdigest() != digest:
        raise PublicProofRejected()
    key = load_der_public_key(der)
    if not isinstance(key, Ed25519PublicKey) or key.public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo) != der:
        raise PublicProofRejected()
    return key


def _window(receipt: dict, now_ms: int) -> bool:
    start, end = receipt["notBefore"], receipt["expiresAt"]
    return (
        type(start) is int and type(end) is int and
        0 <= start < end <= MAX_SAFE_INTEGER and end - start <= MAX_WINDOW_MS and
        start <= now_ms and end - now_ms >= MIN_REMAINING_MS
    )


def _canonical(receipt: dict, fields: tuple[str, ...], target: dict) -> bytes:
    if type(receipt) is not dict or set(receipt) != set(fields):
        raise PublicProofRejected()
    if any(receipt[name] != expected for name, expected in target.items()):
        raise PublicProofRejected()
    # Matches the fixed JSON.stringify field order used by the TS verifier.
    return json.dumps({name: receipt[name] for name in fields}, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def _signed(envelope_bytes: bytes, target: dict, fields: tuple[str, ...],
            key: Ed25519PublicKey, now_ms: int) -> tuple[dict, str, bool]:
    obj = _json_bytes(envelope_bytes)
    if set(obj) != {"receipt", "signature"} or type(obj["signature"]) is not str:
        raise PublicProofRejected()
    receipt = obj["receipt"]
    canonical = _canonical(receipt, fields, target)
    signature = obj["signature"]
    if not SIG.fullmatch(signature):
        raise PublicProofRejected()
    binary = base64.urlsafe_b64decode(signature + "==")
    if len(binary) != 64 or base64.urlsafe_b64encode(binary).decode().rstrip("=") != signature:
        raise PublicProofRejected()
    key.verify(binary, canonical)
    return receipt, hashlib.sha256(canonical).hexdigest(), _window(receipt, now_ms)


def verify_public_custody(config: bytes, worker: bytes, dba: bytes, now_ms: int) -> dict:
    """Pure public-signature checks; never assert live worker/login/Owner authority."""
    result = {
        "public_pins_valid": False,
        "worker_signature_valid": False,
        "worker_current_4min": False,
        "issuer_signature_valid": False,
        "issuer_current_4min": False,
        "issuer_worker_binding_valid": False,
        "dba_preparation_off": False,
        "public_custody_current": False,
    }
    try:
        values, result["dba_preparation_off"] = _parse_pins(config)
        attestor = _trust(values, "ATTESTOR")
        issuer = _trust(values, "ISSUER")
        if attestor.public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo) == issuer.public_bytes(
                Encoding.DER, PublicFormat.SubjectPublicKeyInfo):
            raise PublicProofRejected()
        result["public_pins_valid"] = True
        w, digest, wc = _signed(worker, WORKER_TARGET, WORKER_FIELDS, attestor, now_ms)
        if not UUID.fullmatch(w["credentialId"]) or not SHA.fullmatch(w["credentialBinding"]) or w["issuer"] != "CST_DEV_AGENT_CREDENTIAL_ADMIN":
            raise PublicProofRejected()
        result["worker_signature_valid"] = True
        result["worker_current_4min"] = wc
        d, _, dc = _signed(dba, DBA_TARGET, DBA_FIELDS, issuer, now_ms)
        if not UUID.fullmatch(d["receiptId"]):
            raise PublicProofRejected()
        result["issuer_signature_valid"] = True
        result["issuer_current_4min"] = dc
        result["issuer_worker_binding_valid"] = (
            d["credentialId"] == w["credentialId"] and
            d["credentialBinding"] == w["credentialBinding"] and
            d["workerAttestationSha256"] == digest and
            type(d["notBefore"]) is int and type(d["expiresAt"]) is int and
            d["notBefore"] >= w["notBefore"] and d["expiresAt"] <= w["expiresAt"]
        )
    except (PublicProofRejected, ValueError, KeyError, TypeError, UnicodeError, OverflowError, Exception):
        # No source exception, path, signature, credential identifier or value is logged.
        pass
    result["public_custody_current"] = all((
        result["public_pins_valid"], result["worker_signature_valid"],
        result["worker_current_4min"], result["issuer_signature_valid"],
        result["issuer_current_4min"], result["issuer_worker_binding_valid"],
    ))
    return result


def _pinned_canonical_closed(vhost: bytes, boot: bytes) -> bool:
    """Reuse approved root boot precheck's *pure* closed-site verifier.

    The exact installed root script was read using _root_file, verified by SHA,
    and compiled in memory with __name__ != "__main__". Its service prestart
    entry point never runs, nor any file, network or database mutation.
    """
    if hashlib.sha256(boot).hexdigest() != BOOT_SHA:
        return False
    try:
        context = {"__name__": "gpt02_cst_dev_public_readonly_boot_source",
                   "__builtins__": __builtins__}
        exec(compile(boot, "<sha256-pinned-pr1851-boot-source>", "exec"), context)
        canonical = context.get("canonical_closed")
        return callable(canonical) and canonical(vhost) is True
    except Exception:
        return False


def verify_closed_files(vhost: bytes, boot: bytes, backup_absent: bool) -> dict:
    return {
        "closed_vhost_sha": _pinned_canonical_closed(vhost, boot),
        "exactly_one_closed_gate": vhost.count(GATE) == 1 and vhost.count(LOCATION) == 1 and
                                   vhost.count(PROXY) >= 1 and vhost.count(COMMENT) == 0,
        "boot_guard_sha": hashlib.sha256(boot).hexdigest() == BOOT_SHA,
        "rollback_backup_absent": backup_absent,
    }


def _root_file(path: Path, maximum: int, require_mode: int | None = None) -> bytes:
    """Walk the fixed absolute path with no-follow descriptors; compare before/after."""
    if not path.is_absolute() or ".." in path.parts:
        raise PublicProofRejected()
    ancestor = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    fd = None
    try:
        for part in path.parts[1:-1]:
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=ancestor)
            meta = os.fstat(nxt)
            if not stat.S_ISDIR(meta.st_mode) or meta.st_uid != 0 or meta.st_gid != 0 or meta.st_mode & 0o022:
                os.close(nxt)
                raise PublicProofRejected()
            os.close(ancestor)
            ancestor = nxt
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK, dir_fd=ancestor)
        first = os.fstat(fd)
        if (not stat.S_ISREG(first.st_mode) or first.st_uid != 0 or first.st_gid != 0 or
            first.st_nlink != 1 or not 0 < first.st_size <= maximum or
            (stat.S_IMODE(first.st_mode) != require_mode if require_mode is not None else bool(first.st_mode & 0o022))):
            raise PublicProofRejected()
        chunks = []
        total = 0
        while total <= maximum:
            data = os.read(fd, maximum + 1 - total)
            if not data:
                break
            chunks.append(data)
            total += len(data)
            if total > maximum:
                raise PublicProofRejected()
        last = os.fstat(fd)
        fields = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
        if total != first.st_size or any(getattr(last, name) != getattr(first, name) for name in fields):
            raise PublicProofRejected()
        return b"".join(chunks)
    finally:
        if fd is not None:
            os.close(fd)
        os.close(ancestor)


def inspect(now_ms: int | None = None) -> dict:
    result = {
        "scope": "GPT02-1782-CST-DEV",
        "reader_login_verified": False,
        "worker_token_authenticated": False,
        "owner_fresh_one_use_authorization_verified": False,
        "live_negative_http404_verified": False,
        "live_e2e_ready": False,
        "action": "RETAIN_NGINX_503",
    }
    if os.geteuid() != 0 or os.getegid() != 0 or sys.argv[1:]:
        result["readiness"] = "BLOCKED"
        return result
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    if type(now_ms) is not int or not 0 <= now_ms <= MAX_SAFE_INTEGER:
        result["readiness"] = "BLOCKED"
        return result
    try:
        closed = verify_closed_files(_root_file(VHOST, 200_000), _root_file(BOOT, 8192, 0o700),
                                     not os.path.lexists(BACKUP))
        result.update(closed)
        evidence = verify_public_custody(_root_file(CONFIG, 8192, 0o600),
                                         _root_file(WORKER, 8192, 0o600),
                                         _root_file(DBA, 8192, 0o600), now_ms)
        result.update(evidence)
        result["readiness"] = "PUBLIC_EVIDENCE_CURRENT_ONLY" if (
            all(closed.values()) and evidence["public_custody_current"]) else "BLOCKED"
    except Exception:
        result["readiness"] = "BLOCKED"
    return result


def main() -> int:
    result = inspect()
    # Whitelist fixed public status keys; never emit identities, tokens, paths or hashes.
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0 if result["readiness"] == "PUBLIC_EVIDENCE_CURRENT_ONLY" else 2


if __name__ == "__main__":
    raise SystemExit(main())
