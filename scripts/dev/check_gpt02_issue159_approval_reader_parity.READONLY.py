#!/usr/bin/env python3
"""Read-only Issue159 approval-reader source parity gate.

Compare the *installed source file* to the repository's canonical source.
Exit 3 on mismatch (release NO_GO). Never restart services, read approval
records, inspect credentials, create tasks or grant signer/dispatch authority.

Usage: python3 scripts/dev/check_gpt02_issue159_approval_reader_parity.READONLY.py
  [--installed /opt/ai-coding-standalone-dev/gpt02_issue159_approval_intent_reader.py]
  [--canonical scripts/dev/gpt02_issue159_approval_intent_reader.py]
"""
import argparse
import hashlib
import os
import stat
from pathlib import Path

DEFAULT_CANONICAL = Path(__file__).resolve().parent / "gpt02_issue159_approval_intent_reader.py"
DEFAULT_INSTALLED = Path("/opt/ai-coding-standalone-dev/gpt02_issue159_approval_intent_reader.py")


def _hash_source(path: Path):
    mode = path.lstat()
    if not stat.S_ISREG(mode.st_mode) or stat.S_ISLNK(mode.st_mode):
        raise RuntimeError("UNSAFE_SOURCE_TYPE")
    if mode.st_mode & 0o022:
        raise RuntimeError("GROUP_OR_WORLD_WRITABLE_SOURCE")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--installed", type=Path, default=DEFAULT_INSTALLED)
    parser.add_argument("--canonical", type=Path, default=DEFAULT_CANONICAL)
    args = parser.parse_args()
    try:
        canonical_hash = _hash_source(args.canonical)
        installed_hash = _hash_source(args.installed)
    except (OSError, RuntimeError) as error:
        print("NO_GO_APPROVAL_READER_SOURCE_UNVERIFIABLE", type(error).__name__)
        return 3
    if installed_hash != canonical_hash:
        print("NO_GO_APPROVAL_READER_SOURCE_DRIFT")
        print("canonical_sha256=" + canonical_hash)
        print("installed_sha256=" + installed_hash)
        return 3
    print("PASS_APPROVAL_READER_SOURCE_BYTE_PARITY")
    print("SOURCE_PARITY_ONLY_NOT_AUTHORIZATION_OR_RELEASE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
