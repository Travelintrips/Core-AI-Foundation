#!/usr/bin/env python3
"""GPT02-1782 CST-DEV: source-only timing budget for PRIMARY restore timer.

On systemd 255 the default AccuracySec is one minute. The historical guard
used an unpinned 90s delay and could not meet the modeled 90s deadline.
The installed PR1855 guard instead requests 30s, 1s accuracy and zero random
delay; this checker verifies only the source timing contract, not live closure.
No timers, Nginx, PostgreSQL roles or files are changed by this checker.
Theoretical budget PASS is NEVER live readiness or Owner authority.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys

from gpt02_1782_close_only_fallback import GUARD, GUARD_SHA, read_root_file

DEFAULT_SYSTEMD_ACCURACY_S = 60
WINDOW_LIMIT_S = 90
# The guard's subprocess timeouts are 20s each, then 7s for HTTPS verify.
RECOVERY_TEST_TIMEOUT_S = 20
RECOVERY_RELOAD_TIMEOUT_S = 20
RECOVERY_HTTPS_TIMEOUT_S = 7
# A model-level slack allowance, NOT a real-time scheduler guarantee.
SAFETY_MODEL_SLACK_S = 6
REVIEW_PRIMARY_DELAY_S = 30
REVIEW_PRIMARY_ACCURACY_S = 1


def proposed_budget(*, delay_s: int, accuracy_s: int,
                    randomized_delay_s: int = 0,
                    test_s: int = RECOVERY_TEST_TIMEOUT_S,
                    reload_s: int = RECOVERY_RELOAD_TIMEOUT_S,
                    https_s: int = RECOVERY_HTTPS_TIMEOUT_S,
                    slack_s: int = SAFETY_MODEL_SLACK_S) -> dict:
    """Pure integer timing envelope, not a guarantee of scheduling/execution."""
    values = (delay_s, accuracy_s, randomized_delay_s, test_s,
              reload_s, https_s, slack_s)
    safe_inputs = all(type(v) is int and v >= 0 for v in values)
    projected = sum(values) if safe_inputs else None
    accepted = (
        safe_inputs and delay_s >= 1 and 0 < accuracy_s <= 1
        and randomized_delay_s == 0
        and projected is not None and projected <= WINDOW_LIMIT_S
    )
    return {
        "projected_upper_s": projected,
        "model_within_90s": bool(accepted),
        "actual_timer_armed_or_verified": False,
        "host_scheduler_deadline_guaranteed": False,
        "owner_e2e_authorized": False,
        "live_e2e_ready": False,
        "action": "RETAIN_NGINX_503",
    }


def review_existing_guard_source(source: bytes) -> dict:
    """Recognize historical unsafe source and the exact PR1855 timing contract.

    The caller audits the exact pinned SHA before calling this pure reviewer.
    Recognition of a fixture alone never constitutes a trusted host audit.
    """
    common = (
        b'str(delay_seconds) + "s"' in source
        and b'"systemd-run"' in source
        and b'"--on-active="' in source
    )
    legacy = common and (
        b'parser.add_argument("--delay-seconds", type=int, default=90)' in source
    )
    declarations = (
        b'PRIMARY_RESTORE_DELAY_SECONDS = 30',
        b'PRIMARY_TIMER_ACCURACY = "1s"',
        b'PRIMARY_TIMER_RANDOMIZED_DELAY = "0"',
    )
    current = common and not legacy and all(
        source.splitlines().count(line) == 1 for line in declarations
    ) and all(fragment in source for fragment in (
        b'if delay_seconds != PRIMARY_RESTORE_DELAY_SECONDS:',
        b'"--timer-property=AccuracySec=" + PRIMARY_TIMER_ACCURACY',
        b'"--timer-property=RandomizedDelaySec=" + PRIMARY_TIMER_RANDOMIZED_DELAY',
        b'parser.add_argument("--delay-seconds", type=int, default=PRIMARY_RESTORE_DELAY_SECONDS)',
        b'verify_armed_timer_properties(unit)',
        b'"AccuracyUSec": PRIMARY_TIMER_ACCURACY',
        b'"RandomizedDelayUSec": PRIMARY_TIMER_RANDOMIZED_DELAY',
        b'"ActiveState": "active"',
    ))
    shape = bool(legacy or current)
    explicit_accuracy = b"--timer-property=AccuracySec=" in source
    explicit_random = b"--timer-property=RandomizedDelaySec=" in source
    delay = 30 if current else 90 if legacy else None
    accuracy = REVIEW_PRIMARY_ACCURACY_S if current else DEFAULT_SYSTEMD_ACCURACY_S
    # The historical 90s variant is unsafe even with explicit 1s accuracy.
    if legacy and b"--timer-property=AccuracySec=1s" in source:
        accuracy = 1
    model = proposed_budget(
        delay_s=delay,
        accuracy_s=accuracy,
        randomized_delay_s=0,
    )
    proposed = proposed_budget(
        delay_s=REVIEW_PRIMARY_DELAY_S,
        accuracy_s=REVIEW_PRIMARY_ACCURACY_S,
    )
    return {
        "primary_guard_recognized": shape,
        "pr1855_timer_contract_recognized": bool(current),
        "accuracy_explicit_in_installed_guard": explicit_accuracy,
        "randomization_explicit_in_installed_guard": explicit_random,
        "default_accuracy_s": DEFAULT_SYSTEMD_ACCURACY_S,
        "primary_guard_requested_delay_s": delay,
        "existing_guard_model": model,
        "early_restore_model_example": proposed,
        "requires_primary_guard_fix": not (current and model["model_within_90s"]),
        "max_90s_live_close_verified": False,
        "owner_e2e_ready": False,
        "action": "RETAIN_NGINX_503",
    }


def audit() -> dict:
    import hashlib
    source = read_root_file(GUARD, 0o700, 20_000)
    if hashlib.sha256(source).hexdigest() != GUARD_SHA:
        raise ValueError("GUARD_SHA_DRIFT")
    return review_existing_guard_source(source)


def main() -> int:
    if os.geteuid() != 0 or os.getegid() != 0 or sys.argv[1:] != ["--check"]:
        print('{"readiness":"BLOCKED","action":"RETAIN_NGINX_503"}')
        return 2
    try:
        result = audit()
        print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    except Exception:
        print('{"readiness":"BLOCKED","action":"RETAIN_NGINX_503"}')
    return 2  # NO timer arming, no live authorizing mode


if __name__ == "__main__":
    raise SystemExit(main())
