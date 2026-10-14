#!/usr/bin/env python3
"""Offline Docker-free tests: retain only healthy running DEV/PROD image IDs."""
import contextlib
import datetime as dt
import io
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import active_app_image_cleanup as gc

NOW = time.time()


def c(name, ref, image_id, *, running=False, health="healthy", mounts=None):
    return {
        "Name": "/" + name,
        "Id": "container-" + name,
        "Image": image_id,
        "State": {"Running": running, "Status": "running" if running else "exited",
                  "Health": {"Status": health}},
        "Config": {"Image": ref},
        "Mounts": mounts or [],
    }


def image(image_id, tags, *, age_hours=72):
    return {
        "Id": image_id,
        "RepoTags": tags,
        "Created": dt.datetime.fromtimestamp(NOW - age_hours * 3600,
                                              tz=dt.timezone.utc).isoformat(),
        "Size": 2_000_000,
    }


ACTIVE = [
    c("core-ai-dev", "core-ai-dev:latest-good", "sha256:dev", running=True),
    c("ai-core-prod-api", "ai-core-prod:latest-good", "sha256:prod", running=True),
    c("postgres-service", "postgres:16-alpine", "sha256:pg", running=True),
]
LIVE = {
    "core-ai-dev": {"container_id": ACTIVE[0]["Id"],
                    "image_id": "sha256:dev", "sha": "a" * 40},
    "ai-core-prod": {"container_id": ACTIVE[1]["Id"],
                     "image_id": "sha256:prod", "sha": "b" * 40},
}


class ContractTests(unittest.TestCase):
    def test_detects_exact_canonical_healthy_containers(self):
        with patch.object(gc, "health_commit", side_effect=["a" * 40, "b" * 40]):
            self.assertEqual(gc.canonical_state(ACTIVE), LIVE)

    def test_refuses_unhealthy_running_release(self):
        broken = [dict(ACTIVE[0], State={"Running": True, "Health": {"Status": "unhealthy"}}),
                  *ACTIVE[1:]]
        with patch.object(gc, "health_commit", side_effect=["a" * 40, "b" * 40]):
            with self.assertRaisesRegex(gc.Refused, "healthy"):
                gc.canonical_state(broken)

    def test_refuses_running_canary_even_when_canonical_healthy(self):
        running_canary = c("canary", "core-ai-dev:experimental", "sha256:canary", running=True)
        with patch.object(gc, "health_commit", side_effect=["a" * 40, "b" * 40]):
            with self.assertRaisesRegex(gc.Refused, "Additional running"):
                gc.canonical_state(ACTIVE + [running_canary])

    def test_stopped_volumes_are_never_unmounted_or_containers_deleted(self):
        old_with_volume = c("previous-with-volume", "core-ai-dev:old", "sha256:old",
                            mounts=[{"Type": "volume", "Name": "important-data"}])
        old_without_volume = c("previous-no-volume", "core-ai-dev:old", "sha256:old")
        self.assertEqual([x["Name"] for x in gc.eligible_stopped_containers(
            ACTIVE + [old_with_volume, old_without_volume])],
            ["/previous-no-volume"])

    def test_legacy_repositories_are_allowed_only_if_not_running(self):
        old = c("unused-legacy", "ai-core-dev:develop", "sha256:legacy")
        self.assertEqual([x["Name"] for x in gc.eligible_stopped_containers(ACTIVE + [old])],
                         ["/unused-legacy"])

    def test_no_unscoped_container_removal(self):
        other = c("some-db-init", "postgres:17-alpine", "sha256:pgold")
        self.assertEqual(gc.eligible_stopped_containers(ACTIVE + [other]), [])

    def test_repo_detection_respects_registry_port(self):
        self.assertEqual(gc.repo("registry.example.com:5000/team/app:latest"),
                         "registry.example.com:5000/team/app")
        self.assertEqual(gc.repo("core-ai-dev@sha256:abc"), "core-ai-dev")


class CandidateTests(unittest.TestCase):
    def test_only_old_unreferenced_scoped_images_selected(self):
        images = [
            image("sha256:dev", ["core-ai-dev:live"]),
            image("sha256:prod", ["ai-core-prod:live"]),
            image("sha256:old1", ["core-ai-dev:old1"]),
            image("sha256:old2", ["ai-core-prod:old2"]),
            image("sha256:legacy", ["ai-core-dev:develop"]),
            image("sha256:postgres", ["postgres:17-alpine"]),
            image("sha256:unrelated", ["n8n:2.0.0"]),
            image("sha256:pending", ["core-ai-dev:next-release"], age_hours=0.1),
        ]
        result = gc.eligible_images(images, ACTIVE, LIVE, NOW)
        self.assertEqual([x[1] for x in result],
                         ["ai-core-dev:develop", "core-ai-dev:old1", "ai-core-prod:old2"])

    def test_running_shared_image_is_untouchable(self):
        images = [image("sha256:pg", ["core-ai-dev:accidental-tag", "postgres:16-alpine"])]
        self.assertEqual(gc.eligible_images(images, ACTIVE, LIVE, NOW), [])

    def test_preserves_images_referenced_by_unremoved_stopped_container(self):
        protected = c("must-remain", "core-ai-dev:old", "sha256:old",
                      mounts=[{"Type": "volume", "Name": "history"}])
        self.assertEqual(gc.eligible_images([image("sha256:old", ["core-ai-dev:old"])],
                                            ACTIVE + [protected], LIVE, NOW), [])

    def test_plan_excludes_data_volume_containers_from_deletion(self):
        protected = c("with-volume", "core-ai-dev:old", "sha256:old",
                      mounts=[{"Type": "volume", "Name": "history"}])
        removable = c("without-volume", "core-ai-dev:old2", "sha256:old2")
        imgs = [image("sha256:old", ["core-ai-dev:old"]),
                image("sha256:old2", ["core-ai-dev:old2"])]
        planned = gc.plan(ACTIVE + [protected, removable], imgs, LIVE, NOW)
        self.assertEqual([x["Name"] for x in planned["stopped"]],
                         ["/without-volume"])
        self.assertEqual([t for _, t in planned["tags"]],
                         ["core-ai-dev:old2"])


class FakeDocker:
    def __init__(self):
        self.containers = ACTIVE.copy() + [
            c("old-dev-backup", "core-ai-dev:old", "sha256:old"),
            c("legacy-dev-test", "ai-core-dev:develop", "sha256:legacy"),
            c("volume-backed", "core-ai-dev:protected", "sha256:protected",
              mounts=[{"Type": "volume", "Name": "important-database"}]),
        ]
        self.images = [
            image("sha256:dev", ["core-ai-dev:live"]),
            image("sha256:prod", ["ai-core-prod:live"]),
            image("sha256:old", ["core-ai-dev:old"]),
            image("sha256:legacy", ["ai-core-dev:develop"]),
            image("sha256:protected", ["core-ai-dev:protected"]),
            image("sha256:pg", ["postgres:16-alpine"]),
        ]
        self.calls = []

    def __call__(self, *argv, **kwargs):
        self.calls.append(tuple(argv))
        if argv[:2] == ("ps", "-aq"):
            return "\n".join(c["Id"] for c in self.containers)
        if argv[:3] == ("images", "-aq", "--no-trunc"):
            return "\n".join(i["Id"] for i in self.images)
        if argv[:3] == ("volume", "ls", "-q"):
            return "important-database"
        if argv[:2] == ("container", "inspect"):
            out = [c for id in argv[2:] for c in self.containers
                   if c["Id"] == id]
            if len(out) != len(argv[2:]):
                raise gc.Refused("container vanished")
            return json.dumps(out)
        if argv[:2] == ("image", "inspect"):
            out = [i for ref in argv[2:] for i in self.images
                   if i["Id"] == ref or ref in i.get("RepoTags", [])]
            if len(out) != len(argv[2:]):
                raise gc.Refused("image vanished")
            return json.dumps(out)
        if argv[:2] == ("container", "rm"):
            cid = argv[2]
            self.containers = [c for c in self.containers if c["Id"] != cid]
            return cid
        if argv[:3] == ("image", "rm", "--no-prune"):
            tag = argv[3]
            for im in self.images:
                if tag in im.get("RepoTags", []):
                    if any(c["Image"] == im["Id"] for c in self.containers):
                        raise gc.Refused("Image referenced")
                    im["RepoTags"].remove(tag)
                    if not im["RepoTags"]:
                        self.images.remove(im)
                    return tag
            raise gc.Refused("no image tag")
        raise AssertionError("Unexpected Docker command: " + repr(argv))


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.fake = FakeDocker()

    def run_cleanup(self, apply):
        output = io.StringIO()
        with (patch.object(gc, "STATE_DIR", Path(self.tmp.name)),
              patch.object(gc, "docker", side_effect=self.fake),
              patch.object(gc, "health_commit", side_effect=lambda url:
                  "a" * 40 if ":18082" in url else "b" * 40),
              patch.object(gc, "fcntl", SimpleNamespace(LOCK_EX=2, flock=lambda *_: None)),
              patch.object(gc.os, "statvfs", create=True,
                           return_value=SimpleNamespace(f_bavail=10_000_000, f_frsize=4096)),
              contextlib.redirect_stdout(output)):
            gc.main(SimpleNamespace(apply=apply))
        return output.getvalue()

    def test_dry_run_mutates_nothing(self):
        out = self.run_cleanup(False)
        self.assertIn("DRY_RUN=PASS", out)
        self.assertEqual(len(self.fake.containers), 6)
        self.assertEqual(len(self.fake.images), 6)
        self.assertFalse(any(x[:2] == ("container", "rm") for x in self.fake.calls))
        self.assertFalse(any(x[:2] == ("image", "rm") for x in self.fake.calls))

    def test_live_cleanup_keeps_only_deployed_images_and_data_volume(self):
        out = self.run_cleanup(True)
        self.assertIn("ACTIVE_ONLY_RESULT", out)
        remaining_tags = {tag for im in self.fake.images for tag in im["RepoTags"]}
        self.assertEqual(remaining_tags, {
            "core-ai-dev:live", "ai-core-prod:live",
            "core-ai-dev:protected", "postgres:16-alpine",
        })
        remaining_names = {c["Name"] for c in self.fake.containers}
        self.assertIn("/core-ai-dev", remaining_names)
        self.assertIn("/ai-core-prod-api", remaining_names)
        self.assertIn("/volume-backed", remaining_names)
        self.assertNotIn("/old-dev-backup", remaining_names)
        self.assertNotIn("/legacy-dev-test", remaining_names)


class PolicyWiringTests(unittest.TestCase):
    def test_timer_runs_active_only_then_excludes_dev_prod_from_rollback(self):
        root = Path(__file__).resolve().parents[2]
        unit = (root / 'deploy/vps-maintenance/cst-docker-image-retention.service').read_text()
        self.assertIn('cst-docker-active-only.py --apply', unit)
        self.assertIn('--exclude-service core-dev --exclude-service core-prod', unit)
        self.assertIn('docker image prune --all --force --filter until=168h', unit)
        self.assertIn('docker buildx prune --all --force --filter until=168h', unit)
        self.assertNotIn('docker system prune', unit)
        self.assertNotIn('docker container prune', unit)
        self.assertNotIn('docker volume prune', unit)
        self.assertNotIn('prune --volumes', unit)
        self.assertLess(unit.index('cst-docker-active-only.py --apply'),
                        unit.index('docker image prune --all --force --filter until=168h'))
        installer = (root / 'deploy/vps-maintenance/install.sh').read_text()
        self.assertIn('test_active_app_image_cleanup.py', installer)
        self.assertIn('cst-docker-active-only.py', installer)
        self.assertIn('test_active_app_image_cleanup.py -q',
                      (root / '.github/workflows/ci.yml').read_text())

    def test_scoped_cleanup_does_not_use_broad_prune_force_or_volume_removal(self):
        code = Path(__file__).with_name('active_app_image_cleanup.py').read_text()
        self.assertNotIn('docker("system", "prune"', code)
        self.assertNotIn('docker("volume", "rm"', code)
        self.assertNotIn('docker("container", "rm", "-v"', code)
        self.assertNotIn('docker("image", "rm", "--force"', code)

    def test_never_started_container_with_declared_named_volume_is_preserved(self):
        target = c('created-with-volume', 'core-ai-dev:old', 'sha256:old')
        target['HostConfig'] = {'Binds': ['important-data:/data'], 'Mounts': []}
        self.assertTrue(gc.container_has_persistent_volume(target))
        self.assertEqual(gc.eligible_stopped_containers(ACTIVE + [target]), [])


if __name__ == "__main__":
    unittest.main()
