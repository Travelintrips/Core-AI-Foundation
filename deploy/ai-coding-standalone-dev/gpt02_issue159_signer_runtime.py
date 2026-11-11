#!/usr/bin/env python3
"""DEV-only GPT02 Issue #159 signer custody runtime boundary.

Loads one systemd-decrypted Ed25519 private credential only to prove that its
public SPKI fingerprint matches the independently reviewed manifest. It never
signs, opens a network listener, reads business evidence, authorizes, dispatches,
or exposes private key bytes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import socket
import stat
import grp
import sys
import time
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROLES = ("approval", "hub", "core", "issuer")
MANIFEST_KEYS = frozenset(ROLES)


def _deny(code: str) -> None:
    raise RuntimeError(code)


def _load(role: str, credentials_dir: str):
    if role not in ROLES:
        _deny("GPT02_ISSUE159_SIGNER_ROLE_INVALID")
    if os.environ.get("GPT02_ISSUE159_SIGNING_ENABLED", "false") != "false":
        _deny("GPT02_ISSUE159_SIGNING_MUST_REMAIN_DISABLED")

    root = Path(credentials_dir)
    key_path = root / "private-key.pkcs8"
    manifest_path = root / "manifest.json"
    if not key_path.is_file() or not manifest_path.is_file():
        _deny("GPT02_ISSUE159_SYSTEMD_CREDENTIALS_REQUIRED")

    key_bytes = key_path.read_bytes()
    try:
        key = serialization.load_der_private_key(key_bytes, password=None)
    finally:
        # Do not retain a second immutable Python bytes reference longer than
        # necessary. The key object itself remains process-local.
        key_bytes = b""
    if not isinstance(key, Ed25519PrivateKey):
        _deny("GPT02_ISSUE159_ED25519_PRIVATE_KEY_REQUIRED")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or frozenset(manifest) != MANIFEST_KEYS:
        _deny("GPT02_ISSUE159_MANIFEST_SHAPE_INVALID")
    if any(
        not isinstance(v, str) or len(v) != 64
        or any(ch not in "0123456789abcdef" for ch in v)
        for v in manifest.values()
    ) or len(set(manifest.values())) != 4:
        _deny("GPT02_ISSUE159_MANIFEST_FINGERPRINT_INVALID")

    public_der = key.public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    fingerprint = hashlib.sha256(public_der).hexdigest()
    if fingerprint != manifest[role]:
        _deny("GPT02_ISSUE159_PRIVATE_PUBLIC_FINGERPRINT_MISMATCH")
    return key, fingerprint



def _unix_health(socket_path: str, expected: dict[str, object]) -> bool:
    try:
        signer_gid = grp.getgrnam("gpt02-issue159-signers").gr_gid
        endpoint = os.lstat(socket_path)
        parent = os.lstat(os.path.dirname(socket_path))
        if (stat.S_ISLNK(parent.st_mode) or not stat.S_ISDIR(parent.st_mode)
                or parent.st_gid != signer_gid or stat.S_IMODE(parent.st_mode) != 0o750
                or stat.S_ISLNK(endpoint.st_mode) or not stat.S_ISSOCK(endpoint.st_mode)
                or endpoint.st_gid != signer_gid or stat.S_IMODE(endpoint.st_mode) != 0o660):
            return False
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(5)
        try:
            client.connect(socket_path)
            client.sendall(
                b"GET /health HTTP/1.1\r\n"
                b"Host: localhost\r\n"
                b"Connection: close\r\n\r\n"
            )
            chunks = []
            total = 0
            while True:
                chunk = client.recv(4096)
                if not chunk:
                    break
                total += len(chunk)
                if total > 8192:
                    return False
                chunks.append(chunk)
        finally:
            client.close()
        response = b"".join(chunks)
        header, separator, body = response.partition(b"\r\n\r\n")
        if not separator or not header.startswith(b"HTTP/1.1 200 "):
            return False
        payload = json.loads(body.decode("utf-8"))
        return all(payload.get(key) == value for key, value in expected.items())
    except (OSError, ValueError, KeyError, socket.timeout):
        return False


def _probe_trusted_readers() -> dict[str, bool]:
    hub_core = _unix_health(
        "/run/gpt02-reader/reader.sock",
        {
            "ok": True, "environment": "DEV", "twoSessionsVerified": True,
            "signingPermitted": False, "dispatchPermitted": False,
        },
    )
    issuer = _unix_health(
        "/run/gpt02-issuer-reader/reader.sock",
        {
            "ok": True, "environment": "DEV", "readerReady": True,
            "issuerRole": "gpt02_issuer_evidence_reader", "tlsVerified": True,
            "readOnly": True, "signingPermitted": False,
            "authorizationGranted": False, "dispatchPermitted": False,
            "releaseDecision": "NO_GO",
        },
    )
    return {
        "hubCoreReaderOperational": hub_core,
        "issuerReaderOperational": issuer,
        "trustedReaderConnectivityVerified": hub_core and issuer,
    }

def _write_readiness(runtime_dir: str, role: str, fingerprint: str, readers: dict[str, bool]):
    root = Path(runtime_dir)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = root / "readiness.json"
    data = {
        "environment": "DEV",
        "role": role,
        "algorithm": "Ed25519",
        "fingerprintMatched": True,
        "privateCredentialMounted": True,
        "businessEvidenceRead": False,
        "hubCoreReaderOperational": readers["hubCoreReaderOperational"],
        "issuerReaderOperational": readers["issuerReaderOperational"],
        "trustedReaderConnectivityVerified": readers["trustedReaderConnectivityVerified"],
        "authorizerOperational": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }
    tmp = root / ".readiness.json.tmp"
    tmp.write_text(json.dumps(data, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
    return path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    role = os.environ.get("GPT02_ISSUE159_SIGNER_ROLE", "")
    credentials_dir = os.environ.get("CREDENTIALS_DIRECTORY", "")
    runtime_dir = os.environ.get("RUNTIME_DIRECTORY", "")
    if not credentials_dir or not runtime_dir:
        _deny("GPT02_ISSUE159_SYSTEMD_RUNTIME_REQUIRED")

    key, fingerprint = _load(role, credentials_dir)
    readers = (
        {"hubCoreReaderOperational": False, "issuerReaderOperational": False,
         "trustedReaderConnectivityVerified": False}
        if args.once else _probe_trusted_readers()
    )
    _write_readiness(runtime_dir, role, fingerprint, readers)

    # The key is intentionally loaded so systemd credential mounting and public
    # fingerprint binding are real. There is deliberately no signing API.
    if args.once:
        return 0

    stopped = False

    def stop(_sig, _frame):
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    last_readers = readers
    next_probe = time.monotonic() + 5
    while not stopped:
        time.sleep(1)
        if time.monotonic() >= next_probe:
            readers = _probe_trusted_readers()
            if readers != last_readers:
                _write_readiness(runtime_dir, role, fingerprint, readers)
                last_readers = readers
            next_probe = time.monotonic() + 5
    # Keep key alive until shutdown; never serialize or print it.
    del key
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        # Error codes only; never print key bytes, credential contents, or paths
        # supplied by untrusted callers.
        print(str(exc), file=sys.stderr)
        sys.exit(2)
