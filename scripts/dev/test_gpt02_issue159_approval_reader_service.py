import unittest
from pathlib import Path


class ApprovalReaderServiceContractTest(unittest.TestCase):
    def test_unit_is_root_readonly_private_network_and_unix_socket_only(self):
        p=Path(__file__).parents[2]/"deploy/ai-coding-standalone-dev/gpt02-issue159-approval-reader.service"
        body=p.read_text()
        for required in (
            "User=root",
            "Group=gpt02-issue159-signers",
            "PrivateNetwork=yes",
            "RestrictAddressFamilies=AF_UNIX",
            "NoNewPrivileges=yes",
            "ProtectSystem=strict",
            "ProtectHome=yes",
            "ReadOnlyPaths=/opt/ai-coding-standalone-dev/tasks.db",
            "ReadWritePaths=/run/gpt02-approval-reader",
            "RuntimeDirectoryMode=0750",
            "UMask=0077",
            "gpt02_issue159_approval_reader_runtime.py",
        ):
            self.assertIn(required,body)
        for forbidden in ("AF_INET","AF_INET6","service_role","DATABASE_URL=","ExecStartPre=+"):
            self.assertNotIn(forbidden,body)

    def test_runtime_socket_directory_matches_systemd_group_traversal(self):
        p=Path(__file__).parents[2]/"deploy/ai-coding-standalone-dev/gpt02_issue159_approval_reader_runtime.py"
        body=p.read_text()
        self.assertIn("parent.mkdir(mode=0o750",body)
        self.assertIn("pst.st_gid!=expected_gid",body)
        self.assertIn("stat.S_IMODE(pst.st_mode)!=0o750",body)
        self.assertIn("os.chmod(socket_path,0o660)",body)

    def test_runtime_does_not_create_or_update_approval_decisions(self):
        p=Path(__file__).parents[2]/"deploy/ai-coding-standalone-dev/gpt02_issue159_approval_reader_runtime.py"
        body=p.read_text()
        for forbidden in ("INSERT INTO","UPDATE ","DELETE FROM","sqlite3.connect","Ed25519PrivateKey","psycopg","dispatch("):
            self.assertNotIn(forbidden,body)


if __name__=="__main__":unittest.main()
