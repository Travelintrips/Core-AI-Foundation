#!/usr/bin/env python3
"""CST-DEV Gate-A independent, source-only JIT stage lease watchdog.

No CLI, credentials, network connection, systemd installation, or LOGIN grant.
An *independent* authorized admin session must supply:
  query(SQL) -> PostgreSQL rows;
  read_lease() -> exactly one durable active lease/heartbeat dict, or None;
  now -> trusted UTC time (must match DB clock in a real deployment).
This primitive cannot promise relock on host crash or lost DB connectivity;
an independent persistent runner, authorized DB credential and Supavisor
frontend teardown are still operational release blockers.
"""
from __future__ import annotations
from datetime import datetime, timezone
import re
from cst_onejob_stage_relock_controller import ROLE_QUERY, ACTIVE_QUERY, relock_once
from cst_onejob_preapproval_stage_broker import PROJECT

class WatchdogDenied(RuntimeError):
    pass

def _utc(v, label):
    if not isinstance(v,datetime) or v.tzinfo is None:
        raise WatchdogDenied("WATCHDOG_"+label+"_UTC_REQUIRED")
    return v.astimezone(timezone.utc)

def _row(query, sql, expected_len, label):
    rows=query(sql)
    if len(rows)!=1 or len(rows[0])!=expected_len:
        raise WatchdogDenied("WATCHDOG_"+label+"_INVALID")
    try:
        return tuple(int(v) for v in rows[0])
    except (TypeError,ValueError):
        raise WatchdogDenied("WATCHDOG_"+label+"_INVALID") from None

def check_once(query, read_lease, *, now, approved_source_sha, relock=relock_once):
    """Observe a stage session. Relock if lease is absent/stale or role drifts.

    A heartbeat beyond 15s is stale. The independent runner MUST repeat this
    check on its own timer after app/SIGKILL failure; this is only the policy.
    """
    t=_utc(now,"CLOCK")
    if (not isinstance(approved_source_sha,str) or
        re.fullmatch(r"[0-9a-f]{40}",approved_source_sha) is None):
        raise WatchdogDenied("WATCHDOG_PINNED_SOURCE_REQUIRED")
    role=_row(query,ROLE_QUERY,5,"ROLE")
    sessions=_row(query,ACTIVE_QUERY,1,"SESSIONS")[0]
    if sessions<0:
        raise WatchdogDenied("WATCHDOG_NEGATIVE_SESSION_COUNT")
    secure=(role[1:]==(0,0,0,1))
    if not secure:
        relock(query)
        raise WatchdogDenied("WATCHDOG_ROLE_SECURITY_DRIFT_CONTAINED")
    lease=read_lease()
    valid=False
    if isinstance(lease,dict) and set(lease)=={
        "project","nonce","sourceSha","issuedAt","expiresAt","heartbeatAt","state"}:
        try:
            issued=_utc(lease["issuedAt"],"ISSUED")
            expiry=_utc(lease["expiresAt"],"EXPIRES")
            heartbeat=_utc(lease["heartbeatAt"],"HEARTBEAT")
            valid=(lease["project"]==PROJECT
                and lease["sourceSha"]==approved_source_sha
                and isinstance(lease["nonce"],str)
                and re.fullmatch(r"[0-9a-f]{32}",lease["nonce"]) is not None
                and lease["state"]=="ACTIVE"
                and issued<=heartbeat<=t<expiry
                and 0<(expiry-issued).total_seconds()<=600
                and (t-heartbeat).total_seconds()<=15)
        except (WatchdogDenied,TypeError):
            valid=False
    if not valid:
        relock(query)
        return {"status":"RELOCKED_STALE_OR_ABSENT_LEASE",
                "roleLogin":False,"sessionCount":0,
                "releaseDecision":"NO_GO","operationalPermission":False}
    if role[0] not in (0,1):
        relock(query)
        raise WatchdogDenied("WATCHDOG_ROLE_LOGIN_FLAG_INVALID")
    if role[0]==0 and sessions!=0:
        relock(query)
        return {"status":"RELOCKED_ORPHANED_SESSION",
                "roleLogin":False,"sessionCount":0,
                "releaseDecision":"NO_GO","operationalPermission":False}
    if role[0]==1 and sessions>1:
        relock(query)
        raise WatchdogDenied("WATCHDOG_MULTIPLE_STAGE_SESSIONS_CONTAINED")
    return {"status":"LEASE_VALID_OBSERVATION_ONLY",
            "roleLogin":bool(role[0]),"sessionCount":sessions,
            "releaseDecision":"NO_GO","operationalPermission":False}

if __name__=="__main__":
    raise SystemExit("CST_ONEJOB_STAGE_WATCHDOG_SOURCE_ONLY_NO_OPERATIONAL_CLI")
