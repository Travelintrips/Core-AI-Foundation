#!/usr/bin/env python3
"""CST-DEV Gate-A JIT-login source candidate; no operational CLI or secrets.

Validates a separately authorized, short-lived technical permit with the
existing Gate-A verifier, then confines one stage action to a bounded LOGIN
lease. Always invokes the existing role relock controller on every return/
exception after an opening attempt. SIGKILL recovery requires a separately
approved privileged watchdog: absent that, operational deployment is NO-GO.

query: trusted, independently authorized administrative SQL callback.
reserve_nonce: externally authorized atomic durable one-use reservation callback.
acquire_single_flight: cross-process exclusive stage context from trusted runner.
stage_once: one permitted, bounded broker-session action; not a dispatch.
Neither callback is provided by this module. No DB/network access occurs
when imported or executed, and it cannot mint a permit or enable itself.
"""
from __future__ import annotations

from datetime import datetime, timezone
import re

from cst_onejob_preapproval_stage_broker import (
    PROJECT, read_signed_manifest, exact_timestamp,
)
from cst_onejob_stage_relock_controller import (
    ROLE, ROLE_QUERY, ACTIVE_QUERY, relock_once,
)
from cst_onejob_gatea_lease_reader import read_database_utc_clock

class JitStageDenied(RuntimeError):
    pass

def _one_int(query, statement, label):
    rows=query(statement)
    if len(rows)!=1 or len(rows[0])!=1:
        raise JitStageDenied("JIT_"+label+"_CATALOG_INVALID")
    try:
        return int(rows[0][0])
    except (TypeError, ValueError):
        raise JitStageDenied("JIT_"+label+"_CATALOG_INVALID") from None

def run_signed_one_stage(
    query, stage_once, *, reserve_nonce, acquire_single_flight,
    envelope_path, public_key_path, approved_public_pin,
    approved_source_sha, relock=relock_once,
):
    """Source-only, callable ONLY after separately provisioned approval and DB custody.

    The source does not connect to Supabase, read credentials, generate keys,
    install a service, or authorize a real Owner. A future operational runner
    must guarantee SIGKILL/host-crash relock independently AND provide an
    atomic durable nonce reservation across all launcher processes.
    """
    if (not isinstance(approved_source_sha,str)
        or re.fullmatch(r"[0-9a-f]{40}",approved_source_sha) is None):
        raise JitStageDenied("JIT_SOURCE_PIN_REQUIRED")
    if not callable(query):
        raise JitStageDenied("JIT_TRUSTED_DATABASE_QUERY_REQUIRED")
    if not callable(acquire_single_flight):
        raise JitStageDenied("JIT_INDEPENDENT_SINGLE_FLIGHT_LOCK_REQUIRED")
    # PostgreSQL UTC is authoritative for permit validation; never trust
    # an injected caller/host clock to open the stage role.
    current=read_database_utc_clock(query)
    # Existing strict Gate-A validation enforces Ed25519 signature, pinned
    # public root, project/role/Company 1, nonce, one-use technical scope.
    permit=read_signed_manifest(envelope_path,public_key_path,
                                approved_public_pin,now=current)
    if permit["sourceSha"]!=approved_source_sha or permit["project"]!=PROJECT:
        raise JitStageDenied("JIT_PINNED_SOURCE_OR_PROJECT_MISMATCH")
    lease_end=exact_timestamp(permit["expiresAt"])
    if not current < lease_end or not 0 < (lease_end-current).total_seconds() <= 600:
        raise JitStageDenied("JIT_LEASE_EXPIRED_OR_UNBOUNDED")
    # The lock MUST cover baseline, nonce consumption, LOGIN and forced relock
    # as one exclusive region. Different valid nonces are not sufficient to
    # prevent two concurrent launchers opening the same role.
    with acquire_single_flight():
        return _run_locked_one_stage(query,stage_once,reserve_nonce,
                                      permit,approved_source_sha,lease_end,relock)

def _run_locked_one_stage(query,stage_once,reserve_nonce,permit,approved_source_sha,lease_end,relock):
    # Re-read PostgreSQL time after acquiring the exclusive lock. The permit
    # may expire while lock acquisition or prior validation is in progress.
    current=read_database_utc_clock(query)
    remaining=(lease_end-current).total_seconds()
    if not 0 < remaining <= 600:
        raise JitStageDenied("JIT_LEASE_EXPIRED_OR_UNBOUNDED")
    existing_sessions=_one_int(query,ACTIVE_QUERY,"ACTIVE")
    role_state=query(ROLE_QUERY)
    baseline=role_state in ([[0,0,0,0,1]],[["0","0","0","0","1"]])
    if existing_sessions or not baseline:
        # A validated permit is NOT permission to reuse an old LOGIN or
        # orphan session. First contain it with the existing relock reader.
        # Never treat recovery of unsafe baseline as a successful new stage.
        relock(query)
        raise JitStageDenied("JIT_UNEXPECTED_LOGIN_OR_SESSIONS_CONTAINED")
    # A valid Ed25519 signature does not make a reusable manifest a one-shot
    # permit. Reserve its signed nonce atomically and DURABLY BEFORE LOGIN.
    # The caller must supply independent storage that rejects duplicates
    # across *all* worker processes. In-memory test stubs are QA ONLY.
    nonce=permit.get("nonce")
    if (not isinstance(nonce,str) or
        re.fullmatch(r"[0-9a-f]{32}",nonce) is None):
        raise JitStageDenied("JIT_SIGNED_NONCE_REQUIRED")
    if not callable(reserve_nonce):
        raise JitStageDenied("JIT_DURABLE_RESERVATION_REQUIRED")
    reserved=reserve_nonce(PROJECT,nonce,approved_source_sha,lease_end)
    if reserved is not True:
        raise JitStageDenied("JIT_NONCE_ALREADY_RESERVED_OR_DENIED")
    # Nonce consumption is permanent even if the permit expires while it is
    # being reserved. Re-read DB time immediately before attempting LOGIN.
    current=read_database_utc_clock(query)
    remaining=(lease_end-current).total_seconds()
    if not 0 < remaining <= 600:
        raise JitStageDenied("JIT_LEASE_EXPIRED_OR_UNBOUNDED")
    # UTC timestamp constructed solely from a parsed signed lease. No SQL
    # caller-controlled identifier or raw string enters the statement.
    until=lease_end.strftime("%Y-%m-%d %H:%M:%S+00")
    tried_open=False
    try:
        tried_open=True
        query("ALTER ROLE "+ROLE+" LOGIN VALID UNTIL '"+until+"'")
        if query(ROLE_QUERY) not in ([[1,0,0,0,1]],[["1","0","0","0","1"]]):
            raise JitStageDenied("JIT_ROLE_OPEN_READBACK_DENIED")
        stage_once()
    finally:
        if tried_open:
            # A failed relock is an error; never report GO if it fails.
            relock(query)
    return {"status":"SOURCE_ONLY_RELOCKED",
            "stageLogin":False,"releaseDecision":"NO_GO",
            "operationalPermission":False,"realE2ePass":False}

if __name__=="__main__":
    raise SystemExit("CST_STAGE_JIT_SOURCE_ONLY_NO_OPERATIONAL_ENTRYPOINT")
