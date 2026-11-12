"""Static guard: private GPT02 preflight must be exact, read-only, and fail closed."""
from pathlib import Path
import re
import unittest

SOURCE = (Path(__file__).resolve().parents[2] /
          "scripts/dev/gpt02_issue159_lifecycle_catalog_preflight.sql")

class LifecyclePrivilegeGateSource(unittest.TestCase):
    def setUp(self):
        self.sql = SOURCE.read_text()

    def test_exact_six_rpc_schemas_roles_and_grants(self):
        for name in (
            "prepare_core_task", "record_linked_approval",
            "consume_linked_approval", "reserve_post_consumption_fence",
            "record_issuer_evidence", "consume_issuer_lease",
        ):
            self.assertIn(name+"(", self.sql)
        for role in (
            "gpt02_core_prep_login", "dev_gpt02_attestor_evidence",
            "dev_gpt02_issuer_evidence", "dev_gpt02_claim_writer_nologin",
        ):
            self.assertIn(role, self.sql)
        for role in ("anon", "authenticated", "service_role"):
            self.assertIn("has_function_privilege('"+role+"'", self.sql)
        self.assertIn("has_function_privilege(ef.executor_role,p.oid,'EXECUTE')",self.sql)
        self.assertIn("aclexplode(", self.sql)
        self.assertIn("a.grantee=0", self.sql)
        self.assertIn("p.prosecdef IS TRUE", self.sql)
        self.assertIn("search_path=pg_catalog", self.sql)

    def test_explicit_eight_tables_and_all_forced_rls(self):
        for table in (
            "core_preparations", "approvals", "operator_links", "receipts",
            "core_identity_receipts", "post_consumption_fences",
            "issuer_evidences", "issuer_lease_consumptions",
        ):
            self.assertIn("'"+table+"'", self.sql)
        for required in ("c.relrowsecurity IS TRUE",
                         "c.relforcerowsecurity IS TRUE",
                         "forced_rls_table_count",
                         "AS required_table_count",
                         "(SELECT count(*) FROM table_checks WHERE safe)=8"):
            self.assertIn(required, self.sql)

    def test_standby_no_login_and_no_authorization(self):
        for phrase in (
            "p.rolcanlogin IS FALSE", "p.rolbypassrls IS FALSE",
            "CATALOG_PRIVILEGE_STANDBY_PASS_NOT_E2E_AUTHORIZED",
            "NO_GO_REVIEW_REQUIRED",
        ):
            self.assertIn(phrase, self.sql)
        # SQL must never mutate database state or change roles/permissions.
        source = re.sub(r"--[^\n]*", "", self.sql).upper()
        for sql_word in ("INSERT INTO", "UPDATE ", "DELETE FROM",
                         "DROP ", "ALTER ", "CREATE ", "GRANT ", "REVOKE ",
                         "SET ROLE", "CALL "):
            self.assertNotIn(sql_word, source, sql_word)

if __name__ == "__main__":
    unittest.main()
