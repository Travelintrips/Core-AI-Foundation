#!/usr/bin/env python3
"""Read-only CST-DEV GPT02 relock executor readiness gate.

Never executes systemctl actions, opens database credentials or authorizes work.
This deliberately distinguishes the historic signed one-read service from the
Owner-approved GPT02_RELOCK_CST_DEV database relock operations.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess

SCOPE = "GPT02_RELOCK_CST_DEV"
PROJECT = "xssrfshdrtdfupgqwfdw"
HOST = "srv1792369"
EXPECTED_OPERATIONS = (
    "DISABLE_ISSUE159_TIMER",
    "SET_EVIDENCE_ROLES_NOLOGIN_LIMIT0_PASSWORD_NULL",
    "SET_AUDITOR_NOLOGIN_LIMIT0_PRESERVE_PASSWORD",
)
TIMER = "gpt02-issue159-relock-catalog-auditor.timer"
AUDITOR = "gpt02-issue159-relock-catalog-auditor.service"
ONE_READ = "gpt02-issue159-one-shot-native@.service"
NO_GO = "NO_GO"


def evaluate(snapshot):
    """Pure, fail-closed evaluation of a *read-only* evidence snapshot."""
    if not isinstance(snapshot, dict):
        raise ValueError("snapshot must be a JSON object")
    failures = []
    def require(condition, reason):
        if not condition:
            failures.append(reason)

    require(snapshot.get("scope") == SCOPE, "SCOPE_MISMATCH")
    require(snapshot.get("projectId") == PROJECT, "PROJECT_MISMATCH")
    require(snapshot.get("hostId") == HOST, "HOST_MISMATCH")
    # This gate must never accept a bare user-supplied approval flag as proof.
    require(snapshot.get("ledgerVerifiedByTrustedReader") is True,
            "TRUSTED_LEDGER_READBACK_REQUIRED")
    require(snapshot.get("approvalDecision") == "APPROVED",
            "OWNER_APPROVAL_NOT_VERIFIED")
    require(snapshot.get("challengeStatus") == "CONSUMED",
            "CHALLENGE_NOT_CONSUMED")
    require(snapshot.get("decisionCount") == 1,
            "EXACTLY_ONE_OWNER_DECISION_REQUIRED")
    require(snapshot.get("consumedCount") == 1,
            "EXACTLY_ONE_CONSUMED_CHALLENGE_REQUIRED")
    require(tuple(snapshot.get("manifestOperations", ())) == EXPECTED_OPERATIONS,
            "MANIFEST_OPERATIONS_MISMATCH")
    timer = snapshot.get("relockTimer") or {}
    require(timer.get("active") == "inactive", "RELOCK_TIMER_ACTIVE")
    require(timer.get("unitFile") in ("disabled", "masked"),
            "RELOCK_TIMER_NOT_DISABLED_OR_MASKED")
    service = snapshot.get("relockService") or {}
    require(service.get("mainPid") == 0, "RELOCK_SERVICE_STILL_RUNNING")
    require(service.get("active") == "inactive", "RELOCK_SERVICE_NOT_CLEAN")
    require(snapshot.get("canonicalExecutorInstalled") is True,
            "CANONICAL_RELOCK_EXECUTOR_NOT_INSTALLED")
    require(snapshot.get("oneShotServiceKind") == "RELOCK_ONLY",
            "HISTORIC_SIGNED_ONE_READ_IS_NOT_RELOCK_EXECUTOR")
    require(snapshot.get("exactOwnerDigestBound") is True,
            "ONE_SHOT_DIGEST_BINDING_MISSING")
    require(snapshot.get("oneUseNonceVerified") is True,
            "ONE_USE_NONCE_UNVERIFIED")
    require(snapshot.get("encryptedCustodyReady") is True,
            "ENCRYPTED_CUSTODY_NOT_READY")
    require(snapshot.get("separateExecutorAuthorization") is True,
            "EXECUTOR_AUTHORIZATION_REQUIRED")
    require(snapshot.get("signingEnabled") is False and
            snapshot.get("dispatchEnabled") is False,
            "SIGNING_OR_DISPATCH_MUST_REMAIN_OFF")

    # This is a readiness/QA gate, never an executor and never a permit.
    return {
        "scope": SCOPE,
        "environment": "CST-DEV",
        "readOnly": True,
        "authorizationGranted": False,
        "executionPermitted": False,
        "signingPermitted": False,
        "dispatchPermitted": False,
        "releaseDecision": NO_GO,
        "preflightPass": len(failures) == 0,
        "blockingReasons": sorted(set(failures)),
    }


def systemd_fields(name):
    try:
        p = subprocess.run(
            ["systemctl", "show", name, "--no-pager", "-p", "ActiveState",
             "-p", "UnitFileState", "-p", "MainPID"],
            check=False, capture_output=True, text=True, timeout=6,
        )
        if p.returncode != 0:
            return {}
        fields = dict(line.split("=", 1) for line in p.stdout.splitlines()
                      if "=" in line)
        return {
            "active": fields.get("ActiveState", "unknown"),
            "unitFile": fields.get("UnitFileState", "unknown"),
            "mainPid": int(fields.get("MainPID", "-1")),
        }
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {}


def live_snapshot():
    # Only OS metadata. Neither the ledger nor encrypted credentials are read.
    timer = systemd_fields(TIMER)
    service = systemd_fields(AUDITOR)
    try:
        host = subprocess.run(["hostname", "-s"], check=True,
                              capture_output=True, text=True, timeout=3).stdout.strip()
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        host = None
    # Deliberately NOT infer readiness from source files or historic one-read
    # systemd template. Canonical relock-only executor has not been verified.
    return {
        "scope": SCOPE, "projectId": PROJECT, "hostId": host,
        "relockTimer": timer, "relockService": service,
        "ledgerVerifiedByTrustedReader": False,
        "oneShotServiceKind": "SIGNED_ONE_READ_REVIEW",
        "canonicalExecutorInstalled": False,
        "encryptedCustodyReady": False, "exactOwnerDigestBound": False,
        "oneUseNonceVerified": False, "separateExecutorAuthorization": False,
        "signingEnabled": False, "dispatchEnabled": False,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", type=Path, help="offline QA fixture JSON")
    args = parser.parse_args()
    if args.snapshot:
        # Fixtures are *not* trusted live evidence. Only offline tests may pass.
        if os.environ.get("GPT02_PREFLIGHT_OFFLINE_TEST") != "true":
            raise SystemExit("offline fixture mode requires explicit QA environment")
        snapshot = json.loads(args.snapshot.read_text())
    else:
        snapshot = live_snapshot()
    result = evaluate(snapshot)
    print(json.dumps(result, sort_keys=True))
    return 0 if result["preflightPass"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
