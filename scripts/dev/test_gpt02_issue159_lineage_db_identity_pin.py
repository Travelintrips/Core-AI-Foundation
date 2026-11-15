#!/usr/bin/env python3
"""Fail-closed regression of the *installed* Issue159 lineage PostgreSQL role pin.

This is an offline unit test using synthetic connector and DB doubles.
It does not read secrets, open sockets, connect to PostgreSQL, or change
operational credentials. A per-task credential CANNOT simply replace the
existing shared login without a reviewed change to this independent check.
"""
from __future__ import annotations

import importlib.util
import pathlib
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
RUNTIME_PATH = ROOT / "deploy/ai-coding-standalone-dev/gpt02_issue159_lineage_reader_runtime.py"
EXPECTED_LOGIN = "dev_gpt02_lineage_login.xssrfshdrtdfupgqwfdw"


def runtime_module():
    spec = importlib.util.spec_from_file_location("lineage_role_pin_test", RUNTIME_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class SyntheticConnection:
    def __init__(self, user):
        self.info = type("Info", (), {"user": user})()
        self.entered = False

    def __enter__(self):
        self.entered = True
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False


class LineageIdentityPinOfflineTest(unittest.TestCase):
    def test_active_login_must_be_pinned_in_both_checks(self):
        source = RUNTIME_PATH.read_text()
        self.assertEqual(source.count('"' + EXPECTED_LOGIN + '"'), 2)
        self.assertIn('args.get("sslmode") != "verify-full"', source)
        self.assertIn('args.get("sslrootcert")', source)
        self.assertIn("SO_PEERCRED", source)

    def test_shared_identity_passes_identity_check_but_not_authority(self):
        runtime = runtime_module()
        c = SyntheticConnection(EXPECTED_LOGIN)
        with patch.object(runtime, "read_lineage_once", return_value=[]):
            result = runtime.read_verified_lineage(
                {"synthetic": True}, connect=lambda: c
            )
        self.assertTrue(c.entered)
        self.assertFalse(result["matched"])
        self.assertFalse(result["signingPermitted"])
        self.assertFalse(result["authorizationGranted"])
        self.assertFalse(result["dispatchPermitted"])
        self.assertEqual(result["releaseDecision"], "NO_GO")

    def test_task_scoped_credential_is_rejected_by_existing_runtime(self):
        runtime = runtime_module()
        scoped_user = "dev_gpt02_task170_reader.xssrfshdrtdfupgqwfdw"
        c = SyntheticConnection(scoped_user)
        with patch.object(runtime, "read_lineage_once") as query:
            with self.assertRaisesRegex(RuntimeError, "LINEAGE_DB_IDENTITY_MISMATCH"):
                runtime.read_verified_lineage({"synthetic": True}, connect=lambda: c)
            query.assert_not_called()
        self.assertTrue(c.entered)

    def test_service_role_is_rejected_before_query(self):
        runtime = runtime_module()
        c = SyntheticConnection("service_role")
        with patch.object(runtime, "read_lineage_once") as query:
            with self.assertRaisesRegex(RuntimeError, "LINEAGE_DB_IDENTITY_MISMATCH"):
                runtime.read_verified_lineage({"synthetic": True}, connect=lambda: c)
            query.assert_not_called()


if __name__ == "__main__":
    unittest.main()
