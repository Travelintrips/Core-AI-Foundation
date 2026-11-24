#!/usr/bin/env python3
"""Gate-A durable lease snapshot reader, source-only/no database connection.

Consumes a trusted, authorized SQL callback, never a URL, token, password,
environment variable or source of authority. No SQL writes, no grants.
A future relock-only watchdog must pair this with its independent SQL
credential and the existing cst_onejob_stage_watchdog_candidate.check_once.
"""
from __future__ import annotations

from datetime import datetime, timezone
import re

from cst_onejob_preapproval_stage_broker import PROJECT

CLOCK_SQL = """SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')"""
LEASE_SQL = """SELECT project, nonce, source_sha,
                     to_char(issued_at AT TIME ZONE 'UTC',
                             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                     to_char(expires_at AT TIME ZONE 'UTC',
                             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                     to_char(heartbeat_at AT TIME ZONE 'UTC',
                             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                     state
              FROM ai_platform.cst_gatea_stage_leases
              WHERE project='xssrfshdrtdfupgqwfdw'"""

class StageLeaseReadDenied(RuntimeError):
    pass

_STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")

def _stamp(raw):
    if not isinstance(raw, str) or not _STAMP.fullmatch(raw):
        raise StageLeaseReadDenied("GATEA_LEASE_TIMESTAMP_INVALID")
    try:
        value=datetime.strptime(raw,"%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError:
        raise StageLeaseReadDenied("GATEA_LEASE_TIMESTAMP_INVALID") from None
    return value.replace(tzinfo=timezone.utc)

def _rows(query, statement):
    if not callable(query):
        raise StageLeaseReadDenied("GATEA_LEASE_READER_REQUIRED")
    rows=query(statement)
    if not isinstance(rows,list) or any(not isinstance(x,(tuple,list)) for x in rows):
        raise StageLeaseReadDenied("GATEA_LEASE_RESULT_INVALID")
    return rows

def read_database_utc_clock(query):
    """Use the database's real clock, not the worker host clock."""
    rows=_rows(query,CLOCK_SQL)
    if len(rows)!=1 or len(rows[0])!=1:
        raise StageLeaseReadDenied("GATEA_DATABASE_CLOCK_INVALID")
    return _stamp(rows[0][0])

def read_project_lease(query):
    """Exactly one project lease or None (missing -> watchdog relock)."""
    rows=_rows(query,LEASE_SQL)
    if not rows:
        return None
    if len(rows)!=1 or len(rows[0])!=7:
        raise StageLeaseReadDenied("GATEA_LEASE_CARDINALITY_DENIED")
    r=rows[0]
    if (r[0]!=PROJECT or not isinstance(r[1],str)
        or re.fullmatch(r"[0-9a-f]{32}",r[1]) is None
        or not isinstance(r[2],str)
        or re.fullmatch(r"[0-9a-f]{40}",r[2]) is None
        or r[6] not in ("ACTIVE","CLOSED")):
        raise StageLeaseReadDenied("GATEA_LEASE_SCOPE_DENIED")
    return {
        "project":r[0],"nonce":r[1],"sourceSha":r[2],
        "issuedAt":_stamp(r[3]),"expiresAt":_stamp(r[4]),
        "heartbeatAt":_stamp(r[5]),"state":r[6],
    }

if __name__ == "__main__":
    raise SystemExit("CST_GATEA_LEASE_READER_SOURCE_ONLY_NO_OPERATIONAL_ENTRYPOINT")