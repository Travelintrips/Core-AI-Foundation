"""Issue #238 disposable QA execution adapter -- NOT deployed or externally callable.

The caller must be a separately authorized, authenticated, isolated custodian
runner. This module does not open a network endpoint, provision signing keys,
grant Docker access, or schedule work. Never attach it to a public API.
"""
import hashlib
import os
import subprocess
import tempfile
from pathlib import Path

from issue238_qa_integrity import QA_MANIFEST, verify_source_manifest, verify_image_metadata
from issue238_qa_ledger import finish, status
from issue238_qa_permit import APPROVED_SQL_SHA256, PermitDenied

# Exact Docker runs occur INSIDE the previously reviewed scripts; the caller
# must ensure the Docker engine cannot be changed by untrusted principals.
SAFE_ENV = {
    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "HOME": "/nonexistent",
    "LANG": "C",
    "LC_ALL": "C",
    # The executor is NOT the approving DBA custodian; never self-authorize QA.
    # Existing fixtures will refuse execution with exit 73 until a separately
    # reviewed, authenticated launch protocol supplies legitimate approval.
    "ISSUE238_APPROVED_SQL_SHA256": APPROVED_SQL_SHA256,
}


def _snapshot(source_dir: Path, private_dir: Path):
    """Snapshot all approved source files into a private, non-writable tree."""
    staging = private_dir / "verified"
    staging.mkdir(mode=0o700)
    for filename, expected_sha in QA_MANIFEST.items():
        source = source_dir / filename
        target = staging / filename
        # The independent preflight runs first. Validate each copied byte too.
        contents = source.read_bytes()
        if hashlib.sha256(contents).hexdigest() != expected_sha:
            raise PermitDenied("snapshot_changed_" + filename)
        with target.open("xb") as output:
            output.write(contents)
            output.flush()
            os.fsync(output.fileno())
        target.chmod(0o400)
    verify_source_manifest(staging, expected_owner_uid=os.getuid())
    return staging


def execute_reserved_qa(prepared, *, ledger_path: Path, source_root: Path,
                        trusted_image_inspection, run_process=subprocess.run,
                        max_seconds: int = 360):
    """Execute one already-authorized RESERVED command in a trusted host runner.

    Restricted to a preflight result object. Runner must separately establish
    authenticated principal, signed custodian permit, immutable local Docker
    image, and exclusive Docker engine access. No remote caller can invoke this
    function in the currently deployed system.
    """
    from issue238_qa_preflight import PreparedQa

    if not isinstance(prepared, PreparedQa) or prepared.status != "RESERVED_NOT_EXECUTED":
        raise PermitDenied("preflight_required")
    if prepared.script_name not in QA_MANIFEST or not prepared.script_name.endswith("-qa.sh"):
        raise PermitDenied("unlisted_qa_script")
    if max_seconds != 360:
        raise PermitDenied("timeout_must_be_reviewed")
    record = status(ledger_path, prepared.nonce)
    if (not record or record["state"] != "RESERVED"
            or record["command_id"] != prepared.command_id
            or record["signed_digest"] != prepared.claims_digest):
        raise PermitDenied("durable_reservation_required")
    if not callable(trusted_image_inspection):
        raise PermitDenied("trusted_image_inspector_required")
    if verify_image_metadata(trusted_image_inspection()) != prepared.image_id:
        raise PermitDenied("runtime_image_changed")
    # Source is checked again before each execution; copy verifies bytes.
    verify_source_manifest(source_root, expected_owner_uid=os.getuid())
    try:
        with tempfile.TemporaryDirectory(prefix="cst-issue238-qa-") as directory:
            snapshot = _snapshot(source_root, Path(directory))
            invocation = ["/usr/bin/bash", str(snapshot / prepared.script_name)]
            result = run_process(invocation, shell=False, cwd=str(snapshot), env=dict(SAFE_ENV),
                                 capture_output=True, text=True, timeout=max_seconds, check=False)
            if not isinstance(result.returncode, int):
                raise RuntimeError("runner_missing_exit_status")
            output = ((result.stdout or "") + "\n" + (result.stderr or ""))[:65536]
            digest = hashlib.sha256(output.encode("utf8")).hexdigest()
            state = "PASS" if result.returncode == 0 else "FAIL"
            finish(ledger_path, nonce=prepared.nonce, command_id=prepared.command_id,
                   receipt_digest=digest, state=state)
            return {"state": state, "exitCode": result.returncode,
                    "commandId": prepared.command_id, "outputDigest": digest}
    except (subprocess.TimeoutExpired, OSError, RuntimeError):
        # A timeout may leave a disposable Docker container running. Do not
        # claim success or retry. A human must reconcile cleanup and receipt.
        # Keep original RESERVED state as deliberate fail-closed evidence.
        raise
