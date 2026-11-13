#!/usr/bin/env python3
"""Pull-only DEV release watchdog; promotes only a CI-green develop commit."""
import json
import subprocess
import sys
from urllib.request import Request, urlopen

from dev_source_only_release_gate import (DECISION_RELEASE, DECISION_SKIP,
                                          canonical_sha, compare_remote)

REPO = "Travelintrips/Core-AI-Foundation"
UPSTREAM = "https://github.com/" + REPO + ".git"
API = "https://api.github.com/repos/" + REPO + "/actions/runs"
REQUIRED = frozenset(("CI Verify", "DEV Fast Verify"))


def latest_sha():
    out = subprocess.check_output(
        ["git", "ls-remote", UPSTREAM, "refs/heads/develop"],
        text=True, timeout=35,
    ).strip()
    return out.split()[0]


def ci_green(sha):
    url = API + "?branch=develop&head_sha=" + sha + "&per_page=100"
    req = Request(url, headers={
        "User-Agent": "CST-VPS-DEV-CI-Release/1.0",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urlopen(req, timeout=18) as response:
        runs = json.load(response)["workflow_runs"]
    green = {
        run["name"] for run in runs
        if run.get("name") in REQUIRED
        and run.get("head_sha") == sha
        and run.get("head_branch") == "develop"
        and run.get("event") == "push"
        and run.get("status") == "completed"
        and run.get("conclusion") == "success"
    }
    return REQUIRED.issubset(green), sorted(green)


def local_sha():
    req = Request("http://127.0.0.1:18082/api/healthz")
    with urlopen(req, timeout=8) as response:
        if response.status != 200 or json.load(response).get("status") != "ok":
            return None
        return response.headers.get("x-cst-commit-sha")


def main():
    sha = latest_sha()
    if len(sha) != 40 or any(x not in "0123456789abcdef" for x in sha):
        raise RuntimeError("remote develop SHA is invalid")
    active_sha = None
    try:
        active_sha = local_sha()
        if active_sha == sha:
            print("VPS_DEV_POLL=READY sha=" + sha)
            return
    except Exception:
        print("VPS_DEV_POLL=STALE_OR_UNAVAILABLE_LOCAL_HEALTH")
    ready, workflows = ci_green(sha)
    if not ready:
        print("VPS_DEV_POLL=WAITING_CI sha=" + sha + " verified=" + ",".join(workflows))
        return
    # Source-only Windows commits must not restart the running VPS DEV app.
    # Unknown Git ancestry or API failures are BLOCKED, not treated as a
    # source-only pass or a reason to redeploy.
    if isinstance(active_sha, str) and len(active_sha) == 40:
        baseline = canonical_sha(active_sha)
        decision = compare_remote(baseline, sha)
        if decision["decision"] == DECISION_SKIP:
            print("VPS_DEV_POLL=SOURCE_ONLY_NO_RESTART base=" + baseline +
                  " target=" + sha + " reason=" + decision["reason"])
            return
        if decision["decision"] != DECISION_RELEASE:
            raise RuntimeError("source-only classification did not authorize normal release")
    print("VPS_DEV_POLL=RELEASING sha=" + sha, flush=True)
    subprocess.run(
        ["/usr/bin/python3", "/usr/local/sbin/cst-vps-dev-release.py", sha],
        check=True, timeout=1500,
    )
    if local_sha() != sha:
        raise RuntimeError("DEV release returned but exact-sha live check failed")
    print("VPS_DEV_POLL=PASS sha=" + sha)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("VPS_DEV_POLL=BLOCKED " + str(error), file=sys.stderr)
        sys.exit(1)
