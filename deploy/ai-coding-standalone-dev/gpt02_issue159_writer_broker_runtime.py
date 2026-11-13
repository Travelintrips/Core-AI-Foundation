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
import pwd
import re
import signal
import struct
import socket
import socketserver
import stat
import time
from pathlib import Path
from typing import Any

from gpt02_issue159_writer_broker_contract import (
    BrokerAdmissionError, verify_lifecycle_evidence_packet,
)
from gpt02_issue159_staged_admission import verify_pre_consumption_packet
from gpt02_issue159_lineage_readback_contract import validate_trusted_lineage_row

DEFAULT_SOCKET = "/run/gpt02-issue159-writer/verify.sock"
DEFAULT_APPROVAL_READER_SOCKET = "/run/gpt02-approval-reader/approval.sock"
DEFAULT_LINEAGE_READER_SOCKET = "/run/gpt02-lineage-reader/reader.sock"
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
    routes = {
        b"POST /verify-packet HTTP/1.1": "verify",
        b"POST /verify-approved-packet HTTP/1.1": "verify-approved",
        b"POST /verify-staged-approval HTTP/1.1": "verify-staged-approval",
        b"POST /verify-persisted-lineage HTTP/1.1": "verify-persisted-lineage",
    }
    if not lines or lines[0] not in routes:
        raise LookupError("ROUTE_NOT_FOUND")
    route = routes[lines[0]]
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
    return route, body


def _require_persisted_admin_decision(
    claims: dict[str, Any], approval_digest: str,
    reader_socket_path: str, server_now_ms: int,
) -> None:
    """Confirm a signer-verified approval was also persisted by the DEV admin API.

    This is a read-only Unix-socket lookup, not signer/dispatch authorization.
    The lookup is always derived from signed claims; caller JSON cannot provide
    a substitute "approved" boolean or a forged readback response.
    """
    st = os.lstat(reader_socket_path)
    if (not stat.S_ISSOCK(st.st_mode)
            or stat.S_IMODE(st.st_mode) & 0o007):
        raise RuntimeError("APPROVAL_SOCKET_NOT_PRIVATE")
    # The canonical production reader socket must be root-owned. Test-only
    # socket paths use disposable private directories and never grant authority.
    if reader_socket_path == DEFAULT_APPROVAL_READER_SOCKET:
        parent = os.lstat(str(Path(reader_socket_path).parent))
        if (st.st_uid != 0 or parent.st_uid != 0
                or not stat.S_ISDIR(parent.st_mode)
                or stat.S_IMODE(parent.st_mode) & 0o007):
            raise RuntimeError("APPROVAL_SOCKET_ROOT_CUSTODY_REQUIRED")
    lookup = {
        "claimsSha256": approval_digest,
        "taskId": claims["taskId"],
        "commandId": claims["commandId"],
        "attemptId": claims["attemptId"],
        "companyId": claims["companyId"],
        "superAdminId": claims["superAdminId"],
    }
    body = json.dumps(
        {"lookup": lookup, "observedAt": server_now_ms},
        separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")
    request = (
        b"POST /approval-intent HTTP/1.1\r\n"
        b"Host: localhost\r\n"
        b"Content-Type: application/json\r\n"
        b"Content-Length: " + str(len(body)).encode("ascii") +
        b"\r\nConnection: close\r\n\r\n" + body
    )
    chunks = []
    n = 0
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.settimeout(4.0)
        conn.connect(reader_socket_path)
        conn.sendall(request)
        while True:
            part = conn.recv(4096)
            if not part:
                break
            n += len(part)
            if n > 12000:
                raise RuntimeError("APPROVAL_READBACK_RESPONSE_TOO_LARGE")
            chunks.append(part)
    message = b"".join(chunks)
    header, sep, response_body = message.partition(b"\r\n\r\n")
    if not sep:
        raise RuntimeError("APPROVAL_READBACK_HTTP_INVALID")
    start = header.split(b"\r\n", 1)[0].split()
    if len(start) < 2 or start[0] != b"HTTP/1.1":
        raise RuntimeError("APPROVAL_READBACK_HTTP_INVALID")
    if start[1] == b"404":
        raise BrokerAdmissionError("PERSISTED_ADMIN_APPROVAL_NOT_FOUND")
    if start[1] != b"200":
        raise RuntimeError("APPROVAL_READBACK_NOT_OPERATIONAL")
    headers = {}
    for line in header.split(b"\r\n")[1:]:
        k, sep, v = line.partition(b":")
        if not sep:
            raise RuntimeError("APPROVAL_READBACK_HEADERS_INVALID")
        k = k.strip().lower()
        if k in headers:
            raise RuntimeError("APPROVAL_READBACK_DUPLICATE_HEADER")
        headers[k] = v.strip()
    if (headers.get(b"content-type") != b"application/json"
            or b"transfer-encoding" in headers
            or not headers.get(b"content-length", b"").isdigit()
            or len(response_body) != int(headers[b"content-length"])):
        raise RuntimeError("APPROVAL_READBACK_LENGTH_INVALID")
    response = json.loads(response_body.decode("utf-8"))
    if not isinstance(response, dict):
        raise RuntimeError("APPROVAL_READBACK_RESULT_INVALID")
    result = response.get("result")
    decision = result.get("decision") if isinstance(result, dict) else None
    if (response.get("ok") is not True
            or response.get("environment") != "DEV"
            or response.get("approvalReadOnly") is not True
            or response.get("decisionCreated") is not False
            or response.get("signingPermitted") is not False
            or response.get("authorizationGranted") is not False
            or response.get("dispatchPermitted") is not False
            or response.get("releaseDecision") != "NO_GO"
            or not isinstance(result, dict)
            or result.get("persistedTrustedReadProven") is not True
            or result.get("approvalBindingMatched") is not True
            or result.get("adminApprovalMatched") is not True
            or result.get("signingPermitted") is not False
            or result.get("authorizationGranted") is not False
            or result.get("dispatchPermitted") is not False
            or result.get("releaseDecision") != "NO_GO"
            or not isinstance(decision, dict)
            or decision.get("claimsSha256") != approval_digest
            or decision.get("actorId") != claims["superAdminId"]
            or decision.get("decision") != "APPROVE"
            or decision.get("roleAtDecision") != "super_admin"
            or decision.get("authMethod") not in (
                "supabase_admin_session", "supabase_aal2")
            or type(decision.get("recordedAt")) is not int
            or decision["recordedAt"] > server_now_ms):
        raise BrokerAdmissionError("PERSISTED_ADMIN_APPROVAL_READBACK_MISMATCH")


def _require_persisted_lineage(
    signed_packet: dict[str, Any], pinned_roots: dict[str, str],
    approval_digest: str, reader_socket: str, server_now_ms: int,
    *, reader_uid: int | None = None, reader_gid: int | None = None,
) -> dict[str, Any]:
    """Authenticate the DEV-only read-only Unix peer and signed lineage binding.

    No caller-provided receipt/fence IDs or reader rows enter the lookup.
    This is evidence verification, never a writer or dispatch authorization.
    """
    try:
        if reader_uid is None:
            reader_uid = pwd.getpwnam("gpt02-lineage-reader").pw_uid
        if reader_gid is None:
            reader_gid = grp.getgrnam("gpt02-issue159-signers").gr_gid
    except KeyError as exc:
        # A missing OS identity is an unavailable dependency (503), not a
        # request route miss (404) and never a reason to bypass peer pinning.
        raise RuntimeError("LINEAGE_READER_OS_IDENTITY_MISSING") from exc
    st = os.lstat(reader_socket)
    parent = os.lstat(str(Path(reader_socket).parent))
    if (not stat.S_ISSOCK(st.st_mode) or st.st_uid != reader_uid
            or st.st_gid != reader_gid or stat.S_IMODE(st.st_mode) != 0o660
            or not stat.S_ISDIR(parent.st_mode) or stat.S_ISLNK(parent.st_mode)
            or parent.st_uid != reader_uid or parent.st_gid != reader_gid
            or stat.S_IMODE(parent.st_mode) != 0o750):
        raise RuntimeError("LINEAGE_SOCKET_CUSTODY_INVALID")
    approval = signed_packet["approval"]["claims"]
    lookup = {
        "company_id": approval["companyId"],
        "task_id": approval["taskId"],
        "command_id": approval["commandId"],
        "attempt_id": approval["attemptId"],
        "approval_digest": approval_digest,
    }
    data = json.dumps({"lookup": lookup}, separators=(",", ":"), allow_nan=False).encode() + b"\n"
    chunks: list[bytes] = []
    size = 0
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.settimeout(4.0)
        conn.connect(reader_socket)
        if not hasattr(socket, "SO_PEERCRED"):
            raise RuntimeError("LINEAGE_PEER_CREDENTIALS_UNAVAILABLE")
        peer = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
        _pid, uid, _gid = struct.unpack("3i", peer)
        if uid != reader_uid:
            raise RuntimeError("LINEAGE_SOCKET_PEER_UID_MISMATCH")
        conn.sendall(data)
        while True:
            chunk = conn.recv(4096)
            if not chunk:
                break
            size += len(chunk)
            if size > 16384:
                raise RuntimeError("LINEAGE_READER_RESPONSE_TOO_LARGE")
            chunks.append(chunk)
            if b"\n" in chunk:
                break
    reply = b"".join(chunks)
    if not reply.endswith(b"\n") or reply.count(b"\n") != 1:
        raise RuntimeError("LINEAGE_READER_RESPONSE_FRAMING_INVALID")
    response = json.loads(reply.decode("utf-8"))
    expected_fields = {
        "environment", "readOnly", "matched", "rows",
        "databaseWritePerformed", "signingPermitted",
        "authorizationGranted", "dispatchPermitted", "releaseDecision",
    }
    if (not isinstance(response, dict) or set(response) != expected_fields
            or response["environment"] != "DEV"
            or response["readOnly"] is not True
            or response["databaseWritePerformed"] is not False
            or response["signingPermitted"] is not False
            or response["authorizationGranted"] is not False
            or response["dispatchPermitted"] is not False
            or response["releaseDecision"] != "NO_GO"):
        raise BrokerAdmissionError("PERSISTED_LINEAGE_READER_RESPONSE_INVALID")
    rows = response["rows"]
    if (response["matched"] is not True
            or not isinstance(rows, list) or len(rows) != 1):
        raise BrokerAdmissionError("PERSISTED_LINEAGE_NOT_FOUND_OR_AMBIGUOUS")
    verified = validate_trusted_lineage_row(
        signed_packet, pinned_roots, server_now_ms, rows)
    return {**verified, "trustedAdapterAuthenticated": True,
            "lineageReaderReadOnly": True}


class _Handler(socketserver.StreamRequestHandler):
    roots: dict[str, str] = {}
    approval_reader_socket: str = DEFAULT_APPROVAL_READER_SOCKET
    lineage_reader_socket: str = DEFAULT_LINEAGE_READER_SOCKET

    def handle(self):
        try:
            request, body = _read_request(self.request)
            if request not in ("verify", "verify-approved", "verify-staged-approval",
                               "verify-persisted-lineage"):
                self.wfile.write(_response(404, {"ok": False, "reason": "NOT_FOUND"}))
                return
            packet = json.loads(body.decode("utf-8"))
            if (not isinstance(packet, dict)
                    or set(packet) != {"packet", "observedAt"}):
                raise ValueError("REQUEST_SHAPE_INVALID")
            # The caller's observedAt is never an authority for freshness.
            # Reject significant skew and verify using the server's own clock.
            server_now_ms = int(time.time() * 1000)
            caller_time = packet["observedAt"]
            if (type(caller_time) is not int
                    or abs(caller_time - server_now_ms) > 5000):
                raise ValueError("CLIENT_OBSERVATION_TIME_UNTRUSTED")
            if request == "verify-staged-approval":
                # Stage A has no receipt/fence yet. Verify three independent
                # signatures, then derive persisted-approval lookup from claims.
                result = verify_pre_consumption_packet(
                    packet["packet"], self.roots, server_now_ms
                )
                _require_persisted_admin_decision(
                    packet["packet"]["approval"]["claims"],
                    result["approvalDigest"],
                    self.approval_reader_socket,
                    server_now_ms,
                )
                result = {**result, "persistedAdminApprovalReadBack": True}
            else:
                result = verify_lifecycle_evidence_packet(
                    packet["packet"], self.roots, server_now_ms
                )
            if request in ("verify-approved", "verify-persisted-lineage"):
                _require_persisted_admin_decision(
                    packet["packet"]["approval"]["claims"],
                    result["approvalDigest"],
                    self.approval_reader_socket,
                    server_now_ms,
                )
                result = {**result, "persistedAdminApprovalReadBack": True}
            if request == "verify-persisted-lineage":
                proof = _require_persisted_lineage(
                    packet["packet"], self.roots, result["approvalDigest"],
                    self.lineage_reader_socket, server_now_ms)
                result = {**result, **proof}
            elif request == "verify":
                result = {**result, "persistedAdminApprovalReadBack": False}
            # Verification only. The NO_GO contract is deliberate and immutable.
            if ((result.get("packetVerified") is not True
                 and result.get("threeSignaturesVerified") is not True)
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
        except BrokerAdmissionError as exc:
            code = str(exc)
            # Never echo arbitrary exception text; a stable uppercase code
            # is safe to expose while all authorization flags remain false.
            if not re.fullmatch(r"[A-Z0-9_:-]{1,120}", code):
                code = "PERSISTED_APPROVAL_OR_SIGNED_EVIDENCE_DENIED"
            self.wfile.write(_response(403 if code.startswith("PERSISTED_") else 400, {
                "ok": False, "reason": code,
                "writerEnabled": False, "signingPermitted": False,
                "authorizationGranted": False, "dispatchPermitted": False,
                "releaseDecision": "NO_GO",
            }))
        except LookupError:
            self.wfile.write(_response(404, {"ok": False, "reason": "NOT_FOUND"}))
        except OverflowError:
            self.wfile.write(_response(413, {"ok": False, "reason": "REQUEST_TOO_LARGE"}))
        except (ValueError, UnicodeError, json.JSONDecodeError):
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
          group_name: str, once: bool = False,
          approval_reader_socket: str = DEFAULT_APPROVAL_READER_SOCKET,
          lineage_reader_socket: str = DEFAULT_LINEAGE_READER_SOCKET) -> int:
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
    parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    pst = os.lstat(parent)
    gid = grp.getgrnam(group_name).gr_gid
    if (stat.S_ISLNK(pst.st_mode) or not stat.S_ISDIR(pst.st_mode)
            or pst.st_uid != os.getuid() or pst.st_gid != gid
            or stat.S_IMODE(pst.st_mode) != 0o750):
        raise RuntimeError("SOCKET_DIRECTORY_OWNERSHIP_INVALID")
    if os.path.lexists(socket_path):
        raise RuntimeError("SOCKET_PATH_ALREADY_EXISTS")
    _Handler.roots = roots
    _Handler.approval_reader_socket = approval_reader_socket
    _Handler.lineage_reader_socket = lineage_reader_socket
    server = _UnixServer(socket_path, _Handler)
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
    p.add_argument("--approval-reader-socket", default=DEFAULT_APPROVAL_READER_SOCKET)
    p.add_argument("--lineage-reader-socket", default=DEFAULT_LINEAGE_READER_SOCKET)
    args = p.parse_args()
    return serve(args.socket, args.public_roots, args.fingerprint_manifest, args.socket_group,
                 args.once, args.approval_reader_socket, args.lineage_reader_socket)


if __name__ == "__main__":
    raise SystemExit(main())
