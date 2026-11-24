"""CST-DEV one-job: inert Linux AF_UNIX kernel SO_PEERCRED verifier.

This module never starts a server, opens an outbound connection, modifies a
database or authorizes the pilot. Invoke verify_unix_peer() on an already
accepted AF_UNIX stream socket *before* processing the PostgreSQL byte stream.
An observed filesystem mode cannot substitute for this kernel evidence.
"""
from __future__ import annotations
import os
import socket
import struct
import sys
from dataclasses import dataclass

_CREDENTIAL_FORMAT = "3i"
_CREDENTIAL_SIZE = struct.calcsize(_CREDENTIAL_FORMAT)


@dataclass(frozen=True)
class PeerVerdict:
    accepted: bool
    reason: str


def verify_unix_peer(
    connection: socket.socket, *, expected_uid: int, expected_gid: int
) -> PeerVerdict:
    """Fail closed on all invalid input, nonlocal/unsupported sockets or UID mismatch.

    Expected IDs must be explicit positive kernel UIDs/GIDs from an independent
    operator-controlled config; never derive them from client payload bytes.
    Does NOT assert ACL, database identity, TLS, role or work authorization.
    """
    if (
        type(expected_uid) is not int or type(expected_gid) is not int
        or not 0 < expected_uid <= 60000
        or not 0 < expected_gid <= 60000
    ):
        return PeerVerdict(False, "EXPECTED_NONROOT_PEER_IDENTITY_MISSING")
    if not isinstance(connection, socket.socket) or connection.family != socket.AF_UNIX:
        return PeerVerdict(False, "NOT_UNIX_SOCKET")
    if connection.type & socket.SOCK_STREAM != socket.SOCK_STREAM:
        return PeerVerdict(False, "NOT_UNIX_STREAM")
    if not hasattr(socket, "SO_PEERCRED"):
        return PeerVerdict(False, "KERNEL_PEERCRED_UNAVAILABLE")
    try:
        data = connection.getsockopt(
            socket.SOL_SOCKET, socket.SO_PEERCRED, _CREDENTIAL_SIZE
        )
        if len(data) != _CREDENTIAL_SIZE:
            return PeerVerdict(False, "KERNEL_PEERCRED_UNAVAILABLE")
        pid, uid, gid = struct.unpack(_CREDENTIAL_FORMAT, data)
    except (OSError, TypeError, ValueError, struct.error):
        return PeerVerdict(False, "KERNEL_PEERCRED_UNAVAILABLE")
    if pid <= 0 or uid != expected_uid or gid != expected_gid:
        return PeerVerdict(False, "KERNEL_PEER_IDENTITY_MISMATCH")
    return PeerVerdict(True, "KERNEL_PEER_IDENTITY_MATCHED")


def start_operational_broker():
    """No authorized operational entrypoint before full independent release."""
    raise RuntimeError("CST_ONEJOB_BROKER_INDEPENDENT_EGRESS_AND_DB_NO_GO")


def _check_inherited_accepted_fd3() -> int:
    """Check fd3 from a bounded Node acceptor; never read client bytes.

    Called with -I and numeric expected UID/GID. Only a constant verdict
    is printed; never emit credentials, raw peer IDs or PostgreSQL traffic.
    """
    if len(sys.argv) != 4 or sys.argv[1] != "--check-accepted-fd3":
        print("CST_ONEJOB_KERNEL_PEER_DENIED")
        return 4
    try:
        uid_s, gid_s = sys.argv[2:]
        if not uid_s.isdecimal() or not gid_s.isdecimal():
            raise ValueError("non-numeric peer")
        uid, gid = int(uid_s), int(gid_s)
        with socket.socket(fileno=3) as accepted:
            verdict = verify_unix_peer(
                accepted, expected_uid=uid, expected_gid=gid
            )
        if verdict.accepted:
            print("CST_ONEJOB_KERNEL_PEER_VERIFIED")
            return 0
    except (OSError, ValueError, TypeError):
        pass
    print("CST_ONEJOB_KERNEL_PEER_DENIED")
    return 3


if __name__ == "__main__":
    if len(sys.argv) > 1:
        sys.exit(_check_inherited_accepted_fd3())
    print("CST_ONEJOB_PEERCRED_IMPORT_ONLY_NO_DISPATCH")