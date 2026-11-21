#!/usr/bin/env python3
"""Gate-A role relock primitive, import-only, CST-DEV source candidate.

No operational CLI, network, credential reads, timer, or LOGIN enablement.
The caller must be an independently authorized, narrowly privileged owner
of a trusted SQL connection.  This never creates roles or permits dispatch.
It is safe to call repeatedly after an interrupted or expired staging lease.
"""
from __future__ import annotations
import time

ROLE = "cst_team_model_pilot_stage_login"
ROLE_QUERY = """SELECT rolcanlogin::int,rolbypassrls::int,rolsuper::int,
                   rolinherit::int,rolconnlimit
                FROM pg_catalog.pg_roles
                WHERE rolname='cst_team_model_pilot_stage_login'"""
ACTIVE_QUERY = """SELECT count(*) FROM pg_catalog.pg_stat_activity
                  WHERE usename='cst_team_model_pilot_stage_login'
                    AND pid<>pg_backend_pid()"""
NOLOGIN_QUERY = "ALTER ROLE cst_team_model_pilot_stage_login NOLOGIN CONNECTION LIMIT 1"
TERMINATE_QUERY = """SELECT pg_catalog.pg_terminate_backend(pid)
                     FROM pg_catalog.pg_stat_activity
                     WHERE usename='cst_team_model_pilot_stage_login'
                       AND pid<>pg_backend_pid()"""

class RelockError(RuntimeError):
    pass

def _one(rows, label):
    if len(rows)!=1 or len(rows[0])!=5:
        raise RelockError("RELOCK_"+label+"_CATALOG_INVALID")
    try:
        return tuple(int(x) for x in rows[0])
    except (ValueError,TypeError):
        raise RelockError("RELOCK_"+label+"_CATALOG_INVALID")

def relock_once(query, *, pause=time.sleep, attempts=5):
    """Query callback must use independent administrative session.

    Errors never turn into PASS.  Confirm NOLOGIN before killing sessions,
    verify zero residual sessions, and check NOLOGIN after shutdown. No
    reliance on checking psql command exit code alone.  No secret exposure.
    """
    if attempts<1 or attempts>10:
        raise RelockError("RELOCK_INVALID_ATTEMPT_LIMIT")
    initial=_one(query(ROLE_QUERY),"PRE")
    # A privilege drift is a violation, but it must NOT prevent containment:
    # first disable authentication and terminate established role sessions,
    # then report the drift only after zero-session readback. Never mask it.
    scope_drift=initial[1:]!=(0,0,0,1)
    query(NOLOGIN_QUERY)
    post=_one(query(ROLE_QUERY),"POST_NOLOGIN")
    post_drift=post!=(0,0,0,0,1)
    for n in range(attempts):
        query(TERMINATE_QUERY)
        rows=query(ACTIVE_QUERY)
        if len(rows)!=1 or len(rows[0])!=1:
            raise RelockError("RELOCK_ACTIVITY_CATALOG_INVALID")
        try:
            remaining=int(rows[0][0])
        except (ValueError,TypeError):
            raise RelockError("RELOCK_ACTIVITY_CATALOG_INVALID")
        if remaining<0:
            raise RelockError("RELOCK_ACTIVITY_CATALOG_INVALID")
        if remaining==0:
            if _one(query(ROLE_QUERY),"FINAL")!=(0,0,0,0,1):
                raise RelockError("RELOCK_FINAL_ROLE_CHANGED")
            if scope_drift:
                raise RelockError("RELOCK_ROLE_SCOPE_DRIFT_AFTER_CONTAINMENT")
            if post_drift:
                raise RelockError("RELOCK_NOLOGIN_NOT_CONFIRMED_AFTER_CONTAINMENT")
            return {"status":"PASS","role":ROLE,"roleLogin":False,
                    "roleBypassRls":False,"roleConnLimit":1,
                    "residualRoleSessions":0,"operationalPermission":False}
        if n+1<attempts:
            pause(0.2)
    raise RelockError("RELOCK_RESIDUAL_SESSIONS")

def main():
    # No CLI that can connect to real Supabase or mutate a connected role.
    raise SystemExit("CST_STAGE_RELOCK_SOURCE_ONLY_NO_OPERATIONAL_ENTRYPOINT")

if __name__=="__main__":
    main()
