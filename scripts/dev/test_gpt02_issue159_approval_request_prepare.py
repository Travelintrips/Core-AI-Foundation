#!/usr/bin/env python3
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

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

    def test_test_mode_cannot_touch_live_approval_paths(self):
        for db_path, output in (
            (prepare_module.LIVE_DB, self.output),
            (self.db, prepare_module.LIVE_OUTPUT),
            (self.db, "/opt/ai-coding-standalone-dev/forged-pending.json"),
        ):
            with self.subTest(db_path=db_path, output=output):
                with self.assertRaisesRegex(
                    RuntimeError, "ISSUE159_TEST_MODE_LIVE_TARGET_FORBIDDEN"
                ):
                    prepare_module.prepare(
                        db_path, output, 172, COMMAND, ATTEMPT,
                        now_ms=1_800_000_000_000, operational=False,
                    )
                self.assertFalse(os.path.exists(self.output))

    def test_operational_preparer_rechecks_trusted_hub_core_lineage(self):
        now = 1_800_000_000_000
        claims = {
            "companyId": "default", "taskId": 172,
            "commandId": COMMAND, "attemptId": ATTEMPT,
            "expiresAt": now + 240_000,
        }
        captured = []
        facts = {"trusted": "from-pinned-socket"}
        def reader(query):
            captured.append(("read", query))
            return facts
        def verifier(value, proposed_claims, observed_at):
            captured.append(("verify", value, proposed_claims, observed_at))
            return now + 260_000
        module = types.SimpleNamespace(
            _socket_fact_reader=reader,
            _verify_pre_sign_facts=verifier,
        )
        with patch.dict(sys.modules, {
            "gpt02_issue159_approval_request_refresh": module,
        }):
            prepare_module._require_operational_pre_sign(claims, now)
        self.assertEqual(captured[0], ("read", {
            "companyId": "default", "hubTaskId": 172,
            "commandCandidateId": COMMAND, "attemptId": ATTEMPT,
        }))
        self.assertEqual(captured[1], ("verify", facts, claims, now))

    def test_operational_preparer_denies_reader_failure_or_expired_preparation(self):
        now = 1_800_000_000_000
        claims = {
            "companyId": "default", "taskId": 172,
            "commandId": COMMAND, "attemptId": ATTEMPT,
            "expiresAt": now + 240_000,
        }
        for module in (
            types.SimpleNamespace(
                _socket_fact_reader=lambda _: (_ for _ in ()).throw(
                    RuntimeError("TRUSTED_SOCKET_ABSENT")
                ),
                _verify_pre_sign_facts=lambda *args: now + 260_000,
            ),
            types.SimpleNamespace(
                _socket_fact_reader=lambda _: {"source": "synthetic"},
                _verify_pre_sign_facts=lambda *args: now + 240_000,
            ),
        ):
            with patch.dict(sys.modules, {
                "gpt02_issue159_approval_request_refresh": module,
            }):
                with self.assertRaisesRegex(
                    RuntimeError, "ISSUE159_FRESH_TRUSTED_PRESIGN_REQUIRED"
                ):
                    prepare_module._require_operational_pre_sign(claims, now)
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
