#!/usr/bin/env python3
"""Offline, no-network tests for an existing bounded GPT02 DEV writer-slot probe.

Uses AST extraction of one pure helper only. Never imports or executes the
top-level VPS credential / ALTER ROLE / systemd harness.
"""
import ast
import unittest
import time
from pathlib import Path

SOURCE = Path(__file__).with_name("gpt02_issue159_writer_slot_handoff_probe.py")


def load_pure_guard():
    tree = ast.parse(SOURCE.read_text())
    funcs = [
        node for node in tree.body if isinstance(node, ast.FunctionDef)
        and node.name == "require_writer_slot_drained"
    ]
    if len(funcs) != 1:
        raise AssertionError("REQUIRED_SLOT_GUARD_ABSENT")
    safe_module = ast.Module(body=funcs, type_ignores=[])
    namespace = {"time": time, "RuntimeError": RuntimeError}
    exec(compile(safe_module, str(SOURCE), "exec"), namespace)
    return namespace["require_writer_slot_drained"]


guard = load_pure_guard()


def load_catalog_guard():
    """AST-load only the new pure fail-closed predicate; no VPS imports."""
    tree = ast.parse(SOURCE.read_text())
    funcs = [
        node for node in tree.body if isinstance(node, ast.FunctionDef)
        and node.name == "require_no_untracked_catalog_window"
    ]
    if len(funcs) != 1:
        raise AssertionError("RELOCK_CATALOG_GUARD_ABSENT")
    safe_module = ast.Module(body=funcs, type_ignores=[])
    namespace = {"RuntimeError": RuntimeError}
    exec(compile(safe_module, str(SOURCE), "exec"), namespace)
    return namespace["require_no_untracked_catalog_window"]


catalog_guard = load_catalog_guard()


class FakeCatalogAdmin:
    def __init__(self, row):
        self.row = row
        self.calls = []

    def execute(self, query):
        expected = ("SELECT to_regclass("
                    "'gpt02_relock_audit.writer_issuance_watchdog') IS NOT NULL")
        if query != expected:
            raise AssertionError("UNEXPECTED_OR_MUTATING_CATALOG_QUERY")
        self.calls.append(query)
        return self

    def fetchone(self):
        return self.row


class Result:
    def __init__(self, number):
        self.number = number

    def fetchone(self):
        return (self.number,)


class FakeAdmin:
    def __init__(self, sequence):
        self.sequence = iter(sequence)
        self.calls = []

    def execute(self, query, args):
        if query != "SELECT count(*) FROM pg_stat_activity WHERE usename=%s":
            raise AssertionError("NOT_READONLY_SQL")
        if args not in (("dev_gpt02_attestor_evidence",),
                        ("dev_gpt02_issuer_evidence",)):
            raise AssertionError("UNSCOPED_ROLE")
        self.calls.append(args[0])
        return Result(next(self.sequence))


class Clock:
    def __init__(self):
        self.current = 0.0
        self.sleeps = []

    def monotonic(self):
        return self.current

    def sleep(self, n):
        self.current += n
        self.sleeps.append(n)


class HandoffSlotSafetyTest(unittest.TestCase):
    def test_installed_relock_catalog_blocks_legacy_role_opening(self):
        admin = FakeCatalogAdmin((True,))
        with self.assertRaisesRegex(
            RuntimeError, "WRITER_HANDOFF_RELOCK_WATCHDOG_REGISTRATION_REQUIRED"
        ):
            catalog_guard(admin)
        self.assertEqual(len(admin.calls), 1)

    def test_missing_or_ambiguous_catalog_fails_closed_except_legacy_absence(self):
        for result in (None, (), (None,), (1,), (True,)):
            with self.subTest(result=result), self.assertRaisesRegex(
                RuntimeError, "WRITER_HANDOFF_RELOCK_WATCHDOG_REGISTRATION_REQUIRED"
            ):
                catalog_guard(FakeCatalogAdmin(result))
        legacy = FakeCatalogAdmin((False,))
        catalog_guard(legacy)
        self.assertEqual(len(legacy.calls), 1)

    def test_catalog_guard_executes_before_first_legacy_role_open(self):
        text = SOURCE.read_text()
        call = text.index("\\n require_no_untracked_catalog_window(admin)\\n".replace("\\n", "\n"))
        armed = text.index("\\n armed=True\\n".replace("\\n", "\n"))
        unlock = text.index('admin.execute(sql.SQL("ALTER ROLE {} LOGIN')
        self.assertLess(call, armed)
        self.assertLess(armed, unlock)

    def test_immediate_free_attestor_slot(self):
        admin = FakeAdmin([0])
        clock = Clock()
        guard(admin, "dev_gpt02_attestor_evidence", "attestor",
              monotonic=clock.monotonic, sleep=clock.sleep)
        self.assertEqual(len(admin.calls), 1)
        self.assertEqual(clock.sleeps, [])

    def test_delayed_close_waits_a_bounded_interval(self):
        admin = FakeAdmin([1, 1, 1, 0])
        clock = Clock()
        guard(admin, "dev_gpt02_issuer_evidence", "issuer",
              monotonic=clock.monotonic, sleep=clock.sleep)
        self.assertEqual(len(admin.calls), 4)
        self.assertEqual(clock.sleeps, [.25] * 3)

    def test_one_connection_never_reported_as_released(self):
        admin = FakeAdmin([1] * 100)
        clock = Clock()
        with self.assertRaisesRegex(RuntimeError,
                                    "WRITER_SESSION_NOT_RELEASED_AFTER_HANDOFF_issuer"):
            guard(admin, "dev_gpt02_issuer_evidence", "issuer",
                  timeout_seconds=1, monotonic=clock.monotonic, sleep=clock.sleep)
        self.assertLessEqual(clock.current, 1.25)
        self.assertGreaterEqual(len(admin.calls), 4)

    def test_reject_unexpected_writer_role_without_query(self):
        admin = FakeAdmin([])
        with self.assertRaisesRegex(RuntimeError, "WRITER_HANDOFF_UNEXPECTED_ROLE"):
            guard(admin, "postgres", "attestor")
        self.assertEqual(admin.calls, [])

    def test_reject_invalid_or_unbounded_timeouts(self):
        for value in (-1, 0, 10.000001, None, "15"):
            with self.subTest(value=value), self.assertRaisesRegex(
                RuntimeError, "WRITER_HANDOFF_TIMEOUT_INVALID"):
                guard(FakeAdmin([]), "dev_gpt02_issuer_evidence", "issuer",
                      timeout_seconds=value)

    def test_two_writers_use_only_pinned_count_query(self):
        for role, name in (("dev_gpt02_attestor_evidence", "attestor"),
                           ("dev_gpt02_issuer_evidence", "issuer")):
            admin = FakeAdmin([0])
            guard(admin, role, name)
            self.assertEqual(admin.calls, [role])

    def test_unarmed_probe_cannot_stop_or_open_roles(self):
        text = SOURCE.read_text()
        self.assertIn("GPT02_ISSUE159_WRITER_HANDOFF_READONLY", text)
        self.assertIn('"explicit-readonly"', text)
        self.assertIn('os.geteuid()==0', text)
        self.assertIn("reader_start_attempted=False", text)
        self.assertIn("reader_start_attempted=True", text)
        self.assertIn("if reader_start_attempted:", text)
        # A failure before the first service start has no stop side effect.
        head = text.split('reader_start_attempted=True', 1)[0]
        self.assertNotIn('run(["systemctl","stop",SERVICE]', head)

    def test_source_only_reuses_prior_credentials_and_relocks(self):
        text = SOURCE.read_text()
        for must in (
            'REF="xssrfshdrtdfupgqwfdw"',
            'NODE_ENV',
            'APP_ENV',
            'SUPABASE_DATABASE_URL_DEV',
            'VALID UNTIL',
            'CONNECTION LIMIT 1',
            'BEGIN READ ONLY',
            'NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL',
            'PASSWORD NULL',
            'HANDOFF_WINDOW_READY_NO_APPROVAL',
            'ALL_ROLES_RELOCKED_PASS',
        ):
            self.assertIn(must, text)
        self.assertNotIn("CREATE ROLE", text)
        self.assertNotIn("GRANT EXECUTE", text)
        self.assertNotIn("run_after_approval(", text)


if __name__ == "__main__":
    unittest.main()
