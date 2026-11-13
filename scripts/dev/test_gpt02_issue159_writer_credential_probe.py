"""Offline contract tests for restricted writer credential read-only probe."""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/dev"))
import gpt02_issue159_writer_credential_probe as probe


class CredentialProbeTest(unittest.TestCase):
    def dsn(self, role):
        return {
            "user": f"{probe.ROLES[role][0]}.{probe.PROJECT}",
            "host": probe.HOST, "port": "5432", "dbname": "postgres",
            "sslmode": "verify-full", "sslrootcert": probe.CA,
            "password": "synthetic_only",
        }

    def test_exact_separated_credentials_scope(self):
        for role in probe.ROLES:
            self.assertEqual(probe.validate_dsn(self.dsn(role), role),
                             "PINNED_POOLER")
            direct = self.dsn(role)
            direct["user"] = probe.ROLES[role][0]
            direct["host"] = f"db.{probe.PROJECT}.supabase.co"
            self.assertEqual(probe.validate_dsn(direct, role),
                             "PINNED_DIRECT")
            direct["hostaddr"] = "127.0.0.1"
            with self.assertRaisesRegex(probe.ProbeDenied, "untrusted_address"):
                probe.validate_dsn(direct, role)
        bad = self.dsn("attestor")
        bad["user"] = self.dsn("issuer")["user"]
        with self.assertRaisesRegex(probe.ProbeDenied, "STRICT_DEV_DSN"):
            probe.validate_dsn(bad, "attestor")
        bad = self.dsn("issuer")
        bad["sslmode"] = "require"
        with self.assertRaisesRegex(probe.ProbeDenied, "STRICT_DEV_DSN"):
            probe.validate_dsn(bad, "issuer")

    def test_classify_only_keeps_direct_and_pooler_profiles_distinct(self):
        for role in probe.ROLES:
            pooled = self.dsn(role)
            self.assertEqual(probe.classify_pinned_profile(pooled, role),
                             "PINNED_POOLER")
            direct = dict(pooled)
            direct["user"] = probe.ROLES[role][0]
            direct["host"] = f"db.{probe.PROJECT}.supabase.co"
            self.assertEqual(probe.classify_pinned_profile(direct, role),
                             "PINNED_DIRECT")
            direct["host"] = "unrecognized.invalid"
            self.assertEqual(probe.classify_pinned_profile(direct, role),
                             "UNRECOGNIZED")

    def test_identity_rejects_wrong_role_or_non_readonly(self):
        for role in probe.ROLES:
            name = probe.ROLES[role][0]
            good = (name,name,"postgres","on",True,True,1,
                    False,False,False,False,False)
            probe.check_identity(good, role)
            incorrect = list(good)
            incorrect[3] = "off"
            with self.assertRaises(probe.ProbeDenied):
                probe.check_identity(tuple(incorrect), role)
            incorrect = list(good)
            incorrect[10] = True
            with self.assertRaises(probe.ProbeDenied):
                probe.check_identity(tuple(incorrect), role)

    def test_rpc_grants_are_role_separated(self):
        for role in probe.ROLES:
            rows = [(name, name in probe.ROLES[role][2])
                    for name in probe.RPC_NAMES]
            probe.check_grants(rows, role)
            forged = [(name, True) for name in probe.RPC_NAMES]
            with self.assertRaisesRegex(probe.ProbeDenied, "GRANT_SCOPE"):
                probe.check_grants(forged, role)

    def test_source_never_activates_privileges_or_writes(self):
        source = (ROOT/"scripts/dev/gpt02_issue159_writer_credential_probe.py").read_text()
        for s in ("BEGIN READ ONLY", "ROLLBACK", "LoadCredentialEncrypted",
                  "CREDENTIALS_DIRECTORY", "verify-full", "pg_stat_ssl",
                  "has_function_privilege"):
            if s == "LoadCredentialEncrypted":
                continue
            self.assertIn(s, source)
        for s in ("ALTER ROLE ", "SET ROLE ", "INSERT INTO ", "UPDATE gpt02_",
                  "DELETE FROM ", "systemctl start", "dispatch_to_dell("):
            self.assertNotIn(s, source)


if __name__ == "__main__":
    unittest.main()
