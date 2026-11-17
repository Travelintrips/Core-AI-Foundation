#!/usr/bin/env python3
"""GPT02 DEV only: recover one approved packet after SQLite commit, without reapproval.

Existing one-use SQLite intent is authoritative. A *fresh* exact pending
claims file and independent Hub/Core readback must match it before an
exclusive root-only approved packet can be reconstructed. Does not create an
approval, read private keys, sign, dispatch or call writer RPCs.

By default CLI is diagnostic only. A supervised explicit switch is required
to publish. No recovery of an expired/missing/ambiguous decision is allowed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import stat
import sys
import time
from pathlib import Path

from gpt02_issue159_approval_intent_contract import (
    ApprovalIntentContractError, validate_approval_claims,
)
from gpt02_issue159_approval_intent_reader import read_approval_intent
from gpt02_issue159_approval_request_refresh import (
    _socket_fact_reader, _verify_pre_sign_facts,
)

BASE = Path("/opt/ai-coding-standalone-dev")
DB = BASE / "tasks.db"
PENDING = BASE / "gpt02_issue159_pending_claims.json"
APPROVED = BASE / "gpt02_issue159_approved_claims.json"
NO_GO = {
    "environment": "DEV", "signingPermitted": False,
    "authorizationGranted": False, "dispatchPermitted": False,
    "releaseDecision": "NO_GO",
}
OUTPUTS = tuple(
    Path("/run/gpt02-issue159-sign-once-" + role) / (role + "-signature.json")
    for role in ("approval", "hub", "core", "issuer")
)
EXTRA_OUTPUTS = (
    BASE / "gpt02_issue159_issuer_claims.json",
    BASE / "gpt02_issue159_hub_core_link_claims.json",
)


class PacketRecoveryDenied(RuntimeError):
    pass


def deny(code: str):
    raise PacketRecoveryDenied(code)


def private_regular(path: Path, owner: int, *, binary_read: bool = True) -> bytes | None:
    # Open the exact inode with O_NOFOLLOW and fstat the open descriptor.
    # lstat() followed by read_bytes() would permit a path-swap race.
    fd = None
    try:
        fd = os.open(
            path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
        )
        meta = os.fstat(fd)
        if (
            not stat.S_ISREG(meta.st_mode) or meta.st_uid != owner
            or (owner == 0 and meta.st_gid != 0)
            or stat.S_IMODE(meta.st_mode) != 0o600 or meta.st_nlink != 1
            or meta.st_size <= 0 or (binary_read and meta.st_size > 20000)
        ):
            deny("SOURCE_PRIVATE_CUSTODY_INVALID")
        if not binary_read:
            return None
        with os.fdopen(fd, "rb") as reader:
            fd = None
            data = reader.read(meta.st_size + 1)
        if len(data) != meta.st_size:
            deny("SOURCE_PRIVATE_CUSTODY_INVALID")
        return data
    except FileNotFoundError:
        deny("SOURCE_PRIVATE_FILE_MISSING")
    except OSError:
        deny("SOURCE_PRIVATE_FILE_UNREADABLE")
    finally:
        if fd is not None:
            os.close(fd)


def slot_clear(target: Path) -> bool:
    # No following symlinks and no implicitly overwriting old evidence.
    for path in (target, target.with_name("." + target.name + ".tmp")):
        try:
            os.lstat(path)
        except FileNotFoundError:
            continue
        except OSError:
            return False
        return False
    return True


def prepare_recovery(
    db_path: Path,
    pending_path: Path,
    approved_path: Path,
    *,
    now_ms: int,
    operational: bool = True,
    fact_reader=None,
    fact_verifier=None,
    ready_gate=None,
    output_paths=OUTPUTS,
) -> dict:
    if type(now_ms) is not int or now_ms <= 0:
        deny("RECOVERY_TIME_INVALID")
    if operational:
        if (
            os.geteuid() != 0
            or db_path != DB or pending_path != PENDING
            or approved_path != APPROVED
            or os.environ.get("APP_ENV") != "development"
        ):
            deny("RECOVERY_DEV_OPERATOR_SCOPE_REQUIRED")
        if any(v is not None for v in (fact_reader, fact_verifier, ready_gate)):
            deny("RECOVERY_OPERATIONAL_TEST_INJECTION_DENIED")
        owner = 0
        reader = _socket_fact_reader
        verifier = _verify_pre_sign_facts
    else:
        # Tests are kept in a separate temporary directory; never allow
        # invoking test mode against any pinned live path.
        if db_path == DB or pending_path == PENDING or approved_path == APPROVED:
            deny("RECOVERY_TEST_TARGET_FORBIDDEN")
        if not all(callable(x) for x in (fact_reader, fact_verifier, ready_gate)):
            deny("RECOVERY_TEST_TRUSTED_FIXTURE_REQUIRED")
        owner = os.geteuid()
        reader, verifier = fact_reader, fact_verifier

    private_regular(db_path, owner, binary_read=False)
    try:
        payload = json.loads(private_regular(pending_path, owner))
        if type(payload) is not dict or set(payload) != {"claims"}:
            deny("PENDING_CLAIMS_INVALID")
        claims = payload["claims"]
        digest = validate_approval_claims(claims)["claimsSha256"]
    except (ValueError, TypeError, KeyError, ApprovalIntentContractError):
        deny("PENDING_CLAIMS_INVALID")
    if (
        now_ms < claims["issuedAt"]
        or claims["expiresAt"] - now_ms < 120_000
    ):
        deny("RECOVERY_APPROVAL_EXPIRED_OR_TOO_SHORT")
    if not slot_clear(approved_path):
        deny("RECOVERY_APPROVED_PACKET_OUTPUT_OCCUPIED")
    if any(not slot_clear(item) for item in output_paths):
        deny("RECOVERY_SIGNER_OUTPUT_OCCUPIED")
    if operational and any(item.exists() or item.is_symlink() for item in EXTRA_OUTPUTS):
        deny("RECOVERY_PARTIAL_CHAIN_OUTPUT_OCCUPIED")

    try:
        with sqlite3.connect("file:" + str(db_path) + "?mode=ro", uri=True, timeout=2) as con:
            con.execute("PRAGMA query_only=ON")
            con.row_factory = sqlite3.Row
            rows = con.execute(
                """SELECT id,task_id,command_id,attempt_id,company_id,
                          claims_sha256,actor_id,auth_method,
                          role_at_decision,decision,recorded_at_ms,expires_at_ms
                     FROM gpt02_issue159_approval_intents
                    WHERE task_id=? OR command_id=? OR attempt_id=?""",
                (claims["taskId"], claims["commandId"], claims["attemptId"]),
            ).fetchall()
    except sqlite3.Error:
        deny("RECOVERY_LEDGER_UNAVAILABLE")
    if len(rows) != 1:
        deny("RECOVERY_LEDGER_NOT_UNIQUE_OR_MISSING")
    row = dict(rows[0])
    matches = {
        "task_id": claims["taskId"],
        "command_id": claims["commandId"],
        "attempt_id": claims["attemptId"],
        "company_id": claims["companyId"],
        "claims_sha256": digest,
        "actor_id": claims["superAdminId"],
        "decision": "APPROVE",
        "role_at_decision": "super_admin",
        "expires_at_ms": claims["expiresAt"],
    }
    if any(row.get(key) != value for key, value in matches.items()):
        deny("RECOVERY_IMMUTABLE_LEDGER_BINDING_MISMATCH")
    if (
        not isinstance(row["recorded_at_ms"], int)
        or not claims["issuedAt"] <= row["recorded_at_ms"] < now_ms
        or row["auth_method"] not in ("supabase_admin_session", "supabase_aal2")
        or not isinstance(row["id"], str)
    ):
        deny("RECOVERY_DECISION_INVALID")
    lookup = {
        "claimsSha256": digest,
        "taskId": claims["taskId"], "commandId": claims["commandId"],
        "attemptId": claims["attemptId"], "companyId": claims["companyId"],
        "superAdminId": claims["superAdminId"],
    }
    trusted = read_approval_intent(str(db_path), lookup, now_ms, operational=operational)
    decision = trusted.get("decision")
    if not (
        trusted.get("persistedTrustedReadProven") is True
        and isinstance(decision, dict)
        and decision.get("decisionId") == row["id"]
        and decision.get("claimsSha256") == digest
        and decision.get("actorId") == row["actor_id"]
        and decision.get("authMethod") == row["auth_method"]
        and decision.get("recordedAt") == row["recorded_at_ms"]
        and trusted.get("authorizationGranted") is False
        and trusted.get("dispatchPermitted") is False
        and trusted.get("releaseDecision") == "NO_GO"
    ):
        deny("RECOVERY_APPROVAL_READBACK_NOT_TRUSTED")

    record = {**row}
    if operational:
        from approval_api import issue159_chain_readiness_gate
        gate = issue159_chain_readiness_gate
    else:
        gate = ready_gate
    if gate(record) is not True:
        deny("RECOVERY_CHAIN_NOT_READY")

    query = {
        "companyId": claims["companyId"], "hubTaskId": claims["taskId"],
        "commandCandidateId": claims["commandId"],
        "attemptId": claims["attemptId"],
    }
    try:
        facts = reader(query)
        observed = int(time.time() * 1000) if operational else now_ms
        preparation_expiry = verifier(facts, claims, observed)
    except Exception:
        deny("RECOVERY_FRESH_PRESIGN_NOT_AVAILABLE")
    if (
        preparation_expiry < claims["expiresAt"] + 1000
        or claims["expiresAt"] - observed < 120_000
    ):
        deny("RECOVERY_PREPARATION_NOT_FRESH")

    packet = {
        "claims": claims, "intentId": row["id"],
        "claimsSha256": digest, "actorId": row["actor_id"],
        "authMethod": row["auth_method"],
        "roleAtDecision": row["role_at_decision"],
        "decision": row["decision"],
        "recordedAt": row["recorded_at_ms"],
        "expiresAt": row["expires_at_ms"],
        **{k: v for k, v in NO_GO.items() if k != "environment"},
    }
    return {
        "packet": packet,
        "taskId": claims["taskId"],
        "intentId": row["id"],
        "approvalCountUnchanged": True,
        "signingPermitted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }


def recover_packet_once(
    db_path: Path,
    pending_path: Path,
    approved_path: Path,
    *,
    now_ms: int,
    operational: bool = True,
    fact_reader=None,
    fact_verifier=None,
    ready_gate=None,
    output_paths=OUTPUTS,
) -> dict:
    result = prepare_recovery(
        db_path, pending_path, approved_path, now_ms=now_ms,
        operational=operational, fact_reader=fact_reader,
        fact_verifier=fact_verifier, ready_gate=ready_gate,
        output_paths=output_paths,
    )
    target = approved_path
    tmp = target.with_name("." + target.name + ".tmp")
    if not slot_clear(target):
        deny("RECOVERY_APPROVED_PACKET_OUTPUT_OCCUPIED")
    packet_bytes = (
        json.dumps(result["packet"], sort_keys=True, separators=(",", ":")) + "\n"
    ).encode("utf-8")
    # Create temp without following links, then link exclusively. No overwrite
    # even when two repair invocations race. The original intent is unchanged.
    try:
        fd = os.open(
            tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
    except FileExistsError:
        deny("RECOVERY_APPROVED_PACKET_OUTPUT_OCCUPIED")
    try:
        with os.fdopen(fd, "wb") as writer:
            writer.write(packet_bytes)
            writer.flush()
            os.fsync(writer.fileno())
        if operational:
            os.chown(tmp, 0, 0)
        os.link(tmp, target)
        dir_fd = os.open(str(target.parent), os.O_DIRECTORY | os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except FileExistsError:
        deny("RECOVERY_APPROVED_PACKET_OUTPUT_OCCUPIED")
    except OSError:
        deny("RECOVERY_PUBLICATION_FAILED")
    finally:
        tmp.unlink(missing_ok=True)
    return {
        "environment": "DEV", "taskId": result["taskId"],
        "recoveredExistingIntent": True, "newApprovalRecorded": False,
        "packetPublished": True, **{k: v for k, v in NO_GO.items() if k != "environment"},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--recover", action="store_true")
    args = parser.parse_args()
    try:
        if args.recover and os.environ.get("GPT02_ISSUE159_SUPERVISED_PACKET_RECOVERY") != "explicit":
            deny("RECOVERY_EXPLICIT_OPERATOR_INTENT_REQUIRED")
        now = int(time.time() * 1000)
        if args.recover:
            result = recover_packet_once(DB, PENDING, APPROVED, now_ms=now)
        else:
            status = prepare_recovery(DB, PENDING, APPROVED, now_ms=now)
            result = {
                "environment": "DEV", "taskId": status["taskId"],
                "recoverable": True, "packetPublished": False, **NO_GO,
            }
        print(json.dumps(result, sort_keys=True))
        return 0
    except PacketRecoveryDenied as exc:
        print(json.dumps({
            "environment": "DEV", "recoverable": False,
            "packetPublished": False, "reason": str(exc), **NO_GO,
        }, sort_keys=True))
        return 3


if __name__ == "__main__":
    sys.exit(main())

[executed on device: srv1792369 (0891e23a-6a6b-4f8c-a16a-962e888e2014)]