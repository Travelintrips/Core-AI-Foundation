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

import hashlib
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


# From the existing gpt02_stage.prepare_core_task_v1_internal contract:
# the immutable task instruction is persisted in ai_coding_tasks, while
# core_preparations stores its command/attempt/core-task and config digest.
# This is read-only and must be executed via an independently scoped reader.
BOUND_CORE_INSTRUCTION_SQL = """
SELECT p.company_id,p.hub_task_id,
       p.command_candidate_id::text,p.attempt_id::text,p.core_task_id::text,
       p.config_sha256,
       floor(extract(epoch from p.expires_at)*1000)::bigint AS expires_at_ms,
       c.id::text AS id,c.task_number,c.project_name,c.repository,c.branch,
       c.instruction,c.status
FROM gpt02_stage.core_preparations p
JOIN ai_platform.ai_coding_tasks c ON c.id=p.core_task_id
WHERE p.company_id='default' AND p.hub_task_id=%s::integer
  AND p.command_candidate_id=%s::uuid
  AND p.attempt_id=%s::uuid
ORDER BY p.core_task_id LIMIT 2
"""
BOUND_PREP_FIELDS = frozenset({
    "company_id","hub_task_id","command_candidate_id","attempt_id",
    "core_task_id","config_sha256","expires_at_ms",
})
BOUND_TASK_FIELDS = frozenset({
    "id","task_number","project_name","repository","branch",
    "instruction","status",
})


def inspect_persisted_core_instruction(
    outbox: Any, prepared: Any, core_task: Any, now_ms: int,
) -> dict[str, Any]:
    """Attest proposal identity and instruction hash, never approve a send.

    Inputs must come from a trusted read-only SQL adapter. A caller may forge
    the JSON objects, so this pure function NEVER grants dispatch authority.
    """
    if type(now_ms) is not int or now_ms <= 0:
        deny("CORE_INSTRUCTION_CLOCK_INVALID")
    if not isinstance(outbox, Mapping) or set(outbox) != OUTBOX_FIELDS:
        deny("HELD_OUTBOX_ROW_SHAPE_INVALID")
    if outbox.get("delivery_state") != HELD or outbox.get("worker_id") != WORKER:
        deny("HELD_OUTBOX_SCOPE_INVALID")
    if not isinstance(prepared, Mapping) or set(prepared) != BOUND_PREP_FIELDS:
        deny("CORE_PREPARATION_READBACK_SHAPE_INVALID")
    if not isinstance(core_task, Mapping) or set(core_task) != BOUND_TASK_FIELDS:
        deny("CORE_TASK_READBACK_SHAPE_INVALID")
    for field in ("command_id", "attempt_id", "core_task_id"):
        canonical_uuid(outbox.get(field), "OUTBOX_UUID_INVALID")
    for field in ("command_candidate_id", "attempt_id", "core_task_id"):
        canonical_uuid(prepared.get(field), "CORE_PREPARATION_UUID_INVALID")
    canonical_uuid(core_task.get("id"), "CORE_TASK_UUID_INVALID")
    task_id = outbox.get("hub_task_id")
    config_hash = prepared.get("config_sha256")
    expires_at_ms = prepared.get("expires_at_ms")
    instruction = core_task.get("instruction")
    if (
        type(task_id) is not int or task_id <= 139
        or prepared.get("company_id") != "default"
        or prepared.get("hub_task_id") != task_id
        or prepared.get("command_candidate_id") != outbox["command_id"]
        or prepared.get("attempt_id") != outbox["attempt_id"]
        or prepared.get("core_task_id") != outbox["core_task_id"]
        or core_task.get("id") != outbox["core_task_id"]
        or type(expires_at_ms) is not int or expires_at_ms <= now_ms
        or not isinstance(config_hash, str) or not HEX64.fullmatch(config_hash)
        or core_task.get("task_number") !=
            ("GPT02DEV-" + str(task_id) + "-" + config_hash[:14])
        or core_task.get("project_name") != "GPT02 DEV coding lifecycle"
        or core_task.get("repository") != "Travelintrips/Core-AI-Foundation"
        or core_task.get("branch") != "develop"
        or core_task.get("status") != "PENDING"
        or not isinstance(instruction, str) or not (1 <= len(instruction) <= 2000)
        or any(ord(c) < 32 or ord(c) == 127 for c in instruction)
    ):
        deny("IMMUTABLE_CORE_INSTRUCTION_BINDING_REQUIRED")
    return {
        "environment": "DEV",
        "stage": "READONLY_CORE_INSTRUCTION_SOURCE_BOUND",
        "commandId": outbox["command_id"],
        "coreTaskId": outbox["core_task_id"],
        "attemptId": outbox["attempt_id"],
        "instructionSha256": hashlib.sha256(instruction.encode("utf-8")).hexdigest(),
        "source": "gpt02_stage.core_preparations+ai_platform.ai_coding_tasks",
        "trustedReaderMustAuthenticate": True,
        "ownerChannelVerified": False,
        "targetConversationVerified": False,
        "bridgeCommandInserted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }
