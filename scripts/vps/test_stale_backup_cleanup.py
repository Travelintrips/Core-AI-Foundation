"""Offline checks for the selective stale-backup Docker cleanup job."""
import contextlib
import datetime
import io
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import stale_backup_cleanup as gc


def sample(name, *, age_hours=96, running=False, volumes=None, binds=None):
    end = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=age_hours)
    return {
        "Name": "/" + name,
        "Id": "test-" + name,
        "Image": "sha256:fakeimage",
        "State": {
            "Running": running,
            "FinishedAt": end.isoformat().replace("+00:00", "Z"),
        },
        "Config": {"Image": "ai-task-hub:old"},
        "Mounts": volumes or [],
        "HostConfig": {"Binds": binds or [], "Mounts": []},
    }


class CleanupPolicyTests(unittest.TestCase):
    def test_analyzer_and_ai_task_historical_backups_allowed(self):
        for name in ("ai-core-repository-analyzer-vps-pre-ssh2",
                     "ai-core-repository-analyzer-vps-before1135",
                     "ai-task-bridge-dev",
                     "ai-task-dev-pr49-backup-20261014-v2"):
            with self.subTest(name=name):
                self.assertTrue(gc.eligible(sample(name), datetime.datetime.now(
                    datetime.timezone.utc).timestamp()))

    def test_never_remove_an_active_service_even_with_backup_name(self):
        c = sample("ai-task-bridge-dev", running=True)
        self.assertFalse(gc.eligible(c, datetime.datetime.now(
            datetime.timezone.utc).timestamp()))

    def test_non_backup_service_and_one_shot_init_protected(self):
        for name in ("ai-core-workers-temporal-admin-tools-1",
                     "cst-wa-gateway-migration-export-1",
                     "ai-core-workers-openclaw-work-supervisor-1",
                     "ai-task-production",
                     "ai-core-repository-analyzer-vps"):
            with self.subTest(name=name):
                self.assertFalse(gc.eligible(sample(name), datetime.datetime.now(
                    datetime.timezone.utc).timestamp()))

    def test_recent_backups_remain_for_72_hours(self):
        c = sample("ai-task-dev-pr49-backup-20261014-v3", age_hours=6)
        self.assertFalse(gc.eligible(c, datetime.datetime.now(
            datetime.timezone.utc).timestamp()))

    def test_protect_named_and_implicit_docker_volumes(self):
        name = "ai-task-bridge-dev"
        for c in (sample(name, volumes=[{"Type": "volume", "Name": "data"}]),
                  sample(name, binds=["important-data:/data"]),
                  sample(name)):
            if not c.get("Mounts") and not c["HostConfig"]["Binds"]:
                c["HostConfig"]["Mounts"] = [{"Type": "volume"}]
            self.assertTrue(gc.has_volume(c))
            self.assertFalse(gc.eligible(c, datetime.datetime.now(
                datetime.timezone.utc).timestamp()))

    def test_bind_mounts_are_not_deleted(self):
        c = sample("ai-core-repository-analyzer-vps-backup", binds=["/root/.aicore:/root/.aicore"])
        self.assertFalse(gc.has_volume(c))
        self.assertTrue(gc.eligible(c, datetime.datetime.now(
            datetime.timezone.utc).timestamp()))

    def test_zero_age_finished_at_never_pruned(self):
        c = sample("ai-task-bridge-dev")
        c["State"]["FinishedAt"] = "0001-01-01T00:00:00Z"
        self.assertFalse(gc.eligible(c, datetime.datetime.now(
            datetime.timezone.utc).timestamp()))

    def test_default_script_has_read_only_argument(self):
        root = Path(__file__).resolve().parents[2]
        path = root / 'deploy/vps-maintenance/cst-docker-image-retention.service'
        unit = path.read_text(encoding='utf-8')
        self.assertIn('cst-docker-stale-backups.py --apply', unit)
        self.assertIn('docker image prune --all --force --filter until=168h', unit)
        self.assertIn('docker buildx prune --all --force --filter until=168h', unit)
        installer = (root / 'deploy/vps-maintenance/install.sh').read_text()
        self.assertIn('test_stale_backup_cleanup.py', installer)
        self.assertIn('cst-docker-stale-backups.py', installer)
        self.assertNotIn('docker system prune', unit)
        self.assertNotIn('docker volume prune', unit)
        self.assertNotIn('docker container prune', unit)


if __name__ == "__main__":
    unittest.main()
