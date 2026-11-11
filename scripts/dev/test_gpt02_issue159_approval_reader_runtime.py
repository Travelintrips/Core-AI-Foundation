#!/usr/bin/env python3
import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / "deploy/ai-coding-standalone-dev"
sys.path.insert(0, str(DEPLOY))
RUNTIME = DEPLOY / "gpt02_issue159_approval_reader_runtime.py"
UNIT = DEPLOY / "gpt02-issue159-approval-reader.service"

spec = importlib.util.spec_from_file_location("approval_reader_runtime", RUNTIME)
runtime = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(runtime)

LOOKUP = {
    "claimsSha256": "a" * 64,
    "taskId": 2_147_483_647,
    "commandId": "11111111-1111-4111-8111-111111111111",
    "attemptId": "22222222-2222-4222-8222-222222222222",
    "companyId": "default",
    "superAdminId": "gpt02-approval-read-probe",
}


class ApprovalReaderRuntimeTest(unittest.TestCase):
    def test_missing_exact_lookup_is_negative_read_only_and_no_authority(self):
        calls = []

        def reader(db_path, lookup, observed_at, operational):
            calls.append((db_path, lookup, observed_at, operational))
            return {
                "environment": "DEV",
                "reason": "APPROVAL_INTENT_NOT_UNIQUE_OR_MISSING",
                "persistedTrustedReadProven": False,
                "approvalBindingMatched": False,
                "adminApprovalMatched": False,
                "signingPermitted": False,
                "authorizationGranted": False,
                "dispatchPermitted": False,
                "releaseDecision": "NO_GO",
            }

        status, body = runtime.handle_approval_intent_payload(
            {"lookup": LOOKUP, "observedAtMs": 2000}, reader=reader
        )
        self.assertEqual(status, 409)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1], LOOKUP)
        self.assertEqual(calls[0][2:], (2000, True))
        self.assertFalse(body["ok"])
        self.assertEqual(body["result"]["reason"], "APPROVAL_INTENT_NOT_UNIQUE_OR_MISSING")
        self.assertFalse(body["persistedTrustedReadProven"])
        self.assertFalse(body["signingPermitted"])
        self.assertFalse(body["authorizationGranted"])
        self.assertFalse(body["dispatchPermitted"])
        self.assertEqual(body["releaseDecision"], "NO_GO")

    def test_exact_valid_admin_intent_is_evidence_only_never_authority(self):
        def reader(_db_path, _lookup, _observed_at, operational):
            self.assertTrue(operational)
            return {
                "environment": "DEV",
                "reason": "TRUSTED_APPROVAL_INTENT_READ_NO_SIGNING_AUTHORITY",
                "decision": {
                    "decisionId": "33333333-3333-4333-8333-333333333333",
                    "actorId": "real-super-admin-subject",
                    "authMethod": "supabase_admin_session",
                    "roleAtDecision": "super_admin",
                    "decision": "APPROVE",
                },
                "persistedTrustedReadProven": True,
                "approvalBindingMatched": True,
                "adminApprovalMatched": True,
                "signingPermitted": False,
                "authorizationGranted": False,
                "dispatchPermitted": False,
                "releaseDecision": "NO_GO",
            }

        status, body = runtime.handle_approval_intent_payload(
            {"lookup": LOOKUP, "observedAtMs": 2000}, reader=reader
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertTrue(body["persistedTrustedReadProven"])
        self.assertEqual(body["result"]["decision"]["authMethod"], "supabase_admin_session")
        self.assertFalse(body["signingPermitted"])
        self.assertFalse(body["authorizationGranted"])
        self.assertFalse(body["dispatchPermitted"])
        self.assertEqual(body["releaseDecision"], "NO_GO")

    def test_shape_and_observation_errors_do_not_call_reader(self):
        def reader(*_args, **_kwargs):
            raise AssertionError("reader must not be called")

        for payload in (
            {"lookup": LOOKUP},
            {"lookup": LOOKUP, "observedAtMs": True},
            {"lookup": LOOKUP, "observedAtMs": 0},
            {"lookup": LOOKUP, "observedAtMs": 2000, "authorized": True},
        ):
            status, body = runtime.handle_approval_intent_payload(payload, reader=reader)
            self.assertEqual(status, 400)
            self.assertFalse(body["signingPermitted"])
            self.assertFalse(body["authorizationGranted"])
            self.assertFalse(body["dispatchPermitted"])

    def test_service_is_root_scoped_read_only_and_unix_only(self):
        unit = UNIT.read_text()
        for required in (
            "User=root",
            "Group=gpt02-issue159-signers",
            "RuntimeDirectory=gpt02-approval-reader",
            "RuntimeDirectoryMode=0750",
            "PrivateNetwork=yes",
            "RestrictAddressFamilies=AF_UNIX",
            "ReadOnlyPaths=/opt/ai-coding-standalone-dev/tasks.db",
            "ReadWritePaths=/run/gpt02-approval-reader",
            "NoNewPrivileges=yes",
            "CapabilityBoundingSet=",
        ):
            self.assertIn(required, unit)
        self.assertNotIn("ReadWritePaths=/opt", unit)

    def test_source_has_no_database_write_or_signing_surface(self):
        source = RUNTIME.read_text()
        for forbidden in (
            "INSERT INTO", "UPDATE ", "DELETE FROM", "sqlite3.connect(",
            "createPrivateKey", "private_key", ".sign(", "dispatch_worker",
            "socket.AF_INET", "socket.AF_INET6",
        ):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
