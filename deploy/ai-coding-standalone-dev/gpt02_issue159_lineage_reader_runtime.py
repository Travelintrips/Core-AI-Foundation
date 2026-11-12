#!/usr/bin/env python3
"""DEV-only independent lineage reader socket (source-only; NOT INSTALLED).

A dedicated, least-privilege PostgreSQL LOGIN credential must be provisioned
AFTER the NOLOGIN grant/RLS migration is applied by its authorized owner.
Never reuse issuer-reader, writer, signer or service_role credentials.
A successful readback never grants signing, authorization, or dispatch.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import socket
import socketserver
import stat
import struct
from typing import Any

from gpt02_issue159_lineage_db_reader import _clean_lookup, read_lineage_once
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError

MAX_BYTES = 2048
DEFAULT_SOCKET = "/run/gpt02-lineage-reader/reader.sock"


def _credential_path() -> Path:
    directory = os.environ.get("CREDENTIALS_DIRECTORY", "")
    if not directory or not Path(directory).is_dir():
        raise RuntimeError("LINEAGE_ENCRYPTED_CREDENTIAL_REQUIRED")
    path = Path(directory) / "lineage-reader-dsn"
    st = path.lstat()
    if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode):
        raise RuntimeError("LINEAGE_CREDENTIAL_TYPE_DENIED")
    if stat.S_IMODE(st.st_mode) & 0o007:
        raise RuntimeError("LINEAGE_CREDENTIAL_WORLD_ACCESS_DENIED")
    return path


def _load_connection():
    # Import only at run time; no DB connection or dependencies during tests.
    import psycopg
    from psycopg.conninfo import conninfo_to_dict
    dsn = _credential_path().read_text(encoding="utf-8").strip()
    if not dsn or len(dsn) > 4096:
        raise RuntimeError("LINEAGE_DSN_INVALID")
    args = conninfo_to_dict(dsn)
    # Supabase pooler requires the exact DB role + CST-DEV project suffix.
    expected_user = "dev_gpt02_lineage_login.xssrfshdrtdfupgqwfdw"
    if (args.get("user") != expected_user
            or args.get("dbname") != "postgres"
            or args.get("host") != "aws-1-ap-southeast-2.pooler.supabase.com"
            or args.get("port") != "5432"):
        raise RuntimeError("LINEAGE_DEDICATED_DEV_POOLER_IDENTITY_REQUIRED")
    if args.get("sslmode") != "verify-full":
        raise RuntimeError("LINEAGE_TLS_PEER_VERIFICATION_REQUIRED")
    if not args.get("sslrootcert"):
        raise RuntimeError("LINEAGE_TLS_ROOT_REQUIRED")
    return psycopg.connect(dsn, autocommit=False, connect_timeout=3)


def read_verified_lineage(lookup: Any, connect=_load_connection) -> dict[str, Any]:
    """Read only: caller cannot inject rows or claim an authorized mutation."""
    params = _clean_lookup(lookup)
    with connect() as connection:
        if connection.info.user != "dev_gpt02_lineage_login.xssrfshdrtdfupgqwfdw":
            raise RuntimeError("LINEAGE_DB_IDENTITY_MISMATCH")
        rows = read_lineage_once(connection, params)
    return {
        "environment": "DEV", "readOnly": True, "matched": len(rows) == 1,
        "rows": rows, "databaseWritePerformed": False,
        "signingPermitted": False, "authorizationGranted": False,
        "dispatchPermitted": False, "releaseDecision": "NO_GO",
    }


def _peer_uid(conn: socket.socket) -> int:
    if not hasattr(socket, "SO_PEERCRED"):
        raise RuntimeError("UNIX_PEER_CREDENTIALS_UNAVAILABLE")
    raw = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
    _pid, uid, _gid = struct.unpack("3i", raw)
    return uid


class _Handler(socketserver.StreamRequestHandler):
    allowed_uid: int = -1
    read_fn = staticmethod(read_verified_lineage)

    def handle(self):
        try:
            if _peer_uid(self.request) != type(self).allowed_uid:
                raise PermissionError("LINEAGE_PEER_UNAUTHORIZED")
            self.request.settimeout(2)
            data = self.rfile.readline(MAX_BYTES + 1)
            if not data or len(data) > MAX_BYTES or not data.endswith(b"\n"):
                raise ValueError("LINEAGE_REQUEST_INVALID")
            payload = json.loads(data.decode("utf-8"))
            if not isinstance(payload, dict) or set(payload) != {"lookup"}:
                raise ValueError("LINEAGE_REQUEST_SHAPE_INVALID")
            result = type(self).read_fn(payload["lookup"])
        except (BrokerAdmissionError, ValueError, UnicodeError, PermissionError):
            result = {"ok": False, "reason": "LINEAGE_LOOKUP_REJECTED",
                      "releaseDecision": "NO_GO"}
        except Exception:
            result = {"ok": False, "reason": "LINEAGE_READER_UNAVAILABLE",
                      "releaseDecision": "NO_GO"}
        self.wfile.write(json.dumps(result, separators=(",", ":"), sort_keys=True).encode() + b"\n")


class _UnixServer(socketserver.UnixStreamServer):
    allow_reuse_address = False


def serve(socket_path: str, allowed_uid: int) -> None:
    if allowed_uid < 1:
        raise RuntimeError("PINNED_VERIFIER_UID_REQUIRED")
    parent = Path(socket_path).parent
    st = parent.lstat()
    if (not stat.S_ISDIR(st.st_mode) or stat.S_ISLNK(st.st_mode)
            or st.st_uid != os.getuid() or st.st_gid != os.getgid()
            or stat.S_IMODE(st.st_mode) != 0o750):
        raise RuntimeError("PRIVATE_SOCKET_DIRECTORY_REQUIRED")
    if os.path.lexists(socket_path):
        raise RuntimeError("SOCKET_ALREADY_EXISTS")
    _Handler.allowed_uid = allowed_uid
    with _UnixServer(socket_path, _Handler) as server:
        os.chmod(socket_path, 0o660)
        sock_stat = os.lstat(socket_path)
        if (not stat.S_ISSOCK(sock_stat.st_mode)
                or sock_stat.st_uid != os.getuid()
                or sock_stat.st_gid != os.getgid()
                or stat.S_IMODE(sock_stat.st_mode) != 0o660):
            raise RuntimeError("PRIVATE_SOCKET_OWNERSHIP_INVALID")
        server.serve_forever(poll_interval=0.25)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", default=DEFAULT_SOCKET)
    parser.add_argument("--allowed-verifier-uid", type=int, required=True)
    args = parser.parse_args()
    _credential_path()  # fail before opening a socket if not provisioned
    serve(args.socket, args.allowed_verifier_uid)


if __name__ == "__main__":
    main()
