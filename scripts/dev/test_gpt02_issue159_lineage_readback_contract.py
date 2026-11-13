"""Synthetic negative tests; never query or modify live Supabase."""
import copy
import unittest

from test_gpt02_issue159_writer_broker_contract import WriterBrokerContractTest
from gpt02_issue159_lineage_readback_contract import (
    TRUSTED_LINEAGE_SQL, ROW_FIELDS, validate_trusted_lineage_row,
)
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError


class TrustedLineageReadbackTest(unittest.TestCase):
    def setUp(self):
        f = WriterBrokerContractTest(
            methodName="test_four_domain_signatures_verify_but_no_authority")
        f.setUp()
        self.fixture = f
        a, l, i = f.approval, f.link, f.issuer
        self.row = {
            "task_id": a["taskId"], "company_id": a["companyId"],
            "attempt_id": a["attemptId"], "command_id": a["commandId"],
            "approval_digest": l["approvalDigest"],
            "approval_nonce": a["nonce"],
            "approval_expires_at": a["expiresAt"],
            "link_id": l["linkId"], "hub_execution_id": l["hubExecutionId"],
            "core_task_id": l["coreTaskId"], "link_digest": self._link_digest(),
            "link_expires_at": l["expiresAt"],
            "receipt_id": i["receiptId"],
            "receipt_consumed_at": f.now - 700,
            "binding_verified": False, "may_dispatch_worker": False,
            "may_issue_grant": False, "may_close_job": False,
            "identity_ledger_written": False,
            "fence_id": i["fenceId"], "worker_id": i["workerId"],
            "lease_epoch": 1, "lease_started_at": f.now - 500,
            "lease_expires_at": f.now + 10000,
            "fence_dispatch_allowed": False,
            "fence_ledger_written": False,
        }

    def _link_digest(self):
        from gpt02_issue159_writer_broker_contract import LINK_FIELDS, _canonical
        import hashlib
        return hashlib.sha256(_canonical(self.fixture.link, LINK_FIELDS)).hexdigest()

    def verify(self, rows=None, packet=None, now=None):
        f = self.fixture
        return validate_trusted_lineage_row(
            f.packet if packet is None else packet,
            f.roots, f.now if now is None else now,
            [self.row] if rows is None else rows,
        )

    def test_matching_readback_is_verification_only(self):
        result = self.verify()
        self.assertTrue(result["fourSignaturesVerified"])
        self.assertTrue(result["persistedLineageMatched"])
        self.assertFalse(result["trustedAdapterAuthenticated"])
        for key in ("databaseWritePerformed", "nonceConsumed", "leaseConsumed",
                    "signingPermitted", "authorizationGranted", "dispatchPermitted"):
            self.assertFalse(result[key])
        self.assertEqual(result["releaseDecision"], "NO_GO")

    def test_missing_duplicate_or_malformed_rows_fail(self):
        for rows in ([], [self.row, self.row], [{}], ["pretend"]):
            with self.subTest(rows=rows):
                with self.assertRaises(BrokerAdmissionError):
                    self.verify(rows=rows)

    def test_cross_command_attempt_receipt_fence_or_operator_fails(self):
        for field, value in (
            ("command_id", "10000000-0000-4000-8000-000000000099"),
            ("attempt_id", "20000000-0000-4000-8000-000000000099"),
            ("receipt_id", "60000000-0000-4000-8000-000000000099"),
            ("fence_id", "70000000-0000-4000-8000-000000000099"),
            ("link_id", "30000000-0000-4000-8000-000000000099"),
            ("approval_digest", "f"*64),
            ("link_digest", "f"*64),
        ):
            with self.subTest(field=field):
                row=dict(self.row)
                row[field]=value
                with self.assertRaises(BrokerAdmissionError):
                    self.verify(rows=[row])

    def test_forbidden_authority_flags_rejected(self):
        for field in ("binding_verified", "may_dispatch_worker", "may_issue_grant",
                      "may_close_job", "identity_ledger_written",
                      "fence_dispatch_allowed", "fence_ledger_written"):
            with self.subTest(field=field):
                row=dict(self.row)
                row[field]=True
                with self.assertRaises(BrokerAdmissionError):
                    self.verify(rows=[row])

    def test_expired_or_invalid_lease_rejected(self):
        for key, value in (
            ("lease_expires_at", self.fixture.now - 1),
            ("approval_expires_at", self.fixture.now - 1),
            ("link_expires_at", self.fixture.now - 1),
            ("receipt_consumed_at", self.fixture.now + 1),
            ("lease_started_at", self.fixture.now + 1),
            ("lease_epoch", 2),
            ("lease_expires_at", self.fixture.now + 20000),
        ):
            with self.subTest(key=key,value=value):
                row=dict(self.row)
                row[key]=value
                with self.assertRaises(BrokerAdmissionError):
                    self.verify(rows=[row])

    def test_signature_mutation_is_rejected_before_row_trust(self):
        packet=copy.deepcopy(self.fixture.packet)
        packet["issuerEvidence"]["claims"]["receiptId"]=self.row["receipt_id"][:-1]+"0"
        with self.assertRaises(BrokerAdmissionError):
            self.verify(packet=packet)

    def test_sql_only_uses_server_bound_command_and_not_client_lineage_ids(self):
        for key in ("%(company_id)s", "%(task_id)s", "%(command_id)s",
                    "%(attempt_id)s", "%(approval_digest)s"):
            self.assertIn(key, TRUSTED_LINEAGE_SQL)
        self.assertNotIn("%(receipt_id)s", TRUSTED_LINEAGE_SQL)
        self.assertNotIn("%(fence_id)s", TRUSTED_LINEAGE_SQL)
        self.assertIn("LIMIT 2", TRUSTED_LINEAGE_SQL)
        self.assertEqual(len(ROW_FIELDS), len(self.row))

    def test_contract_source_has_no_write_or_secret_surface(self):
        from pathlib import Path
        source = (Path(__file__).parents[2] /
                  "deploy/ai-coding-standalone-dev/gpt02_issue159_lineage_readback_contract.py").read_text()
        for word in ("psycopg", "sqlite3", "Ed25519PrivateKey",
                     "INSERT INTO", "UPDATE ", "DELETE FROM", "dispatch("):
            self.assertNotIn(word, source)


if __name__ == "__main__":
    unittest.main()
