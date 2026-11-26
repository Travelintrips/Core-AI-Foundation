#!/usr/bin/env python3
"""Durable SQLite one-use nonce CLAIM prototype for isolated GPT02 DEV QA.

Not installed, no CLI or file path, network, host or credential access.
Requires a caller-created SQLite connection to an independently governed DB.
Database schema, signing key custody, host permissions, and real production
integration are deliberately NOT provided. Claim is not executor authorization.
"""
from __future__ import annotations
import re
import sqlite3

from gpt02_relock_once_candidate import VerifiedExecutorGrant, GateDenied

_UUID = re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")
_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_ALLOWED_TERMINAL = frozenset(("FAILED_RECONCILIATION_REQUIRED", "RELOCK_READBACK_PASS"))


class SQLiteNonceCustodyCandidate:
    """Explicit connection injection only. No path/default database allowed."""

    def __init__(self, connection: sqlite3.Connection):
        if not isinstance(connection, sqlite3.Connection) or connection.in_transaction:
            raise GateDenied("TRUSTED_ATOMIC_CUSTODY_CONNECTION_REQUIRED")
        self.conn = connection

    def claim_executor_nonce_once(self, grant: VerifiedExecutorGrant) -> str:
        if (not isinstance(grant, VerifiedExecutorGrant) or
            not _UUID.fullmatch(grant.executor_nonce) or
            not _UUID.fullmatch(grant.challenge_id) or
            not _DIGEST.fullmatch(grant.manifest_digest)):
            raise GateDenied("BOUND_EXECUTOR_GRANT_REQUIRED")
        # A real installed caller MUST separately authenticate signed grant,
        # Owner ledger receipt, encryption custody and database file provenance.
        try:
            self.conn.execute("BEGIN IMMEDIATE")
            self.conn.execute(
                "INSERT INTO gpt02_oneuse_claims "
                "(nonce,challenge_id,manifest_digest,status) VALUES (?,?,?,'CLAIMED')",
                (grant.executor_nonce, grant.challenge_id, grant.manifest_digest),
            )
            self.conn.execute("COMMIT")
        except sqlite3.IntegrityError:
            self.conn.execute("ROLLBACK")
            raise GateDenied("EXECUTOR_NONCE_REPLAY") from None
        except sqlite3.Error:
            if self.conn.in_transaction:
                self.conn.execute("ROLLBACK")
            raise GateDenied("EXECUTOR_NONCE_CUSTODY_UNAVAILABLE") from None
        return grant.executor_nonce

    def record_terminal_receipt(self, claim: str, result: str) -> None:
        if not isinstance(claim, str) or not _UUID.fullmatch(claim) or result not in _ALLOWED_TERMINAL:
            raise GateDenied("EXECUTOR_TERMINAL_RECEIPT_INVALID")
        try:
            self.conn.execute("BEGIN IMMEDIATE")
            cursor = self.conn.execute(
                "UPDATE gpt02_oneuse_claims SET status=? "
                "WHERE nonce=? AND status='CLAIMED'", (result, claim)
            )
            if cursor.rowcount != 1:
                self.conn.execute("ROLLBACK")
                raise GateDenied("EXECUTOR_TERMINAL_CLAIM_NOT_PENDING")
            self.conn.execute("COMMIT")
        except GateDenied:
            raise
        except sqlite3.Error:
            if self.conn.in_transaction:
                self.conn.execute("ROLLBACK")
            raise GateDenied("EXECUTOR_TERMINAL_CUSTODY_UNAVAILABLE") from None
