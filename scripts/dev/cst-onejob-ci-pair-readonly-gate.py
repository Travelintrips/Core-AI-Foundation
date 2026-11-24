#!/usr/bin/env python3
"""CST-DEV Owner UI + API immutable CI pair gate (source QA only).

Reads an authenticated GitHub Actions build artifact ZIP already downloaded
to disk. No credentials, live requests, deployment, key/signature generation,
database writes, Linux signer starts or PROD actions.

The caller MUST separately verify GitHub run's head SHA, its conclusion and
the exact GitHub-generated PR merge commit SHA. The script checks that the
immutable ZIP and both compiled halves actually agree with those inputs.
It never returns operational release permission.
"""
import argparse
import hashlib
import json
import os
import re
import stat
import sys
import zipfile
from pathlib import PurePosixPath

SHA40 = re.compile(r"^[a-f0-9]{40}$")
SHA64 = re.compile(r"^[a-f0-9]{64}$")
MERGE_META = "ai-platform/dist/public/build-meta.json"
FRONTEND_HTML = "ai-platform/dist/public/index.html"
BACKEND_BUNDLE = "api-server/dist/index.mjs"
JS_PREFIX = "ai-platform/dist/public/assets/index-"
REQUIRED_UI = (
    b"Setujui satu job DEV",
    b"owner-stage-readiness",
    b"owner-approve-and-stage",
)
REQUIRED_API = (
    b"owner-stage-readiness",
    b"owner-approve-and-stage",
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def digest_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def verify(archive, expected_digest, ci_head, current_head, merge_sha, ci_conclusion):
    if not all(SHA40.fullmatch(v or "") for v in (ci_head, current_head, merge_sha)):
        raise ValueError("INVALID_GIT_SHA")
    if not SHA64.fullmatch(expected_digest or ""):
        raise ValueError("INVALID_ARTIFACT_SHA")
    if ci_head != current_head:
        raise ValueError("STALE_CI_HEAD_NOT_CURRENT_DRAFT")
    if ci_conclusion != "success":
        raise ValueError("CI_CHECK_NOT_SUCCESS")
    if ci_head == merge_sha:
        raise ValueError("CI_PR_MERGE_SHA_NOT_INDEPENDENT")
    if not os.path.isfile(archive) or os.path.islink(archive):
        raise ValueError("ARTIFACT_NOT_REGULAR_FILE")
    file_size = os.stat(archive).st_size
    if not 1024 <= file_size <= 100 * 1024 * 1024:
        raise ValueError("ARTIFACT_SIZE_OUTSIDE_BOUNDS")
    if digest_file(archive) != expected_digest:
        raise ValueError("ARTIFACT_ZIP_DIGEST_MISMATCH")
    try:
        with zipfile.ZipFile(archive) as bundle:
            items = bundle.infolist()
            if not 3 <= len(items) <= 7000:
                raise ValueError("ARTIFACT_FILE_COUNT_INVALID")
            seen = set()
            total_bytes = 0
            for entry in items:
                p = PurePosixPath(entry.filename)
                if (not entry.filename or p.is_absolute()
                        or ".." in p.parts or "\\" in entry.filename
                        or entry.filename in seen):
                    raise ValueError("UNSAFE_ARTIFACT_ZIP_ENTRY")
                seen.add(entry.filename)
                if stat.S_ISLNK(entry.external_attr >> 16):
                    raise ValueError("ARTIFACT_SYMLINK_FORBIDDEN")
                total_bytes += entry.file_size
                if total_bytes > 250 * 1024 * 1024:
                    raise ValueError("ARTIFACT_UNPACKED_TOO_LARGE")
            if MERGE_META not in seen or FRONTEND_HTML not in seen or BACKEND_BUNDLE not in seen:
                raise ValueError("CI_FRONTEND_BACKEND_PAIR_MISSING")
            js = [p for p in seen if p.startswith(JS_PREFIX) and p.endswith(".js")]
            if len(js) != 1:
                raise ValueError("MAIN_FRONTEND_JS_NOT_UNIQUE")
            meta = json.loads(bundle.read(MERGE_META))
            if type(meta) is not dict or meta.get("commitSha") != merge_sha:
                raise ValueError("CI_MERGE_BUILD_META_MISMATCH")
            if b"<html" not in bundle.read(FRONTEND_HTML).lower():
                raise ValueError("FRONTEND_INDEX_NOT_HTML")
            frontend = bundle.read(js[0])
            api = bundle.read(BACKEND_BUNDLE)
            if not all(term in frontend for term in REQUIRED_UI):
                raise ValueError("OWNER_UI_NOT_IN_COMPILED_FRONTEND")
            if not all(term in api for term in REQUIRED_API):
                raise ValueError("OWNER_API_NOT_IN_COMPILED_BACKEND")
            return {
                "status": "READONLY_SOURCE_PAIR_VERIFIED_NOT_DEPLOYED",
                "releaseDecision": "NO_GO",
                "project": "xssrfshdrtdfupgqwfdw",
                "ciHeadSha": ci_head,
                "prMergeSha": merge_sha,
                "zipSha256": expected_digest,
                "frontendJsSha256": digest(frontend),
                "backendJsSha256": digest(api),
                "frontendAndBackendFromSameZip": True,
                "ownerGetAndPostCompiled": True,
                "authenticatedOwnerSessionVerified": False,
                "ownerApprovalCreated": False,
                "devDeployed": False,
                "prodChanged": False,
                "signerServiceStarted": False,
                "dispatchEnabled": False,
                "googleKmsRequired": False,
            }
    except (zipfile.BadZipFile, OSError, UnicodeError, KeyError) as error:
        raise ValueError("CORRUPT_OR_UNREADABLE_CI_ARTIFACT") from error


def main():
    parser = argparse.ArgumentParser(description="READ-ONLY CST-DEV paired build checker")
    parser.add_argument("--artifact", required=True)
    parser.add_argument("--artifact-sha256", required=True)
    parser.add_argument("--ci-head", required=True)
    parser.add_argument("--current-pr-head", required=True)
    parser.add_argument("--pr-merge-sha", required=True)
    parser.add_argument("--ci-conclusion", required=True)
    args = parser.parse_args()
    try:
        proof = verify(
            args.artifact, args.artifact_sha256, args.ci_head,
            args.current_pr_head, args.pr_merge_sha, args.ci_conclusion,
        )
        exit_status = 0
    except (ValueError, TypeError) as exc:
        proof = {
            "status": "DENIED",
            "reason": str(exc),
            "releaseDecision": "NO_GO",
            "ownerApprovalCreated": False,
            "devDeployed": False,
            "prodChanged": False,
            "signerServiceStarted": False,
        }
        exit_status = 2
    print(json.dumps(proof, sort_keys=True, separators=(",", ":")))
    return exit_status


if __name__ == "__main__":
    sys.exit(main())
