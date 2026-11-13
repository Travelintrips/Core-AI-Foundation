#!/usr/bin/env python3
"""Fail-closed Github compare gate for isolated DEV source-only releases.

A verified pure Windows GPT02 source change may skip a no-op VPS DEV
container restart. This module NEVER grants dispatch/production deploy.
"""
import argparse
import json
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

REPO = "Travelintrips/Core-AI-Foundation"
API = "https://api.github.com/repos/" + REPO + "/compare/"
SHA = re.compile(r"^[a-f0-9]{40}$")
WINDOWS_SOURCE = "scripts/windows/ai-core/"
SAFE_EXACT = frozenset((
    ".github/workflows/gpt02-dell-canonical-dev-backport.yml",
    ".github/workflows/hostinger-dev-deploy.yml",
    "scripts/vps/dev_ci_watcher.py",
    "scripts/vps/dev_source_only_release_gate.py",
    "scripts/vps/test_dev_source_only_release_gate.py",
    "scripts/vps/test_dev_ci_watcher_source_only.py",
))
SAFE_STATUSES = frozenset(("added", "modified", "removed"))
DECISION_SKIP = "SKIP_DEV_RESTART"
DECISION_RELEASE = "NORMAL_DEV_RELEASE"
DECISION_BLOCK = "BLOCK_UNVERIFIED"


class ComparisonError(ValueError):
    pass


def canonical_sha(value):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise ComparisonError("invalid exact commit SHA")
    return value


def valid_git_path(name):
    if not isinstance(name, str) or not name:
        return False
    if chr(92) in name or chr(0) in name:
        return False
    if name.startswith("/") or name.endswith("/"):
        return False
    return not any(part in ("", ".", "..") for part in name.split("/"))


def safe_path(name):
    return valid_git_path(name) and (name.startswith(WINDOWS_SOURCE) or name in SAFE_EXACT)


def verdict(decision, reason, count=0):
    return {
        "scope": "CST_DEV_SOURCE_ONLY_RELEASE_GATE_V1",
        "decision": decision, "reason": reason,
        "changed_file_count": count,
        "prod_permitted": False,
        "worker_dispatch_permitted": False,
        "changes_made": False,
    }


def classify_compare(data, base_sha, target_sha):
    """Classify a complete GitHub Compare payload; never infer missing files."""
    base_sha, target_sha = canonical_sha(base_sha), canonical_sha(target_sha)
    if base_sha == target_sha:
        return verdict(DECISION_SKIP, "DEV_ALREADY_AT_EXACT_SHA")
    if not isinstance(data, dict):
        raise ComparisonError("compare result unavailable")
    base = data.get("base_commit")
    ancestor = data.get("merge_base_commit")
    commits = data.get("commits")
    # GitHub REST compare endpoint returns base_commit, merge_base_commit and
    # commits[-1] as head. It does NOT have a "head_commit" member.
    if (not isinstance(base, dict) or not isinstance(ancestor, dict) or
            not isinstance(commits, list) or not commits or
            not all(isinstance(commit, dict) for commit in commits)):
        raise ComparisonError("missing Git ancestry evidence")
    if (base.get("sha") != base_sha or commits[-1].get("sha") != target_sha or
            ancestor.get("sha") != base_sha):
        raise ComparisonError("comparison not pinned to deployed SHA")
    status = data.get("status")
    ahead, behind = data.get("ahead_by"), data.get("behind_by")
    if (status != "ahead" or type(ahead) is not int or ahead < 1 or
            type(behind) is not int or behind != 0):
        raise ComparisonError("target not a strict descendant of deployed SHA")
    files = data.get("files")
    if not isinstance(files, list) or not 1 <= len(files) < 300:
        raise ComparisonError("missing or potentially truncated file list")
    if type(data.get("total_commits")) is not int or not 1 <= data["total_commits"] <= 250:
        raise ComparisonError("missing or truncated commit history")
    if data["total_commits"] != ahead or len(commits) != ahead:
        raise ComparisonError("incomplete compare commit list")
    seen = set()
    app_changes = []
    for entry in files:
        if not isinstance(entry, dict):
            raise ComparisonError("invalid changed-file entry")
        name, kind = entry.get("filename"), entry.get("status")
        if not valid_git_path(name):
            raise ComparisonError("invalid Git file path")
        if name.casefold() in seen:
            raise ComparisonError("duplicate case-insensitive path")
        seen.add(name.casefold())
        if kind not in SAFE_STATUSES or entry.get("previous_filename"):
            raise ComparisonError("unsupported/renamed path status")
        if not safe_path(name):
            app_changes.append(name)
    if app_changes:
        return verdict(DECISION_RELEASE, "APPLICATION_OR_UNLISTED_CHANGE_PRESENT", len(files))
    return verdict(DECISION_SKIP, "ONLY_ALLOWLISTED_WINDOWS_DEV_SOURCE_CHANGED", len(files))


def compare_remote(base_sha, target_sha, timeout=12):
    base_sha, target_sha = canonical_sha(base_sha), canonical_sha(target_sha)
    if base_sha == target_sha:
        return verdict(DECISION_SKIP, "DEV_ALREADY_AT_EXACT_SHA")
    url = API + base_sha + "..." + target_sha
    req = Request(url, headers={
        "User-Agent": "CST-VPS-DEV-Source-Only-Gate/1.0",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urlopen(req, timeout=timeout) as response:
        if response.status != 200:
            raise ComparisonError("GitHub Compare was not HTTP 200")
        raw = response.read(4 * 1024 * 1024 + 1)
        if len(raw) > 4 * 1024 * 1024:
            raise ComparisonError("compare response exceeded bounded size")
    return classify_compare(json.loads(raw), base_sha, target_sha)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline-sha", required=True)
    parser.add_argument("--target-sha", required=True)
    parser.add_argument("--compare-json-file", type=Path, help="offline contract test only")
    options = parser.parse_args()
    try:
        if options.compare_json_file:
            body = json.loads(options.compare_json_file.read_text(encoding="utf-8"))
            result = classify_compare(body, options.baseline_sha, options.target_sha)
        else:
            result = compare_remote(options.baseline_sha, options.target_sha)
    except (ComparisonError, OSError, ValueError, TypeError, KeyError) as exc:
        result = verdict(DECISION_BLOCK, str(exc)[:110])
    print(json.dumps(result, sort_keys=True))
    if result["decision"] == DECISION_BLOCK:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
