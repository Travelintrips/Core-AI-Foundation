"""Offline, repeatable Linux SO_PEERCRED tests, without real accounts or DB."""
from __future__ import annotations
import errno
import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parent))
from cst_team_onejob_peercred import verify_unix_peer, start_operational_broker


@unittest.skipUnless(sys.platform.startswith("linux"), "Linux peer credentials only")
class UnixPeerCredTests(unittest.TestCase):
    def test_expected_nonroot_uid_gid_required_even_if_callers_claim_success(self):
        a, b = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            for uid, gid in [(0, 1), (1, 0), (-1, 50), (1, -1),
                             (True, 3), (3, False), ("123", 4), (60001, 4)]:
                self.assertEqual(
                    verify_unix_peer(a, expected_uid=uid, expected_gid=gid).reason,
                    "EXPECTED_NONROOT_PEER_IDENTITY_MISSING",
                )
            self.assertFalse(verify_unix_peer(
                a, expected_uid=12345, expected_gid=12345).accepted)
        finally:
            a.close()
            b.close()

    def test_non_unix_socket_is_never_accepted(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            result = verify_unix_peer(s, expected_uid=28502, expected_gid=28501)
            self.assertFalse(result.accepted)
            self.assertEqual(result.reason, "NOT_UNIX_SOCKET")

    def test_actual_kernel_credentials_and_permission_boundary(self):
        with tempfile.TemporaryDirectory(prefix="cst-peercred-offline-") as folder:
            parent = Path(folder)
            sockpath = str(parent / "identity.sock")
            server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                server.bind(sockpath)
                server.listen(2)
                server.settimeout(2.0)

                if os.geteuid() == 0:
                    # Ephemeral kernel IDs only: NO passwd/group account creation.
                    broker_uid, shared_gid = 28500, 28501
                    allowed_uid, denied_uid, denied_gid = 28502, 28503, 28504
                    os.chown(folder, broker_uid, shared_gid)
                    os.chmod(folder, 0o750)
                    os.chown(sockpath, broker_uid, shared_gid)
                    os.chmod(sockpath, 0o660)
                else:
                    # Unprivileged CI: verify self's actual kernel identity.
                    allowed_uid, shared_gid = os.geteuid(), os.getegid()
                    if allowed_uid == 0 or shared_gid == 0:
                        self.skipTest("Need positive unprivileged UID/GID")
                    os.chmod(folder, 0o700)
                    os.chmod(sockpath, 0o600)

                pid = os.fork()
                if pid == 0:
                    try:
                        if os.geteuid() == 0:
                            os.setgroups([])
                            os.setgid(shared_gid)
                            os.setuid(allowed_uid)
                        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                            client.settimeout(1.5)
                            client.connect(sockpath)
                            client.sendall(b"OFFLINE_PEER_ONLY")
                        os._exit(0)
                    except BaseException:
                        os._exit(9)

                accepted, _ = server.accept()
                with accepted:
                    result = verify_unix_peer(
                        accepted, expected_uid=allowed_uid, expected_gid=shared_gid
                    )
                    self.assertTrue(result.accepted, result.reason)
                    self.assertEqual(result.reason, "KERNEL_PEER_IDENTITY_MATCHED")
                    self.assertFalse(verify_unix_peer(
                        accepted, expected_uid=allowed_uid + 1,
                        expected_gid=shared_gid).accepted)
                    self.assertEqual(accepted.recv(64), b"OFFLINE_PEER_ONLY")
                _, status = os.waitpid(pid, 0)
                self.assertEqual(os.waitstatus_to_exitcode(status), 0)

                if os.geteuid() == 0:
                    pid = os.fork()
                    if pid == 0:
                        try:
                            os.setgroups([])
                            os.setgid(denied_gid)
                            os.setuid(denied_uid)
                            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                                client.connect(sockpath)
                            os._exit(8)  # Security regression: unauthorized accepted
                        except OSError as error:
                            os._exit(0 if error.errno == errno.EACCES else 7)
                    _, status = os.waitpid(pid, 0)
                    self.assertEqual(os.waitstatus_to_exitcode(status), 0)
            finally:
                server.close()
                # Restore ownership for automatic tmpdir cleanup when root.
                if os.geteuid() == 0:
                    os.chown(folder, 0, 0)

    def test_no_runtime_launcher_is_present(self):
        with self.assertRaisesRegex(
            RuntimeError, "CST_ONEJOB_BROKER_INDEPENDENT_EGRESS_AND_DB_NO_GO"
        ):
            start_operational_broker()


if __name__ == "__main__":
    unittest.main(verbosity=2)
