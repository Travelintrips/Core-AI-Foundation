"""Strict CDP rescue for incomplete read-only OpenClaw tab inventory.
Only use after Chrome PID + exact managed user-data directory + CDP port are verified.
Never select between duplicate tabs or change an already pinned reader target.
"""
import re
RAW=re.compile(r"^[A-Fa-f0-9]{32}$")

def unique_bound_target(rows, expected_url):
    if not isinstance(rows, list) or not 1 <= len(rows) <= 256:
        return None
    ids=[]
    matches=[]
    for tab in rows:
        if not isinstance(tab,dict):
            return None
        tid=tab.get('targetId')
        if not isinstance(tid,str) or not RAW.fullmatch(tid):
            return None
        ids.append(tid.lower())
        if tab.get('type')=='page' and tab.get('url')==expected_url:
            matches.append(tid)
    if len(set(ids)) != len(ids) or len(matches)!=1:
        return None
    return matches[0]
