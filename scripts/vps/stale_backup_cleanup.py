#!/usr/bin/env python3
"""Prune old one-off AI Task/analyzer backup containers, never volumes.

Defaults to dry run. Only historical names are allowed; all running containers
and all named Docker volumes must be unchanged afterwards.
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

NAME = re.compile(
    r"^(ai-core-repository-analyzer-vps-(pre.*|before.*|backup.*|pr[0-9]+.*)"
    r"|ai-task-(bridge-dev.*|dev-hostnet|development|dev-pr[0-9]+-backup.*))$"
)
REQUIRED = ("core-ai-dev", "ai-core-prod-api", "ai-task-production",
            "ai-task-dev-pr49-hostnet", "ai-core-repository-analyzer-vps",
            "cst-wa-gateway-api-1", "ai-core-workers-openclaw-1")
MIN_AGE = 72 * 3600

def docker(*args):
    p = subprocess.run(("docker",) + args, capture_output=True,
                       text=True, timeout=60, check=True)
    return p.stdout.strip()

def containers():
    ids = docker("ps", "-aq").split()
    return json.loads(docker("container", "inspect", *ids)) if ids else []

def volumes():
    return set(docker("volume", "ls", "-q").splitlines())

def guard(cs):
    by_name = {x["Name"].lstrip("/"): x for x in cs}
    for name in REQUIRED:
        c = by_name.get(name)
        if not c or not c["State"]["Running"]:
            raise RuntimeError("Required service not running: " + name)
        if (c["State"].get("Health") or {}).get("Status") != "healthy":
            raise RuntimeError("Required service not healthy: " + name)
    for port in (18082, 18088):
        with urllib.request.urlopen("http://127.0.0.1:%d/api/healthz" % port, timeout=8) as response:
            result = json.load(response)
            if response.status != 200 or result.get("status") != "ok":
                raise RuntimeError("Application health failed")
    return {x["Name"]: (x["Id"], x["Image"]) for x in cs if x["State"]["Running"]}

def has_volume(c):
    if any(m.get("Type") == "volume" for m in c.get("Mounts") or []):
        return True
    hc = c.get("HostConfig") or {}
    if any(m.get("Type") == "volume" for m in hc.get("Mounts") or []):
        return True
    return any(not str(b).split(":", 1)[0].startswith("/")
               for b in hc.get("Binds") or [])

def eligible(c, now):
    if c["State"]["Running"] or not NAME.fullmatch(c["Name"].lstrip("/")):
        return False
    if has_volume(c):
        return False
    end = c["State"].get("FinishedAt", "")
    if not end or end.startswith("0001-"):
        return False
    timestamp = datetime.datetime.fromisoformat(end.replace("Z", "+00:00")).timestamp()
    return now - timestamp >= MIN_AGE

def main(apply):
    before = containers()
    fingerprint = guard(before)
    volume_names = volumes()
    old = sorted((c for c in before if eligible(c, time.time())),
                 key=lambda c: c["Name"])[:20]
    print("HISTORICAL_BACKUP_PLAN=%d apply=%s" % (len(old), apply), flush=True)
    deleted = []
    for c in old:
        if not apply:
            print("WOULD_REMOVE " + c["Name"].lstrip("/"))
            continue
        if guard(containers()) != fingerprint:
            raise RuntimeError("Running service changed, abort")
        check = json.loads(docker("container", "inspect", c["Id"]))[0]
        if check["Id"] != c["Id"] or not eligible(check, time.time()):
            continue
        docker("container", "rm", c["Id"])
        deleted.append(c["Name"].lstrip("/"))
        print("REMOVED_HISTORICAL_BACKUP " + c["Name"].lstrip("/"), flush=True)
    if guard(containers()) != fingerprint or volumes() != volume_names:
        raise RuntimeError("Running service or Docker volume set changed")
    print("HISTORICAL_BACKUP_RESULT removed=%d running_unchanged=PASS volumes_unchanged=PASS" %
          len(deleted), flush=True)

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true")
    args = p.parse_args()
    try:
        main(args.apply)
    except Exception as exc:
        print("HISTORICAL_BACKUP_BLOCKED " + type(exc).__name__ + ": " + str(exc), file=sys.stderr)
        sys.exit(2)
