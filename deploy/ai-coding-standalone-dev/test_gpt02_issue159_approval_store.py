import sqlite3
import unittest
from pathlib import Path

from gpt02_issue159_approval_store import (
    TABLE,
    approval_claims_sha256,
    canonical_issue159_approval,
    record_issue159_approval,
)


def claims():
    return {
        "v": 2,
        "environment": "DEV",
        "audience": "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
        "taskId": 137,
        "commandId": "11111111-1111-4111-8111-111111111111",
        "attemptId": "22222222-2222-4222-8222-222222222222",
        "nonce": "A" * 44,
        "operatorNamespace": "ai-task-hub.public.users",
        "superAdminId": "google_fixture_super_admin",
        "companyId": "default",
        "issuedAt": 1000,
        "expiresAt": 120000,
    }


def identity():
    return {
        "user_id": "google_fixture_super_admin",
        "role": "super_admin",
        "auth_method": "supabase_aal2",
    }


class Issue159ApprovalStoreTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")

    def tearDown(self):
        self.db.close()

    def test_canonical_bytes_match_ai_task_field_order(self):
        expected = (
            '{"v":2,"environment":"DEV",'
            '"audience":"GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",'
            '"taskId":137,'
            '"commandId":"11111111-1111-4111-8111-111111111111",'
            '"attemptId":"22222222-2222-4222-8222-222222222222",'
            '"nonce":"' + ("A" * 44) + '",'
            '"operatorNamespace":"ai-task-hub.public.users",'
            '"superAdminId":"google_fixture_super_admin",'
            '"companyId":"default","issuedAt":1000,"expiresAt":120000}'
        )
        self.assertEqual(canonical_issue159_approval(claims()), expected)
        self.assertEqual(len(approval_claims_sha256(claims())), 64)

    def test_records_aal2_super_admin_provenance_idempotently_without_authority(self):
        first = record_issue159_approval(
            self.db, claims=claims(), identity=identity(), observed_at_ms=2000
        )
        second = record_issue159_approval(
            self.db, claims=claims(), identity=identity(), observed_at_ms=2000
        )
        self.assertTrue(first["inserted"])
        self.assertFalse(second["inserted"])
        self.assertEqual(first["approval_id"], second["approval_id"])
        self.assertEqual(first["claims_sha256"], approval_claims_sha256(claims()))
        self.assertEqual(first["auth_method"], "supabase_aal2")
        self.assertEqual(first["role_at_decision"], "super_admin")
        self.assertEqual(first["decision"], "APPROVE")
        self.assertFalse(first["signingExecuted"])
        self.assertFalse(first["authorizationGranted"])
        self.assertFalse(first["dispatchPermitted"])
        self.assertEqual(first["releaseDecision"], "NO_GO")
        count = self.db.execute(f"SELECT COUNT(*) FROM {TABLE}").fetchone()[0]
        self.assertEqual(count, 1)

    def test_rejects_static_token_admin_role_or_actor_mismatch(self):
        bad = [
            {
                "user_id": "dev_approval_token",
                "role": "super_admin",
                "auth_method": "supabase_aal2",
            },
            {
                "user_id": "google_fixture_super_admin",
                "role": "admin",
                "auth_method": "supabase_aal2",
            },
            {
                "user_id": "google_fixture_super_admin",
                "role": "super_admin",
                "auth_method": "static_dev_token",
            },
            {
                "user_id": "another_super_admin",
                "role": "super_admin",
                "auth_method": "supabase_aal2",
            },
        ]
        for item in bad:
            with self.subTest(item=item):
                with self.assertRaisesRegex(
                    ValueError, "GPT02_ISSUE159_AAL2_SUPER_ADMIN_REQUIRED"
                ):
                    record_issue159_approval(
                        self.db,
                        claims=claims(),
                        identity=item,
                        observed_at_ms=2000,
                    )
        self.assertEqual(
            self.db.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
                (TABLE,),
            ).fetchone()[0],
            0,
        )

    def test_rejects_claim_shape_scope_and_timing_drift_before_persistence(self):
        invalid = [
            {**claims(), "extra": True},
            {**claims(), "taskId": 136},
            {**claims(), "environment": "PROD"},
            {**claims(), "companyId": "*"},
            {**claims(), "commandId": claims()["attemptId"]},
            {**claims(), "expiresAt": 500000},
            {**claims(), "issuedAt": 8001},
        ]
        for item in invalid:
            with self.subTest(item=item):
                with self.assertRaises(ValueError):
                    record_issue159_approval(
                        self.db,
                        claims=item,
                        identity=identity(),
                        observed_at_ms=2000,
                    )

    def test_approval_rows_are_append_only(self):
        row = record_issue159_approval(
            self.db, claims=claims(), identity=identity(), observed_at_ms=2000
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                f"UPDATE {TABLE} SET decision='REJECT' WHERE id=?",
                (row["approval_id"],),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                f"DELETE FROM {TABLE} WHERE id=?",
                (row["approval_id"],),
            )
        persisted = self.db.execute(
            f"SELECT decision,actor_id,auth_method,role_at_decision FROM {TABLE}"
        ).fetchone()
        self.assertEqual(
            persisted,
            (
                "APPROVE",
                "google_fixture_super_admin",
                "supabase_aal2",
                "super_admin",
            ),
        )

    def test_source_has_no_private_key_signing_network_or_dispatch_path(self):
        source = Path(__file__).with_name(
            "gpt02_issue159_approval_store.py"
        ).read_text()
        for forbidden in (
            "createPrivateKey",
            "private_key",
            "sign(",
            "requests.",
            "urllib.request",
            "http://",
            "https://",
            '"dispatchPermitted": True',
            '"authorizationGranted": True',
        ):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
