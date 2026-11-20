#!/usr/bin/env python3
"""Read-only GPT02 DEV approval prerequisite: independent relock watchdog.

This does not authenticate users, grant roles, execute SQL, start systemd, sign
or dispatch. It refuses to authorize a one-use approval unless the *existing*
relock timer has a recent successful, non-skipped service execution and a
private encrypted auditor credential is mounted on the DEV host.
"""
from __future__ import annotations

import os
from pathlib import Path
import stat
import subprocess
import time

CREDENTIAL = Path("/etc/credstore.encrypted/gpt02-issue159-relock-catalog-dsn")
TIMER = "gpt02-issue159-relock-catalog-auditor.timer"
SERVICE = "gpt02-issue159-relock-catalog-auditor.service"
MAX_CREDENTIAL_BYTES = 16384
MAX_SUCCESS_AGE_US = 20_000_000


def _show(unit, fields, runner):
    args = ["systemctl", "show", unit]
    for field in fields:
        args.extend(("-p", field))
    args.append("--no-pager")
    result = runner(args, capture_output=True, text=True, timeout=3)
    if result.returncode != 0 or type(result.stdout) is not str:
        return None
    properties = {}
    for line in result.stdout.splitlines():
        if line.count("=") != 1:
            return None
        key, value = line.split("=", 1)
        if key not in fields or key in properties:
            return None
        properties[key] = value
    return properties if set(properties) == set(fields) else None


def independent_relock_supervisor_ready(
    *, credential=CREDENTIAL, runner=None, statter=None, clock_us=None
):
    """Fail closed on disabled/skipped/stale watchdog; never enable it here."""
    if runner is None:
        runner = subprocess.run
    if statter is None:
        statter = os.lstat
    if clock_us is None:
        clock_us = time.monotonic_ns() // 1000
    try:
        metadata = statter(credential)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != 0 or metadata.st_gid != 0
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or metadata.st_nlink != 1
            or not 0 < metadata.st_size <= MAX_CREDENTIAL_BYTES
            or type(clock_us) is not int or clock_us <= 0
        ):
            return False

        timer = _show(
            TIMER, ("LoadState", "UnitFileState", "ActiveState"), runner
        )
        if timer != {
            "LoadState": "loaded",
            "UnitFileState": "enabled",
            "ActiveState": "active",
        }:
            return False

        service = _show(
            SERVICE, (
                "LoadState", "ConditionResult", "Result", "ExecMainStatus",
                "ActiveState", "ExecMainStartTimestampMonotonic",
                "ExecMainExitTimestampMonotonic",
            ), runner
        )
        if not service:
            return False
        for key, value in {
            "LoadState": "loaded",
            "ConditionResult": "yes",
            "Result": "success",
            "ExecMainStatus": "0",
            "ActiveState": "inactive",
        }.items():
            if service.get(key) != value:
                return False
        start = int(service["ExecMainStartTimestampMonotonic"])
        end = int(service["ExecMainExitTimestampMonotonic"])
        return 0 < start <= end <= clock_us and (
            clock_us - end <= MAX_SUCCESS_AGE_US
        )
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        return False
