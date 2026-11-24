"""Issue 238 disposable-only QA execution handoff; NOT deployed.

Requires authenticated AI Core work identity, an authorized custodian public
key and signed permit, root-owned reviewed sources and a trusted local Docker
inspection. No listener, daemon, privileged socket or signer is installed.
"""
import hashlib
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from issue238_qa_integrity import QA_MANIFEST
from issue238_qa_ledger import finish
from issue238_qa_permit import PermitDenied, APPROVED_SQL_SHA256
from issue238_qa_preflight import AuthenticatedWork, prepare_qa

# Only a trusted privileged executor may invoke this module. It does not
# authenticate sockets, supply a signer, mint permits or manage Docker access.
BASH = "/usr/bin/bash"
ENV_ALLOW = frozenset(("PATH", "LANG", "LC_ALL"))
TIMEOUT_SECONDS = 240


@dataclass(frozen=True)
class TerminalReceipt:
    command_id: str
    job_id: str
    state: str
    exit_code: int
    output_digest: str


def run_approved_qa(*, identity: AuthenticatedWork, envelope: dict,
                    public_key, source_root: Path, ledger_path: Path,
                    image_inspection, authenticated_executor: bool,
                    command_runner=None):
    """Run exactly one approved QA fixture, fail closed before execution.

    The caller must authenticate the actor, key custodian, docker metadata,
    and isolation of the executor, independent of JSON claims. No hosted
    database credentials or general shell arguments are accepted.
    """
    if authenticated_executor is not True:
        raise PermitDenied("trusted_executor_required")
    # No real execution path may be selected from an untrusted Boolean.
    # A future audited adapter must supply the isolated runner explicitly.
    if command_runner is None:
        raise PermitDenied("trusted_command_runner_required")
    if not callable(command_runner):
        raise PermitDenied("invalid_command_runner")
    prepared = prepare_qa(
        identity=identity, envelope=envelope,
        custodian_public_key=public_key,
        source_root=source_root, ledger_path=ledger_path,
        trusted_image_inspection=image_inspection,
    )
    script = source_root / prepared.script_name
    # Recheck source and file before running; the installed runner still
    # requires a trusted immutable snapshot/launch boundary.
    if script.is_symlink() or not script.is_file() or (
        hashlib.sha256(script.read_bytes()).hexdigest()
        != QA_MANIFEST[prepared.script_name]
    ):
        raise PermitDenied("source_changed_after_reservation")
    env = {k: v for k, v in os.environ.items() if k in ENV_ALLOW}
    env["PATH"] = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    # Never mint QA custodian approval in this module. This draft intentionally
    # cannot satisfy the fixture approval gate on its own.
    env.pop("ISSUE238_DBA_DISPOSABLE_QA_APPROVED", None)
    env["ISSUE238_APPROVED_SQL_SHA256"] = APPROVED_SQL_SHA256
    try:
        result = command_runner(
            [BASH, str(script)], cwd=str(source_root), env=env,
            shell=False, capture_output=True, text=True,
            timeout=TIMEOUT_SECONDS, check=False,
        )
        state = "PASS" if result.returncode == 0 else "FAIL"
        code = result.returncode
        # Persistent receipts keep only digest of bounded text for audit;
        # raw stderr/stdout must not be forwarded to a public channel.
        output_digest = hashlib.sha256(
            (result.stdout[:8192] + "\n" + result.stderr[:2048]).encode()
        ).hexdigest()
    except (OSError, subprocess.TimeoutExpired):
        state = "UNKNOWN"
        code = -1
        output_digest = hashlib.sha256(b"execution_unknown").hexdigest()
    finish(ledger_path, nonce=prepared.nonce, command_id=prepared.command_id,
           receipt_digest=output_digest, state=state)
    return TerminalReceipt(prepared.command_id, prepared.job_id, state,
                           code, output_digest)
