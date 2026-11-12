#!/usr/bin/env python3
import importlib.util
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/dev/prepare_gpt02_issue159_approval_request.py"
spec = importlib.util.spec_from_file_location("issue159_prepare", SCRIPT)
prepare_module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(prepare_module)

AUTH = "auth-active-super-admin"
HUB = "active-super-admin"
COMMAND = "11111111-1111-4111-8111-111111111111"
ATTEMPT = "22222222-2222-4222-8222-222222222222"


class PrepareIssue159ApprovalRequestTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="issue159-prepare-")
        self.db = os.path.join(self.root, "tasks.db")
        self.output = os.path.join(self.root, "pending.json")
        con = sqlite3.connect(self.db)
        con.execute(
            "CREATE TABLE admin_identities(user_id TEXT PRIMARY KEY, role TEXT NOT NULL, enabled INTEGER NOT NULL)"
        )
        con.execute("""CREATE TABLE gpt02_issue159_admin_operator_links (
          auth_user_id TEXT PRIMARY KEY, hub_operator_id TEXT NOT NULL UNIQUE,
          email TEXT NOT NULL, enabled INTEGER NOT NULL
        )""")
        con.execute(
            "INSERT INTO admin_identities VALUES (?,?,1)",
            (AUTH, "super_admin"),
        )
        con.execute(
            "INSERT INTO gpt02_issue159_admin_operator_links VALUES (?,?,?,1)",
            (AUTH, HUB, "active@example.com"),
        )
        con.commit()
        con.close()
        os.chmod(self.db, 0o600)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.root, ignore_errors=True)

    def test_prepares_short_lived_request_for_existing_task_without_creating_task(self):
        out = prepare_module.prepare(
            self.db, self.output, 140, COMMAND, ATTEMPT,
            now_ms=1_800_000_000_000, operational=False,
        )
        self.assertTrue(out["pendingRequestCreated"])
        self.assertEqual(out["taskId"], 140)
        self.assertFalse(out["signingPermitted"])
        self.assertFalse(out["authorizationGranted"])
        self.assertFalse(out["dispatchPermitted"])
        self.assertEqual(out["releaseDecision"], "NO_GO")
        self.assertEqual(os.stat(self.output).st_mode & 0o777, 0o600)
        payload = json.loads(Path(self.output).read_text())
        claims = payload["claims"]
        self.assertEqual(claims["superAdminId"], HUB)
        self.assertNotEqual(claims["superAdminId"], AUTH)
        self.assertEqual(claims["taskId"], 140)
        self.assertEqual(claims["commandId"], COMMAND)
        self.assertEqual(claims["attemptId"], ATTEMPT)
        self.assertEqual(claims["expiresAt"] - claims["issuedAt"], 240_000)
        tables = {
            r[0] for r in sqlite3.connect(self.db).execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        self.assertEqual(tables, {"admin_identities", "gpt02_issue159_admin_operator_links"})

    def test_rejects_multiple_active_super_admins_without_writing(self):
        con = sqlite3.connect(self.db)
        con.execute(
            "INSERT INTO admin_identities VALUES (?,?,1)",
            ("auth-second-super-admin", "super_admin"),
        )
        con.execute(
            "INSERT INTO gpt02_issue159_admin_operator_links VALUES (?,?,?,1)",
            ("auth-second-super-admin", "second-super-admin", "second@example.com"),
        )
        con.commit()
        con.close()
        with self.assertRaisesRegex(RuntimeError, "ACTIVE_ADMIN_OPERATOR_MAPPING_NOT_UNIQUE"):
            prepare_module.prepare(
                self.db, self.output, 140, COMMAND, ATTEMPT,
                now_ms=1_800_000_000_000, operational=False,
            )
        self.assertFalse(os.path.exists(self.output))

    def test_rejects_invalid_or_reused_identifiers_without_writing(self):
        cases = (
            (139, COMMAND, ATTEMPT),
            (140, COMMAND, COMMAND),
            (140, "not-a-uuid", ATTEMPT),
        )
        for task_id, command_id, attempt_id in cases:
            with self.subTest(task_id=task_id, command_id=command_id):
                with self.assertRaises(RuntimeError):
                    prepare_module.prepare(
                        self.db, self.output, task_id, command_id, attempt_id,
                        now_ms=1_800_000_000_000, operational=False,
                    )
                self.assertFalse(os.path.exists(self.output))

    def test_refuses_to_overwrite_existing_pending_request(self):
        Path(self.output).write_text('{"claims":{}}')
        with self.assertRaisesRegex(RuntimeError, "PENDING_REQUEST_ALREADY_EXISTS"):
            prepare_module.prepare(
                self.db, self.output, 140, COMMAND, ATTEMPT,
                now_ms=1_800_000_000_000, operational=False,
            )
        self.assertEqual(Path(self.output).read_text(), '{"claims":{}}')


if __name__ == "__main__":
    unittest.main()
