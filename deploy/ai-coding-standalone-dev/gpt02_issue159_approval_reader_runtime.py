#!/usr/bin/env python3
"""Read-only DEV Unix-socket reader for GPT02 Issue #159 Super Admin approval intents.

The service reads the pinned root-owned SQLite store in read-only/query-only mode.
It never records approvals, writes SQLite, loads signer keys, signs, authorizes,
or dispatches. A valid stored intent is evidence only and still returns NO_GO.
"""
from __future__ import annotations

import grp
import json
import os
import signal
import socket
import socketserver
import stat
import threading
from http.server import BaseHTTPRequestHandler

from gpt02_issue159_approval_intent_reader import LIVE_DB, read_approval_intent
from gpt02_issue159_approval_store_readiness import inspect as inspect_approval_store

SOCKET_PATH = "/run/gpt02-approval-reader/reader.sock"
RUNTIME_DIR = "/run/gpt02-approval-reader"
SIGNER_GROUP = "gpt02-issue159-signers"
MAX_BODY_BYTES = 8192


def _exact_object(value: object, fields: tuple[str, ...]) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == set(fields)
    )


def handle_approval_intent_payload(payload: object, reader=read_approval_intent):
    """Evaluate one exact lookup; no caller-provided booleans become authority."""
    if not _exact_object(payload, ("lookup", "observedAtMs")):
        return 400, {
            "environment": "DEV",
            "reason": "APPROVAL_READER_REQUEST_SHAPE_INVALID",
            "persistedTrustedReadProven": False,
            "signingPermitted": False,
            "authorizationGranted": False,
            "dispatchPermitted": False,
            "releaseDecision": "NO_GO",
        }
    lookup = payload["lookup"]
    observed_at = payload["observedAtMs"]
    if not isinstance(observed_at, int) or isinstance(observed_at, bool) or observed_at <= 0:
        return 400, {
            "environment": "DEV",
            "reason": "APPROVAL_READER_OBSERVATION_INVALID",
            "persistedTrustedReadProven": False,
            "signingPermitted": False,
            "authorizationGranted": False,
            "dispatchPermitted": False,
            "releaseDecision": "NO_GO",
        }

    result = reader(LIVE_DB, lookup, observed_at, operational=True)
    reason = result.get("reason")
    if result.get("persistedTrustedReadProven") is True:
        status = 200
    elif reason == "APPROVAL_INTENT_LOOKUP_INVALID":
        status = 400
    elif reason in (
        "APPROVAL_DB_NOT_FOUND",
        "APPROVAL_DB_FILE_SECURITY_NOT_VERIFIED",
        "APPROVAL_DB_READ_FAILED",
        "APPROVAL_INTENT_READ_FAILED",
    ):
        status = 503
    else:
        status = 409

    return status, {
        "environment": "DEV",
        "ok": result.get("persistedTrustedReadProven") is True,
        "result": result,
        "persistedTrustedReadProven": result.get("persistedTrustedReadProven") is True,
        "approvalBindingMatched": result.get("approvalBindingMatched") is True,
        "adminApprovalMatched": result.get("adminApprovalMatched") is True,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }


class ApprovalReaderHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "GPT02-Approval-Reader/1"

    def log_message(self, _format, *_args):
        # Never log request bodies, claim digests, or admin identifiers.
        return

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def do_GET(self):
        if self.path != "/health":
            return self._send_json(404, {
                "environment": "DEV",
                "ok": False,
                "reason": "NOT_FOUND",
                "signingPermitted": False,
                "authorizationGranted": False,
                "dispatchPermitted": False,
                "releaseDecision": "NO_GO",
            })
        store = inspect_approval_store(LIVE_DB, operational=True)
        ready = (
            store.get("trustedPersistedReadReady") is True
            and store.get("approvalIntentSchemaExact") is True
            and store.get("approvalIntentLookupIndexExact") is True
            and store.get("fileSecurityVerified") is True
        )
        return self._send_json(200 if ready else 503, {
            "environment": "DEV",
            "ok": ready,
            "approvalReaderReady": ready,
            "readOnly": True,
            "approvalIntentSchemaExact": store.get("approvalIntentSchemaExact") is True,
            "approvalIntentLookupIndexExact": store.get("approvalIntentLookupIndexExact") is True,
            "signingPermitted": False,
            "authorizationGranted": False,
            "dispatchPermitted": False,
            "releaseDecision": "NO_GO",
        })

    def do_POST(self):
        if self.path != "/approval-intent":
            return self._send_json(404, {
                "environment": "DEV",
                "ok": False,
                "reason": "NOT_FOUND",
                "signingPermitted": False,
                "authorizationGranted": False,
                "dispatchPermitted": False,
                "releaseDecision": "NO_GO",
            })
        if not str(self.headers.get("Content-Type", "")).lower().startswith("application/json"):
            return self._send_json(400, {
                "environment": "DEV",
                "ok": False,
                "reason": "JSON_REQUIRED",
                "signingPermitted": False,
                "authorizationGranted": False,
                "dispatchPermitted": False,
                "releaseDecision": "NO_GO",
            })
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length < 1 or length > MAX_BODY_BYTES:
            return self._send_json(413 if length > MAX_BODY_BYTES else 400, {
                "environment": "DEV",
                "ok": False,
                "reason": "REQUEST_SIZE_INVALID",
                "signingPermitted": False,
                "authorizationGranted": False,
                "dispatchPermitted": False,
                "releaseDecision": "NO_GO",
            })
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._send_json(400, {
                "environment": "DEV",
                "ok": False,
                "reason": "JSON_INVALID",
                "signingPermitted": False,
                "authorizationGranted": False,
                "dispatchPermitted": False,
                "releaseDecision": "NO_GO",
            })
        status, response = handle_approval_intent_payload(payload)
        return self._send_json(status, response)


class UnixHTTPServer(socketserver.UnixStreamServer):
    allow_reuse_address = True
    daemon_threads = True
    request_queue_size = 8


def _assert_runtime_directory(gid: int):
    st = os.lstat(RUNTIME_DIR)
    if (
        not stat.S_ISDIR(st.st_mode)
        or stat.S_ISLNK(st.st_mode)
        or st.st_uid != 0
        or st.st_gid != gid
        or stat.S_IMODE(st.st_mode) != 0o750
    ):
        raise RuntimeError("APPROVAL_READER_RUNTIME_DIRECTORY_INVALID")


def _assert_store_ready():
    result = inspect_approval_store(LIVE_DB, operational=True)
    if (
        result.get("trustedPersistedReadReady") is not True
        or result.get("approvalIntentSchemaExact") is not True
        or result.get("approvalIntentLookupIndexExact") is not True
        or result.get("fileSecurityVerified") is not True
    ):
        raise RuntimeError("APPROVAL_READER_STORE_NOT_READY")


def main():
    if os.environ.get("GPT02_ISSUE159_APPROVAL_READER_ENV") != "DEV":
        raise RuntimeError("APPROVAL_READER_EXPLICIT_DEV_MODE_REQUIRED")
    gid = grp.getgrnam(SIGNER_GROUP).gr_gid
    _assert_runtime_directory(gid)
    _assert_store_ready()

    if os.path.lexists(SOCKET_PATH):
        existing = os.lstat(SOCKET_PATH)
        if (
            not stat.S_ISSOCK(existing.st_mode)
            or existing.st_uid != 0
            or existing.st_gid != gid
        ):
            raise RuntimeError("APPROVAL_READER_SOCKET_OCCUPIED")
        os.unlink(SOCKET_PATH)

    server = UnixHTTPServer(SOCKET_PATH, ApprovalReaderHandler)
    os.chown(SOCKET_PATH, 0, gid)
    os.chmod(SOCKET_PATH, 0o660)
    endpoint = os.lstat(SOCKET_PATH)
    if (
        not stat.S_ISSOCK(endpoint.st_mode)
        or endpoint.st_uid != 0
        or endpoint.st_gid != gid
        or stat.S_IMODE(endpoint.st_mode) != 0o660
    ):
        server.server_close()
        raise RuntimeError("APPROVAL_READER_SOCKET_MODE_INVALID")

    print(json.dumps({
        "event": "gpt02_approval_reader_started",
        "environment": "DEV",
        "socketPath": SOCKET_PATH,
        "readOnly": True,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }, sort_keys=True), flush=True)

    stopped = False

    def stop(_signum, _frame):
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    server.timeout = 1.0
    try:
        while not stopped:
            server.handle_request()
    finally:
        server.server_close()
        try:
            current = os.lstat(SOCKET_PATH)
            if stat.S_ISSOCK(current.st_mode) and current.st_uid == 0 and current.st_gid == gid:
                os.unlink(SOCKET_PATH)
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr, flush=True)
        raise SystemExit(2)
