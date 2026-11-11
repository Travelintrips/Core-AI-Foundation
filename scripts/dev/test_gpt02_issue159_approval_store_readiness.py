#!/usr/bin/env python3
import importlib.util
import json
import os
import sqlite3
import stat
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROBE_PATH = ROOT / "scripts/dev/gpt02_issue159_approval_store_readiness.py"
SCHEMA_PATH = ROOT / "deploy/ai-coding-standalone-dev/gpt02_issue159_approval_intent_schema.sql"

spec = importlib.util.spec_from_file_location("approval_store_probe", PROBE_PATH)
probe = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(probe)

LEGACY = """
CREATE TABLE approval_decisions (
 id TEXT PRIMARY KEY,
 job_id TEXT NOT NULL,
 decision TEXT NOT NULL,
 actor TEXT NOT NULL,
 artifact_hash TEXT NOT NULL,
 reason TEXT,
 created_at TEXT NOT NULL
);
CREATE TABLE admin_identities (
 user_id TEXT PRIMARY KEY,
 role TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE approval_permissions (
 principal TEXT NOT NULL,
 repository TEXT NOT NULL,
 environment TEXT NOT NULL,
 action TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(principal,repository,environment,action)
);
"""

class ApprovalStoreReadinessTest(unittest.TestCase):
    def db(self, schema=LEGACY):
        fd, path = tempfile.mkstemp(prefix="issue159-approval-", suffix=".db")
        os.close(fd)
        con = sqlite3.connect(path)
        con.executescript(schema)
        con.commit()
        con.close()
        os.chmod(path, 0o600)
        self.addCleanup(lambda: os.path.exists(path) and os.unlink(path))
        return path

    def seed_mapping(self, path, hub_operator_id="user-1"):
        con=sqlite3.connect(path)
        con.execute(
            "INSERT OR REPLACE INTO admin_identities(user_id,role,enabled) VALUES (?,?,1)",
            ("auth-fixture-"+hub_operator_id,"super_admin"),
        )
        con.execute(
            """INSERT OR REPLACE INTO gpt02_issue159_admin_operator_links
            (auth_user_id,hub_operator_id,email,enabled) VALUES (?,?,?,1)""",
            ("auth-fixture-"+hub_operator_id,hub_operator_id,
             hub_operator_id+"@example.com"),
        )
        con.commit(); con.close()

    def test_legacy_store_fails_closed_without_issue159_binding_table(self):
        path = self.db()
        out = probe.inspect(path, operational=False)
        self.assertEqual(out["reason"], "ISSUE159_APPROVAL_INTENT_TABLE_MISSING")
        self.assertTrue(out["legacyDecisionTablePresent"])
        self.assertFalse(out["approvalIntentTablePresent"])
        self.assertFalse(out["trustedPersistedReadReady"])
        self.assertFalse(out["signingPermitted"])
        self.assertEqual(out["releaseDecision"], "NO_GO")

    def test_exact_schema_is_readable_but_never_signing_authority(self):
        path = self.db()
        con = sqlite3.connect(path)
        con.executescript(SCHEMA_PATH.read_text())
        con.commit(); con.close()
        self.seed_mapping(path, "user-1")
        con = sqlite3.connect(path)
        con.execute(
            "INSERT INTO approval_decisions VALUES (?,?,?,?,?,?,?)",
            ("88888888-8888-4888-8888-888888888888","job-1","APPROVE",
             "user-1","f"*64,"","2026-11-11T00:00:00Z"),
        )
        con.execute(
            """INSERT INTO gpt02_issue159_approval_intents
            (id,task_id,command_id,attempt_id,company_id,
             claims_sha256,actor_id,auth_method,role_at_decision,decision,
             recorded_at_ms,expires_at_ms)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("99999999-9999-4999-8999-999999999999",140,
             "11111111-1111-4111-8111-111111111111",
             "22222222-2222-4222-8222-222222222222","default",
             "a"*64,"user-1","supabase_aal2","super_admin","APPROVE",1000,2000),
        )
        con.commit()
        con.close()

        out = probe.inspect(path, operational=False)
        self.assertEqual(out["reason"],
                         "ISSUE159_APPROVAL_STORE_READY_NO_SIGNING_AUTHORITY")
        self.assertTrue(out["approvalIntentSchemaExact"])
        self.assertTrue(out["approvalIntentSelfContainedDecision"])
        self.assertTrue(out["approvalIntentLookupIndexExact"])
        self.assertEqual(out["approvalIntentRows"], 1)
        self.assertTrue(out["operationalEvidenceAvailable"])
        self.assertTrue(out["trustedPersistedReadReady"])
        self.assertFalse(out["signingPermitted"])
        self.assertFalse(out["authorizationGranted"])
        self.assertFalse(out["dispatchPermitted"])

    def test_empty_exact_schema_is_schema_ready_not_evidence_ready(self):
        path = self.db()
        con = sqlite3.connect(path)
        con.executescript(SCHEMA_PATH.read_text())
        con.commit()
        con.close()
        self.seed_mapping(path, "empty-store-admin")
        out = probe.inspect(path, operational=False)
        self.assertEqual(out["reason"],
                         "ISSUE159_APPROVAL_STORE_READY_NO_SIGNING_AUTHORITY")
        self.assertTrue(out["approvalIntentSchemaExact"])
        self.assertTrue(out["approvalIntentSelfContainedDecision"])
        self.assertTrue(out["approvalIntentLookupIndexExact"])
        self.assertEqual(out["approvalIntentRows"], 0)
        self.assertFalse(out["operationalEvidenceAvailable"])
        self.assertTrue(out["trustedPersistedReadReady"])

    def test_missing_lookup_index_fails_closed(self):
        path = self.db()
        con = sqlite3.connect(path)
        schema = SCHEMA_PATH.read_text().replace(
            "CREATE INDEX IF NOT EXISTS idx_gpt02_issue159_approval_intents_lookup\n"
            "  ON gpt02_issue159_approval_intents(\n"
            "    company_id, task_id, command_id, attempt_id, claims_sha256, actor_id\n"
            "  );\n", ""
        )
        con.executescript(schema)
        con.commit()
        con.close()
        self.seed_mapping(path, "index-admin")
        out = probe.inspect(path, operational=False)
        self.assertEqual(out["reason"], "ISSUE159_APPROVAL_INTENT_INDEX_DRIFT")
        self.assertTrue(out["approvalIntentSelfContainedDecision"])
        self.assertFalse(out["approvalIntentLookupIndexExact"])
        self.assertFalse(out["trustedPersistedReadReady"])

    def test_schema_drift_fails_closed(self):
        path = self.db()
        con = sqlite3.connect(path)
        con.executescript(SCHEMA_PATH.read_text())
        con.execute("DROP TABLE gpt02_issue159_approval_intents")
        con.execute("""CREATE TABLE gpt02_issue159_approval_intents (
          id TEXT PRIMARY KEY, task_id INTEGER NOT NULL
        )""")
        con.commit()
        con.close()
        self.seed_mapping(path, "drift-admin")
        out = probe.inspect(path, operational=False)
        self.assertEqual(out["reason"], "ISSUE159_APPROVAL_INTENT_SCHEMA_DRIFT")
        self.assertFalse(out["trustedPersistedReadReady"])

    def test_intent_schema_without_operator_mapping_fails_closed(self):
        path=self.db()
        con=sqlite3.connect(path)
        con.executescript(SCHEMA_PATH.read_text())
        con.execute("DROP TABLE gpt02_issue159_admin_operator_links")
        con.commit(); con.close()
        out=probe.inspect(path,operational=False)
        self.assertEqual(out["reason"],"ISSUE159_ADMIN_OPERATOR_MAPPING_TABLE_MISSING")
        self.assertFalse(out["trustedPersistedReadReady"])

    def test_legacy_task139_actor_does_not_poison_fresh_mapping_readiness(self):
        path=self.db()
        con=sqlite3.connect(path)
        legacy_schema=SCHEMA_PATH.read_text().replace(
            "task_id INTEGER NOT NULL CHECK (task_id > 139)",
            "task_id INTEGER NOT NULL CHECK (task_id > 136)",
        )
        con.executescript(legacy_schema)
        con.commit(); con.close()
        self.seed_mapping(path, "current-hub-admin")
        con=sqlite3.connect(path)
        con.execute(
            """INSERT INTO gpt02_issue159_approval_intents
            (id,task_id,command_id,attempt_id,company_id,claims_sha256,actor_id,
             auth_method,role_at_decision,decision,recorded_at_ms,expires_at_ms)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("dddddddd-dddd-4ddd-8ddd-dddddddddddd",139,
             "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
             "ffffffff-ffff-4fff-8fff-ffffffffffff","default","c"*64,
             "legacy-auth-subject","supabase_aal2","super_admin","APPROVE",1000,2000),
        )
        con.commit(); con.close()
        out=probe.inspect(path,operational=False)
        self.assertEqual(out["reason"],"ISSUE159_APPROVAL_STORE_READY_NO_SIGNING_AUTHORITY")
        self.assertTrue(out["adminOperatorMappingReady"])
        self.assertEqual(out["fallbackActorRowsInIntentTable"],0)
        self.assertTrue(out["trustedPersistedReadReady"])

    def test_operational_path_is_pinned_and_source_is_read_only(self):
        path = self.db()
        out = probe.inspect(path, operational=True)
        self.assertEqual(out["reason"], "OPERATIONAL_DB_PATH_NOT_PINNED")

        source = PROBE_PATH.read_text()
        self.assertIn("mode=ro", source)
        self.assertIn("PRAGMA query_only=ON", source)
        for forbidden in (
            "INSERT INTO", "UPDATE ", "DELETE FROM", "DROP TABLE",
            "ALTER TABLE", "CREATE TABLE",
        ):
            self.assertNotIn(forbidden, source)



    def test_verified_super_admin_session_is_valid_without_separate_aal2_challenge(self):
        path = self.db()
        con = sqlite3.connect(path)
        con.executescript(SCHEMA_PATH.read_text())
        con.commit(); con.close()
        self.seed_mapping(path, "active-super-admin")
        con = sqlite3.connect(path)
        con.execute(
            """INSERT INTO gpt02_issue159_approval_intents
            (id,task_id,command_id,attempt_id,company_id,
             claims_sha256,actor_id,auth_method,role_at_decision,decision,
             recorded_at_ms,expires_at_ms)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",140,
             "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
             "cccccccc-cccc-4ccc-8ccc-cccccccccccc","default",
             "b"*64,"active-super-admin","supabase_admin_session",
             "super_admin","APPROVE",1000,2000),
        )
        con.commit()
        con.close()
        out = probe.inspect(path, operational=False)
        self.assertEqual(out["reason"],
                         "ISSUE159_APPROVAL_STORE_READY_NO_SIGNING_AUTHORITY")
        self.assertEqual(out["approvalIntentRows"], 1)
        self.assertEqual(out["fallbackActorRowsInIntentTable"], 0)
        self.assertTrue(out["operationalEvidenceAvailable"])
        self.assertFalse(out["signingPermitted"])
        self.assertFalse(out["dispatchPermitted"])

if __name__ == "__main__":
    unittest.main()
