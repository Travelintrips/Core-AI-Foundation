"""DEV Issue159 on-demand request rotation, authenticated and non-authorizing.

Only replaces an EXPIRED pending approval file for the SAME immutable,
still-valid Hub/Core preparation; never creates task/command/approval, signs
or dispatches. A trusted independent read-only Unix reader confirms lineage.
"""
from __future__ import annotations

import fcntl
import json
import os
import socket
import sqlite3
import stat
import time
from pathlib import Path

from gpt02_issue159_approval_intent_contract import validate_approval_claims
from prepare_gpt02_issue159_approval_request import prepare

LIVE_DB = "/opt/ai-coding-standalone-dev/tasks.db"
LIVE_OUTPUT = "/opt/ai-coding-standalone-dev/gpt02_issue159_pending_claims.json"
READER_SOCKET = "/run/gpt02-reader/reader.sock"
MIN_PREPARATION_REMAINING_MS = 250_000
MAX_HTTP_READ_BYTES = 24_000


class RefreshDenied(RuntimeError):
    def __init__(self, code: str, http_status: int = 409):
        super().__init__(code)
        self.code = code
        self.http_status = http_status


def _root_private_file(path: str, *, expected_mode: int = 0o600) -> None:
    st = os.lstat(path)
    if (stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode)
            or st.st_uid != 0 or st.st_gid != 0
            or stat.S_IMODE(st.st_mode) != expected_mode):
        raise RefreshDenied("ISSUE159_PRIVATE_FILE_CUSTODY_INVALID", 503)


def _socket_fact_reader(identity: dict) -> dict:
    # This socket belongs to the independent read-only Hub/Core adapter.
    from grp import getgrnam
    p = Path(READER_SOCKET)
    entry = os.lstat(p.parent)
    if stat.S_ISLNK(entry.st_mode):
        if (entry.st_uid != 0 or entry.st_gid != 0
                or os.path.realpath(p.parent) != "/run/private/gpt02-reader"):
            raise RefreshDenied("ISSUE159_TRUSTED_READER_DIRECTORY_DRIFT", 503)
        parent = os.stat(p.parent)
    else:
        parent = entry
    endpoint = os.lstat(p)
    group = getgrnam("gpt02-issue159-signers").gr_gid
    if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid == 0
            or parent.st_gid != group
            or stat.S_IMODE(parent.st_mode) != 0o750
            or not stat.S_ISSOCK(endpoint.st_mode) or endpoint.st_uid == 0
            or endpoint.st_gid != group
            or stat.S_IMODE(endpoint.st_mode) != 0o660):
        raise RefreshDenied("ISSUE159_TRUSTED_READER_SOCKET_CUSTODY_INVALID", 503)

    body = json.dumps(identity, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(body) > 2048:
        raise RefreshDenied("ISSUE159_FACT_QUERY_TOO_LARGE", 400)
    request = (b"POST /pre-sign-facts HTTP/1.1\r\n"
               b"Host: localhost\r\n"
               b"Content-Type: application/json\r\n"
               b"Content-Length: " + str(len(body)).encode() +
               b"\r\nConnection: close\r\n\r\n" + body)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.settimeout(12)
        conn.connect(READER_SOCKET)
        conn.sendall(request)
        chunks, n = [], 0
        while True:
            part = conn.recv(4096)
            if not part:
                break
            n += len(part)
            if n > MAX_HTTP_READ_BYTES:
                raise RefreshDenied("ISSUE159_TRUSTED_FACTS_RESPONSE_TOO_LARGE", 503)
            chunks.append(part)
    raw = b"".join(chunks)
    header, sep, body = raw.partition(b"\r\n\r\n")
    if not sep:
        raise RefreshDenied("ISSUE159_TRUSTED_FACTS_HTTP_INVALID", 503)
    first = header.split(b"\r\n", 1)[0].split()
    if len(first) < 2 or first[0] != b"HTTP/1.1":
        raise RefreshDenied("ISSUE159_TRUSTED_FACTS_HTTP_INVALID", 503)
    if first[1] != b"200":
        raise RefreshDenied("ISSUE159_TRUSTED_FACTS_NOT_AVAILABLE", 409)
    headers = {}
    for line in header.split(b"\r\n")[1:]:
        key, sep, value = line.partition(b":")
        if not sep:
            raise RefreshDenied("ISSUE159_TRUSTED_FACTS_HEADER_INVALID", 503)
        key = key.lower().strip()
        if key in headers:
            raise RefreshDenied("ISSUE159_TRUSTED_FACTS_DUPLICATE_HEADER", 503)
        headers[key] = value.strip()
    if (headers.get(b"content-type", b"").split(b";", 1)[0] != b"application/json"
            or b"transfer-encoding" in headers
            or not headers.get(b"content-length", b"").isdigit()
            or int(headers[b"content-length"]) != len(body)):
        raise RefreshDenied("ISSUE159_TRUSTED_FACTS_CONTENT_INVALID", 503)
    try:
        obj = json.loads(body.decode("utf-8"))
    except (UnicodeError, ValueError) as exc:
        raise RefreshDenied("ISSUE159_TRUSTED_FACTS_JSON_INVALID", 503) from exc
    if (not isinstance(obj, dict) or obj.get("ok") is not True
            or obj.get("environment") != "DEV"
            or any(obj.get(k) is not False for k in
                   ("signingPermitted", "authorizationGranted", "dispatchPermitted"))
            or obj.get("releaseDecision") != "NO_GO"):
        raise RefreshDenied("ISSUE159_TRUSTED_FACTS_NOT_READONLY", 503)
    return obj.get("facts")


def _verify_pre_sign_facts(facts: dict, claims: dict, now_ms: int) -> int:
    if not isinstance(facts, dict):
        raise RefreshDenied("ISSUE159_PRESIGN_NOT_AVAILABLE", 409)
    pre = facts.get("prepared")
    job = facts.get("job")
    core = facts.get("core")
    hub = facts.get("hubOperator")
    assignment = facts.get("hubAssignment")
    proof = facts.get("trustedReadProof")
    if not all(isinstance(v, dict) for v in (pre, job, core, hub, assignment, proof)):
        raise RefreshDenied("ISSUE159_PRESIGN_MISSING_LINEAGE", 409)
    valid = (
        pre.get("companyId") == claims["companyId"] == "default"
        and pre.get("hubTaskId") == claims["taskId"]
        and pre.get("commandCandidateId") == claims["commandId"]
        and pre.get("attemptId") == claims["attemptId"]
        and pre.get("operatorSubject") == claims["superAdminId"]
        and job.get("taskId") == claims["taskId"]
        and job.get("status") == "prepared"
        and job.get("dispatchStarted") is False
        and job.get("commandId") is None
        and job.get("workerCommandCount") == 0
        and core.get("status") == "PENDING"
        and core.get("commandCount") == 0
        and core.get("runCount") == 0
        and core.get("commandCandidateId") == claims["commandId"]
        and core.get("attemptId") == claims["attemptId"]
        and core.get("taskId") == pre.get("coreTaskId")
        and hub.get("subject") == claims["superAdminId"]
        and hub.get("role") == "super_admin"
        and hub.get("active") is True
        and assignment.get("actorId") == claims["superAdminId"]
        and assignment.get("actorRole") == "super_admin"
        and assignment.get("actorActive") is True
        and proof.get("source") == "gpt02-issue159-presign-reader"
        and proof.get("environment") == "DEV"
        and proof.get("hubRole") == "gpt02_hub_evidence_reader"
        and proof.get("coreRole") == "gpt02_core_evidence_reader"
        and proof.get("separateBackends") is True
        and proof.get("clientTlsVerified") is True
        and proof.get("readOnly") is True
        and all(proof.get(k) is False for k in
                ("signingPermitted", "authorizationGranted", "dispatchPermitted"))
        and proof.get("releaseDecision") == "NO_GO"
        and type(facts.get("observedAt")) is int
        and abs(facts["observedAt"] - now_ms) <= 5000
        and type(pre.get("expiresAt")) in (int, float)
    )
    if not valid:
        raise RefreshDenied("ISSUE159_PRESIGN_LINEAGE_MISMATCH", 409)
    expires = int(pre["expiresAt"])
    if expires - now_ms < MIN_PREPARATION_REMAINING_MS:
        raise RefreshDenied("ISSUE159_PREPARATION_NOT_FRESH_ENOUGH", 409)
    return expires


def refresh_pending(db_path: str, output_path: str, actor_id: str, *,
                    fact_reader=_socket_fact_reader,
                    now_fn=lambda: int(time.time() * 1000),
                    operational: bool = True) -> dict:
    if type(actor_id) is not str or not actor_id.strip():
        raise RefreshDenied("ISSUE159_ACTIVE_SUPER_ADMIN_REQUIRED", 403)
    if operational:
        if (os.geteuid() != 0 or db_path != LIVE_DB or output_path != LIVE_OUTPUT):
            raise RefreshDenied("ISSUE159_REFRESH_TARGET_NOT_PINNED", 503)
        _root_private_file(db_path)
        _root_private_file(output_path)
    elif not os.path.isfile(db_path) or not os.path.isfile(output_path):
        raise RefreshDenied("ISSUE159_TEST_SOURCE_MISSING", 409)

    # Independent lock separate from SQLite; no task, approval or DB write.
    lock_path = output_path + ".refresh.lock"
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        if operational:
            _root_private_file(lock_path)
        fcntl.flock(fd, fcntl.LOCK_EX)
        now_ms = now_fn()
        if type(now_ms) is not int or now_ms <= 0:
            raise RefreshDenied("ISSUE159_SERVER_CLOCK_INVALID", 503)
        payload = json.loads(Path(output_path).read_text("utf-8"))
        if (type(payload) is not dict or set(payload) != {"claims"}
                or not isinstance(payload["claims"], dict)):
            raise RefreshDenied("ISSUE159_PENDING_CLAIMS_SHAPE_INVALID", 409)
        claims = payload["claims"]
        validate_approval_claims(claims)
        if claims["superAdminId"] != actor_id:
            raise RefreshDenied("ISSUE159_APPROVAL_ACTOR_MISMATCH", 403)
        if claims["issuedAt"] > now_ms:
            raise RefreshDenied("ISSUE159_PENDING_CLAIMS_FROM_FUTURE", 409)
        if now_ms < claims["expiresAt"]:
            return {"environment": "DEV", "pending": True,
                    "taskId": claims["taskId"], "expiresAt": claims["expiresAt"],
                    "alreadyFresh": True, "requestRefreshed": False,
                    "signingPermitted": False, "authorizationGranted": False,
                    "dispatchPermitted": False, "releaseDecision": "NO_GO"}

        connection = sqlite3.connect("file:" + db_path + "?mode=ro", uri=True, timeout=2)
        try:
            connection.execute("PRAGMA query_only=ON")
            # A single existing approval, even EXPIRED, blocks new attempts
            # for the same immutable command/attempt.
            approved = connection.execute(
                "SELECT count(*) FROM gpt02_issue159_approval_intents "
                "WHERE task_id=? OR command_id=? OR attempt_id=?",
                (claims["taskId"], claims["commandId"], claims["attemptId"])
            ).fetchone()[0]
        finally:
            connection.close()
        if approved != 0:
            raise RefreshDenied("ISSUE159_APPROVAL_ALREADY_RECORDED", 409)

        query = {"companyId": claims["companyId"],
                 "hubTaskId": claims["taskId"],
                 "commandCandidateId": claims["commandId"],
                 "attemptId": claims["attemptId"]}
        facts = fact_reader(query)
        prep_expiry = _verify_pre_sign_facts(facts, claims, now_ms)
        # The existing, independently tested preparer is reused, not rewritten.
        target = Path(output_path)
        archive = target.with_name(
            target.name + ".expired-task" + str(claims["taskId"]) +
            "-" + str(now_ms) + ".json")
        if os.path.lexists(archive):
            raise RefreshDenied("ISSUE159_REFRESH_ARCHIVE_COLLISION", 409)
        os.rename(output_path, archive)
        try:
            result = prepare(db_path, output_path, claims["taskId"],
                             claims["commandId"], claims["attemptId"],
                             now_ms=now_ms, operational=operational)
            newest = json.loads(target.read_text("utf-8"))["claims"]
            validate_approval_claims(newest)
            if (newest["nonce"] == claims["nonce"]
                    or newest["expiresAt"] > prep_expiry - 1000
                    or newest["superAdminId"] != actor_id
                    or newest["taskId"] != claims["taskId"]
                    or newest["commandId"] != claims["commandId"]
                    or newest["attemptId"] != claims["attemptId"]
                    or result["signingPermitted"] is not False
                    or result["dispatchPermitted"] is not False):
                raise RefreshDenied("ISSUE159_REFRESH_RESULT_MISMATCH", 503)
        except BaseException:
            if target.exists():
                os.unlink(target)
            os.rename(archive, output_path)
            raise

        return {"environment": "DEV", "pending": True,
                "taskId": claims["taskId"], "expiresAt": newest["expiresAt"],
                "alreadyFresh": False, "requestRefreshed": True,
                "previousRequestArchived": True, "signingPermitted": False,
                "authorizationGranted": False, "dispatchPermitted": False,
                "releaseDecision": "NO_GO"}
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)
