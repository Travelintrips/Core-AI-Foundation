#!/usr/bin/env python3
"""Disposable exact-ID outbox -> existing AI Core bridge review regressions.

No live database, command submission, worker claim or signer interactions.
"""
from __future__ import annotations

import copy
from pathlib import Path
import unittest

from gpt02_issue159_bridge_handoff_preflight import (
    BRIDGE_IDENTITY_COLLISION_SQL,
    BOUND_CORE_INSTRUCTION_SQL,
    HandoffBoundaryError,
    inspect_held_outbox_bridge_identity,
    inspect_persisted_core_instruction,
    external_id,
)

COMMAND = "10000000-0000-4000-8000-000000000001"
ATTEMPT = "20000000-0000-4000-8000-000000000002"
PERMIT = "30000000-0000-4000-8000-000000000003"
CORE = "50000000-0000-4000-8000-000000000005"
OTHER = "60000000-0000-4000-8000-000000000006"
SHA = "a" * 64
WORKER = "openclaw-dell-chatgpt-wake-dev"


class BridgeHandoffPreflightTests(unittest.TestCase):
    def setUp(self):
        self.row = {
            "command_id": COMMAND,
            "permit_id": PERMIT,
            "attempt_id": ATTEMPT,
            "core_task_id": CORE,
            "hub_task_id": 171,
            "worker_id": WORKER,
            "packet_sha256": SHA,
            "delivery_state": "HELD_NO_DISPATCH",
        }
        self.proof = {
            "environment": "DEV",
            "stage": "FOUR_SIGNATURE_PERSISTED_LINEAGE_REVIEWED",
            "commandId": COMMAND,
            "attemptId": ATTEMPT,
            "hubTaskId": 171,
            "verifiedPacketSha256": SHA,
            "verifiedByExistingReader": True,
            "positivePermitCreated": False,
            "databaseWritePerformed": False,
            "signingPermitted": False,
            "authorizationGranted": False,
            "dispatchPermitted": False,
            "releaseDecision": "NO_GO",
        }
        self.existing = {
            "id": COMMAND,
            "source": "ai-core",
            "external_command_id": external_id(COMMAND),
            "command_type": "EXTERNAL_AGENT_WORK",
            "status": "RECEIVED",
            "metadata_json": {"gpt02Issue159PositivePermit": {"commandId": COMMAND}},
        }

    def review(self, *, outbox=None, reviewed=None, rows=None):
        return inspect_held_outbox_bridge_identity(
            self.row if outbox is None else outbox,
            self.proof if reviewed is None else reviewed,
            [] if rows is None else rows,
        )

    def deny(self, *, outbox=None, reviewed=None, rows=None):
        with self.assertRaises(HandoffBoundaryError):
            self.review(outbox=outbox, reviewed=reviewed, rows=rows)

    def test_empty_bridge_is_not_an_automatic_dispatch_authorization(self):
        r = self.review()
        self.assertEqual(r["issuerCommandId"], COMMAND)
        self.assertEqual(r["proposedBridgeCommandId"], COMMAND)
        self.assertEqual(r["coreTaskId"], CORE)
        self.assertEqual(r["attemptId"], ATTEMPT)
        self.assertEqual(r["externalCommandId"], "gpt02-issue159:" + COMMAND)
        self.assertEqual(r["requiredSource"], "ai-core")
        self.assertEqual(r["targetWorker"], WORKER)
        self.assertEqual(r["nextGate"], "DEDICATED_AUTHORIZED_INSERT_PATH_NOT_IMPLEMENTED")
        self.assertFalse(r["reconciliationRequired"])
        for k in ("genericBridgeSubmitAllowed", "bridgeCommandInserted",
                  "workerNotified", "dispatchPermitted", "finalAckVerified"):
            self.assertFalse(r[k], k)
        self.assertEqual(r["releaseDecision"], "NO_GO")

    def test_same_id_existing_row_requires_reconciliation_not_duplicate_insert(self):
        r = self.review(rows=[self.existing])
        self.assertTrue(r["reconciliationRequired"])
        self.assertEqual(r["existingBridgeRowCount"], 1)
        self.assertEqual(r["nextGate"], "EXISTING_BRIDGE_COMMAND_RECONCILIATION_REQUIRED")
        self.assertFalse(r["workerNotified"])
        self.assertFalse(r["bridgeCommandInserted"])

    def test_wrong_id_but_external_key_collision_is_still_blocked(self):
        collision = {**self.existing, "id": OTHER}
        self.assertTrue(self.review(rows=[collision])["reconciliationRequired"])

    def test_protected_marker_collision_is_still_blocked(self):
        collision = {
            **self.existing,
            "id": OTHER,
            "source": "unrelated",
            "external_command_id": "unrelated",
        }
        self.assertTrue(self.review(rows=[collision])["reconciliationRequired"])

    def test_terminal_existing_command_does_not_get_replayed(self):
        collision = {**self.existing, "status": "FAILED"}
        r = self.review(rows=[collision])
        self.assertFalse(r["genericBridgeSubmitAllowed"])
        self.assertFalse(r["workerNotified"])
        self.assertTrue(r["reconciliationRequired"])

    def test_any_mismatched_signed_identity_denied(self):
        for k, value in [
            ("commandId", OTHER),
            ("attemptId", OTHER),
            ("hubTaskId", 172),
            ("verifiedPacketSha256", "f" * 64),
            ("verifiedByExistingReader", False),
            ("positivePermitCreated", True),
            ("dispatchPermitted", True),
            ("signingPermitted", True),
            ("authorizationGranted", True),
            ("databaseWritePerformed", True),
            ("releaseDecision", "GO"),
        ]:
            with self.subTest(k=k):
                p = dict(self.proof, **{k: value})
                self.deny(reviewed=p)

    def test_invalid_outbox_scope_denied(self):
        for k, value in [
            ("command_id", OTHER),
            ("attempt_id", "wrong"),
            ("core_task_id", None),
            ("hub_task_id", 139),
            ("hub_task_id", True),
            ("worker_id", "openclaw-generic"),
            ("packet_sha256", "x" * 64),
            ("delivery_state", "DISPATCHED"),
        ]:
            with self.subTest(k=k):
                row = dict(self.row, **{k: value})
                self.deny(outbox=row)

    def test_missing_or_extra_field_fails_closed(self):
        row = dict(self.row)
        del row["permit_id"]
        self.deny(outbox=row)
        self.deny(outbox=dict(self.row, extra=True))
        self.deny(rows=[{"id": COMMAND}])

    def test_unscoped_or_bad_bridge_row_is_denied(self):
        row = dict(self.existing)
        row.update(id=OTHER, source="other", external_command_id="other",
                   metadata_json={})
        self.deny(rows=[row])
        row = dict(self.existing)
        row["id"] = "bad-uuid"
        self.deny(rows=[row])
        self.deny(rows=[self.existing] * 4)

    def test_readback_must_be_collection(self):
        self.deny(rows={"rows": []})
        self.deny(rows=None if False else "untrusted")
        self.deny(rows=[False])

    def test_collision_sql_is_bounded_read_only_on_real_schema(self):
        s = BRIDGE_IDENTITY_COLLISION_SQL.strip().lower()
        self.assertTrue(s.startswith("select "))
        self.assertIn("from ai_platform.ai_coding_bridge_commands", s)
        self.assertIn("id=%s::uuid", s)
        self.assertIn("external_command_id=%s::text", s)
        self.assertIn("gpt02issue159positivepermit", s)
        self.assertIn("limit 4", s)
        for forbidden in ("insert into", "update ", "delete from", "drop table",
                          "notify_external", "claimcodingbridge"):
            self.assertNotIn(forbidden, s)

    def test_generic_bridge_quarantine_is_real_source_gate(self):
        source = (Path(__file__).resolve().parents[2] /
                  "artifacts/api-server/src/services/gpt02RecoveryGenericClaimQuarantine.ts").read_text()
        self.assertIn('"gpt02Issue159PositivePermit"', source)
        self.assertIn("'gpt02Issue159PositivePermit'", source)

    def test_persisted_core_source_identity_is_not_dispatch_authority(self):
        prepared = {
            "company_id": "default",
            "hub_task_id": 171,
            "command_candidate_id": COMMAND,
            "attempt_id": ATTEMPT,
            "core_task_id": CORE,
            "config_sha256": "c" * 64,
            "expires_at_ms": 1_800_000_120_000,
        }
        task = {
            "id": CORE,
            "task_number": "GPT02DEV-171-" + "c" * 14,
            "project_name": "GPT02 DEV coding lifecycle",
            "repository": "Travelintrips/Core-AI-Foundation",
            "branch": "develop",
            "instruction": "DEV E2E source-only proof task",
            "status": "PENDING",
        }
        result = inspect_persisted_core_instruction(
            self.row, prepared, task, 1_800_000_000_000)
        self.assertEqual(result["commandId"], COMMAND)
        self.assertEqual(result["coreTaskId"], CORE)
        self.assertEqual(result["attemptId"], ATTEMPT)
        self.assertEqual(len(result["instructionSha256"]), 64)
        self.assertFalse(result["fullConfigDigestRecomputed"])
        self.assertFalse(result["instructionAuthorityVerified"])
        self.assertFalse(result["ownerChannelVerified"])
        self.assertFalse(result["targetConversationVerified"])
        self.assertFalse(result["bridgeCommandInserted"])
        self.assertFalse(result["dispatchPermitted"])
        self.assertEqual(result["releaseDecision"], "NO_GO")

        for field, wrong in [
            ("company_id", "prod"),
            ("hub_task_id", 170),
            ("command_candidate_id", OTHER),
            ("attempt_id", OTHER),
            ("core_task_id", OTHER),
            ("config_sha256", "x" * 64),
            ("expires_at_ms", 1_800_000_000_000),
        ]:
            with self.subTest(field=field):
                with self.assertRaises(HandoffBoundaryError):
                    inspect_persisted_core_instruction(
                        self.row, dict(prepared, **{field: wrong}),
                        task, 1_800_000_000_000)
        for field, wrong in [
            ("id", OTHER),
            ("task_number", "GPT02DEV-170-cccccccccccccc"),
            ("project_name", "another project"),
            ("repository", "Travelintrips/unrelated"),
            ("branch", "main"),
            ("instruction", ""),
            ("instruction", "contains\ncontrol"),
            ("status", "COMPLETED"),
        ]:
            with self.subTest(field=field, wrong=wrong):
                with self.assertRaises(HandoffBoundaryError):
                    inspect_persisted_core_instruction(
                        self.row, prepared, dict(task, **{field: wrong}),
                        1_800_000_000_000)

    def test_core_instruction_sql_is_read_only_and_single_task_scoped(self):
        query = BOUND_CORE_INSTRUCTION_SQL.lower()
        self.assertTrue(query.strip().startswith("select "))
        self.assertIn("from gpt02_stage.core_preparations", query)
        self.assertIn("join ai_platform.ai_coding_tasks", query)
        self.assertIn("command_candidate_id=%s::uuid", query)
        self.assertIn("attempt_id=%s::uuid", query)
        self.assertIn("limit 2", query)
        for forbidden in ("insert into", "update ", "delete from", "drop table"):
            self.assertNotIn(forbidden, query)

    def test_no_send_or_write_surface(self):
        source = (Path(__file__).resolve().parents[2] /
                  "deploy/ai-coding-standalone-dev/gpt02_issue159_bridge_handoff_preflight.py").read_text()
        for forbidden in ("psycopg", "sqlite3", "httpx", "requests.", "socket.socket",
                          "subprocess", "INSERT INTO", "UPDATE ", "DELETE FROM",
                          "dispatch(", "notifyExternalAgentWork(", "submitCodingBridgeCommand("):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
