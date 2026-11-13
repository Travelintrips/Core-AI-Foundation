#!/usr/bin/env python3
"""Read-only Issue159 exact-command bridge identity review (DEV proposal).

This is deliberately NOT an AI Core command issuer or a worker dispatcher.
Existing generic bridge submission generates a new UUID and may renotify an
existing worker command. Neither behavior is acceptable for Issue159's
single-command-ID issuer-to-Final-ACK contract.

This module checks the immutable HELD_NO_DISPATCH outbox identity against the
existing bridge's schema and fail-closes on *any* prior command collision.
Only a separate authorized and reviewed transaction may ever insert a command.
"""
from __future__ import annotations

import re
import uuid
from typing import Any, Mapping

WORKER = "openclaw-dell-chatgpt-wake-dev"
HELD = "HELD_NO_DISPATCH"
SOURCE = "ai-core"
COMMAND_TYPE = "EXTERNAL_AGENT_WORK"
PROTECTED_MARKER = "gpt02Issue159PositivePermit"
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
OUTBOX_FIELDS = frozenset({
    "command_id", "permit_id", "attempt_id", "core_task_id", "hub_task_id",
    "worker_id", "packet_sha256", "delivery_state",
})
BRIDGE_ROW_FIELDS = frozenset({
    "id", "source", "external_command_id", "command_type",
    "status", "metadata_json",
})

# Read-only SQL. The operational caller must use a dedicated authenticated
# reader with parameters; caller-owned rows are never authorization evidence.
# This detects UUID, source/external-id and protected-marker collisions.
BRIDGE_IDENTITY_COLLISION_SQL = """
SELECT id::text AS id,source,external_command_id,command_type,status,metadata_json
FROM ai_platform.ai_coding_bridge_commands
WHERE id=%s::uuid
   OR (source=%s::text AND external_command_id=%s::text)
   OR (
     metadata_json ? 'gpt02Issue159PositivePermit'
     AND metadata_json->'gpt02Issue159PositivePermit'->>'commandId'=%s::text
   )
ORDER BY id
LIMIT 4
"""


class HandoffBoundaryError(ValueError):
    pass


def deny(code: str):
    raise HandoffBoundaryError(code)


def canonical_uuid(value: Any, code: str) -> str:
    if not isinstance(value, str) or not UUID_PATTERN.fullmatch(value):
        deny(code)
    try:
        if str(uuid.UUID(value)) != value:
            deny(code)
    except ValueError as exc:
        raise HandoffBoundaryError(code) from exc
    return value


def external_id(command_id: str) -> str:
    canonical_uuid(command_id, "ISSUE159_COMMAND_UUID_INVALID")
    return "gpt02-issue159:" + command_id


def inspect_held_outbox_bridge_identity(
    outbox: Any, reviewed: Any, observed_bridge_rows: Any,
) -> dict[str, Any]:
    """Produce a reconciliation identity, NEVER insertion or dispatch rights.

    The upstream verifier must authenticate the signed packet and persisted
    owner decision. Even if these caller-provided values are fabricated,
    this function cannot authorize or create a command.
    """
    if not isinstance(outbox, Mapping) or set(outbox) != OUTBOX_FIELDS:
        deny("HELD_OUTBOX_ROW_SHAPE_INVALID")
    command_id = canonical_uuid(outbox["command_id"], "ISSUE159_COMMAND_UUID_INVALID")
    attempt_id = canonical_uuid(outbox["attempt_id"], "ISSUE159_ATTEMPT_UUID_INVALID")
    core_id = canonical_uuid(outbox["core_task_id"], "ISSUE159_CORE_TASK_UUID_INVALID")
    canonical_uuid(outbox["permit_id"], "ISSUE159_PERMIT_UUID_INVALID")
    if (
        outbox["delivery_state"] != HELD
        or outbox["worker_id"] != WORKER
        or type(outbox["hub_task_id"]) is not int
        or outbox["hub_task_id"] <= 139
        or not isinstance(outbox["packet_sha256"], str)
        or not HEX64.fullmatch(outbox["packet_sha256"])
    ):
        deny("HELD_OUTBOX_SCOPE_INVALID")
    if not isinstance(reviewed, Mapping) or (
        reviewed.get("environment") != "DEV"
        or reviewed.get("stage") != "FOUR_SIGNATURE_PERSISTED_LINEAGE_REVIEWED"
        or reviewed.get("commandId") != command_id
        or reviewed.get("attemptId") != attempt_id
        or reviewed.get("hubTaskId") != outbox["hub_task_id"]
        or reviewed.get("verifiedPacketSha256") != outbox["packet_sha256"]
        or reviewed.get("verifiedByExistingReader") is not True
        or reviewed.get("databaseWritePerformed") is not False
        or reviewed.get("positivePermitCreated") is not False
        or reviewed.get("signingPermitted") is not False
        or reviewed.get("authorizationGranted") is not False
        or reviewed.get("dispatchPermitted") is not False
        or reviewed.get("releaseDecision") != "NO_GO"
    ):
        deny("EXACT_VERIFIED_ISSUER_OUTBOX_BINDING_REQUIRED")
    if not isinstance(observed_bridge_rows, (list, tuple)):
        deny("TRUSTED_BRIDGE_READBACK_REQUIRED")
    if len(observed_bridge_rows) > 3:
        deny("BRIDGE_COLLISION_CENSUS_NOT_UNIQUE")
    for row in observed_bridge_rows:
        if not isinstance(row, Mapping) or set(row) != BRIDGE_ROW_FIELDS:
            deny("BRIDGE_COLLISION_ROW_INVALID")
        canonical_uuid(row["id"], "BRIDGE_EXISTING_ID_INVALID")
        if (
            not isinstance(row["source"], str)
            or not isinstance(row["external_command_id"], str)
            or not isinstance(row["command_type"], str)
            or not isinstance(row["status"], str)
            or not isinstance(row["metadata_json"], Mapping)
        ):
            deny("BRIDGE_COLLISION_ROW_INVALID")
        marker = row["metadata_json"].get(PROTECTED_MARKER)
        marked_same = (isinstance(marker, Mapping)
                       and marker.get("commandId") == command_id)
        if not (
            row["id"] == command_id
            or (row["source"] == SOURCE
                and row["external_command_id"] == external_id(command_id))
            or marked_same
        ):
            deny("BRIDGE_COLLISION_READBACK_UNSCOPED")
    return {
        "environment": "DEV",
        "stage": "HELD_OUTBOX_EXACT_ID_RECONCILIATION_ONLY",
        "issuerCommandId": command_id,
        "proposedBridgeCommandId": command_id,
        "coreTaskId": core_id,
        "attemptId": attempt_id,
        "hubTaskId": outbox["hub_task_id"],
        "externalCommandId": external_id(command_id),
        "requiredSource": SOURCE,
        "requiredCommandType": COMMAND_TYPE,
        "targetWorker": WORKER,
        "protectedGenericClaimMarker": PROTECTED_MARKER,
        "existingBridgeRowCount": len(observed_bridge_rows),
        "reconciliationRequired": len(observed_bridge_rows) > 0,
        "nextGate": (
            "EXISTING_BRIDGE_COMMAND_RECONCILIATION_REQUIRED"
            if observed_bridge_rows else
            "DEDICATED_AUTHORIZED_INSERT_PATH_NOT_IMPLEMENTED"
        ),
        "genericBridgeSubmitAllowed": False,
        "bridgeCommandInserted": False,
        "workerNotified": False,
        "dispatchPermitted": False,
        "finalAckVerified": False,
        "releaseDecision": "NO_GO",
    }
