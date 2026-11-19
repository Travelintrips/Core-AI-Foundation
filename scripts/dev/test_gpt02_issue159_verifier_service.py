import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / "deploy/ai-coding-standalone-dev"

class VerifierServiceBoundaryTest(unittest.TestCase):
    def test_service_unprivileged_no_keys_no_db_no_network(self):
        unit=(DEPLOY/"gpt02-issue159-verifier.service").read_text()
        expected=(
            "User=gpt02-issue159-verifier",
            "Group=gpt02-issue159-signers",
            "PrivateNetwork=yes",
            "RestrictAddressFamilies=AF_UNIX",
            "NoNewPrivileges=yes",
            "CapabilityBoundingSet=",
            "ProtectSystem=strict",
            "RuntimeDirectoryMode=0750",
            "UMask=0077",
            "ReadOnlyPaths=/opt/gpt02-verifier",
            "InaccessiblePaths=-/opt/ai-coding-standalone-dev/tasks.db",
            "--approval-reader-socket /run/gpt02-approval-reader/approval.sock",
            "--public-roots /etc/gpt02-dev/verifier-public",
            "--socket /run/gpt02-issue159-verifier/verify.sock",
        )
        for string in expected:
            self.assertIn(string,unit,string)
        for forbidden in ("User=root","LoadCredential","EnvironmentFile=",
                          "AF_INET","AF_INET6","--sign","--dispatch",
                          "DATABASE_URL","SERVICE_ROLE","sudo "):
            self.assertNotIn(forbidden,unit,forbidden)

    def test_identity_has_no_login(self):
        sysusers=(DEPLOY/"gpt02-issue159-verifier.sysusers").read_text()
        self.assertIn("u gpt02-issue159-verifier",sysusers)
        self.assertIn("/usr/sbin/nologin",sysusers)

    def test_verifier_stays_read_only_and_group_socket_is_private(self):
        runtime=(DEPLOY/"gpt02_issue159_writer_broker_runtime.py").read_text()
        for required in ("parent.mkdir(mode=0o750","pst.st_gid != gid",
                         "stat.S_IMODE(pst.st_mode) != 0o750",
                         "os.chmod(socket_path, 0o660)",
                         '"databaseConnected": False',
                         '"writerEnabled": False',
                         '"releaseDecision": "NO_GO"'):
            self.assertIn(required,runtime,required)
        for forbidden in ("psycopg","sqlite3","Ed25519PrivateKey",
                          "INSERT INTO","UPDATE ","DELETE FROM","key.sign("):
            self.assertNotIn(forbidden,runtime,forbidden)

if __name__=="__main__":
    unittest.main()
