"""Source-level safety tests only; no systemd service installation."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
UNIT = ROOT / "deploy/ai-coding-standalone-dev/gpt02-issue159-lineage-reader.service"
SYSUSERS = ROOT / "deploy/ai-coding-standalone-dev/gpt02-issue159-lineage-reader.sysusers"
RUNTIME = ROOT / "deploy/ai-coding-standalone-dev/gpt02_issue159_lineage_reader_runtime.py"

class LineageServicePolicyTest(unittest.TestCase):
    def test_dedicated_identity_not_signer_or_writer(self):
        unit = UNIT.read_text()
        self.assertIn("User=gpt02-lineage-reader", unit)
        self.assertIn("Group=gpt02-issue159-signers", unit)
        self.assertIn("RuntimeDirectory=gpt02-lineage-reader", unit)
        self.assertIn("RuntimeDirectoryMode=0750", unit)
        self.assertIn("995", unit)  # explicit known DEV verifier UID, preflight before install
        self.assertIn("u gpt02-lineage-reader -", SYSUSERS.read_text())
        self.assertNotIn("User=root", unit)

    def test_encrypted_credential_and_tls_material(self):
        unit=UNIT.read_text()
        self.assertIn("LoadCredentialEncrypted=lineage-reader-dsn:",unit)
        self.assertIn("ConditionPathExists=/etc/credstore.encrypted/gpt02-issue159-lineage-reader-dsn",unit)
        self.assertIn("LoadCredential=supabase-root-ca-2021.crt:",unit)
        self.assertIn("ConditionPathExists=/etc/gpt02-dev/supabase-root-ca-2021.crt",unit)
        self.assertNotIn("Environment=DATABASE_URL=",unit)
        self.assertNotIn("Environment=PGPASSWORD=",unit)
        self.assertNotIn("Environment=SUPABASE_SERVICE_ROLE",unit)

    def test_sandbox_and_no_dispatch_flags(self):
        unit=UNIT.read_text()
        for required in ("NoNewPrivileges=yes","ProtectSystem=strict",
                         "ProtectHome=yes","PrivateTmp=yes","PrivateDevices=yes",
                         "CapabilityBoundingSet=","AmbientCapabilities=",
                         "MemoryMax=128M","UMask=0077","RestrictSUIDSGID=yes",
                         "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6"):
            self.assertIn(required,unit)
        self.assertNotIn("ExecStartPost=",unit)
        self.assertNotIn("GPT02_ISSUE159_SIGNING_ENABLED=true",unit)
        self.assertNotIn("dispatchPermitted=true",unit)

    def test_socket_checks_exact_peer_and_directory(self):
        runtime=RUNTIME.read_text()
        for required in ("SO_PEERCRED","st.st_uid != os.getuid()",
                         "st.st_gid != os.getgid()",
                         "stat.S_IMODE(st.st_mode) != 0o750",
                         "stat.S_IMODE(sock_stat.st_mode) != 0o660",
                         "PINNED_VERIFIER_UID_REQUIRED"):
            self.assertIn(required,runtime)


if __name__ == "__main__":
    unittest.main()
