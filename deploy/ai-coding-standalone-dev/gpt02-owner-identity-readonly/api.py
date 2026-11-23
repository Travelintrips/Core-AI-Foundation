#!/usr/bin/env python3
"""Loopback-only, GET-only GPT02 Owner-link readiness service.

It verifies the exact signed Hub session by calling the existing read-only
CST Hub session-readiness endpoint, then checks the separately pinned
GPT02 Owner operator link using the existing root-owned SQLite reader.
It has no POST, decision, approval, signer, issuer, or dispatch route.
"""
from __future__ import annotations

import base64
import http.client
import importlib.util
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

BIND_HOST = "127.0.0.1"
BIND_PORT = 18509
EXPECTED_HOST = "dev-ai-task.cstlogistic.co.id"
OWNER_IDENTITY_PATH = "/api/ai-tasks/183/gpt02-owner-identity-readiness?companyId=default"
HUB_SESSION_PATH = "/api/auth/gpt02/operator-session-readiness"
HUB_AUTH_HOST = "127.0.0.1"
HUB_AUTH_PORT = 18499
MAX_TOKEN_BYTES = 4_096
MAX_RESPONSE_BYTES = 8_192
CONNECT_TIMEOUT_SECONDS = 3
IDENTITY_READER = Path("/opt/ai-coding-standalone-dev/qa/task183-owner-identity-readiness.py")

class AuthRejected(Exception):
    pass

class VerifierUnavailable(Exception):
    pass


def _b64url_json(part: str) -> dict[str, Any]:
    if not isinstance(part, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", part):
        raise AuthRejected("JWT_ENCODING_INVALID")
    try:
        raw = base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))
        value = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise AuthRejected("JWT_CLAIMS_INVALID") from exc
    if not isinstance(value, dict):
        raise AuthRejected("JWT_CLAIMS_INVALID")
    return value


def _actor_from_hub_verified_token(token: str) -> dict[str, Any]:
    if not isinstance(token, str) or not (48 <= len(token.encode("utf-8")) <= MAX_TOKEN_BYTES) or any(c.isspace() for c in token):
        raise AuthRejected("HUB_SESSION_TOKEN_INVALID")
    parts = token.split(".")
    if len(parts) != 3:
        raise AuthRejected("HUB_SESSION_TOKEN_INVALID")
    header = _b64url_json(parts[0])
    if header.get("alg") != "HS256":
        raise AuthRejected("HUB_SESSION_ALGORITHM_DENIED")
    claims = _b64url_json(parts[1])
    # The token signature and expiry are verified by the existing Hub API
    # middleware below. We decode claims only after that signed-session proof.
    required = ("id", "role", "companyId", "email", "authSource", "authSupabaseId", "authVerifiedAt")
    if any(key not in claims for key in required):
        raise AuthRejected("HUB_SESSION_CLAIMS_INCOMPLETE")
    return {key: claims[key] for key in required}


def verify_hub_session(token: str, connection_factory: Callable[..., Any] = http.client.HTTPConnection) -> dict[str, Any]:
    """Ask the existing Hub middleware to verify this exact bearer token."""
    connection = None
    try:
        connection = connection_factory(HUB_AUTH_HOST, HUB_AUTH_PORT, timeout=CONNECT_TIMEOUT_SECONDS)
        connection.request(
            "GET",
            HUB_SESSION_PATH,
            headers={
                "Host": EXPECTED_HOST,
                "Authorization": "Bearer " + token,
                "Accept": "application/json",
                "Connection": "close",
            },
        )
        response = connection.getresponse()
        content_type = response.getheader("Content-Type", "")
        body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            raise VerifierUnavailable("HUB_READINESS_RESPONSE_TOO_LARGE")
        if response.status in (401, 403):
            raise AuthRejected("HUB_SESSION_REJECTED")
        if response.status != 200:
            raise VerifierUnavailable("HUB_SESSION_VERIFIER_UNAVAILABLE")
        if not re.match(r"^application/json(?:\s*;|$)", content_type, re.I):
            raise VerifierUnavailable("HUB_READINESS_RESPONSE_INVALID")
        try:
            readiness = json.loads(body.decode("utf-8"))
        except Exception as exc:
            raise VerifierUnavailable("HUB_READINESS_RESPONSE_INVALID") from exc
        if not isinstance(readiness, dict) or not (
            readiness.get("googleProofFresh") is True
            and readiness.get("googleProofStatus") == "SIGNED_SESSION_GOOGLE_PROOF_FRESH"
            and readiness.get("requiresFreshGoogleLogin") is False
            and readiness.get("proofSource") == "signed_app_session"
            and readiness.get("readOnly") is True
            and readiness.get("operatorApprovalRecorded") is False
            and readiness.get("commandBoundConsentVerified") is False
            and readiness.get("issuerLeaseGranted") is False
            and readiness.get("dispatchPermitted") is False
            and readiness.get("resumePermitted") is False
            and readiness.get("statusChanged") is False
        ):
            raise AuthRejected("FRESH_GOOGLE_SUPERADMIN_SESSION_REQUIRED")
        return _actor_from_hub_verified_token(token)
    except (AuthRejected, VerifierUnavailable):
        raise
    except (OSError, http.client.HTTPException, TimeoutError) as exc:
        raise VerifierUnavailable("HUB_SESSION_VERIFIER_UNREACHABLE") from exc
    finally:
        if connection is not None:
            connection.close()


def load_owner_reader() -> Any:
    try:
        st = IDENTITY_READER.lstat()
    except OSError as exc:
        raise VerifierUnavailable("OWNER_READER_SOURCE_UNAVAILABLE") from exc
    if IDENTITY_READER.is_symlink() or st.st_uid != 0 or (st.st_mode & 0o777) != 0o400:
        raise VerifierUnavailable("OWNER_READER_SOURCE_CUSTODY_INVALID")
    spec = importlib.util.spec_from_file_location("gpt02_owner_identity_reader", IDENTITY_READER)
    if spec is None or spec.loader is None:
        raise VerifierUnavailable("OWNER_READER_IMPORT_FAILED")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception as exc:
        raise VerifierUnavailable("OWNER_READER_IMPORT_FAILED") from exc
    return module


def verify_owner_link(actor: dict[str, Any], reader: Any | None = None) -> dict[str, Any]:
    module = reader if reader is not None else load_owner_reader()
    try:
        result = module.eligible_owner(actor)
    except ValueError as exc:
        raise AuthRejected("EXACT_OWNER_OPERATOR_LINK_REQUIRED") from exc
    except Exception as exc:
        raise VerifierUnavailable("OWNER_IDENTITY_READER_UNAVAILABLE") from exc
    if not isinstance(result, dict) or not (
        result.get("eligible") is True
        and result.get("taskId") == 183
        and result.get("companyId") == "default"
        and result.get("scope") == "SUPERADMIN_OWNER_IDENTITY_READ_ONLY"
        and result.get("ownerSubject") == "owner:" + actor.get("id", "")
        and result.get("googleSessionVerified") is True
        and result.get("enabledOperatorLinkVerified") is True
        and result.get("approvalDecisionCreated") is False
        and result.get("cryptographicOwnerSignatureVerified") is False
        and result.get("issuerAuthorized") is False
        and result.get("dispatchPermitted") is False
        and result.get("readOnly") is True
    ):
        raise VerifierUnavailable("OWNER_IDENTITY_RESPONSE_CONTRACT_INVALID")
    # Return only the minimum identity-link proof fields expected by Core-AI.
    return {
        "eligible": True,
        "taskId": 183,
        "companyId": "default",
        "scope": "SUPERADMIN_OWNER_IDENTITY_READ_ONLY",
        "ownerSubject": result["ownerSubject"],
        "googleSessionVerified": True,
        "enabledOperatorLinkVerified": True,
        "approvalDecisionCreated": False,
        "cryptographicOwnerSignatureVerified": False,
        "issuerAuthorized": False,
        "dispatchPermitted": False,
        "readOnly": True,
    }


def make_handler(
    session_verifier: Callable[[str], dict[str, Any]] = verify_hub_session,
    owner_verifier: Callable[[dict[str, Any]], dict[str, Any]] = verify_owner_link,
) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "GPT02OwnerIdentityReadOnly/1.0"
        sys_version = ""

        def log_message(self, *_args: Any) -> None:
            # Never log URL credentials, bearer tokens, emails, or actor claims.
            return

        def reply(self, code: int, payload: dict[str, Any]) -> None:
            raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(raw)
            self.close_connection = True

        def do_GET(self) -> None:
            if self.path != OWNER_IDENTITY_PATH:
                self.reply(404, {"error": "NOT_FOUND", "readOnly": True, "dispatchPermitted": False})
                return
            if self.headers.get("Host") != EXPECTED_HOST:
                self.reply(403, {"error": "EXPECTED_DEV_HOST_REQUIRED", "readOnly": True, "dispatchPermitted": False})
                return
            if self.headers.get("Content-Length", "0") not in ("0", ""):
                self.reply(400, {"error": "GET_BODY_NOT_ALLOWED", "readOnly": True, "dispatchPermitted": False})
                return
            authorization = self.headers.get("Authorization", "")
            if not authorization.startswith("Bearer "):
                self.reply(401, {"error": "AUTHENTICATION_REQUIRED", "eligible": False, "dispatchPermitted": False})
                return
            token = authorization[7:]
            try:
                actor = session_verifier(token)
                result = owner_verifier(actor)
                self.reply(200, result)
            except AuthRejected:
                self.reply(403, {"error": "SUPERADMIN_OWNER_LINK_NOT_AUTHORIZED", "eligible": False, "issuerAuthorized": False, "dispatchPermitted": False, "readOnly": True})
            except VerifierUnavailable:
                self.reply(503, {"error": "OWNER_IDENTITY_READER_UNAVAILABLE", "eligible": False, "issuerAuthorized": False, "dispatchPermitted": False, "readOnly": True})
            except Exception:
                self.reply(503, {"error": "OWNER_IDENTITY_READER_UNAVAILABLE", "eligible": False, "issuerAuthorized": False, "dispatchPermitted": False, "readOnly": True})

        def do_POST(self) -> None:
            self.reply(405, {"error": "METHOD_NOT_ALLOWED", "readOnly": True, "dispatchPermitted": False})

        def do_PUT(self) -> None:
            self.reply(405, {"error": "METHOD_NOT_ALLOWED", "readOnly": True, "dispatchPermitted": False})

        def do_PATCH(self) -> None:
            self.reply(405, {"error": "METHOD_NOT_ALLOWED", "readOnly": True, "dispatchPermitted": False})

        def do_DELETE(self) -> None:
            self.reply(405, {"error": "METHOD_NOT_ALLOWED", "readOnly": True, "dispatchPermitted": False})

        def do_OPTIONS(self) -> None:
            self.reply(405, {"error": "METHOD_NOT_ALLOWED", "readOnly": True, "dispatchPermitted": False})

    return Handler


class ReadOnlyHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False
    request_queue_size = 16
    _slots = threading.BoundedSemaphore(8)

    def process_request(self, request: Any, client_address: Any) -> None:
        if not self._slots.acquire(blocking=False):
            payload = b'{"error":"READINESS_CAPACITY_EXCEEDED","readOnly":true,"dispatchPermitted":false}'
            response = (
                b"HTTP/1.1 503 Service Unavailable\r\n"
                b"Content-Type: application/json; charset=utf-8\r\n"
                b"Cache-Control: no-store\r\n"
                b"Connection: close\r\nContent-Length: "
                + str(len(payload)).encode("ascii")
                + b"\r\n\r\n" + payload
            )
            try:
                request.sendall(response)
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._slots.release()
            raise

    def process_request_thread(self, request: Any, client_address: Any) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()


def main() -> None:
    server = ReadOnlyHTTPServer((BIND_HOST, BIND_PORT), make_handler())
    server.timeout = 1
    try:
        print("GPT02_OWNER_IDENTITY_READONLY_LISTENING=127.0.0.1:18509", flush=True)
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
