"""CST-DEV VPS signer durable nonce ledger QA (disposable, no real credentials).

Test ONLY the source module in this repo; do not start systemd signers, load
encrypted credentials, open production sockets, write database, or issue ACKs.
"""
import importlib.util
import os
import pathlib
import stat
import tempfile
import unittest
from unittest import mock

SOURCE = pathlib.Path(__file__).with_name("cst_onejob_vps_signer.py")
SPEC = importlib.util.spec_from_file_location("cst_onejob_vps_signer_synthetic_qa", SOURCE)
signer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(signer)


class NonceDurabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="cstdev-onejob-nonce-disposable-")
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name) / "ledger"
        self.root.mkdir(mode=0o700)
        self.root.chmod(0o700)
        self.nonce = "a" * 64

    def record(self):
        return self.root / (self.nonce + ".used")

    def test_created_record_is_private_and_replay_fails(self):
        signer.consume_nonce(str(self.root), self.nonce)
        self.assertEqual(self.record().read_bytes(), b"consumed\n")
        self.assertEqual(stat.S_IMODE(self.record().stat().st_mode), 0o600)
        with self.assertRaises(FileExistsError):
            signer.consume_nonce(str(self.root), self.nonce)

    def test_fsync_file_then_directory_before_returning(self):
        original = os.fsync
        events = []

        def observe(fd):
            details = os.fstat(fd)
            events.append("directory" if stat.S_ISDIR(details.st_mode) else "file")
            return original(fd)

        with mock.patch.object(signer.os, "fsync", side_effect=observe):
            signer.consume_nonce(str(self.root), self.nonce)
        self.assertEqual(events, ["file", "directory"])

    def test_failed_directory_fsync_fails_closed_without_deleting_nonce(self):
        original = os.fsync

        def fail_directory(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode):
                raise OSError("simulated interrupted directory sync")
            return original(fd)

        with mock.patch.object(signer.os, "fsync", side_effect=fail_directory):
            with self.assertRaisesRegex(OSError, "directory sync"):
                signer.consume_nonce(str(self.root), self.nonce)
        self.assertTrue(self.record().exists())
        with self.assertRaises(FileExistsError):
            signer.consume_nonce(str(self.root), self.nonce)

    def test_failed_file_fsync_keeps_the_nonce_unusable(self):
        original = os.fsync

        def fail_file(fd):
            if stat.S_ISREG(os.fstat(fd).st_mode):
                raise OSError("simulated incomplete file sync")
            return original(fd)

        with mock.patch.object(signer.os, "fsync", side_effect=fail_file):
            with self.assertRaisesRegex(OSError, "file sync"):
                signer.consume_nonce(str(self.root), self.nonce)
        self.assertTrue(self.record().exists())
        with self.assertRaises(FileExistsError):
            signer.consume_nonce(str(self.root), self.nonce)

    def test_short_write_is_rejected(self):
        with mock.patch.object(signer.os, "write", return_value=1):
            with self.assertRaisesRegex(RuntimeError, "WRITE_INCOMPLETE"):
                signer.consume_nonce(str(self.root), self.nonce)
        self.assertTrue(self.record().exists())
        with self.assertRaises(FileExistsError):
            signer.consume_nonce(str(self.root), self.nonce)

    def test_bad_nonce_and_path_traversal_denied_without_files(self):
        for bad in ("../out", "a/../out", "", "x" * 64, "A" * 64, None, 9):
            with self.subTest(value=repr(bad)):
                with self.assertRaisesRegex(RuntimeError, "FORMAT_INVALID"):
                    signer.consume_nonce(str(self.root), bad)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_symlink_ledger_denied(self):
        link = pathlib.Path(self.temp.name) / "symlink"
        link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "DIRECTORY_UNSAFE"):
            signer.consume_nonce(str(link), self.nonce)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_world_writable_ledger_denied(self):
        self.root.chmod(0o777)
        with self.assertRaisesRegex(RuntimeError, "DIRECTORY_UNSAFE"):
            signer.consume_nonce(str(self.root), self.nonce)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_no_operational_release_from_nonce_test(self):
        self.assertFalse((self.root / "sign.sock").exists())
        self.assertNotIn("CREDENTIALS_DIRECTORY", signer.consume_nonce.__code__.co_names)
        self.assertEqual(signer.PROJECT, "xssrfshdrtdfupgqwfdw")


if __name__ == "__main__":
    unittest.main()
