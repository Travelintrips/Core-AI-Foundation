#!/usr/bin/env python3
"""Safe, post-verification Docker image retention for CST VPS.

A deployer calls "record" ONLY after its full deployment verification passes.
The scheduled "sweep --apply" waits 24 hours and rechecks the running container.
Only named application images can be removed. It never removes containers,
volumes, databases, logs, or third-party image repositories.

A newly enrolled service is only a baseline: no deletion happens until a later
verified deployment changes that service's image identity.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
try:
    import fcntl  # Linux-only: serializes cleanup with verification receipts
except ImportError:
    fcntl = None
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request

STATE_DIR = Path("/var/lib/cst-docker-image-retention")
GRACE_SECONDS = 24 * 3600
MAX_IMAGES_PER_SWEEP = 5

# Deliberate allowlist. Third-party base images, PostgreSQL and Redis are never
# touched, even if they are no longer used.
SERVICES = {
    "core-dev": ("core-ai-dev", "core-ai-dev"),
    "core-prod": ("ai-core-prod", "ai-core-prod-api"),
    "analyzer": ("ai-core-repository-analyzer", "ai-core-repository-analyzer-vps"),
    "openclaw": ("ghcr.io/openclaw/openclaw", "ai-core-workers-openclaw-1"),
}
# These services also need a local application-level exact commit check.
COMMIT_HEALTH_URLS = {
    "core-dev": "http://127.0.0.1:18082/api/healthz",
    "core-prod": "http://127.0.0.1:18088/api/healthz",
}
RESERVED_TAGS = {"latest", "stable", "production", "develop"}


class Refused(Exception):
    pass


def docker(*args: str) -> str:
    result = subprocess.run(
        ["docker", *args], check=False, capture_output=True, text=True,
        timeout=45,
    )
    if result.returncode:
        raise Refused("Docker operation failed: " + " ".join(args[:2]))
    return result.stdout.strip()


def docker_objects(*args: str) -> list[dict]:
    try:
        raw = docker(*args)
        val = json.loads(raw)
    except (ValueError, TypeError) as exc:
        raise Refused("Invalid JSON returned by Docker") from exc
    if not isinstance(val, list):
        raise Refused("Expected a Docker JSON list")
    return val


def inspect_container(name: str) -> dict:
    items = docker_objects("container", "inspect", name)
    if len(items) != 1:
        raise Refused("Missing or ambiguous container: " + name)
    return items[0]


def image_matches(container: dict, repository: str) -> bool:
    image_ref = str(container.get("Config", {}).get("Image", ""))
    return image_ref.startswith(repository + ":") or image_ref.startswith(repository + "@")


def assert_current_healthy(service: str) -> dict:
    repository, name = SERVICES[service]
    container = inspect_container(name)
    state = container.get("State") or {}
    health = (state.get("Health") or {}).get("Status")
    if not state.get("Running") or health != "healthy":
        raise Refused(service + ": running healthy container is required")
    if not image_matches(container, repository):
        raise Refused(service + ": unexpected container image repository")
    image_id = str(container.get("Image", ""))
    if not image_id.startswith("sha256:"):
        raise Refused(service + ": exact immutable image ID is required")
    return container


def verify_commit_health(service: str, sha: str | None) -> None:
    if service not in COMMIT_HEALTH_URLS:
        return
    if not sha or len(sha) != 40 or any(x not in "0123456789abcdef" for x in sha):
        raise Refused(service + ": exact 40-character commit SHA required")
    request = urllib.request.Request(
        COMMIT_HEALTH_URLS[service],
        headers={"Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            live_sha = response.headers.get("X-CST-Commit-SHA", "")
            body = json.load(response)
            good = response.status == 200 and live_sha == sha and body.get("status") == "ok"
    except (OSError, ValueError, TypeError) as exc:
        raise Refused(service + ": local health check unavailable") from exc
    if not good:
        raise Refused(service + ": health/commit mismatch")


def read_state(root: Path, service: str) -> dict | None:
    path = root / (service + ".json")
    if not path.is_file() or path.is_symlink():
        return None
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        raise Refused(service + ": receipt unreadable") from exc
    if state.get("version") != 1 or state.get("service") != service:
        raise Refused(service + ": receipt schema mismatch")
    return state


def atomic_save(root: Path, service: str, state: dict) -> None:
    fd, tmp = tempfile.mkstemp(prefix="." + service + "-", dir=root)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(state, stream, sort_keys=True, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, root / (service + ".json"))
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


@contextlib.contextmanager
def locked_state(root: Path):
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.is_symlink():
        raise Refused("Receipt state directory must not be a symlink")
    os.chmod(root, 0o700)
    lock = root / ".lock"
    with lock.open("a+") as fd:
        fcntl.flock(fd.fileno(), fcntl.LOCK_EX)
        yield


def new_receipt(
    service: str, image_id: str, old: dict | None, sha: str | None,
    evidence: str, now: int,
) -> dict:
    repository, container = SERVICES[service]
    previous = None
    verified_at = now
    if old and old.get("image_id") == image_id:
        previous = old.get("rollback_image_id")
        verified_at = int(old["verified_at"])
    elif old:
        previous = old.get("image_id")
    return {
        "version": 1,
        "service": service,
        "repository": repository,
        "container": container,
        "image_id": image_id,
        "rollback_image_id": previous,
        "expected_sha": sha if service in COMMIT_HEALTH_URLS else None,
        "evidence_id": evidence[:150],
        "verified_at": verified_at,
    }


def record(args) -> None:
    if not args.evidence or len(args.evidence) < 5:
        raise Refused("Deployment verification evidence ID required")
    container = assert_current_healthy(args.service)
    verify_commit_health(args.service, args.sha)
    current = container["Image"]
    if args.expected_image and current != args.expected_image:
        raise Refused("Deployed image differs from the verified image ID")
    with locked_state(args.state_dir):
        old = read_state(args.state_dir, args.service)
        receipt = new_receipt(
            args.service, current, old, args.sha, args.evidence, int(time.time()),
        )
        atomic_save(args.state_dir, args.service, receipt)
    state = "new-verified-release" if old and old.get("image_id") != current else "baseline-or-repeat"
    print(f"image_retention_record=PASS service={args.service} state={state} "
          "next=wait-24h-and-reverify")


def list_images() -> list[dict]:
    raw = docker("image", "ls", "--no-trunc", "--format", "{{json .}}")
    result = []
    for line in raw.splitlines():
        entry = json.loads(line)
        if entry.get("Repository") in ("", "<none>"):
            continue
        if entry.get("Tag") in ("", "<none>"):
            continue
        result.append({
            "id": entry.get("ID"),
            "repository": entry.get("Repository"),
            "tag": entry.get("Tag"),
        })
    return result


def all_container_image_ids() -> set[str]:
    raw = docker("container", "ls", "-aq")
    if not raw:
        return set()
    ids = raw.splitlines()
    # Docker inspect in bounded batches; include stopped containers and backups.
    used = set()
    for start in range(0, len(ids), 30):
        for container in docker_objects("container", "inspect", *ids[start:start + 30]):
            used.add(container.get("Image"))
    return used


def created_seconds(image_id: str) -> int:
    objects = docker_objects("image", "inspect", image_id)
    if len(objects) != 1:
        raise Refused("Missing or ambiguous image")
    iso = objects[0].get("Created", "").replace("Z", "+00:00")
    return int(dt.datetime.fromisoformat(iso).timestamp())


def candidates_for_service(
    proof: dict, images: list[dict], referenced_ids: set[str],
    created: dict[str, int], now: int,
) -> list[dict]:
    active = proof["image_id"]
    rollback = proof.get("rollback_image_id")
    if not rollback or rollback == active:
        return []  # baseline only; must observe a later successful deployment
    if now < int(proof["verified_at"]) + GRACE_SECONDS:
        return []  # grace period for production rollback
    if active not in created or rollback not in created:
        return []  # no way to guarantee a restorable rollback
    repository = proof["repository"]
    protected = referenced_ids | {active, rollback}
    result = []
    for image in images:
        if image["repository"] != repository or image["id"] in protected:
            continue
        if image["tag"] in RESERVED_TAGS:
            continue
        # A newer but not yet released image may be a pending deploy. Preserve it.
        if image["id"] not in created or created[image["id"]] >= created[active]:
            continue
        result.append(image)
    return sorted(result, key=lambda row: created[row["id"]])


def sweep(args) -> None:
    if not args.state_dir.exists():
        print("image_retention=SKIP reason=no-verification-receipts")
        return
    with locked_state(args.state_dir):
        images = list_images()
        referenced = all_container_image_ids()
        created = {}
        for row in images:
            if row["id"] not in created:
                created[row["id"]] = created_seconds(row["id"])
        deleted = 0
        for service in SERVICES:
            if service in getattr(args, "exclude_service", []):
                continue  # DEV/PROD follow the active-image-only policy
            proof = read_state(args.state_dir, service)
            if proof is None:
                continue
            repository, name = SERVICES[service]
            if proof.get("repository") != repository or proof.get("container") != name:
                print(f"image_retention={service}:BLOCKED reason=receipt-identity")
                continue
            try:
                current = assert_current_healthy(service)
                verify_commit_health(service, proof.get("expected_sha"))
                if current["Image"] != proof.get("image_id"):
                    raise Refused("release changed: verification needed")
            except Refused as exc:
                print(f"image_retention={service}:BLOCKED reason={exc}")
                continue
            eligible = candidates_for_service(
                proof, images, referenced, created, int(time.time()),
            )
            if not eligible:
                print(f"image_retention={service}:SAFE no-eligible-images")
                continue
            for item in eligible:
                if deleted >= MAX_IMAGES_PER_SWEEP:
                    break
                ref = item["repository"] + ":" + item["tag"]
                if not args.apply:
                    print(f"image_retention=DRY_RUN service={service} tag={ref}")
                    continue
                # Recheck identity just before each destructive operation.
                latest = assert_current_healthy(service)
                verify_commit_health(service, proof.get("expected_sha"))
                if latest["Image"] != proof["image_id"]:
                    raise Refused("Release changed during cleanup")
                # Stopped rollback containers are protected as well.
                if item["id"] in all_container_image_ids():
                    continue
                if docker_objects("image", "inspect", ref)[0].get("Id") != item["id"]:
                    continue
                try:
                    docker("image", "rm", "--no-prune", ref)
                except Refused:
                    print(f"image_retention=SKIP service={service} tag={ref} reason=docker-refused")
                    continue
                deleted += 1
                print(f"image_retention=REMOVED service={service} tag={ref}")
        print(f"image_retention={'APPLY' if args.apply else 'DRY_RUN'} complete deleted={deleted}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, default=STATE_DIR)
    sub = parser.add_subparsers(dest="command", required=True)
    mark = sub.add_parser("record", help="Record a release after E2E / health verification")
    mark.add_argument("--service", choices=tuple(SERVICES), required=True)
    mark.add_argument("--evidence", required=True, help="CI verify run or approved deploy ID")
    mark.add_argument("--sha", help="Exact source commit for apps with /api/healthz")
    mark.add_argument("--expected-image", help="Optional immutable sha256: image ID")
    apply = sub.add_parser("sweep", help="Only prune old verified image tags")
    apply.add_argument("--apply", action="store_true", help="Enable removal (default: dry-run)")
    apply.add_argument("--exclude-service", action="append", choices=tuple(SERVICES), default=[],
                       help="Exclude app services handled by separate active-only policy")
    args = parser.parse_args()
    try:
        if args.command == "record":
            record(args)
        else:
            sweep(args)
        return 0
    except (Refused, ValueError, OSError, subprocess.TimeoutExpired) as exc:
        print("image_retention=BLOCKED reason=" + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
