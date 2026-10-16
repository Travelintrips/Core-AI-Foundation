#!/usr/bin/env python3
"""Keep only deployed/running AI Core DEV and PROD images on the shared VPS.

Scope is intentionally narrow. Stops/deletes ONLY obsolete *stopped* containers
created from the exact allowlisted app repositories, then removes ONLY their
unreferenced old image tags. Data volumes, bind mounts, and unrelated images
are never removed or pruned. No --force and no broad Docker prune.

CLI dry-runs unless --apply; must observe BOTH canonical app containers healthy
and their local commit-bearing HTTP /api/healthz responses.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
try:
    import fcntl  # Linux-only; mocked for offline Windows CI tests
except ImportError:
    fcntl = None
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request

STATE_DIR = Path("/var/lib/cst-docker-image-retention")
POLICY = {
    "core-ai-dev": ("core-ai-dev", "http://127.0.0.1:18082/api/healthz"),
    "ai-core-prod": ("ai-core-prod-api", "http://127.0.0.1:18088/api/healthz"),
}
# Historical alternate DEV image namespaces, not used by a canonical running app.
LEGACY_DEV_REPOS = frozenset({"ai-core-dev", "core-ai"})
SCOPE = frozenset(POLICY) | LEGACY_DEV_REPOS
MIN_STALE_AGE_SECONDS = 2 * 3600
MAX_IMAGES_PER_SWEEP = 30
MAX_CONTAINERS_PER_SWEEP = 40
SHA_PATTERN = re.compile(r"^[a-f0-9]{40}$")


class Refused(Exception):
    pass


def docker(*arguments: str, timeout: int = 50) -> str:
    try:
        result = subprocess.run(
            ["docker", *arguments], capture_output=True, text=True,
            timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Refused("Docker command unavailable: " + arguments[0]) from exc
    if result.returncode:
        raise Refused("Docker refused " + " ".join(arguments[:2]))
    return result.stdout.strip()


def inspect_many(kind: str, ids: list[str]) -> list[dict]:
    if not ids:
        return []
    result = []
    for at in range(0, len(ids), 30):
        try:
            objects = json.loads(docker(kind, "inspect", *ids[at:at + 30]))
        except (ValueError, TypeError) as exc:
            raise Refused("Invalid Docker inspect response") from exc
        if len(objects) != len(ids[at:at + 30]):
            raise Refused("Missing Docker object")
        result.extend(objects)
    return result


def repo(image_ref: str) -> str:
    """Extract Docker repository, treating digests and registry ports correctly."""
    if "@" in image_ref:
        return image_ref.split("@", 1)[0]
    name, _sep, _tag = image_ref.rpartition(":")
    return name if name else image_ref


def list_containers() -> list[dict]:
    return inspect_many("container", docker("ps", "-aq").splitlines())


def list_images() -> list[dict]:
    ids = sorted(set(docker("images", "-aq", "--no-trunc").splitlines()))
    return inspect_many("image", ids)


def health_commit(url: str) -> str:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=7) as response:
            data = json.load(response)
            sha = response.headers.get("X-CST-Commit-SHA", "").strip().lower()
            if response.status != 200 or data.get("status") != "ok":
                raise Refused("Application health body is not OK")
    except (OSError, TypeError, ValueError) as exc:
        raise Refused("Cannot validate local application health") from exc
    if not SHA_PATTERN.fullmatch(sha):
        raise Refused("Application did not expose valid commit SHA")
    return sha


def canonical_state(containers: list[dict]) -> dict:
    by_name = {c["Name"].lstrip("/"): c for c in containers}
    live = {}
    for repository, (name, url) in POLICY.items():
        container = by_name.get(name)
        if not container:
            raise Refused("Canonical service is missing: " + name)
        status = container.get("State") or {}
        if not status.get("Running") or (status.get("Health") or {}).get("Status") != "healthy":
            raise Refused("Canonical service is not running and healthy: " + name)
        if repo(str(container["Config"]["Image"])) != repository:
            raise Refused("Unexpected canonical image repository: " + name)
        commit = health_commit(url)
        live[repository] = {
            "container_id": container["Id"],
            "image_id": container["Image"],
            "sha": commit,
        }
    # Never discard images from a second running DEV/PROD canary or alias.
    for c in containers:
        if not c.get("State", {}).get("Running"):
            continue
        repository = repo(str(c.get("Config", {}).get("Image", "")))
        if repository not in SCOPE:
            continue
        if repository not in live or live[repository]["container_id"] != c["Id"]:
            raise Refused("Additional running scoped app/container; skip cleanup")
    return live


def container_has_persistent_volume(container: dict) -> bool:
    """Protect named/anonymous volumes, including mounts of a never-started container."""
    if any(m.get("Type") == "volume" for m in container.get("Mounts") or []):
        return True
    config = container.get("HostConfig") or {}
    if any(m.get("Type") == "volume" for m in config.get("Mounts") or []):
        return True
    for spec in config.get("Binds") or []:
        source = str(spec).split(":", 1)[0]
        if not source.startswith("/"):
            return True  # named Docker volume, not an absolute host path
    return False


def eligible_stopped_containers(containers: list[dict]) -> list[dict]:
    return sorted(
        [
            c for c in containers
            if not c.get("State", {}).get("Running")
            and repo(str(c.get("Config", {}).get("Image", ""))) in SCOPE
            and not container_has_persistent_volume(c)
        ],
        key=lambda c: c["Name"],
    )


def eligible_images(
    images: list[dict], preserved_containers: list[dict],
    active: dict, now: float,
) -> list[tuple[str, str]]:
    used = {c["Image"] for c in preserved_containers}
    used.update(record["image_id"] for record in active.values())
    results = []
    for image in images:
        tags = image.get("RepoTags") or []
        in_scope = [tag for tag in tags if repo(tag) in SCOPE]
        if not in_scope or image["Id"] in used:
            continue
        if len(in_scope) != len(tags):
            continue  # cross-repository image; keep all tags for safety
        try:
            created = dt.datetime.fromisoformat(image["Created"].replace("Z", "+00:00"))
        except (KeyError, TypeError, ValueError) as exc:
            raise Refused("Docker image missing creation timestamp") from exc
        if now - created.timestamp() < MIN_STALE_AGE_SECONDS:
            continue  # not yet released, might still be being tested
        for tag in in_scope:
            results.append((image["Id"], tag))
    return sorted(results)


def plan(containers: list[dict], images: list[dict], live: dict, now: float) -> dict:
    stopped = eligible_stopped_containers(containers)
    batch = stopped[:MAX_CONTAINERS_PER_SWEEP]
    batch_ids = {c["Id"] for c in batch}
    preserved = [c for c in containers if c["Id"] not in batch_ids]
    return {
        "stopped": batch,
        "all_stopped_candidates": len(stopped),
        "tags": eligible_images(images, preserved, live, now)[:MAX_IMAGES_PER_SWEEP],
        "live": live,
    }


def live_fingerprint(containers: list[dict]) -> dict[str, tuple[str, str]]:
    return {
        c["Name"]: (c["Id"], c["Image"])
        for c in containers if c.get("State", {}).get("Running")
    }


def volume_ids() -> set[str]:
    return set(docker("volume", "ls", "-q").splitlines())


def exact_live(expected: dict) -> None:
    actual = canonical_state(list_containers())
    if actual != expected:
        raise Refused("Running app image, commit or container changed during cleanup")


def remove_old_container(container: dict, live: dict) -> None:
    exact_live(live)
    current = inspect_many("container", [container["Id"]])
    if len(current) != 1:
        raise Refused("Container disappeared during cleanup")
    c = current[0]
    if (c["Name"], c["Image"], c["Config"]["Image"]) != (
        container["Name"], container["Image"], container["Config"]["Image"],
    ):
        raise Refused("Stopped container identity changed")
    if c.get("State", {}).get("Running") or container_has_persistent_volume(c):
        raise Refused("Container restarted or has a data volume")
    docker("container", "rm", container["Id"], timeout=40)


def remove_old_tag(image_id: str, tag: str, live: dict) -> None:
    exact_live(live)
    if repo(tag) not in SCOPE:
        raise Refused("Unapproved image repository")
    ids = {c["Image"] for c in list_containers()}
    if image_id in ids or image_id in (record["image_id"] for record in live.values()):
        raise Refused("Image gained a container reference")
    images = inspect_many("image", [tag])
    if len(images) != 1 or images[0]["Id"] != image_id:
        raise Refused("Image tag has changed since dry run")
    # A separate deployment could tag this image for another repository.
    if any(repo(t) not in SCOPE for t in (images[0].get("RepoTags") or [])):
        raise Refused("Image now has out-of-scope tags")
    docker("image", "rm", "--no-prune", tag, timeout=70)


@contextlib.contextmanager
def exclusive_lock():
    if fcntl is None:
        raise Refused("Linux fcntl required for locked cleanup")
    STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    if STATE_DIR.is_symlink():
        raise Refused("State folder must not be symlink")
    lock = STATE_DIR / ".lock"
    with lock.open("a+") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        yield


def write_audit(data: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Only last execution summary, no sensitive data or container environment.
    dest = STATE_DIR / "active-only-last-run.json"
    tmp = STATE_DIR / ("active-only-last-run.tmp." + str(os.getpid()))
    with tmp.open("w", encoding="utf-8") as f:
        os.chmod(tmp, 0o600)
        json.dump(data, f, indent=2)
        f.write("\n")
    os.replace(tmp, dest)


def main(args: argparse.Namespace) -> None:
    with exclusive_lock():
        initial_containers = list_containers()
        initial_images = list_images()
        active = canonical_state(initial_containers)
        scheduled = plan(initial_containers, initial_images, active, time.time())
        print("ACTIVE_ONLY_PLAN stopped_containers={} image_tags={} active_dev={} active_prod={}".format(
            scheduled["all_stopped_candidates"],
            len(scheduled["tags"]),
            active["core-ai-dev"]["image_id"][7:19],
            active["ai-core-prod"]["image_id"][7:19],
        ), flush=True)
        if not args.apply:
            for c in scheduled["stopped"]:
                print("WOULD_REMOVE_STOPPED_CONTAINER " + c["Name"].lstrip("/"))
            for _id, tag in scheduled["tags"]:
                print("WOULD_REMOVE_OLD_IMAGE_TAG " + tag)
            print("ACTIVE_ONLY_DRY_RUN=PASS no_mutation", flush=True)
            return

        initial_live = live_fingerprint(initial_containers)
        initial_volumes = volume_ids()
        free_before = os.statvfs("/").f_bavail * os.statvfs("/").f_frsize
        removed_containers: list[str] = []
        removed_tags: list[str] = []
        skipped: list[str] = []
        for c in scheduled["stopped"]:
            try:
                remove_old_container(c, active)
                removed_containers.append(c["Name"].lstrip("/"))
                print("REMOVED_STOPPED_CONTAINER " + c["Name"].lstrip("/"), flush=True)
            except Refused as exc:
                skipped.append("container " + c["Name"].lstrip("/") + ": " + str(exc))
                print("SKIPPED_STOPPED_CONTAINER " + c["Name"].lstrip("/"), flush=True)

        # Recompute tags with *actual* surviving containers. This preserves
        # anything whose stopped container could not be removed.
        current = list_containers()
        actual = plan(current, list_images(), active, time.time())
        for image_id, tag in actual["tags"]:
            try:
                remove_old_tag(image_id, tag, active)
                removed_tags.append(tag)
                print("REMOVED_OLD_IMAGE_TAG " + tag, flush=True)
            except Refused as exc:
                skipped.append("image " + tag + ": " + str(exc))
                print("SKIPPED_OLD_IMAGE_TAG " + tag, flush=True)

        final_containers = list_containers()
        final_live = live_fingerprint(final_containers)
        final_volumes = volume_ids()
        exact_live(active)
        if final_live != initial_live or final_volumes != initial_volumes:
            raise Refused("Running container set or Docker volume set changed")
        free_after = os.statvfs("/").f_bavail * os.statvfs("/").f_frsize
        report = {
            "completed_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
            "removed_stopped_containers": removed_containers,
            "removed_image_tags": removed_tags,
            "skipped": skipped,
            "free_gib_before": round(free_before / 1024**3, 3),
            "free_gib_after": round(free_after / 1024**3, 3),
            "active_images": {k: v["image_id"] for k, v in active.items()},
            "running_container_count": len(final_live),
            "named_volume_count": len(final_volumes),
        }
        write_audit(report)
        print("ACTIVE_ONLY_RESULT removed_containers={} removed_tags={} disk_freed_gib={:.3f} skipped={} live_unchanged=PASS volumes_unchanged=PASS".format(
            len(removed_containers), len(removed_tags),
            (free_after - free_before) / 1024**3, len(skipped),
        ), flush=True)
        if skipped:
            raise Refused("Some scoped Docker artifacts were skipped; inspect audit report")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Mutate; otherwise dry-run")
    args = parser.parse_args()
    try:
        main(args)
    except (Refused, OSError, KeyError, ValueError) as exc:
        print("ACTIVE_ONLY_BLOCKED " + str(exc), file=sys.stderr)
        sys.exit(2)
