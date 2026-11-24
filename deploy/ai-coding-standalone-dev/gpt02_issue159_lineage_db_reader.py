"""GPT02 DEV lineage SQL adapter, *read only* and not deployable as a writer.

The operating service must authenticate its own dedicated PostgreSQL reader
credential and private Unix peer. This helper performs a transactionally
read-only, parameterized query; it does not trust a caller-provided row.
No signer, writer, dispatch, network/socket or credential loading is here.
"""
from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Any, Mapping

from gpt02_issue159_lineage_readback_contract import (
    TRUSTED_LINEAGE_SQL, ROW_FIELDS,
)
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError, UUID, HEX

INPUT_FIELDS = frozenset((
    "company_id", "task_id", "command_id", "attempt_id", "approval_digest",
))
TIMESTAMP_FIELDS = frozenset((
    "approval_expires_at", "link_expires_at", "receipt_consumed_at",
    "lease_started_at", "lease_expires_at",
))


def _clean_lookup(lookup: Any) -> dict[str, Any]:
    if not isinstance(lookup, dict) or set(lookup) != INPUT_FIELDS:
        raise BrokerAdmissionError("LINEAGE_LOOKUP_SHAPE_INVALID")
    if (lookup["company_id"] != "default"
            or type(lookup["task_id"]) is not int or lookup["task_id"] <= 139
            or any(not isinstance(lookup[k], str) or not UUID.fullmatch(lookup[k])
                   for k in ("command_id", "attempt_id"))
            or lookup["command_id"] == lookup["attempt_id"]
            or not isinstance(lookup["approval_digest"], str)
            or not HEX.fullmatch(lookup["approval_digest"])):
        raise BrokerAdmissionError("LINEAGE_LOOKUP_SCOPE_INVALID")
    return dict(lookup)


def normalize_row(row: Mapping[str, Any]) -> dict[str, Any]:
    """Normalize DB timestamptz to epoch milliseconds without local TZ drift."""
    if not isinstance(row, dict) or set(row) != ROW_FIELDS:
        raise BrokerAdmissionError("LINEAGE_DATABASE_ROW_INVALID")
    result = dict(row)
    for field in TIMESTAMP_FIELDS:
        value = result[field]
        if not isinstance(value, datetime) or value.tzinfo is None:
            raise BrokerAdmissionError("LINEAGE_TIMESTAMP_TZ_REQUIRED")
        delta = value.astimezone(timezone.utc) - datetime(1970, 1, 1, tzinfo=timezone.utc)
        result[field] = ((delta.days * 86400 + delta.seconds) * 1000
                         + delta.microseconds // 1000)
    return result


def read_lineage_once(connection: Any, lookup: Any) -> list[dict[str, Any]]:
    """Execute under a separately authenticated SELECT-only Postgres role.

    Connection must be a fresh dedicated reader session, not service_role or a
    signer/writer session. The owner service must enforce that identity and
    peer/certificate trust outside this function. Not an authorization receipt.
    """
    params = _clean_lookup(lookup)
    if getattr(connection, "autocommit", None) is not False:
        raise BrokerAdmissionError("READ_ONLY_TRANSACTION_REQUIRED")
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '1500ms'")
            cursor.execute(TRUSTED_LINEAGE_SQL, params)
            rows = cursor.fetchmany(3)
            names = tuple(col.name for col in cursor.description)
        connection.rollback()  # release read-only snapshot; never commit a write
    except Exception:
        connection.rollback()
        raise
    if len(rows) > 1 or len(names) != len(ROW_FIELDS) or set(names) != ROW_FIELDS:
        raise BrokerAdmissionError("LINEAGE_READBACK_CARDINALITY_INVALID")
    return [normalize_row(dict(zip(names, row))) for row in rows]
