#!/usr/bin/env python3
"""Isolated regression of the existing GPT02 native reader's safe login preflight.

Synthetic fixtures only. No real database, systemd, runtime credential, host file
or external network is opened by any test.
"""
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import unittest

SOURCE = Path(__file__).with_name("gpt02_reader_login_readonly.py")
SPEC = importlib.util.spec_from_file_location("gpt02_reader_login_readonly_tested", SOURCE)
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)

PASSWORD = "SYNTHETIC_ONLY_GPT02_READER_PASSWORD_NEVER_REAL"
CFG = {
    "database": "postgres", "host": checker.DIRECT_HOST,
    "password": PASSWORD, "port": 5432, "projectId": checker.PROJECT,
    "sslMode": "verify-full", "user": checker.ROLE,
}
NOW = datetime(2026, 11, 27, 0, 0, tzinfo=timezone.utc)

def valid_row():
    return (
        checker.ROLE, checker.ROLE, "postgres", "on", "on", True,
        NOW + timedelta(minutes=7), 1, False, False, True, False, False, False, NOW,
    )

class Cursor:
    def __init__(self, row):
        self.row = row
        self.sql = []
    def __enter__(self):
        return self
    def __exit__(self, *_):
        return False
    def execute(self, sql):
        self.sql.append(sql)
    def fetchone(self):
        return self.row

class Connection:
    def __init__(self, row):
        self.cursor_obj = Cursor(row)
    def __enter__(self):
        return self
    def __exit__(self, *_):
        return False
    def cursor(self):
        return self.cursor_obj

class TransportTests(unittest.TestCase):
    def test_native_direct_transport_preserves_original_hostname_and_username(self):
        cfg = checker.parse_credential(__import__("json").dumps(CFG).encode())
        self.assertEqual(cfg, CFG)
        self.assertEqual(checker.wire_user(cfg), checker.ROLE)

    def test_only_exact_session_pooler_gets_project_suffix_and_verified_tls(self):
        cfg = checker.parse_credential(__import__("json").dumps({**CFG, "host": checker.SESSION_HOST}).encode())
        self.assertEqual(checker.wire_user(cfg), checker.ROLE + "." + checker.PROJECT)
        params = []
        def connector(**kw):
            params.append(kw)
            return Connection(valid_row())
        self.assertEqual(checker.read_only_probe(cfg, Path("/fixture/only-ca.crt"), connector), 420)
        self.assertEqual(len(params), 1)
        self.assertEqual(params[0]["sslmode"], "verify-full")
        self.assertEqual(params[0]["sslrootcert"], "/fixture/only-ca.crt")
        self.assertEqual(params[0]["user"], checker.ROLE + "." + checker.PROJECT)
        self.assertNotIn("default_transaction_read_only=", params[0]["options"])
        self.assertEqual(params[0]["autocommit"], True)

    def test_exact_readonly_sql_and_cleanup(self):
        cursor = Cursor(valid_row())
        class C(Connection):
            def __init__(self): self.cursor_obj = cursor
        self.assertEqual(checker.read_only_probe(CFG, Path("/fixture/only-ca.crt"), lambda **_: C()), 420)
        self.assertEqual(cursor.sql[0], "BEGIN TRANSACTION READ ONLY")
        self.assertEqual(cursor.sql[-1], "ROLLBACK")
        self.assertIn("session_user::text", cursor.sql[1])
        self.assertIn("pg_stat_ssl", cursor.sql[1])
        self.assertNotIn("FROM gpt02_owner_approval", cursor.sql[1])
        self.assertNotIn("UPDATE ", cursor.sql[1])

    def test_no_unapproved_endpoint_tls_role_project_port_or_extra_key(self):
        invalids = [
            {"host": "evil.invalid"},
            {"host": checker.SESSION_HOST + ".evil.invalid"},
            {"host": "aws-1-ap-southeast-2.pooler.supabase.com"},
            {"host": checker.SESSION_HOST, "port": 6543},
            {"port": "5432"}, {"projectId": "nzdweipzckfszczzqtuw"},
            {"user": "gpt02_owner_ledger_reader_dev"},
            {"user": "postgres"}, {"sslMode": "require"}, {"sslMode": "verify-ca"},
            {"sslMode": "disable"}, {"database": "other"},
            {"password": "short"}, {"some_extra_option": "true"},
        ]
        for change in invalids:
            with self.subTest(change=change):
                with self.assertRaises(checker.ReaderDenied):
                    checker.parse_credential(__import__("json").dumps({**CFG, **change}).encode())

    def test_duplicate_or_invalid_json_never_accepted(self):
        samples = [
            b"{", b"\xff", b"[]", b"null", b'{"password":NaN}',
            (__import__("json").dumps(CFG)[:-1] + ', "host":"evil.invalid"}').encode(),
        ]
        for data in samples:
            with self.subTest(size=len(data)):
                with self.assertRaises(checker.ReaderDenied):
                    checker.parse_credential(data)

class NativeRoleTests(unittest.TestCase):
    def test_native_role_lease_is_required(self):
        self.assertEqual(checker.check_row(valid_row()), 420)
        for position, replacement in [
            (0, "postgres"), (0, checker.ROLE+"."+checker.PROJECT),
            (1, "postgres"), (2, "template1"),
            (3, "off"), (4, "off"), (5, False), (5, None),
            (6, NOW-timedelta(seconds=1)), (6, NOW+timedelta(seconds=179)),
            (6, None), (7, -1), (7, 2),
            (8, True), (9, True), (10, False),
            (11, True), (12, True), (13, True),
        ]:
            with self.subTest(position=position, replacement=str(replacement)):
                row = list(valid_row()); row[position] = replacement
                with self.assertRaises(checker.ReaderDenied):
                    checker.check_row(tuple(row))
        with self.assertRaises(checker.ReaderDenied):
            checker.check_row(None)

    def test_pooler_backend_non_tls_fails_closed_even_when_frontend_tls_verified(self):
        cfg = {**CFG, "host": checker.SESSION_HOST}
        row = list(valid_row()); row[5] = False
        conn = Connection(tuple(row))
        with self.assertRaises(checker.ReaderDenied) as exc:
            checker.read_only_probe(cfg, Path("/fixture/only-ca.crt"), lambda **_: conn)
        self.assertEqual(exc.exception.code, "BACKEND_TLS_UNVERIFIED")
        self.assertEqual(conn.cursor_obj.sql[0], "BEGIN TRANSACTION READ ONLY")
        self.assertEqual(conn.cursor_obj.sql[-1], "ROLLBACK")

    def test_no_debug_dump_contains_a_synthetic_password(self):
        cfg = checker.parse_credential(__import__("json").dumps(CFG).encode())
        self.assertEqual(cfg["password"], PASSWORD)
        self.assertNotIn(PASSWORD, checker.ReaderDenied("BACKEND_TLS_UNVERIFIED").code)

if __name__ == "__main__":
    unittest.main()
