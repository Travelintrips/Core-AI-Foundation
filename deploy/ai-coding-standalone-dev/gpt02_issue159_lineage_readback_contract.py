"""GPT02 DEV receipt/fence trusted-readback contract (source-only).

No database connections, signer key access, or permission to write/dispatch.
The SQL is for a *dedicated read-only* adapter using bound parameters.
Never accept receiptId or fenceId supplied by an untrusted request as proof.
"""
from __future__ import annotations

import hashlib
from typing import Any, Mapping

from gpt02_issue159_writer_broker_contract import (
    BrokerAdmissionError, UUID, WORKER, verify_lifecycle_evidence_packet,
)

# PostgreSQL only. Query from immutable server-side SQL with parameter binding,
# scoped to the previously verified task/command/attempt/approval digest.
# In particular, neither receipt_id nor fence_id is a query argument.
TRUSTED_LINEAGE_SQL = """
SELECT
  a.task_id, a.company_id, a.attempt_id::text AS attempt_id,
  a.command_id::text AS command_id, a.digest AS approval_digest,
  a.nonce AS approval_nonce, a.expires_at AS approval_expires_at,
  l.link_id::text AS link_id, l.hub_execution_id::text AS hub_execution_id,
  l.core_task_id::text AS core_task_id, l.link_digest,
  l.expires_at AS link_expires_at,
  r.id::text AS receipt_id, r.consumed_at AS receipt_consumed_at,
  i.binding_verified, i.may_dispatch_worker, i.may_issue_grant,
  i.may_close_job, i.core_ledger_written AS identity_ledger_written,
  f.fence_id::text AS fence_id, f.worker_id, f.lease_epoch,
  f.lease_started_at, f.lease_expires_at,
  f.dispatch_allowed AS fence_dispatch_allowed,
  f.core_ledger_written AS fence_ledger_written
FROM gpt02_private.approvals AS a
JOIN gpt02_private.operator_links AS l
  ON l.command_id = a.command_id
 AND l.attempt_id = a.attempt_id
 AND l.company_id = a.company_id
 AND l.hub_task_id = a.task_id
 AND l.approval_digest = a.digest
JOIN gpt02_private.receipts AS r
  ON r.command_id = a.command_id
 AND r.nonce = a.nonce AND r.digest = a.digest
JOIN gpt02_private.core_identity_receipts AS i
  ON i.receipt_id = r.id AND i.command_id = r.command_id
 AND i.link_id = l.link_id AND i.link_digest = l.link_digest
JOIN gpt02_private.post_consumption_fences AS f
  ON f.receipt_id = r.id AND f.command_id = a.command_id
 AND f.link_id = l.link_id AND f.attempt_id = a.attempt_id
 AND f.hub_execution_id = l.hub_execution_id
 AND f.core_task_id = l.core_task_id
WHERE a.company_id = %(company_id)s
  AND a.task_id = %(task_id)s
  AND a.command_id = %(command_id)s::uuid
  AND a.attempt_id = %(attempt_id)s::uuid
  AND a.digest = %(approval_digest)s
LIMIT 2
"""

ROW_FIELDS = frozenset((
    "task_id", "company_id", "attempt_id", "command_id",
    "approval_digest", "approval_nonce", "approval_expires_at",
    "link_id", "hub_execution_id", "core_task_id", "link_digest",
    "link_expires_at", "receipt_id", "receipt_consumed_at",
    "binding_verified", "may_dispatch_worker", "may_issue_grant",
    "may_close_job", "identity_ledger_written",
    "fence_id", "worker_id", "lease_epoch",
    "lease_started_at", "lease_expires_at",
    "fence_dispatch_allowed", "fence_ledger_written",
))


def validate_trusted_lineage_row(
    packet: Mapping[str, Any], roots: Mapping[str, str],
    observed_at_ms: int, rows: Any,
) -> dict[str, Any]:
    """Consume rows returned from a separately authenticated read-only adapter.

    This function cannot authenticate the adapter or guarantee transaction
    freshness: the operational caller must enforce both separately.
    """
    verified = verify_lifecycle_evidence_packet(packet, roots, observed_at_ms)
    if not isinstance(rows, (tuple, list)) or len(rows) != 1:
        raise BrokerAdmissionError("TRUSTED_LINEAGE_ROW_COUNT_INVALID")
    row = rows[0]
    if not isinstance(row, dict) or set(row) != ROW_FIELDS:
        raise BrokerAdmissionError("TRUSTED_LINEAGE_ROW_SHAPE_INVALID")
    a = packet["approval"]["claims"]
    link = packet["hubLink"]["claims"]
    issuer = packet["issuerEvidence"]["claims"]
    expected = {
        "task_id": a["taskId"],
        "company_id": a["companyId"],
        "command_id": a["commandId"],
        "attempt_id": a["attemptId"],
        "approval_digest": verified["approvalDigest"],
        "approval_nonce": a["nonce"],
        "link_id": link["linkId"],
        "hub_execution_id": link["hubExecutionId"],
        "core_task_id": link["coreTaskId"],
        "link_digest": verified["hubLinkDigest"],
        "receipt_id": issuer["receiptId"],
        "fence_id": issuer["fenceId"],
        "worker_id": WORKER,
        "lease_epoch": 1,
    }
    if any(type(row[k]) is not type(v) or row[k] != v for k, v in expected.items()):
        raise BrokerAdmissionError("TRUSTED_LINEAGE_BINDING_MISMATCH")
    # Mandatory fail-closed evidence state: this chain cannot grant dispatch.
    if any(row[k] is not False for k in (
        "binding_verified", "may_dispatch_worker", "may_issue_grant",
        "may_close_job", "identity_ledger_written",
        "fence_dispatch_allowed", "fence_ledger_written",
    )):
        raise BrokerAdmissionError("TRUSTED_LINEAGE_FORBIDDEN_AUTHORITY")
    # Times are UTC epoch milliseconds normalized by the read-only adapter.
    timing = ("approval_expires_at", "link_expires_at",
              "receipt_consumed_at", "lease_started_at", "lease_expires_at")
    if any(type(row[k]) is not int for k in timing):
        raise BrokerAdmissionError("TRUSTED_LINEAGE_TIMESTAMPS_INVALID")
    if not (row["receipt_consumed_at"] <= row["lease_started_at"]
            and row["lease_started_at"] <= issuer["issuedAt"]
            and row["receipt_consumed_at"] >= row["lease_started_at"] - 15000
            and observed_at_ms < min(
                row["approval_expires_at"],
                row["link_expires_at"], row["lease_expires_at"],
            )
            and row["lease_expires_at"] - row["lease_started_at"] <= 15000
            and issuer["expiresAt"] <= row["lease_expires_at"]):
        raise BrokerAdmissionError("TRUSTED_LINEAGE_LEASE_OR_EXPIRY_INVALID")
    if issuer["nonceDigest"] != hashlib.sha256(a["nonce"].encode("utf-8")).hexdigest():
        raise BrokerAdmissionError("TRUSTED_LINEAGE_NONCE_DIGEST_INVALID")
    return {
        "environment": "DEV",
        "stage": "POST_FENCE_TRUSTED_READBACK_VERIFICATION_ONLY",
        "fourSignaturesVerified": True,
        "persistedLineageMatched": True,
        "trustedAdapterAuthenticated": False,
        "databaseWritePerformed": False,
        "nonceConsumed": False,
        "leaseConsumed": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }
