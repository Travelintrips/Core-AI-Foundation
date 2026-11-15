#!/usr/bin/env python3
"""Proof-only exact-task policy proposal against disposable PG16.

Current CST-DEV's actual five table names and column types inform the
generator. All DDL is applied ONLY to a network-isolated disposable
PostgreSQL 16 fixture. NO live migration, role activation, credentials,
signer, worker or dispatch.
"""
from __future__ import annotations

import copy
import re
import subprocess
import time
import unittest
import uuid
from unittest.mock import patch

from gpt02_issue159_scoped_policy_proposal import (
    proposed_sql, validate_inert_candidate, TABLE_COLUMNS,
    review_sql_from_authenticated_signed_packet
)
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError
from test_gpt02_issue159_signed_scope_pg import (
    make_candidate, FIVE_TABLE_FIXTURE, quote, bound_query
)


def run(*args, stdin=None, check=True):
    r = subprocess.run(args, input=stdin, text=True,
                       capture_output=True, timeout=60)
    if check and r.returncode:
        raise RuntimeError("DISPOSABLE_SQL_FAILED:" + r.stderr[-1800:])
    return r


def sql(name, body, check=True):
    return run("docker", "exec", "-i", name, "psql", "-X",
               "-v", "ON_ERROR_STOP=1", "-U", "root_admin",
               "-d", "postgres", "-At", stdin=body, check=check)


def migrator_sql(name, body, check=True):
    # Synthetic privileged migration identity is CREATEROLE but NOT superuser.
    return run("docker", "exec", "-i", "-e",
               "PGPASSWORD=synthetic_migrator_only", name,
               "psql", "-X", "-w", "-h", "127.0.0.1",
               "-v", "ON_ERROR_STOP=1", "-U", "postgres",
               "-d", "postgres", "-At", stdin=body, check=check)


class PolicyProposalSourceTest(unittest.TestCase):
    def setUp(self):
        self.candidate = make_candidate()
        # Existing signed packet fixture uses this synthetic clock.
        self.observed_ms = 1_800_000_000_000

    def test_operational_review_entrypoint_uses_pinned_roots_and_trusted_lineage(self):
        from test_gpt02_issue159_postlineage_reader_scope import (
            PostlineageReaderScopeOfflineTest,
        )
        import gpt02_issue159_positive_permit_handoff as handoff
        import gpt02_issue159_writer_broker_runtime as broker

        synthetic = PostlineageReaderScopeOfflineTest()
        synthetic.setUp()
        with patch.object(broker, "_load_public_roots",
                          return_value=synthetic.fixture.roots) as root_reader:
            # Only the private verifier's pinned socket response is mocked.
            # Four Ed25519 packet signatures are verified for real below.
            with patch.object(handoff, "inspect_proposed_permit_candidate",
                              return_value=synthetic.proof) as verified_reader:
                with patch.object(handoff.time, "time",
                                  return_value=self.observed_ms / 1000):
                    ddl = review_sql_from_authenticated_signed_packet(
                        synthetic.fixture.packet,
                    )
        root_reader.assert_called_once_with(
            handoff.VERIFIER_PUBLIC_ROOT_DIR,
            broker.DEFAULT_FINGERPRINT_MANIFEST,
        )
        verified_reader.assert_called_once_with(
            synthetic.fixture.packet,
            synthetic.fixture.roots,
        )
        self.assertRegex(ddl, r"CREATE ROLE dev_gpt02_task_140_[a-f0-9]{12} NOLOGIN")
        self.assertEqual(ddl.count("CREATE POLICY "), 5)
        self.assertNotIn("ALTER ROLE", ddl)
        self.assertIn("GRANT gpt02_store_owner TO postgres WITH SET TRUE;", ddl)
        self.assertIn("SET ROLE gpt02_store_owner;", ddl)
        self.assertIn("GRANT gpt02_store_owner TO postgres WITH SET FALSE;", ddl)
        self.assertIn("SCOPED_POLICY_OWNER_PRIVILEGE_NOT_RESTORED", ddl)
        self.assertNotIn("PASSWORD", ddl)
        print("PASS_SIGNED_PACKET_TO_PINNED_ROOT_AND_PERSISTED_LINEAGE_REVIEW_SQL")

    def test_operational_review_rejects_tamper_and_substituted_roots(self):
        from test_gpt02_issue159_postlineage_reader_scope import (
            PostlineageReaderScopeOfflineTest,
        )
        import gpt02_issue159_positive_permit_handoff as handoff
        import gpt02_issue159_writer_broker_runtime as broker

        synthetic = PostlineageReaderScopeOfflineTest()
        synthetic.setUp()
        packet = copy.deepcopy(synthetic.fixture.packet)
        packet["issuerEvidence"]["claims"]["receiptId"] = (
            "69999999-9999-4999-8999-999999999999"
        )
        with patch.object(broker, "_load_public_roots",
                          return_value=synthetic.fixture.roots):
            with patch.object(handoff, "inspect_proposed_permit_candidate",
                              return_value=synthetic.proof):
                with patch.object(handoff.time, "time",
                                  return_value=self.observed_ms / 1000):
                    with self.assertRaises(BrokerAdmissionError):
                        review_sql_from_authenticated_signed_packet(packet)

        roots = dict(synthetic.fixture.roots)
        roots["core"] = roots["hub"]  # fail four independent key custody
        with patch.object(broker, "_load_public_roots", return_value=roots):
            with patch.object(handoff, "inspect_proposed_permit_candidate",
                              return_value=synthetic.proof):
                with patch.object(handoff.time, "time",
                                  return_value=self.observed_ms / 1000):
                    with self.assertRaises(BrokerAdmissionError):
                        review_sql_from_authenticated_signed_packet(
                            synthetic.fixture.packet
                        )
        with self.assertRaises(TypeError):
            review_sql_from_authenticated_signed_packet(
                synthetic.fixture.packet, requested_role="postgres",
            )
        print("PASS_FORGED_RECEIPT_OR_PUBLIC_ROOT_CANNOT_GENERATE_REVIEW_SQL")

    def test_exact_signed_scope_renders_only_dormant_role_and_five_policies(self):
        ddl = proposed_sql(self.candidate, self.observed_ms)
        self.assertEqual(ddl.count("CREATE ROLE "), 1)
        self.assertEqual(ddl.count(" NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0"), 1)
        self.assertEqual(ddl.count("CREATE POLICY "), 5)
        self.assertEqual(ddl.count("GRANT SELECT ("), 5)
        self.assertEqual(ddl.count("clock_timestamp() < to_timestamp("), 5)
        self.assertNotIn("SECURITY DEFINER", ddl)
        self.assertNotIn("ALTER ROLE", ddl)
        self.assertNotIn("PASSWORD", ddl)
        self.assertNotIn("service_role", ddl)
        self.assertNotIn("dispatch_enabled", ddl)
        self.assertEqual(ddl.count("GRANT USAGE ON SCHEMA"), 1)
        self.assertEqual(len(TABLE_COLUMNS), 5)

    def test_malformed_or_caller_overridden_scope_does_not_render(self):
        attempts = [
            ("candidateRole", "postgres"),
            ("scopeSha256", "f" * 64),
            ("verifiedPacketSha256", "f" * 64),
            ("environment", "PROD"),
            ("releaseDecision", "GO"),
            ("persistedLineageMatched", False),
            ("credentialIssuancePermitted", True),
            ("expiresAt", self.observed_ms),
        ]
        for field, changed in attempts:
            with self.subTest(field=field):
                altered = copy.deepcopy(self.candidate)
                altered[field] = changed
                with self.assertRaises(BrokerAdmissionError):
                    proposed_sql(altered, self.observed_ms)

    def test_signed_role_binding_rejects_attempted_sql_injection(self):
        altered = copy.deepcopy(self.candidate)
        altered["scope"]["company_id"] = "default'; DROP SCHEMA gpt02_private; --"
        with self.assertRaises(BrokerAdmissionError):
            proposed_sql(altered, self.observed_ms)
        altered = copy.deepcopy(self.candidate)
        altered["scope"]["task_id"] = 172
        with self.assertRaises(BrokerAdmissionError):
            proposed_sql(altered, self.observed_ms)
        altered = copy.deepcopy(self.candidate)
        altered["scope"]["approval_digest"] = "f" * 64
        with self.assertRaises(BrokerAdmissionError):
            proposed_sql(altered, self.observed_ms)

    def test_expired_candidate_not_accepted_for_policy(self):
        with self.assertRaises(BrokerAdmissionError):
            proposed_sql(self.candidate, self.candidate["expiresAt"])
        with self.assertRaises(BrokerAdmissionError):
            proposed_sql(self.candidate, 0)


def disposable_live_schema_layout_test():
    candidate = make_candidate()
    scope = candidate["scope"]
    role = candidate["candidateRole"]
    proposal = proposed_sql(candidate, 1_800_000_000_000)
    name = "issue159-schema-grounded-" + uuid.uuid4().hex[:10]
    try:
        run("docker", "run", "--rm", "-d", "--network", "none",
            "--name", name, "-e", "POSTGRES_PASSWORD=fixture_only",
            "-e", "POSTGRES_USER=root_admin",
            "postgres:16-alpine")
        for _ in range(120):
            ready = run(
                "docker", "exec", "-e", "PGPASSWORD=fixture_only",
                name, "psql", "-X", "-w", "-h", "127.0.0.1",
                "-U", "root_admin", "-d", "postgres", "-Atc", "SELECT 1",
                check=False,
            )
            if ready.returncode == 0:
                break
            time.sleep(.25)
        else:
            raise RuntimeError("FINAL_PG_TCP_NOT_READY")

        # Existing fixture tests a second, same-company Task172. Extend its
        # columns to match exact LIVE CST-DEV names used by this proposal.
        fixture = FIVE_TABLE_FIXTURE
        for old, new in (
            ("'n170'", quote(scope["approval_nonce"])),
            ("'d170'", quote(scope["approval_digest"])),
            ("'link170'", quote(scope["link_digest"])),
        ):
            if old not in fixture:
                raise AssertionError("SOURCE_FIXTURE_MISMATCH")
            fixture = fixture.replace(old, new)
        seeded = sql(name, fixture)
        if "PASS_FIVE_TABLE_DIRECT_ENUMERATION_SCOPED" not in seeded.stderr:
            raise AssertionError("INITIAL_FIXTURE_NOT_PASS")
        sql(name, """
ALTER TABLE gpt02_private.approvals
  ADD COLUMN operator_namespace text DEFAULT 'ai-task-hub.public.users';
ALTER TABLE gpt02_private.operator_links
  ADD COLUMN attempt_number integer DEFAULT 1;
ALTER TABLE gpt02_private.operator_links
  ADD COLUMN claims jsonb DEFAULT '{"environment":"DEV"}';
""")
        # Model actual CST-DEV owner/migrator separation. The bootstrap
        # root_admin owns the fixture initially; the real five tables are
        # owned by a NOLOGIN gpt02_store_owner. The 'postgres' migrator has
        # CREATEROLE but is explicitly NOT a PostgreSQL superuser.
        sql(name, """CREATE ROLE gpt02_store_owner NOLOGIN NOINHERIT;
CREATE ROLE postgres LOGIN CREATEROLE NOINHERIT
 PASSWORD 'synthetic_migrator_only';
ALTER SCHEMA gpt02_private OWNER TO gpt02_store_owner;
DO $owner$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['approvals','operator_links','receipts',
 'core_identity_receipts','post_consumption_fences'] LOOP
 EXECUTE format('ALTER TABLE gpt02_private.%I OWNER TO gpt02_store_owner', t);
 END LOOP;
END $owner$;
""")
        # Missing ADMIN OPTION must fail BEFORE CREATE ROLE/GRANT/POLICY.
        missing_owner = migrator_sql(name, proposal, check=False)
        if (missing_owner.returncode == 0
                or 'SCOPED_POLICY_OWNER_CUSTODY_BASELINE_INVALID'
                not in missing_owner.stderr):
            raise AssertionError("MIGRATOR_WITHOUT_OWNER_ADMIN_WAS_ACCEPTED")
        sql(name, """GRANT gpt02_store_owner TO postgres
 WITH ADMIN TRUE, SET FALSE;""")
        initial_set = sql(name,
            "SELECT pg_has_role('postgres','gpt02_store_owner','SET')")
        if initial_set.stdout.strip() != "f":
            raise AssertionError("PREEXISTING_STORE_OWNER_SET_PRIVILEGE")
        print("PASS_MIGRATOR_NO_SUPERUSER_OWNER_CUSTODY_PREFLIGHT")

        # Fault AFTER temporary SET ROLE owner but BEFORE any GRANT or POLICY.
        # On error the transaction and owner-role membership must roll back;
        # no login or dangling per-task role may remain.
        marker = "SET ROLE gpt02_store_owner;\n"
        if proposal.count(marker) != 1:
            raise AssertionError("OWNER_SET_ROLE_SEQUENCE_NOT_UNIQUE")
        faulted = proposal.replace(
            marker,
            marker +
            "DO $fault$ BEGIN RAISE EXCEPTION "
            "'SYNTHETIC_FAULT_AFTER_TEMP_OWNER_SET'; END $fault$;\n",
            1,
        )
        broken = migrator_sql(name, faulted, check=False)
        if (broken.returncode == 0
                or "SYNTHETIC_FAULT_AFTER_TEMP_OWNER_SET"
                not in broken.stderr):
            raise AssertionError("TEMP_OWNER_SET_FAULT_NOT_OBSERVED")
        rollback_state = sql(name,
            "SELECT NOT pg_has_role('postgres','gpt02_store_owner','SET'); "
            "SELECT count(*) FROM pg_roles WHERE rolname=" + quote(role))
        if rollback_state.stdout.splitlines()[-2:] != ["t", "0"]:
            raise AssertionError("FAILED_TRANSACTION_LEFT_OWNER_GRANT_OR_ROLE")
        print("PASS_TEMP_OWNER_SET_AND_ROLE_CREATION_ROLLBACK_ON_FAILURE")

        # This test executes proposal as non-superuser role postgres, not
        # root_admin. The temporary SET TRUE, SET ROLE owner and SET FALSE
        # must happen within one transaction and restore the original lock.
        migrator_sql(name, proposal)
        restored = sql(name,
            "SELECT NOT rolsuper AND rolcreaterole FROM pg_roles "
            "WHERE rolname='postgres'; "
            "SELECT pg_has_role('postgres','gpt02_store_owner','SET')")
        if restored.stdout.splitlines()[-2:] != ["t", "f"]:
            raise AssertionError("STORE_OWNER_SET_PRIVILEGE_NOT_RESTORED")
        print("PASS_NON_SUPERUSER_CUSTODY_TEMP_GRANT_AND_RELOCK")
        print("PASS_SOURCE_ONLY_POLICY_COMPILES_AGAINST_LIVE_COLUMN_NAMES")

        role_state = sql(name,
            "SELECT NOT rolcanlogin AND rolconnlimit=0 AND "
            "NOT rolinherit AND NOT rolbypassrls FROM pg_roles "
            "WHERE rolname=" + quote(role))
        if role_state.stdout.strip() != "t":
            raise AssertionError("POLICY_ROLE_NOT_DORMANT")
        print("PASS_NEW_SCOPED_ROLE_NOLOGIN_CONN_LIMIT_ZERO")
        no_members = sql(name,
            "SELECT count(*) FROM pg_auth_members m JOIN pg_roles r "
            "ON r.oid=m.member WHERE r.rolname=" + quote(role))
        if no_members.stdout.strip() != "0":
            raise AssertionError("SCOPED_ROLE_INHERITED_BROAD_READ_PRIVILEGE")
        all_table_read = sql(name,
            "SELECT has_table_privilege(" + quote(role) +
            ",'gpt02_private.approvals','SELECT')")
        any_column_read = sql(name,
            "SELECT has_any_column_privilege(" + quote(role) +
            ",'gpt02_private.approvals','SELECT')")
        if all_table_read.stdout.strip() != "f" or any_column_read.stdout.strip() != "t":
            raise AssertionError("SCOPED_ROLE_NOT_COLUMN_ONLY_SELECT")
        print("PASS_NO_BROAD_ROLE_INHERITANCE_OR_TABLE_LEVEL_SELECT")

        # Under SELECT-column grants (NOT table SELECT) every required
        # canonical query field and RLS predicate must still work.
        query = bound_query(scope)
        one = sql(name,
            "SET ROLE " + role + "; SELECT count(*) FROM (" +
            query + ") AS scoped; RESET ROLE;")
        if "1" not in one.stdout.splitlines():
            raise AssertionError("ORIGINAL_QUERY_FAILED_ON_COLUMN_GRANTS")
        print("PASS_ORIGINAL_CANONICAL_SQL_USING_COLUMN_ONLY_GRANTS")

        for table in TABLE_COLUMNS:
            got = sql(name, "SET ROLE " + role +
                      "; SELECT count(*) FROM gpt02_private." +
                      table + "; RESET ROLE;")
            if "1" not in got.stdout.splitlines():
                raise AssertionError("EXACT_ROLE_ENUMERATION_" + table)
        wrong = sql(name, "SET ROLE " + role +
                    "; SELECT count(*) FROM gpt02_private.approvals "
                    "WHERE task_id=172; RESET ROLE;")
        if "0" not in wrong.stdout.splitlines():
            raise AssertionError("SAME_COMPANY_OTHER_TASK_VISIBLE")
        print("PASS_FIVE_TABLE_DIRECT_ENUMERATION_ONLY_OWN_TASK")

        denied = sql(name, "SET ROLE " + role +
                     "; INSERT INTO gpt02_private.approvals(task_id) "
                     "VALUES (999); RESET ROLE;", check=False)
        if denied.returncode == 0:
            raise AssertionError("UNEXPECTED_SCOPED_ROLE_WRITE")
        improper = sql(name, "SET ROLE " + role +
                       "; SELECT approver_id FROM gpt02_private.approvals; "
                       "RESET ROLE;", check=False)
        if improper.returncode == 0:
            raise AssertionError("UNEXPECTED_SENSITIVE_COLUMN_READ")
        print("PASS_WRITES_AND_NON_GRANTED_COLUMNS_DENIED")

        # The exact proposal may not be re-applied to silently create a
        # second task/role, or change an existing policy.
        dup = migrator_sql(name, proposal, check=False)
        if dup.returncode == 0:
            raise AssertionError("PROPOSAL_WAS_NOT_DUPLICATE_SAFE_FAIL_CLOSED")
        restored_again = sql(name,
            "SELECT pg_has_role('postgres','gpt02_store_owner','SET')")
        if restored_again.stdout.strip() != "f":
            raise AssertionError("DUPLICATE_FAILURE_OWNER_PRIVILEGE_LEAK")
        print("PASS_REAPPLY_FAILS_CLOSED_NO_SILENT_REPLACE")
        print("PROPOSAL_ONLY_NO_CST_DEV_OR_PROD_MUTATION")
    finally:
        run("docker", "rm", "-f", name, check=False)


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(
        PolicyProposalSourceTest,
    )
    unit = unittest.TextTestRunner(verbosity=1).run(suite)
    if not unit.wasSuccessful():
        raise SystemExit("SCOPED_POLICY_UNIT_TEST_FAILURE")
    disposable_live_schema_layout_test()
