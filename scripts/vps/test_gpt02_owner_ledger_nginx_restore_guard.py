"""Synthetic tests only; the real Nginx service is never changed."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name("gpt02_owner_ledger_nginx_restore_guard.py")
spec = importlib.util.spec_from_file_location("gpt02_guard", SOURCE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.active = root / "dev-ai-task.conf"
        self.backup = root / "backup.conf"
        self.original = (
            b"server { \n" + mod.LOCATION + b"\n" +
            mod.GATE + b"\n" + mod.PROXY + b"\n}\n"
        )
        self.active.write_bytes(self.original)

    def test_prepare_preserves_original_and_digest(self):
        self.assertEqual(mod.prepare(self.active, self.backup),
                         mod.digest(self.original))
        self.assertEqual(self.backup.read_bytes(), self.original)

    def test_restore_single_exact_removal(self):
        mod.prepare(self.active, self.backup)
        self.active.write_bytes(self.original.replace(mod.GATE, mod.COMMENT))
        with patch.object(mod, "run_maintenance") as maintenance:
            self.assertEqual(
                mod.restore(self.active, self.backup, ["nginx", "-t"],
                            ["systemctl", "reload", "nginx"]),
                "RESTORED_GATE_CLOSED",
            )
            maintenance.assert_called_once()
        self.assertEqual(self.active.read_bytes(), self.original)

    def test_gate_already_closed_no_reload(self):
        mod.prepare(self.active, self.backup)
        with patch.object(mod, "run_maintenance") as maintenance:
            self.assertEqual(mod.restore(self.active, self.backup, [], []),
                             "ALREADY_CLOSED")
            maintenance.assert_not_called()

    def test_refuse_unrelated_modification(self):
        mod.prepare(self.active, self.backup)
        self.active.write_bytes(self.original.replace(mod.GATE, mod.COMMENT) +
                                b"\n# other edit\n")
        with self.assertRaisesRegex(mod.GuardError, "UNEXPECTED_NGINX_CHANGE"):
            mod.restore(self.active, self.backup, [], [])
        self.assertNotEqual(self.active.read_bytes(), self.original)

    def test_refuse_wrong_backup(self):
        self.backup.write_bytes(b"not the original")
        with self.assertRaisesRegex(mod.GuardError, "UNTRUSTED_BACKUP_GATE"):
            mod.restore(self.active, self.backup, [], [])

    def test_refuse_open_baseline(self):
        self.active.write_bytes(self.original.replace(mod.GATE, b""))
        with self.assertRaisesRegex(mod.GuardError, "BASELINE_GATE_INVALID"):
            mod.prepare(self.active, self.backup)

    def test_refuse_backup_overwrite(self):
        mod.prepare(self.active, self.backup)
        with self.assertRaisesRegex(mod.GuardError, "BACKUP_EXISTS"):
            mod.prepare(self.active, self.backup)

    def test_refuse_symlink_backup(self):
        self.backup.symlink_to(self.active)
        with self.assertRaisesRegex(mod.GuardError, "BACKUP_EXISTS"):
            mod.prepare(self.active, self.backup)


if __name__ == "__main__":
    unittest.main()
