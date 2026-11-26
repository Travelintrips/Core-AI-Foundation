#!/usr/bin/env python3
"""Read-only PostgreSQL Owner ledger adapter; no live connection factory.

A separately authorized custodian must supply an ALREADY CONNECTED
transaction-read-only session pinned by TLS to CST-DEV and a dedicated
read-only role. This adapter independently rechecks database identity and
transaction mode before the exact parameterized SELECT. It does not create
connections, read credentials, change session settings or execute DML.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Protocol
import re

from gpt02_relock_once_candidate import GateDenied
from gpt02_owner_ledger_reader_candidate import _OWNER_READ_SQL

PROJECT = "xssrfshdrtdfupgqwfdw"
HOST = "db.xssrfshdrtdfupgqwfdw.supabase.co"
DB_NAME = "postgres"
# This role is intentionally NOT provisioned by this PR. An authorized
# custodian must create/provision it with SELECT-only RLS-scoped access.
EXPECTED_ROLE = "gpt02_owner_ledger_reader_dev"

_SESSION_SQL = (
    "SELECT session_user::text AS session_user, current_user::text AS current_user, "
    "current_database()::text AS database_name, "
    "current_setting('transaction_read_only')::text AS tx_read_only, "
    "current_setting('default_transaction_read_only')::text AS default_read_only"
)


class PgReadOnlyConnection(Protocol):
    """Authenticated, pinned-TLS, existing PG session supplied by custodian."""
    def fetch_mappings(self, sql: str, parameters: tuple) -> list[Mapping]: ...


class Gpt02OwnerLedgerPgReaderCandidate:
    def __init__(self, connection: PgReadOnlyConnection):
        if not callable(getattr(connection, "fetch_mappings", None)):
            raise GateDenied("PINNED_READ_ONLY_PG_CUSTODY_REQUIRED")
        self._connection = connection

    def read_exact_owner_decision(self, sql: str, args: tuple[str, ...]) -> list[Mapping]:
        if (sql != _OWNER_READ_SQL or not isinstance(args, tuple) or
            len(args) != 1 or not isinstance(args[0], str) or
            re.fullmatch(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}", args[0]) is None):
            raise GateDenied("UNEXPECTED_LEDGER_SQL")
        try:
            identity = self._connection.fetch_mappings(_SESSION_SQL, ())
        except Exception:
            raise GateDenied("LEDGER_DB_IDENTITY_UNAVAILABLE") from None
        if (not isinstance(identity, list) or len(identity) != 1
            or not isinstance(identity[0], Mapping)
            or identity[0].get("session_user") != EXPECTED_ROLE
            or identity[0].get("current_user") != EXPECTED_ROLE
            or identity[0].get("database_name") != DB_NAME
            or identity[0].get("tx_read_only") != "on"
            or identity[0].get("default_read_only") != "on"):
            raise GateDenied("LEDGER_READ_ONLY_IDENTITY_REQUIRED")
        try:
            rows = self._connection.fetch_mappings(sql, args)
        except Exception:
            raise GateDenied("LEDGER_READ_ONLY_QUERY_UNAVAILABLE") from None
        if not isinstance(rows, list) or len(rows) > 2:
            raise GateDenied("LEDGER_RESULT_UNBOUNDED")
        return rows
