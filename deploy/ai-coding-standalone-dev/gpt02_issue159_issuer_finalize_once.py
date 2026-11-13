#!/usr/bin/env python3
"""DEV GPT02 Issue159: one supervised, fail-closed issuer lifecycle after attestor.

Reuse existing verified three-signer Stage A, dedicated issuer RPCs, isolated
issuer signer, trusted verifier and lineage reader. Never create approval,
grant signing authority, dispatch a worker, or retry a consumed command.
The PostgreSQL receipt/fence transaction is committed only when all PRE
requirements pass; a failure after commit leaves NO_DISPATCH evidence for
human review, never an automatic replay.
"""
from __future__ import annotations

import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import socket
import stat
import struct
import subprocess
import time

from gpt02_issue159_attestor_record_once import (
    APPROVED, LINK, SIGNATURES,
    require_private, validate_and_verify,
)
from gpt02_issue159_writer_broker_contract import (
    APPROVAL_FIELDS, LINK_FIELDS, ISSUER_FIELDS, _canonical,
)

ROLE = "dev_gpt02_issuer_evidence"
PROJECT = "xssrfshdrtdfupgqwfdw"
POOLER = "aws-1-ap-southeast-2.pooler.supabase.com"
ROOT_CA = "/etc/gpt02-dev/supabase-root-ca-2021.crt"
WORKER = "openclaw-dell-chatgpt-wake-dev"
UNIT = "gpt02-issue159-sign-once-issuer.service"
ATTESTOR_UNIT = "gpt02-issue159-attestor-record-once.service"
VERIFIER = "/run/gpt02-issue159-verifier/verify.sock"
ISSUER_OUTPUT = Path("/run/gpt02-issue159-sign-once-issuer/issuer-signature.json")
CLAIMS_FILE = Path("/opt/ai-coding-standalone-dev/gpt02_issue159_issuer_claims.json")
DSN_FILE = Path("/run/credentials/gpt02-issue159-issuer-finalize-once.service/issuer-dsn")
SECRET_SOURCE = Path("/etc/credstore.encrypted/gpt02-issue159-issuer-dsn")
SIGNER_SECRET = Path("/etc/credstore.encrypted/gpt02-issue159-issuer-private-key.pkcs8")
LOCK = Path("/run/lock/gpt02-issue159-issuer-finalize.lock")
UUID = re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")
MIN_PARENT_MS = 30_000
# Max DB fence is 15s; cap the signed claim BEFORE its recorded start bound.
# Never use the entire 15s as the issuer claim window.
FENCE_MAX_MS = 15_000
FENCE_SAFETY_MS = 1_000
ISSUER_TTL_MS = 13_000
MIN_POST_SIGN_MS = 1_200

class IssuerDenied(RuntimeError):
    pass

def deny(code: str):
    raise IssuerDenied(code)

def ms() -> int:
    return time.time_ns() // 1_000_000

def safe_unit(unit: str, *, run=subprocess.run):
    fields = ("LoadState", "ActiveState", "UnitFileState")
    p = run(["systemctl", "show", unit, "-p", ",".join(fields)],
            capture_output=True, text=True, timeout=4, check=True)
    values = dict(line.split("=", 1) for line in p.stdout.splitlines() if "=" in line)
    if set(values) != set(fields):
        deny("ISSUER_UNIT_STATE_UNKNOWN")
    return values

def preflight(*, run=subprocess.run):
    if (os.geteuid() != 0 or os.environ.get("APP_ENV") != "development"
            or os.environ.get("GPT02_ISSUER_FINALIZE_ONCE") != "explicit-supervised"):
        deny("ISSUER_DEV_ROOT_EXPLICIT_AUTHORIZATION_REQUIRED")
    # Keep the signer, verifier and both trusted readers distinct.
    if not (SECRET_SOURCE.is_file() and SIGNER_SECRET.is_file()
            and DSN_FILE.is_file()):
        deny("ISSUER_DEDICATED_CREDENTIALS_NOT_PREPARED")
    if any(p.exists() or p.is_symlink() for p in (CLAIMS_FILE, ISSUER_OUTPUT)):
        deny("ISSUER_PRIOR_OUTPUT_REPLAY_DENIED")
    state = safe_unit(UNIT, run=run)
    if state != {"LoadState":"loaded","ActiveState":"inactive","UnitFileState":"static"}:
        deny("ISSUER_SIGNER_NOT_STATIC_STANDBY")
    # A detached signer must never be started from a previous/manual approval.
    for svc in (ATTESTOR_UNIT, "gpt02-issue159-sign-once-approval.service",
                "gpt02-issue159-sign-once-operator@hub.service",
                "gpt02-issue159-sign-once-operator@core.service"):
        if safe_unit(svc, run=run)["ActiveState"] != "inactive":
            deny("ISSUER_PARENT_UNIT_NOT_FINISHED")
    # The independent verifier and readers must already be healthy; never
    # launch a reader, signer or writer simply to fix a failed dependency.
    for svc in ("gpt02-issue159-verifier.service",
                "gpt02-issue159-lineage-reader.service",
                "gpt02-issue159-issuer-reader.service",
                "gpt02-issue159-approval-reader.service"):
        if safe_unit(svc, run=run)["ActiveState"] != "active":
            deny("ISSUER_TRUSTED_READER_NOT_ACTIVE")
    # VPS one-shot metadata may report monotonic timestamps=0 even after a
    # real execution. Keep the pre-existing operational Result/ExecMainStatus
    # check and, when a reliable monotonic stamp exists, bound it to 60s.
    # This is NOT authority to consume: the issuer's first SECURITY DEFINER
    # RPC separately requires the exact FRESH signed approval and operator
    # link written by the attestor, or it rolls back without creating a receipt.
    out = run(["systemctl", "show", ATTESTOR_UNIT,
               "-p", "ExecMainExitTimestampMonotonic",
               "-p", "Result", "-p", "ExecMainStatus"],
              timeout=4, text=True, check=True, capture_output=True).stdout
    values = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    if values.get("Result") != "success" or values.get("ExecMainStatus") != "0":
        deny("ISSUER_COMPLETED_ATTESTOR_REQUIRED")
    last_exit = values.get("ExecMainExitTimestampMonotonic", "")
    if not last_exit.isdigit():
        deny("ISSUER_ATTESTOR_TIMESTAMP_INVALID")
    if int(last_exit) > 0:
        elapsed_us = time.monotonic_ns() // 1000 - int(last_exit)
        if elapsed_us < 0 or elapsed_us > 60_000_000:
            deny("ISSUER_ATTESTOR_LAST_SUCCESS_NOT_FRESH")
    # Freshness of the actual approval and signed packet is checked again
    # cryptographically before the first database mutation.

def signed_stage():
    approved = json.loads(require_private(APPROVED, root_only=True))
    link = json.loads(require_private(LINK, root_only=True))
    signatures = {
        role: json.loads(require_private(p, root_only=False))
        for role, p in SIGNATURES.items()
    }
    packet, proof = validate_and_verify(approved, link, signatures)
    if (proof.get("threeSignaturesVerified") is not True
            or proof.get("persistedAdminApprovalReadBack") is not True
            or proof.get("verifierPeerAuthenticated") is not True
            or proof.get("releaseDecision") != "NO_GO"):
        deny("ISSUER_SIGNED_STAGE_A_NOT_PROVEN")
    parents = (packet["approval"]["claims"], packet["hubLink"]["claims"])
    if min(v["expiresAt"] for v in parents) - ms() < MIN_PARENT_MS:
        deny("ISSUER_PARENT_APPROVAL_TOO_CLOSE_TO_EXPIRY")
    return packet, proof

def pinned_dev_writer_endpoint(values: dict) -> bool:
    """Two exact CST-DEV endpoints; never arbitrary host or cross-role DSN."""
    return (
        (values.get("user"), values.get("host")) in {
            (f"{ROLE}.{PROJECT}", POOLER),
            (ROLE, f"db.{PROJECT}.supabase.co"),
        }
        and not values.get("hostaddr") and not values.get("service")
    )


def require_issuer_reader_warm(
    *, reader_socket: str | None = None,
) -> None:
    """Prove dedicated issuer reader is READY before reserving any fence.

    The health request is independently read-only and cannot confer signing
    or dispatch authority. It warms the existing single-connection pool, so
    the post-fence issuer lookup does not pay another cold TLS handshake.
    The issuer signer still obtains a completely fresh, signed/evidence-bound
    readback before loading its private key.
    """
    from gpt02_issue159_issuer_signer_guard import _require_socket, ISSUER_READER

    sockpath = ISSUER_READER if reader_socket is None else reader_socket
    uid, _gid = _require_socket(sockpath)
    payload = bytearray()
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.settimeout(6.0)
        conn.connect(sockpath)
        if not hasattr(socket, "SO_PEERCRED"):
            deny("ISSUER_WARMUP_UNIX_PEER_CREDENTIALS_REQUIRED")
        peer = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
        _pid, peer_uid, _peer_gid = struct.unpack("3i", peer)
        if peer_uid != uid:
            deny("ISSUER_WARMUP_READER_PEER_MISMATCH")
        conn.sendall(
            b"GET /health HTTP/1.1\r\n"
            b"Host: localhost\r\nConnection: close\r\n\r\n"
        )
        while True:
            chunk = conn.recv(4096)
            if not chunk:
                break
            payload.extend(chunk)
            if len(payload) > 8_192:
                deny("ISSUER_WARMUP_RESPONSE_TOO_LARGE")
    header, sep, body = bytes(payload).partition(b"\r\n\r\n")
    if not sep or header.split(b"\r\n", 1)[0] != b"HTTP/1.1 200 OK":
        deny("ISSUER_WARMUP_HEALTH_NOT_READY")
    hdr = {}
    for line in header.split(b"\r\n")[1:]:
        key, colon, value = line.partition(b":")
        key = key.strip().lower()
        if not colon or key in hdr:
            deny("ISSUER_WARMUP_FRAMING_INVALID")
        hdr[key] = value.strip()
    length = hdr.get(b"content-length", b"")
    if (b"transfer-encoding" in hdr or not length.isdigit()
            or int(length) != len(body)
            or hdr.get(b"content-type", b"").split(b";", 1)[0].strip()
               != b"application/json"):
        deny("ISSUER_WARMUP_FRAMING_INVALID")
    try:
        response = json.loads(body)
    except (ValueError, UnicodeError) as exc:
        raise IssuerDenied("ISSUER_WARMUP_INVALID_JSON") from exc
    if (not isinstance(response, dict)
            or response.get("ok") is not True
            or response.get("environment") != "DEV"
            or response.get("readerReady") is not True
            or response.get("issuerRole") != "gpt02_issuer_evidence_reader"
            or response.get("tlsVerified") is not True
            or response.get("readOnly") is not True
            or any(response.get(field) is not False for field in (
                "signingPermitted", "authorizationGranted", "dispatchPermitted"))
            or response.get("releaseDecision") != "NO_GO"):
        deny("ISSUER_WARMUP_TRUSTED_READONLY_HEALTH_REQUIRED")


def issuer_dsn():
    from psycopg.conninfo import conninfo_to_dict
    raw = require_private(DSN_FILE, root_only=True, size_limit=4096)
    conninfo = raw.decode("utf-8").strip()
    values = conninfo_to_dict(conninfo)
    if (not pinned_dev_writer_endpoint(values)
            or str(values.get("port")) != "5432"
            or values.get("dbname") != "postgres"
            or values.get("sslmode") != "verify-full"
            or values.get("sslrootcert") != ROOT_CA
            or not values.get("password")):
        deny("ISSUER_EXACT_RESTRICTED_LOGIN_TLS_REQUIRED")
    return conninfo

def _identity(cursor):
    cursor.execute("SET LOCAL statement_timeout='3000ms'")
    cursor.execute("SELECT session_user,current_user,current_database(),"
                   "current_setting('transaction_read_only')")
    if cursor.fetchone() != (ROLE, ROLE, "postgres", "off"):
        deny("ISSUER_DATABASE_SESSION_IDENTITY_DENIED")

def _args(packet, proof):
    a = packet["approval"]
    h = packet["hubLink"]
    c = packet["coreLink"]
    if h["claims"] != c["claims"]:
        deny("ISSUER_DUAL_LINK_NOT_EQUAL")
    return (
        json.dumps(a["claims"], separators=(",", ":"), allow_nan=False),
        a["signature"], proof["approvalDigest"],
        json.dumps(h["claims"], separators=(",", ":"), allow_nan=False),
        h["signature"], c["signature"], proof["hubLinkDigest"],
    )

def consume_and_reserve(connection, packet, proof):
    """Exactly two existing RPCs within one transaction, no direct DML."""
    if not (proof.get("threeSignaturesVerified") is True
            and proof.get("persistedAdminApprovalReadBack") is True
            and proof.get("verifierPeerAuthenticated") is True
            and proof.get("releaseDecision") == "NO_GO"):
        deny("ISSUER_RPC_ADMISSION_REQUIRES_REAL_VERIFIER")
    a = packet["approval"]["claims"]
    link = packet["hubLink"]["claims"]
    if min(a["expiresAt"], link["expiresAt"]) - ms() < MIN_PARENT_MS:
        deny("ISSUER_ADMISSION_EXPIRED")
    try:
        with connection.cursor() as cursor:
            _identity(cursor)
            cursor.execute(
                "SELECT gpt02_private.consume_linked_approval("
                "%s::jsonb,%s,%s,%s::jsonb,%s,%s,%s)", _args(packet, proof))
            receipt = str(cursor.fetchone()[0])
            if not UUID.fullmatch(receipt):
                deny("ISSUER_CONSUME_RECEIPT_INVALID")
            # The same database clock provides a conservative lower bound
            # on fence start. This is a read-only SELECT within the existing
            # transaction; no new roles, grants, RPCs, tables or writes.
            cursor.execute(
                "SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint"
            )
            db_before_fence_ms = cursor.fetchone()[0]
            if (type(db_before_fence_ms) is not int
                    or db_before_fence_ms < 1_000_000_000_000):
                deny("ISSUER_FENCE_DATABASE_CLOCK_UNTRUSTED")
            cursor.execute(
                "SELECT gpt02_private.reserve_post_consumption_fence("
                "%s::uuid,%s::uuid,%s::uuid,%s)",
                (receipt, a["commandId"], link["linkId"], WORKER))
            fence = str(cursor.fetchone()[0])
            if not UUID.fullmatch(fence) or fence == receipt:
                deny("ISSUER_RESERVED_FENCE_INVALID")
        connection.commit()
        return receipt, fence, db_before_fence_ms
    except Exception:
        connection.rollback()
        raise

def issuer_claims(packet, proof, receipt: str, fence: str,
                  *, fence_db_before_ms: int, now_ms: int | None = None) -> dict:
    a, link = packet["approval"]["claims"], packet["hubLink"]["claims"]
    if now_ms is None:
        now_ms = ms()
    if (type(fence_db_before_ms) is not int
            or fence_db_before_ms > now_ms + 1_000
            or now_ms - fence_db_before_ms > 5_000):
        deny("ISSUER_FENCE_TIME_BUDGET_UNTRUSTED")
    earliest = min(a["expiresAt"], link["expiresAt"])
    # DB fence starts AFTER the captured DB clock and expires <=15s after
    # its actual start. Bound our issuer expiry to the earlier DB floor+14s.
    # This never grants or prolongs the actual DB fence.
    expiry = min(
        now_ms + ISSUER_TTL_MS, earliest,
        fence_db_before_ms + FENCE_MAX_MS - FENCE_SAFETY_MS,
    )
    if earliest - now_ms < MIN_PARENT_MS or expiry - now_ms < 5_000:
        deny("ISSUER_NO_SAFE_CLAIM_WINDOW")
    if not (UUID.fullmatch(receipt) and UUID.fullmatch(fence) and receipt != fence):
        deny("ISSUER_TRUSTED_RPC_UUIDS_REQUIRED")
    result = {
        "v": 1, "environment": "DEV",
        "audience": "GPT02_ISSUER_LEASE_EVIDENCE_V1",
        "companyId": a["companyId"], "hubTaskId": a["taskId"],
        "hubExecutionId": link["hubExecutionId"], "coreTaskId": link["coreTaskId"],
        "commandId": a["commandId"], "attemptId": a["attemptId"],
        "workerId": WORKER, "receiptId": receipt, "linkId": link["linkId"],
        "fenceId": fence, "approvalDigest": proof["approvalDigest"],
        "nonceDigest": hashlib.sha256(a["nonce"].encode("utf-8")).hexdigest(),
        "issuerRole": ROLE, "leaseEpoch": 1,
        "issuedAt": now_ms, "expiresAt": expiry,
    }
    if set(result) != set(ISSUER_FIELDS):
        deny("ISSUER_CLAIMS_SHAPE_INVALID")
    return result

def write_private_claims(claims, path=CLAIMS_FILE):
    # Exclusive create, no overwrite and no cleanup after a partially
    # consumed approval. Manual reconciliation is required on failure.
    if path.exists() or path.is_symlink():
        deny("ISSUER_CLAIMS_REPLAY_FILE_EXISTS")
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(claims, out, separators=(",", ":"), sort_keys=True)
            out.write("\n")
            out.flush()
            os.fsync(out.fileno())
    except Exception:
        # Intentionally leave a partial file as a fail-closed replay fence.
        raise

def start_signer(*, run=subprocess.run):
    if safe_unit(UNIT, run=run) != {
            "LoadState":"loaded","ActiveState":"inactive","UnitFileState":"static"}:
        deny("ISSUER_SIGNER_STATE_CHANGED")
    run(["systemctl", "start", UNIT], timeout=9, check=True,
        capture_output=True, text=True)
    p = run(["systemctl", "show", UNIT, "-p", "Result",
             "-p", "ExecMainStatus"], timeout=3, check=True,
            capture_output=True, text=True)
    states = dict(line.split("=", 1) for line in p.stdout.splitlines() if "=" in line)
    if states.get("Result") != "success" or states.get("ExecMainStatus") != "0":
        deny("ISSUER_ONCE_SIGNER_FAILED")
    return json.loads(require_private(ISSUER_OUTPUT, root_only=False))

def verify_four_role_packet(packet, claims, result,
                            *, now_ms: int | None = None,
                            verifier=VERIFIER):
    if now_ms is None:
        now_ms = ms()
    digest = hashlib.sha256(_canonical(claims, ISSUER_FIELDS)).hexdigest()
    if (not isinstance(result, dict)
            or set(result) != {"environment", "role", "algorithm",
                "claimsSha256", "signatureBase64url", "fingerprintMatched",
                "authorizationGranted", "dispatchPermitted", "releaseDecision"}
            or result.get("environment") != "DEV"
            or result.get("role") != "issuer"
            or result.get("algorithm") != "Ed25519"
            or result.get("fingerprintMatched") is not True
            or result.get("claimsSha256") != digest
            or result.get("authorizationGranted") is not False
            or result.get("dispatchPermitted") is not False
            or result.get("releaseDecision") != "NO_GO"
            or not isinstance(result.get("signatureBase64url"), str)):
        deny("ISSUER_SIGNATURE_ENVELOPE_INVALID")
    if claims["expiresAt"] - now_ms < MIN_POST_SIGN_MS:
        deny("ISSUER_SIGNATURE_WINDOW_EXPIRED")
    full = {**packet, "issuerEvidence": {
        "claims": claims, "signature": result["signatureBase64url"]}}
    try:
        uid = pwd.getpwnam("gpt02-issue159-verifier").pw_uid
        gid = grp.getgrnam("gpt02-issue159-signers").gr_gid
        fs = os.lstat(verifier)
        parent = os.lstat(str(Path(verifier).parent))
    except (OSError, KeyError) as exc:
        raise IssuerDenied("ISSUER_VERIFIER_UNAVAILABLE") from exc
    if (not stat.S_ISSOCK(fs.st_mode) or fs.st_uid != uid or fs.st_gid != gid
            or stat.S_IMODE(fs.st_mode) != 0o660 or stat.S_ISLNK(fs.st_mode)
            or not stat.S_ISDIR(parent.st_mode) or stat.S_ISLNK(parent.st_mode)
            or parent.st_uid != uid or parent.st_gid != gid
            or stat.S_IMODE(parent.st_mode) != 0o750):
        deny("ISSUER_VERIFIER_SOCKET_CUSTODY_INVALID")
    body = json.dumps({"packet":full,"observedAt":now_ms},
                      separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(body) > 24_576:
        deny("ISSUER_VERIFICATION_REQUEST_TOO_LONG")
    req = (b"POST /verify-persisted-lineage HTTP/1.1\r\n"
           b"Host: localhost\r\nContent-Type: application/json\r\n"
           b"Content-Length: " + str(len(body)).encode("ascii")
           + b"\r\nConnection: close\r\n\r\n" + body)
    data = bytearray()
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.settimeout(2.5)
        conn.connect(verifier)
        if not hasattr(socket, "SO_PEERCRED"):
            deny("ISSUER_VERIFIER_PEER_PROOF_UNAVAILABLE")
        _pid, actual_uid, _gid = struct.unpack(
            "3i", conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if actual_uid != uid:
            deny("ISSUER_VERIFIER_PEER_MISMATCH")
        conn.sendall(req)
        while True:
            chunk = conn.recv(4096)
            if not chunk:
                break
            data.extend(chunk)
            if len(data) > 24_576:
                deny("ISSUER_VERIFIER_RESPONSE_TOO_LARGE")
    head, sep, raw = bytes(data).partition(b"\r\n\r\n")
    if not sep or head.split(b"\r\n", 1)[0] != b"HTTP/1.1 200 OK":
        deny("ISSUER_FOUR_ROLE_VERIFIER_REJECTED")
    headers = {}
    for line in head.split(b"\r\n")[1:]:
        key, colon, val = line.partition(b":")
        if not colon or key.strip().lower() in headers:
            deny("ISSUER_VERIFIER_HTTP_HEADERS_INVALID")
        headers[key.strip().lower()] = val.strip()
    size = headers.get(b"content-length", b"")
    if (b"transfer-encoding" in headers or not size.isdigit()
            or int(size) != len(raw)
            or headers.get(b"content-type") != b"application/json"):
        deny("ISSUER_VERIFIER_FRAMING_INVALID")
    response = json.loads(raw.decode("utf-8"))
    r = response.get("result") if isinstance(response, dict) else None
    if (not isinstance(response, dict)
            or response.get("ok") is not True or response.get("environment") != "DEV"
            or response.get("writerEnabled") is not False
            or response.get("databaseConnected") is not False
            or response.get("releaseDecision") != "NO_GO"
            or any(response.get(k) is not False for k in (
                "signingPermitted", "authorizationGranted", "dispatchPermitted"))
            or not isinstance(r, dict)
            or r.get("packetVerified") is not True
            or r.get("fourDistinctRoleRootsUsed") is not True
            or r.get("issuerEvidenceVerified") is not True
            or r.get("persistedAdminApprovalReadBack") is not True
            or r.get("persistedLineageMatched") is not True
            or r.get("trustedAdapterAuthenticated") is not True
            or r.get("lineageReaderReadOnly") is not True
            or r.get("approvalDigest") != hashlib.sha256(
                _canonical(packet["approval"]["claims"], APPROVAL_FIELDS)).hexdigest()
            or r.get("hubLinkDigest") != hashlib.sha256(
                _canonical(packet["hubLink"]["claims"], LINK_FIELDS)).hexdigest()
            or r.get("coreLinkDigest") != hashlib.sha256(
                _canonical(packet["coreLink"]["claims"], LINK_FIELDS)).hexdigest()
            or r.get("releaseDecision") != "NO_GO"
            or any(r.get(k) is not False for k in (
                "databaseWritePerformed", "nonceConsumed", "leaseConsumed",
                "signingPermitted", "authorizationGranted", "dispatchPermitted"))):
        deny("ISSUER_PERSISTED_FOUR_ROLE_PROOF_NOT_VERIFIED")
    if claims["expiresAt"] - ms() < MIN_POST_SIGN_MS:
        deny("ISSUER_POST_VERIFICATION_WINDOW_EXPIRED")
    return full, r

def record_and_consume(connection, claims, signed, verified):
    if (verified.get("persistedLineageMatched") is not True
            or verified.get("trustedAdapterAuthenticated") is not True
            or verified.get("issuerEvidenceVerified") is not True
            or verified.get("releaseDecision") != "NO_GO"):
        deny("ISSUER_UNVERIFIED_EVIDENCE_RECORD_DENIED")
    if claims["expiresAt"] - ms() < MIN_POST_SIGN_MS:
        deny("ISSUER_LEASE_TOO_CLOSE_TO_EXPIRY")
    digest = hashlib.sha256(_canonical(claims, ISSUER_FIELDS)).hexdigest()
    try:
        with connection.cursor() as cursor:
            _identity(cursor)
            cursor.execute("SELECT gpt02_private.record_issuer_evidence("
                           "%s::jsonb,%s,%s)",
                           (json.dumps(claims, separators=(",", ":"), allow_nan=False),
                            signed, digest))
            evidence = str(cursor.fetchone()[0])
            if not UUID.fullmatch(evidence):
                deny("ISSUER_RPC_EVIDENCE_ID_INVALID")
            cursor.execute("SELECT gpt02_private.consume_issuer_lease("
                           "%s::uuid,%s::uuid,%s::uuid)",
                           (claims["commandId"], evidence, claims["fenceId"]))
            if cursor.fetchone() != ("LEASE_CONSUMED_NO_DISPATCH",):
                deny("ISSUER_LEASE_RETURN_DID_NOT_DENY_DISPATCH")
        connection.commit()
        return evidence
    except Exception:
        connection.rollback()
        raise

def run_once(*, run=subprocess.run):
    preflight(run=run)
    fd = os.open(str(LOCK), os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        preflight(run=run)
        packet, proof = signed_stage()
        dsn = issuer_dsn()
        import psycopg
        with psycopg.connect(dsn, connect_timeout=4, autocommit=False) as conn:
            # Cold read-only DB TLS establishment happens BEFORE the
            # irreversible receipt/fence transaction, never inside its
            # 15-second lease window.
            require_issuer_reader_warm()
            receipt, fence, fence_clock = consume_and_reserve(conn, packet, proof)
            claims = issuer_claims(
                packet, proof, receipt, fence,
                fence_db_before_ms=fence_clock,
            )
            write_private_claims(claims)
            signed = start_signer(run=run)
            _full, verified = verify_four_role_packet(packet, claims, signed)
            evidence = record_and_consume(
                conn, claims, signed["signatureBase64url"], verified)
        # Note: this is evidence completion without dispatch authorization.
        print("GPT02_DEV_ISSUER_LEASE_CONSUMED_NO_DISPATCH")
        print("evidence_recorded", bool(evidence))
        print("dispatch_permitted", False)
    except BlockingIOError as exc:
        raise IssuerDenied("ISSUER_PARALLEL_INVOCATION_DENIED") from exc
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)

if __name__ == "__main__":
    try:
        run_once()
    except Exception as exc:
        # Preserve stable, non-secret operational failure codes. Never print
        # SQL parameters, DSNs, identities, signatures or claim bodies.
        code = str(exc)
        safe = code if re.fullmatch(r"[A-Z0-9_:-]{1,120}", code) else type(exc).__name__
        print("GPT02_DEV_ISSUER_FINALIZE_DENIED", safe,
              file=__import__("sys").stderr)
        raise SystemExit(2)
