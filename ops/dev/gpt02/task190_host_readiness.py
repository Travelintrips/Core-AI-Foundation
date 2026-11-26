#!/usr/bin/env python3
"""Read-only, fail-closed Task190 CST-DEV host readiness report.

Checks presence and service state only. It never reads credential contents,
connects to PostgreSQL, creates a socket, signs, dispatches, or activates a unit.
"""
from __future__ import annotations
import datetime as dt
import json
import pathlib
import subprocess
import sys
from dataclasses import dataclass

BROKER_UNIT = "gpt02-task190-execution-broker.service"
BROKER_SOCKET = pathlib.Path("/run/gpt02-dev-approval/broker.sock")
GATE_SOCKET = pathlib.Path("/run/gpt02-task190-execution-gate/gate.sock")
PREPARER = pathlib.Path("/etc/credstore.encrypted/gpt02-task190-preparer")
WORKER_PROOF = pathlib.Path("/run/credentials/gpt02-reader-custody/worker-attestation.json")
DBA_RECEIPT = pathlib.Path("/run/credentials/gpt02-reader-custody/issuer-receipt.json")
EXPECTED_PROJECT = "xssrfshdrtdfupgqwfdw"
EXPECTED_CREDENTIAL = "a9d7fcb7-aa47-4765-8e39-a97da8bfe7f3"


@dataclass(frozen=True)
class Snapshot:
    broker_active: bool
    broker_socket: bool
    gate_socket: bool
    preparer_present: bool
    worker_proof_present: bool
    worker_proof_current: bool
    dba_receipt_present: bool
    errors: tuple[str, ...] = ()


def evaluate(snapshot: Snapshot) -> dict:
    checks = {
        "broker_service_active": snapshot.broker_active,
        "broker_socket_present": snapshot.broker_socket,
        "execution_gate_socket_present": snapshot.gate_socket,
        "sealed_preparer_present": snapshot.preparer_present,
        "signed_worker_proof_present": snapshot.worker_proof_present,
        "worker_proof_not_expired": snapshot.worker_proof_current,
        "dba_receipt_present": snapshot.dba_receipt_present,
    }
    return {
        "environment": "CST-DEV",
        "purpose": "TASK190_HOST_READ_ONLY_READINESS",
        "checks": checks,
        "blockers": [k.upper() for k, passed in checks.items() if not passed] + list(snapshot.errors),
        "operationalE2ePass": False,
        "canDispatch": False,
        "canSign": False,
        "credentialsRead": False,
        "dbQueried": False,
        "unitsModified": False,
        "gateStarted": False,
    }


def systemctl_active(unit: str) -> bool:
    response = subprocess.run(["systemctl", "is-active", unit], text=True,
                              capture_output=True, timeout=5, check=False)
    return response.returncode == 0 and response.stdout.strip() == "active"


def proof_is_current(path: pathlib.Path, now_ms: int) -> bool:
    try:
        # The proof is a PUBLIC signed envelope. This check only tests scope,
        # binding metadata and expiration. It does NOT validate its signature.
        # A separate pinned-key verification is required for any operation.
        if not path.is_file() or path.stat().st_size > 8192:
            return False
        document = json.loads(path.read_text(encoding="utf-8"))
        receipt = document["receipt"]
        return (receipt.get("project") == EXPECTED_PROJECT
                and receipt.get("credentialId") == EXPECTED_CREDENTIAL
                and receipt.get("audience") == "CST-DEV/GPT02/READER-CUSTODY/WORKER-ATTESTATION/v2"
                and type(receipt.get("notBefore")) is int
                and type(receipt.get("expiresAt")) is int
                and receipt["notBefore"] <= now_ms < receipt["expiresAt"]
                and isinstance(document.get("signature"), str)
                and len(document["signature"]) > 50)
    except (OSError, ValueError, TypeError, KeyError, UnicodeError):
        return False


def collect() -> Snapshot:
    now_ms = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)
    return Snapshot(
        broker_active=systemctl_active(BROKER_UNIT),
        broker_socket=BROKER_SOCKET.is_socket(),
        gate_socket=GATE_SOCKET.is_socket(),
        preparer_present=PREPARER.is_file(),
        worker_proof_present=WORKER_PROOF.is_file(),
        worker_proof_current=proof_is_current(WORKER_PROOF, now_ms),
        dba_receipt_present=DBA_RECEIPT.is_file(),
    )


def main() -> int:
    if sys.platform != "linux":
        print(json.dumps({"purpose": "TASK190_HOST_READ_ONLY_READINESS",
                          "blockers": ["UNSUPPORTED_HOST"], "canDispatch": False}))
        return 2
    try:
        report = evaluate(collect())
    except (OSError, subprocess.SubprocessError):
        report = evaluate(Snapshot(False, False, False, False, False, False, False,
                                   ("HOST_PREFLIGHT_UNAVAILABLE",)))
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0 if not report["blockers"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
