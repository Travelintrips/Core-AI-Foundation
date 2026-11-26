"""Source-only integrity preflight for Issue #238 disposable PG17 QA.

No Docker execution, credentials, job dispatch, role grants or DB writes.
An independently authenticated, audited runner must invoke this after
permit verification and before immutable image launch.
"""
import hashlib
import os
import stat
from pathlib import Path

from issue238_qa_permit import APPROVED_IMAGE_SHA256, APPROVED_SQL_SHA256, PermitDenied

QA_MANIFEST = {
    "issue238-postgres17-relock.sql": APPROVED_SQL_SHA256,
    "issue238-pg17-lock-expiry-concurrency-qa.sh": "aff921423cf30c8cab4c9948f307e30aec1ca00f8cd70300d37b85006abd03ee",
    "issue238-pgcron164-nonsuperuser-crash-qa.sh": "44d61601142befef52b094fbd8e18ae8f5d2749f8c0b3d6b3eb0f5e224f4f6b1",
    "issue238-pgcron164-scheduler-crash-qa.sh": "91e87358075e85982664175769e587efebd7c669b837354882efe51437801d8f",
}
IMAGE_NAME = "cst-invoice-pgcron-qa:local"


def verify_source_manifest(source_dir: Path, *, expected_owner_uid: int = 0):
    """Verify all known sources before selecting a script.

    Does not attest files remain unchanged after this check: a future runner
    must snapshot verified sources into a read-only image or open safely by fd.
    """
    if not isinstance(source_dir, Path) or source_dir.is_symlink() or not source_dir.is_dir():
        raise PermitDenied("unsafe_source_directory")
    metadata = source_dir.stat()
    if metadata.st_uid != expected_owner_uid or metadata.st_mode & 0o022:
        raise PermitDenied("untrusted_source_directory")
    observed = {}
    for name, sha in QA_MANIFEST.items():
        path = source_dir / name
        if path.is_symlink() or not path.is_file():
            raise PermitDenied("source_missing_or_symlink")
        info = path.stat()
        if info.st_uid != expected_owner_uid or info.st_mode & 0o022 or not stat.S_ISREG(info.st_mode):
            raise PermitDenied("unsafe_source_permissions")
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != sha:
            raise PermitDenied("unreviewed_source_" + name)
        observed[name] = actual
    return observed


def verify_image_metadata(metadata):
    """Validate a Docker inspection result from a *trusted* local Docker API.

    No Docker client call is made here; a separate executor must authenticate
    the engine, fetch metadata, and ensure the image cannot change between
    checking it and creating the disposable container.
    """
    if not isinstance(metadata, dict):
        raise PermitDenied("image_metadata_missing")
    image_id = metadata.get("Id")
    tags = metadata.get("RepoTags")
    if not isinstance(image_id, str) or image_id != "sha256:" + APPROVED_IMAGE_SHA256:
        raise PermitDenied("qa_image_digest_mismatch")
    if not isinstance(tags, list) or IMAGE_NAME not in tags:
        raise PermitDenied("qa_image_tag_mismatch")
    return image_id
