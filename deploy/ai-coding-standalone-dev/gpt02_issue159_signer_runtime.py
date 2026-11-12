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
import uuid
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



def _unix_json_request(socket_path: str, route: str, payload: dict[str, object]):
    try:
        signer_gid = grp.getgrnam("gpt02-issue159-signers").gr_gid
        endpoint = os.lstat(socket_path)
        parent_path = os.path.dirname(socket_path)
        parent_entry = os.lstat(parent_path)
        if stat.S_ISLNK(parent_entry.st_mode):
            # systemd DynamicUser exposes exact, root-owned runtime aliases.
            # Accept only these two reader sockets, never caller paths.
            exact = {
                "/run/gpt02-reader/reader.sock": "/run/private/gpt02-reader",
                "/run/gpt02-issuer-reader/reader.sock": "/run/private/gpt02-issuer-reader",
            }
            if (parent_entry.st_uid != 0 or parent_entry.st_gid != 0
                    or os.path.realpath(parent_path) != exact.get(socket_path)):
                return None
            parent = os.stat(parent_path)
        else:
            parent = parent_entry
        if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid == 0
                or parent.st_gid != signer_gid or stat.S_IMODE(parent.st_mode) != 0o750
                or stat.S_ISLNK(endpoint.st_mode) or not stat.S_ISSOCK(endpoint.st_mode)
                or endpoint.st_uid == 0 or endpoint.st_gid != signer_gid
                or stat.S_IMODE(endpoint.st_mode) != 0o660):
            return None
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request = (
            f"POST {route} HTTP/1.1\r\n"
            "Host: localhost\r\n"
            "Connection: close\r\n"
            "Content-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n\r\n"
        ).encode("ascii") + body
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(35)
        try:
            client.connect(socket_path)
            client.sendall(request)
            chunks = []
            total = 0
            while True:
                chunk = client.recv(4096)
                if not chunk:
                    break
                total += len(chunk)
                if total > 8192:
                    return None
                chunks.append(chunk)
        finally:
            client.close()
        response = b"".join(chunks)
        header, separator, response_body = response.partition(b"\r\n\r\n")
        if not separator:
            return None
        status = int(header.split(b" ", 2)[1])
        return status, json.loads(response_body.decode("utf-8"))
    except (OSError, ValueError, KeyError, socket.timeout):
        return None


def _issuer_probe_payload() -> dict[str, object]:
    """Build a non-persisted, random lineage probe for the read-only Issuer reader."""
    now_ms = int(time.time() * 1000)
    return {
        "observedAt": now_ms,
        "claims": {
            "v": 1,
            "environment": "DEV",
            "audience": "GPT02_ISSUER_LEASE_EVIDENCE_V1",
            "companyId": "default",
            "hubTaskId": 2_147_483_647,
            "hubExecutionId": str(uuid.uuid4()),
            "coreTaskId": str(uuid.uuid4()),
            "commandId": str(uuid.uuid4()),
            "attemptId": str(uuid.uuid4()),
            "workerId": "openclaw-dell-chatgpt-wake-dev",
            "receiptId": str(uuid.uuid4()),
            "linkId": str(uuid.uuid4()),
            "fenceId": str(uuid.uuid4()),
            "approvalDigest": "0" * 64,
            "nonceDigest": "1" * 64,
            "issuerRole": "dev_gpt02_issuer_evidence",
            "leaseEpoch": 1,
            "issuedAt": now_ms - 1_000,
            "expiresAt": now_ms + 5_000,
        },
    }


def _probe_trusted_readers() -> dict[str, bool]:
    hub_result = _unix_json_request(
        "/run/gpt02-reader/reader.sock", "/trusted-facts", {},
    )
    hub_core = bool(
        hub_result and hub_result[0] == 400
        and hub_result[1].get("code") == "UNTRUSTED_TASK_IDENTITY"
        and hub_result[1].get("signingPermitted") is False
        and hub_result[1].get("dispatchPermitted") is False
    )
    issuer_result = _unix_json_request(
        "/run/gpt02-issuer-reader/reader.sock", "/issuer-evidence",
        _issuer_probe_payload(),
    )
    issuer_payload = issuer_result[1] if issuer_result else {}
    issuer_detail = issuer_payload.get("result") or {}
    issuer = bool(
        issuer_result and issuer_result[0] == 409
        and issuer_payload.get("ok") is False
        and issuer_payload.get("environment") == "DEV"
        and issuer_detail.get("reason") == "ISSUER_LEDGER_MISSING_OR_NOT_UNIQUE"
        and issuer_detail.get("readOnlySessionVerified") is True
        and issuer_detail.get("issuerLedgerMatched") is False
        and issuer_detail.get("persistedTrustedReadProven") is False
        and issuer_payload.get("signingPermitted") is False
        and issuer_payload.get("authorizationGranted") is False
        and issuer_payload.get("dispatchPermitted") is False
        and issuer_payload.get("releaseDecision") == "NO_GO"
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
    next_probe = time.monotonic() + 30
    while not stopped:
        time.sleep(1)
        if time.monotonic() >= next_probe:
            readers = _probe_trusted_readers()
            if readers != last_readers:
                _write_readiness(runtime_dir, role, fingerprint, readers)
                last_readers = readers
            next_probe = time.monotonic() + 30
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
