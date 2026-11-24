"""Durable, fail-closed command reservation for a future isolated QA executor.

Source-only: no Docker invocation, privileged service, signer, DB role or
external network. State records are not evidence of a completed PG17 test.
"""
import hashlib
import json
import os
import sqlite3
from pathlib import Path

from issue238_qa_permit import PermitDenied


def _connect(path: Path):
    # SQLite creates its own WAL files: caller must supply an exclusive,
    # persistent owner-only directory (not a shared or public mount).
    if path.is_symlink() or not path.parent.is_dir():
        raise PermitDenied("invalid_ledger_path")
    if os.stat(path.parent).st_mode & 0o077:
        raise PermitDenied("ledger_directory_not_private")
    if path.exists():
        if not path.is_file() or (path.stat().st_mode & 0o077):
            raise PermitDenied("ledger_file_not_private")
    old_umask = os.umask(0o077)
    try:
        con = sqlite3.connect(path, timeout=2, isolation_level=None)
    finally:
        os.umask(old_umask)
    if path.stat().st_mode & 0o077:
        con.close()
        raise PermitDenied("ledger_file_not_private")
    con.execute("PRAGMA busy_timeout=2000")
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=FULL")
    con.execute("""CREATE TABLE IF NOT EXISTS claims (
        nonce TEXT PRIMARY KEY,
        command_id TEXT UNIQUE NOT NULL,
        job_id TEXT NOT NULL,
        signed_digest TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('RESERVED','PASS','FAIL','UNKNOWN')),
        receipt_digest TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    return con


def reserve(path: Path, *, signed_claims: dict):
    """Reserve exactly once. Unknown/incomplete older commands never auto-retry."""
    nonce, command_id, job_id = (signed_claims[k] for k in ("nonce", "command_id", "job_id"))
    if any(not isinstance(x, str) or not x for x in (nonce, command_id, job_id)):
        raise PermitDenied("missing_ids")
    claims_digest = hashlib.sha256(json.dumps(
        signed_claims, sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    con = _connect(path)
    try:
        con.execute("BEGIN IMMEDIATE")
        try:
            con.execute(
                "INSERT INTO claims (nonce,command_id,job_id,signed_digest,state) VALUES (?,?,?,?,?)",
                (nonce, command_id, job_id, claims_digest, "RESERVED"),
            )
        except sqlite3.IntegrityError as exc:
            raise PermitDenied("duplicate_nonce_or_command") from exc
        con.execute("COMMIT")
        return claims_digest
    except BaseException:
        if con.in_transaction:
            con.execute("ROLLBACK")
        raise
    finally:
        con.close()


def finish(path: Path, *, nonce: str, command_id: str,
           receipt_digest: str, state: str):
    """Accept one terminal result only, leaving ambiguous jobs RESERVED."""
    if state not in {"PASS", "FAIL", "UNKNOWN"} or not isinstance(receipt_digest, str):
        raise PermitDenied("invalid_result")
    if len(receipt_digest) != 64 or any(c not in "0123456789abcdef" for c in receipt_digest):
        raise PermitDenied("invalid_receipt_digest")
    con = _connect(path)
    try:
        con.execute("BEGIN IMMEDIATE")
        n = con.execute(
            """UPDATE claims SET state=?, receipt_digest=?, updated_at=CURRENT_TIMESTAMP
                WHERE nonce=? AND command_id=? AND state='RESERVED'""",
            (state, receipt_digest, nonce, command_id),
        ).rowcount
        if n != 1:
            raise PermitDenied("missing_or_terminal_command")
        con.execute("COMMIT")
    except BaseException:
        if con.in_transaction:
            con.execute("ROLLBACK")
        raise
    finally:
        con.close()


def status(path: Path, nonce: str):
    con = _connect(path)
    try:
        row = con.execute("SELECT state,command_id,receipt_digest,signed_digest FROM claims WHERE nonce=?", (nonce,)).fetchone()
        return dict(zip(("state", "command_id", "receipt_digest", "signed_digest"), row)) if row else None
    finally:
        con.close()
