#!/usr/bin/env python3
"""Strict synthetic SQLite/HTTP-free recovery tests; never touch the DEV DB."""
import copy
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from gpt02_issue159_approval_intent_contract import validate_approval_claims
import gpt02_issue159_approval_packet_recovery as recovery

NOW = 1_800_000_100_000
COMMAND = "11111111-1111-4111-8111-111111111111"
ATTEMPT = "22222222-2222-4222-8222-222222222222"
DECISION = "33333333-3333-4333-8333-333333333333"
AUTH = "fixture-supabase-admin"
ACTOR = "fixture-hub-operator"


class ApprovedPacketRepairSafetyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="gpt02-recovery-isolated-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.db = self.root / "tasks.db"
        self.pending = self.root / "pending.json"
        self.approved = self.root / "approved.json"
        self.signers = tuple(self.root / (role + "-signature.json")
                             for role in ("approval", "hub", "core", "issuer"))
        self.claims = {
            "v": 2, "environment": "DEV",
            "audience": "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
            "taskId": 170, "commandId": COMMAND, "attemptId": ATTEMPT,
            "nonce": "A" * 44, "operatorNamespace": "ai-task-hub.public.users",
            "superAdminId": ACTOR, "companyId": "default",
            "issuedAt": NOW - 10_000, "expiresAt": NOW + 230_000,
        }
        c = sqlite3.connect(self.db)
        try:
            c.executescript("""
            CREATE TABLE admin_identities (
              user_id TEXT PRIMARY KEY,role TEXT NOT NULL, enabled INTEGER NOT NULL);
            CREATE TABLE gpt02_issue159_admin_operator_links (
              auth_user_id TEXT PRIMARY KEY,hub_operator_id TEXT NOT NULL,
              email TEXT NOT NULL,enabled INTEGER NOT NULL);
            CREATE TABLE gpt02_issue159_approval_intents (
              id TEXT PRIMARY KEY,task_id INTEGER NOT NULL,
              command_id TEXT NOT NULL,attempt_id TEXT NOT NULL,
              company_id TEXT NOT NULL,claims_sha256 TEXT NOT NULL,
              actor_id TEXT NOT NULL,auth_method TEXT NOT NULL,
              role_at_decision TEXT NOT NULL,decision TEXT NOT NULL,
              recorded_at_ms INTEGER NOT NULL,expires_at_ms INTEGER NOT NULL);
            """)
            c.execute("INSERT INTO admin_identities VALUES (?,?,?)",
                      (AUTH, "super_admin", 1))
            c.execute("INSERT INTO gpt02_issue159_admin_operator_links VALUES (?,?,?,1)",
                      (AUTH, ACTOR, "admin@example.com"))
            c.commit()
        finally:
            c.close()
        self.db.chmod(0o600)
        self.sync_pending()
        self.persist_intent()
        self.reader_calls = []
        self.verifier_calls = []
        self.ready = True

    def sync_pending(self):
        self.pending.write_text(json.dumps({"claims": self.claims}), encoding="utf-8")
        self.pending.chmod(0o600)

    def persist_intent(self):
        digest = validate_approval_claims(self.claims)["claimsSha256"]
        with sqlite3.connect(self.db) as c:
            c.execute(
                "INSERT INTO gpt02_issue159_approval_intents VALUES "
                "(?,?,?,?,?,?,?,?,?,?,?,?)",
                (DECISION, self.claims["taskId"], self.claims["commandId"],
                 self.claims["attemptId"], self.claims["companyId"], digest,
                 self.claims["superAdminId"], "supabase_admin_session",
                 "super_admin", "APPROVE", NOW - 1000,
                 self.claims["expiresAt"]),
            )

    def reader(self, query):
        self.reader_calls.append(query)
        return {"source": "trusted-synthetic-fixture", "observedAt": NOW}

    def verifier(self, facts, claims, now_ms):
        self.verifier_calls.append((facts, claims, now_ms))
        self.assertEqual(now_ms, NOW)
        self.assertEqual(facts.get("source"), "trusted-synthetic-fixture")
        self.assertEqual(claims.get("companyId"), "default")
        return self.claims["expiresAt"] + 100_000

    def gate(self, record):
        return self.ready

    def opts(self):
        return dict(now_ms=NOW, operational=False,
                    fact_reader=self.reader, fact_verifier=self.verifier,
                    ready_gate=self.gate, output_paths=self.signers)

    def inspect(self):
        return recovery.prepare_recovery(self.db, self.pending,
                                          self.approved, **self.opts())

    def recover(self):
        return recovery.recover_packet_once(self.db, self.pending,
                                            self.approved, **self.opts())

    def approval_count(self):
        with sqlite3.connect(self.db) as con:
            return con.execute("SELECT count(*) FROM gpt02_issue159_approval_intents").fetchone()[0]

    def test_rebuilds_exact_committed_packet_without_second_approval(self):
        result = self.recover()
        self.assertTrue(result["recoveredExistingIntent"])
        self.assertFalse(result["newApprovalRecorded"])
        self.assertFalse(result["dispatchPermitted"])
        self.assertEqual(result["releaseDecision"], "NO_GO")
        packet = json.loads(self.approved.read_text())
        self.assertEqual(packet["claims"], self.claims)
        self.assertEqual(packet["intentId"], DECISION)
        self.assertEqual(packet["claimsSha256"],
                         validate_approval_claims(self.claims)["claimsSha256"])
        self.assertFalse(packet["authorizationGranted"])
        self.assertFalse(packet["signingPermitted"])
        self.assertFalse(packet["dispatchPermitted"])
        self.assertEqual(self.approved.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.approval_count(), 1)

    def test_inspection_does_not_publish_or_mutate(self):
        result = self.inspect()
        self.assertEqual(result["taskId"], 170)
        self.assertFalse(self.approved.exists())
        self.assertEqual(self.approval_count(), 1)

    def test_rejects_missing_approval_ledger(self):
        with sqlite3.connect(self.db) as c:
            c.execute("DELETE FROM gpt02_issue159_approval_intents")
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "NOT_UNIQUE_OR_MISSING"):
            self.recover()
        self.assertFalse(self.approved.exists())

    def test_rejects_competing_approvals_for_same_task(self):
        with sqlite3.connect(self.db) as c:
            c.execute(
                "INSERT INTO gpt02_issue159_approval_intents VALUES "
                "(?,?,?,?,?,?,?,?,?,?,?,?)",
                ("44444444-4444-4444-8444-444444444444", 170,
                 "55555555-5555-4555-8555-555555555555",
                 "66666666-6666-4666-8666-666666666666", "default",
                 "0" * 64, ACTOR, "supabase_admin_session",
                 "super_admin", "APPROVE", NOW - 1000, NOW + 230000),
            )
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "NOT_UNIQUE_OR_MISSING"):
            self.recover()
        self.assertEqual(self.approval_count(), 2)

    def test_rejects_changed_pending_nonce(self):
        self.claims["nonce"] = "B" * 44
        self.sync_pending()
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "LEDGER_BINDING_MISMATCH"):
            self.recover()
        self.assertEqual(self.approval_count(), 1)

    def test_rejects_changed_actor(self):
        self.claims["superAdminId"] = "unrelated-operator"
        self.sync_pending()
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "LEDGER_BINDING_MISMATCH"):
            self.recover()

    def test_rejects_expired_approval(self):
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "TOO_SHORT"):
            recovery.prepare_recovery(self.db, self.pending, self.approved,
                **{**self.opts(), "now_ms": NOW + 230_000})

    def test_rejects_short_approval_remaining_time(self):
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "TOO_SHORT"):
            recovery.prepare_recovery(self.db, self.pending, self.approved,
                **{**self.opts(), "now_ms": NOW + 130_000})

    def test_rejects_revoked_super_admin(self):
        with sqlite3.connect(self.db) as c:
            c.execute("UPDATE admin_identities SET enabled=0 WHERE user_id=?", (AUTH,))
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "NOT_TRUSTED"):
            self.recover()

    def test_rejects_revoked_operator_link(self):
        with sqlite3.connect(self.db) as c:
            c.execute("UPDATE gpt02_issue159_admin_operator_links SET enabled=0")
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "NOT_TRUSTED"):
            self.recover()

    def test_denies_existing_approved_packet_without_overwrite(self):
        self.approved.write_bytes(b"old-immutable-approved-packet")
        self.approved.chmod(0o600)
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "OUTPUT_OCCUPIED"):
            self.recover()
        self.assertEqual(self.approved.read_bytes(), b"old-immutable-approved-packet")

    def test_denies_stranded_temp_file(self):
        tmp = self.approved.with_name("." + self.approved.name + ".tmp")
        tmp.write_bytes(b"stranded")
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "OUTPUT_OCCUPIED"):
            self.recover()
        self.assertEqual(tmp.read_bytes(), b"stranded")

    def test_denies_symlink_collision_and_preserves_target(self):
        outside = self.root / "historical-evidence"
        outside.write_bytes(b"unchanged")
        self.approved.symlink_to(outside)
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "OUTPUT_OCCUPIED"):
            self.recover()
        self.assertEqual(outside.read_bytes(), b"unchanged")

    def test_denies_existing_signer_output(self):
        self.signers[2].write_bytes(b"previous-signed-evidence")
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "SIGNER_OUTPUT_OCCUPIED"):
            self.recover()
        self.assertEqual(self.signers[2].read_bytes(), b"previous-signed-evidence")

    def test_reader_outage_fails_closed(self):
        def fail(_query):
            raise ConnectionError("reader-offline")
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "PRESIGN_NOT_AVAILABLE"):
            recovery.recover_packet_once(self.db, self.pending, self.approved,
               **{**self.opts(), "fact_reader": fail})
        self.assertEqual(self.approval_count(), 1)

    def test_preparation_expiry_fails_closed(self):
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "PREPARATION_NOT_FRESH"):
            recovery.recover_packet_once(self.db, self.pending, self.approved,
               **{**self.opts(), "fact_verifier": lambda f,c,n: NOW + 5000})

    def test_readiness_gate_denies_recovery(self):
        self.ready = False
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "CHAIN_NOT_READY"):
            self.recover()

    def test_missing_pending_claims_denied(self):
        self.pending.unlink()
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "SOURCE_PRIVATE_FILE_MISSING"):
            self.recover()

    def test_insecure_pending_permissions_denied(self):
        self.pending.chmod(0o644)
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "SOURCE_PRIVATE_CUSTODY_INVALID"):
            self.recover()

    def test_test_mode_cannot_target_live_paths(self):
        with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "TEST_TARGET_FORBIDDEN"):
            recovery.prepare_recovery(
                recovery.DB, self.pending, self.approved, **self.opts())

    def test_concurrent_repairs_publish_exactly_one_packet(self):
        barrier = threading.Barrier(2, timeout=5)
        def run_once(index):
            barrier.wait()
            try:
                self.recover()
                return "published"
            except recovery.PacketRecoveryDenied as exc:
                if str(exc) == "RECOVERY_APPROVED_PACKET_OUTPUT_OCCUPIED":
                    return "occupied"
                raise
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(run_once, (1,2)))
        self.assertCountEqual(results, ["published", "occupied"])
        self.assertEqual(self.approval_count(), 1)
        self.assertFalse(self.approved.with_name("." + self.approved.name + ".tmp").exists())

    def test_filesystem_failure_retains_original_sqlite_decision_for_recovery(self):
        with patch.object(recovery.os, "link", side_effect=OSError("simulated-disk-error")):
            with self.assertRaisesRegex(recovery.PacketRecoveryDenied, "PUBLICATION_FAILED"):
                self.recover()
        self.assertEqual(self.approval_count(), 1)
        self.assertFalse(self.approved.exists())
        self.assertFalse(self.approved.with_name("." + self.approved.name + ".tmp").exists())
        result = self.recover()
        self.assertTrue(result["recoveredExistingIntent"])
        self.assertEqual(self.approval_count(), 1)


if __name__ == "__main__":
    unittest.main()

[executed on device: srv1792369 (0891e23a-6a6b-4f8c-a16a-962e888e2014)]