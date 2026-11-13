#!/usr/bin/env python3
"""One supervised DEV Issue159 invocation: approval -> Hub/Core -> attestor -> issuer.

Reuse the existing signer units, root-owned approval evidence, independent
Hub/Core and Super Admin read-only sockets, and existing attestor RPC unit.
This does NOT provision credentials, create/refresh a task or approval,
or dispatch to DELL. It delegates issuer nonce/fence/lease operations only to
the separately reviewed, dedicated issuer one-shot service.

No timers, background jobs, retries, daemon, or restart of custody services.
Refuse until every dependency is ready so a 4-minute approval is not wasted.
"""
from __future__ import annotations

import fcntl
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time
from typing import Callable

# Reuse already-installed GPT02 DEV modules; no package installation or
# alternate trust implementation is permitted for this one-shot.
if "/opt/ai-coding-standalone-dev" not in sys.path:
    sys.path.insert(0, "/opt/ai-coding-standalone-dev")

from gpt02_issue159_signer_approval_guard import canonical_sha, persisted_approval_fresh
from gpt02_issue159_hub_core_signer_guard import require_hub_core_facts

APP_ROOT = Path("/opt/ai-coding-standalone-dev")
APPROVED = APP_ROOT / "gpt02_issue159_approved_claims.json"
LINK = APP_ROOT / "gpt02_issue159_hub_core_link_claims.json"
LINK_ASSEMBLER = Path("/root/gpt02-issue159-assemble-hub-core-link.py")
ATTESTOR_CRED = Path("/etc/credstore.encrypted/gpt02-issue159-attestor-dsn")
ISSUER_CRED = Path("/etc/credstore.encrypted/gpt02-issue159-issuer-dsn")
ISSUER_SIGNER_KEY = Path("/etc/credstore.encrypted/gpt02-issue159-issuer-private-key.pkcs8")
ISSUER_CLAIMS = APP_ROOT / "gpt02_issue159_issuer_claims.json"
ISSUER_SIGNATURE = Path("/run/gpt02-issue159-sign-once-issuer/issuer-signature.json")
LOCK = Path("/run/lock/gpt02-issue159-approved-chain.lock")
SIGNER_UNITS = (
    ("approval", "gpt02-issue159-sign-once-approval.service",
     Path("/run/gpt02-issue159-sign-once-approval/approval-signature.json")),
    ("hub", "gpt02-issue159-sign-once-operator@hub.service",
     Path("/run/gpt02-issue159-sign-once-hub/hub-signature.json")),
    ("core", "gpt02-issue159-sign-once-operator@core.service",
     Path("/run/gpt02-issue159-sign-once-core/core-signature.json")),
)
ATTESTOR_UNIT = "gpt02-issue159-attestor-record-once.service"
ISSUER_UNIT = "gpt02-issue159-issuer-finalize-once.service"
ISSUER_SIGNER_UNIT = "gpt02-issue159-sign-once-issuer.service"
MIN_PRE_SIGN_MS = 125_000
MIN_AFTER_LINK_MS = 55_000


class ChainDenied(RuntimeError):
    pass


def deny(code: str) -> None:
    raise ChainDenied(code)


def private_json(path: Path) -> dict:
    st = path.lstat()
    if (not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode)
            or st.st_uid != 0 or st.st_gid != 0
            or stat.S_IMODE(st.st_mode) != 0o600
            or not 8 <= st.st_size <= 12_000):
        deny("CHAIN_PRIVATE_EVIDENCE_INVALID")
    obj = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(obj, dict):
        deny("CHAIN_EVIDENCE_JSON_INVALID")
    return obj


def safe_service_state(unit: str, run: Callable) -> tuple[str, str]:
    def field(field_name: str) -> str:
        completed = run(
            ["systemctl", "show", unit, "-p", field_name, "--value"],
            timeout=4, capture_output=True, text=True, check=True,
        )
        return completed.stdout.strip()
    return field("ActiveState"), field("UnitFileState")


def preflight(run=subprocess.run, *, now_fn=lambda: int(time.time()*1000)) -> None:
    if os.geteuid()!=0 or os.environ.get("APP_ENV")!="development":
        deny("CHAIN_LOCAL_DEV_ROOT_ONLY")
    if os.environ.get("GPT02_ISSUE159_CHAIN_ONCE")!="explicit-supervised":
        deny("CHAIN_EXPLICIT_ONE_SHOT_AUTHORIZATION_REQUIRED")
    if (not ATTESTOR_CRED.is_file() or ATTESTOR_CRED.is_symlink()
            or ATTESTOR_CRED.stat().st_uid!=0
            or stat.S_IMODE(ATTESTOR_CRED.stat().st_mode)!=0o600):
        deny("CHAIN_ATTESTOR_SECRET_NOT_PREPARED")
    # Both isolated writer roles must be provisioned before any short-lived
    # approval is spent; never issue three signatures then stop at issuer.
    if (not ISSUER_CRED.is_file() or ISSUER_CRED.is_symlink()
            or ISSUER_CRED.stat().st_uid != 0
            or stat.S_IMODE(ISSUER_CRED.stat().st_mode) != 0o600):
        deny("CHAIN_ISSUER_SECRET_NOT_PREPARED")
    if (not ISSUER_SIGNER_KEY.is_file() or ISSUER_SIGNER_KEY.is_symlink()
            or ISSUER_SIGNER_KEY.stat().st_uid != 0
            or stat.S_IMODE(ISSUER_SIGNER_KEY.stat().st_mode) != 0o600):
        deny("CHAIN_ISSUER_SIGNER_KEY_NOT_PREPARED")
    if not LINK_ASSEMBLER.is_file() or LINK_ASSEMBLER.is_symlink():
        deny("CHAIN_EXISTING_OPERATOR_LINK_ASSEMBLER_REQUIRED")
    if LINK.exists() or LINK.is_symlink():
        deny("CHAIN_OPERATOR_LINK_ALREADY_EXISTS")
    if (ISSUER_CLAIMS.exists() or ISSUER_CLAIMS.is_symlink()
            or ISSUER_SIGNATURE.exists() or ISSUER_SIGNATURE.is_symlink()):
        deny("CHAIN_ISSUER_REPLAY_EVIDENCE_ALREADY_EXISTS")
    for _, _, output in SIGNER_UNITS:
        if output.exists() or output.is_symlink():
            deny("CHAIN_SIGNER_RECEIPT_ALREADY_EXISTS")
    for _, unit, _ in SIGNER_UNITS:
        state, setting=safe_service_state(unit,run)
        if state!="inactive" or setting!="static":
            deny("CHAIN_ONE_SHOT_SIGNER_UNIT_NOT_STANDBY")
    state, setting=safe_service_state(ATTESTOR_UNIT,run)
    if state!="inactive" or setting!="static":
        deny("CHAIN_ATTESTOR_UNIT_NOT_STANDBY")
    for unit in (ISSUER_UNIT, ISSUER_SIGNER_UNIT):
        state, setting=safe_service_state(unit,run)
        if state!="inactive" or setting!="static":
            deny("CHAIN_ISSUER_UNIT_NOT_STATIC_STANDBY")
    # Independent readers must already be active. Never start a service to
    # rescue a short-lived approval after signing has begun.
    for unit in ("gpt02-issue159-reader.service",
                 "gpt02-issue159-approval-reader.service",
                 "gpt02-issue159-verifier.service",
                 "gpt02-issue159-issuer-reader.service",
                 "gpt02-issue159-lineage-reader.service"):
        state, _setting=safe_service_state(unit,run)
        if state!="active":
            deny("CHAIN_TRUSTED_READER_NOT_READY")
    approval=private_json(APPROVED)
    if set(approval)!={"claims","claimsSha256"}:
        deny("CHAIN_APPROVAL_ENVELOPE_INVALID")
    claims=approval["claims"]
    if approval["claimsSha256"]!=canonical_sha(claims):
        deny("CHAIN_APPROVAL_DIGEST_INVALID")
    now=now_fn()
    if (type(claims.get("expiresAt")) is not int
            or claims["expiresAt"]-now < MIN_PRE_SIGN_MS):
        deny("CHAIN_ADMIN_APPROVAL_NOT_FRESH_ENOUGH")
    if persisted_approval_fresh(claims,now_ms=now)!=approval["claimsSha256"]:
        deny("CHAIN_PERSISTED_ADMIN_NOT_TRUSTED")


def require_link_and_time(*, now_fn=lambda: int(time.time()*1000)) -> None:
    approved=private_json(APPROVED)
    link=private_json(LINK)
    now=now_fn()
    if (type(link.get("expiresAt")) is not int
            or type(approved["claims"].get("expiresAt")) is not int
            or min(link["expiresAt"],approved["claims"]["expiresAt"])-now < MIN_AFTER_LINK_MS):
        deny("CHAIN_NOT_ENOUGH_TIME_FOR_THREE_SIGNATURES_AND_ATTESTOR")
    # This method authenticates both pre-existing trusted Unix sockets,
    # compares current Hub/Core database rows, and binds the stored approval.
    require_hub_core_facts("hub",link,approved["claims"],now_ms=now)


def execution_marks(unit: str, run=subprocess.run) -> dict[str, str]:
    fields=("ExecMainStartTimestampMonotonic", "ExecMainExitTimestampMonotonic",
            "ExecMainStatus", "Result", "ActiveState")
    output=run(["systemctl","show",unit,*[arg for field in fields
               for arg in ("-p",field)]], timeout=4,check=True,
               capture_output=True,text=True).stdout
    values=dict(line.split("=",1) for line in output.splitlines() if "=" in line)
    if set(values)!=set(fields):
        deny("CHAIN_ONE_SHOT_EXECUTION_MARKS_MISSING")
    return values


def start_once(unit: str, run=subprocess.run) -> None:
    state,setting=safe_service_state(unit,run)
    if state!="inactive" or setting!="static":
        deny("CHAIN_UNIT_NOT_STATIC_STANDBY")
    before=execution_marks(unit,run)
    start_before=before["ExecMainStartTimestampMonotonic"]
    if not start_before.isdigit():
        deny("CHAIN_ONE_SHOT_PREVIOUS_START_UNTRUSTED")
    run(["systemctl","start",unit],timeout=24,check=True,
        capture_output=True,text=True)
    after=execution_marks(unit,run)
    start_after=after["ExecMainStartTimestampMonotonic"]
    exit_after=after["ExecMainExitTimestampMonotonic"]
    # systemctl start can return 0 for a skipped ConditionPathExists unit.
    # A NEW monotonic execution timestamp proves ExecStart really ran.
    if (not start_after.isdigit() or not exit_after.isdigit()
            or int(start_after)<=int(start_before)
            or int(exit_after)<int(start_after)
            or after["Result"]!="success" or after["ExecMainStatus"]!="0"
            or after["ActiveState"]!="inactive"):
        deny("CHAIN_ONE_SHOT_NEW_EXECUTION_NOT_PROVEN")


def execute(run=subprocess.run) -> None:
    preflight(run)
    # Exclusive execution; no parallel reapproval/signature or replay.
    fd=os.open(LOCK,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        preflight(run)
        run(
            ["/usr/bin/python3","-B",str(LINK_ASSEMBLER)],
            timeout=15,check=True,capture_output=True,text=True,
        )
        require_link_and_time()
        for role,unit,output in SIGNER_UNITS:
            start_once(unit,run)
            if not output.is_file():
                deny("CHAIN_EXPECTED_SIGNER_EVIDENCE_ABSENT_"+role.upper())
        start_once(ATTESTOR_UNIT,run)
        # The existing finalizer independently rechecks the real Stage-A
        # verifier, issuer reader, receipt/fence lineage and dedicated DB role.
        # It must run directly after attestor, not from a timed worker.
        start_once(ISSUER_UNIT,run)
        print("GPT02_DEV_ATTESTOR_AND_ISSUER_LEASE_COMPLETED_NO_DISPATCH")
        print("dispatch_permitted",False)
    except BlockingIOError as exc:
        raise ChainDenied("CHAIN_CONCURRENT_OPERATION_DENIED") from exc
    finally:
        fcntl.flock(fd,fcntl.LOCK_UN)
        os.close(fd)


if __name__=="__main__":
    try:
        execute()
    except Exception as exc:
        print("GPT02_DEV_CHAIN_DENIED:",type(exc).__name__,file=sys.stderr)
        raise SystemExit(2)
