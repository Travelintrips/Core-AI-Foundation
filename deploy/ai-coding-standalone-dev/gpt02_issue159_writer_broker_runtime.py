#!/usr/bin/env python3
"""DEV-only GPT02 Issue #159 evidence-verification ingress.

This is NOT the database writer. It accepts a bounded signed evidence packet
over a private Unix socket, verifies the four independently rooted signatures,
and returns a NO_GO verification receipt. It never connects to PostgreSQL,
loads private keys, signs, consumes nonce/lease, creates commands or dispatches.
"""
from __future__ import annotations

import argparse
import grp
import json
import os
import signal
import socket
import socketserver
import stat
import time
from pathlib import Path
from typing import Any

from gpt02_issue159_writer_broker_contract import (
    BrokerAdmissionError, verify_lifecycle_evidence_packet,
)

DEFAULT_SOCKET = "/run/gpt02-issue159-writer/verify.sock"
DEFAULT_PUBLIC_ROOTS = "/etc/gpt02-dev/public"
DEFAULT_FINGERPRINT_MANIFEST = "/etc/gpt02-dev/trust-fingerprints.json"
ROOT_FILES = {
    "approval": "approval-public.pem",
    "hub": "hub-identity-public.pem",
    "core": "core-identity-public.pem",
    "issuer": "issuer-public.pem",
}
MAX_BODY = 24 * 1024
MAX_HEADER = 4096
MAX_REQUEST = MAX_BODY + MAX_HEADER


def _load_public_roots(root_dir: str, manifest_path: str) -> dict[str, str]:
    root = Path(root_dir)
    result = {}
    for role, filename in ROOT_FILES.items():
        path = root / filename
        st = os.lstat(path)
        if (stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode)
                or st.st_uid != 0 or stat.S_IMODE(st.st_mode) & 0o022):
            raise RuntimeError("PUBLIC_ROOT_FILE_SECURITY_INVALID")
        content = path.read_text(encoding="ascii")
        if not content.startswith("-----BEGIN PUBLIC KEY-----"):
            raise RuntimeError("PUBLIC_ROOT_FORMAT_INVALID")
        result[role] = content
    manifest_file = Path(manifest_path)
    mst = os.lstat(manifest_file)
    if (stat.S_ISLNK(mst.st_mode) or not stat.S_ISREG(mst.st_mode)
            or mst.st_uid != 0 or stat.S_IMODE(mst.st_mode) & 0o022):
        raise RuntimeError("PUBLIC_FINGERPRINT_MANIFEST_SECURITY_INVALID")
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    if (not isinstance(manifest, dict) or set(manifest) != set(ROOT_FILES)
            or any(not isinstance(v, str) or len(v) != 64
                   or any(ch not in "0123456789abcdef" for ch in v)
                   for v in manifest.values())):
        raise RuntimeError("PUBLIC_FINGERPRINT_MANIFEST_SHAPE_INVALID")
    from gpt02_issue159_writer_broker_contract import _public_key
    import hashlib
    from cryptography.hazmat.primitives import serialization
    actual = {}
    for role, pem in result.items():
        key = _public_key(pem)
        der = key.public_bytes(serialization.Encoding.DER,
                               serialization.PublicFormat.SubjectPublicKeyInfo)
        actual[role] = hashlib.sha256(der).hexdigest()
    if actual != manifest or len(set(actual.values())) != 4:
        raise RuntimeError("PUBLIC_ROOT_FINGERPRINT_PIN_MISMATCH")
    return result


def _response(status: int, payload: dict[str, Any]) -> bytes:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    reason = {200: "OK", 400: "Bad Request", 403: "Forbidden",
              404: "Not Found", 413: "Payload Too Large",
              503: "Service Unavailable"}.get(status, "Error")
    return (
        f"HTTP/1.1 {status} {reason}\r\n"
        "Content-Type: application/json\r\n"
        "Cache-Control: no-store\r\n"
        "Connection: close\r\n"
        f"Content-Length: {len(body)}\r\n\r\n"
    ).encode("ascii") + body


def _read_request(conn: socket.socket) -> tuple[str, bytes]:
    conn.settimeout(3.0)
    total = 0
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = conn.recv(1024)
        if not chunk:
            raise ValueError("REQUEST_HEADER_INCOMPLETE")
        total += len(chunk)
        if total > MAX_HEADER:
            raise OverflowError("REQUEST_HEADER_TOO_LARGE")
        data += chunk
    header, _, remainder = data.partition(b"\r\n\r\n")
    lines = header.split(b"\r\n")
    if not lines or lines[0] != b"POST /verify-packet HTTP/1.1":
        raise LookupError("ROUTE_NOT_FOUND")
    headers = {}
    for line in lines[1:]:
        if b":" not in line:
            raise ValueError("REQUEST_HEADER_INVALID")
        key, value = line.split(b":", 1)
        normalized = key.strip().lower()
        if normalized in headers:
            raise ValueError("REQUEST_DUPLICATE_HEADER")
        headers[normalized] = value.strip()
    if b"transfer-encoding" in headers:
        raise ValueError("TRANSFER_ENCODING_NOT_SUPPORTED")
    if headers.get(b"content-type") != b"application/json":
        raise ValueError("CONTENT_TYPE_INVALID")
    raw_length = headers.get(b"content-length", b"")
    if not raw_length.isdigit():
        raise ValueError("CONTENT_LENGTH_INVALID")
    length = int(raw_length)
    if length <= 0:
        raise ValueError("REQUEST_BODY_EMPTY")
    if length > MAX_BODY:
        raise OverflowError("REQUEST_BODY_TOO_LARGE")
    body = remainder
    while len(body) < length:
        chunk = conn.recv(min(4096, length - len(body)))
        if not chunk:
            raise ValueError("REQUEST_BODY_INCOMPLETE")
        body += chunk
    if len(body) != length:
        raise ValueError("REQUEST_BODY_LENGTH_MISMATCH")
    return "verify", body


class _Handler(socketserver.StreamRequestHandler):
    roots: dict[str, str] = {}

    def handle(self):
        try:
            request, body = _read_request(self.request)
            if request != "verify":
                self.wfile.write(_response(404, {"ok": False, "reason": "NOT_FOUND"}))
                return
            packet = json.loads(body.decode("utf-8"))
            if (not isinstance(packet, dict)
                    or set(packet) != {"packet", "observedAt"}):
                raise ValueError("REQUEST_SHAPE_INVALID")
            result = verify_lifecycle_evidence_packet(
                packet["packet"], self.roots, packet["observedAt"]
            )
            # Verification only. The NO_GO contract is deliberate and immutable.
            if (result.get("packetVerified") is not True
                    or result.get("databaseWritePerformed") is not False
                    or result.get("nonceConsumed") is not False
                    or result.get("leaseConsumed") is not False
                    or result.get("signingPermitted") is not False
                    or result.get("authorizationGranted") is not False
                    or result.get("dispatchPermitted") is not False
                    or result.get("releaseDecision") != "NO_GO"):
                raise RuntimeError("VERIFIER_OUTPUT_CONTRACT_DRIFT")
            self.wfile.write(_response(200, {
                "ok": True, "environment": "DEV", "result": result,
                "writerEnabled": False, "databaseConnected": False,
                "signingPermitted": False, "authorizationGranted": False,
                "dispatchPermitted": False, "releaseDecision": "NO_GO",
            }))
        except LookupError:
            self.wfile.write(_response(404, {"ok": False, "reason": "NOT_FOUND"}))
        except OverflowError:
            self.wfile.write(_response(413, {"ok": False, "reason": "REQUEST_TOO_LARGE"}))
        except (ValueError, UnicodeError, json.JSONDecodeError, BrokerAdmissionError):
            self.wfile.write(_response(400, {"ok": False, "reason": "EVIDENCE_PACKET_REJECTED",
                "writerEnabled": False, "dispatchPermitted": False,
                "releaseDecision": "NO_GO"}))
        except Exception:
            self.wfile.write(_response(503, {"ok": False, "reason": "VERIFIER_UNAVAILABLE",
                "writerEnabled": False, "dispatchPermitted": False,
                "releaseDecision": "NO_GO"}))


class _UnixServer(socketserver.UnixStreamServer):
    allow_reuse_address = False
    daemon_threads = True


def serve(socket_path: str, public_root_dir: str, manifest_path: str,
          group_name: str, once: bool = False) -> int:
    roots = _load_public_roots(public_root_dir, manifest_path)
    # Validate all roots are four independent Ed25519 SPKIs before binding.
    from gpt02_issue159_writer_broker_contract import _public_key
    import hashlib
    from cryptography.hazmat.primitives import serialization
    fingerprints = set()
    for role in ROOT_FILES:
        key = _public_key(roots[role])
        der = key.public_bytes(serialization.Encoding.DER,
                               serialization.PublicFormat.SubjectPublicKeyInfo)
        fingerprints.add(hashlib.sha256(der).hexdigest())
    if len(fingerprints) != 4:
        raise RuntimeError("FOUR_INDEPENDENT_PUBLIC_ROOTS_REQUIRED")
    if once:
        print(json.dumps({"environment":"DEV","publicRootsVerified":True,
                          "fourDistinctRoots":True,"socketBound":False,
                          "databaseConnected":False,"writerEnabled":False,
                          "signingPermitted":False,"dispatchPermitted":False,
                          "releaseDecision":"NO_GO"},sort_keys=True))
        return 0

    parent = Path(socket_path).parent
    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    pst = os.lstat(parent)
    if stat.S_ISLNK(pst.st_mode) or not stat.S_ISDIR(pst.st_mode):
        raise RuntimeError("SOCKET_DIRECTORY_INVALID")
    if pst.st_uid != os.getuid() or stat.S_IMODE(pst.st_mode) != 0o700:
        raise RuntimeError("SOCKET_DIRECTORY_OWNERSHIP_INVALID")
    if os.path.lexists(socket_path):
        raise RuntimeError("SOCKET_PATH_ALREADY_EXISTS")
    _Handler.roots = roots
    server = _UnixServer(socket_path, _Handler)
    gid = grp.getgrnam(group_name).gr_gid
    os.chown(socket_path, os.getuid(), gid)
    os.chmod(socket_path, 0o660)
    st = os.lstat(socket_path)
    if (not stat.S_ISSOCK(st.st_mode) or st.st_uid != os.getuid()
            or st.st_gid != gid or stat.S_IMODE(st.st_mode) != 0o660):
        server.server_close()
        raise RuntimeError("SOCKET_PERMISSION_VERIFICATION_FAILED")
    stopped = False
    def stop(_sig, _frame):
        nonlocal stopped
        stopped = True
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    server.timeout = 0.5
    try:
        while not stopped:
            server.handle_request()
    finally:
        server.server_close()
        try:
            os.unlink(socket_path)
        except FileNotFoundError:
            pass
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--once", action="store_true")
    p.add_argument("--socket", default=os.environ.get("GPT02_WRITER_VERIFY_SOCKET", DEFAULT_SOCKET))
    p.add_argument("--public-roots", default=os.environ.get("GPT02_PUBLIC_ROOTS", DEFAULT_PUBLIC_ROOTS))
    p.add_argument("--fingerprint-manifest", default=os.environ.get("GPT02_FINGERPRINT_MANIFEST", DEFAULT_FINGERPRINT_MANIFEST))
    p.add_argument("--socket-group", default="gpt02-issue159-signers")
    args = p.parse_args()
    return serve(args.socket, args.public_roots, args.fingerprint_manifest, args.socket_group, args.once)


if __name__ == "__main__":
    raise SystemExit(main())
