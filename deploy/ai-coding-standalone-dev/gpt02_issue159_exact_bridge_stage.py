#!/usr/bin/env python3
"""DEV-only *dormant* Issue159 exact-ID HELD command staging.

NOT installed in the AI Core service, NOT a dispatcher, NOT an authorization
grant, and NOT an API endpoint. No credentials, keys or networking in here.
The existing generic submit creates its own UUID and can re-notify on conflict;
it must never be called for this lifecycle.

An independently authorized future stage process would supply a dedicated
database connection. Inside one PostgreSQL transaction, this code verifies
the role, derives the instruction and original command UUID from already
consumed immutable outbox + Core Task, refuses collisions, then inserts a
held, unassigned bridge row. No worker can claim it through the generic
assignedClientId filter; the Issue159 marker is separately quarantined.
"""
from __future__ import annotations

import os
import re
import uuid
from typing import Any

from gpt02_issue159_positive_release_broker import _make_verified_request
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError

STAGING_ROLE = "dev_gpt02_bridge_stage_writer"
WORKER = "openclaw-dell-chatgpt-wake-dev"
SOURCE = "ai-core"
TYPE = "ISSUE159_HELD"
OUTBOX_STATUS = "HELD_NO_DISPATCH"
MARKER = "gpt02Issue159PositivePermit"
ROLE_SQL = "SELECT session_user::text,current_user::text"
UUID_RE = re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")

# A row can be inserted only from the existing immutable outbox and a
# separately consumed permit, never from arbitrary caller instruction text.
# The Core Task ID is a UUID; public.ai_tasks.id is NOT that identifier.
# No assignedClientId is written, even if the caller supplies one.
HELD_BRIDGE_INSERT_SQL = """
INSERT INTO ai_platform.ai_coding_bridge_commands
 (id,task_id,external_command_id,source,command_type,instruction,
  authority_json,metadata_json,status)
SELECT o.command_id,o.core_task_id,
       'gpt02-issue159:'||o.command_id::text,
       'ai-core','ISSUE159_HELD',c.instruction,
       '{}'::jsonb,
       jsonb_build_object(
         'gpt02Issue159PositivePermit',jsonb_build_object(
           'commandId',o.command_id::text,
           'attemptId',o.attempt_id::text,
           'permitId',o.permit_id::text,
           'deliveryState','HELD_NO_DISPATCH'),
         'devOnly',true,
         'issue159Stage','NO_DISPATCH'),
       'RECEIVED'
FROM gpt02_private.positive_dispatch_outbox o
JOIN gpt02_private.positive_dispatch_consumptions z
  ON z.permit_id=o.permit_id AND z.command_id=o.command_id
JOIN gpt02_private.positive_dispatch_permits permit
  ON permit.permit_id=o.permit_id AND permit.command_id=o.command_id
JOIN gpt02_stage.core_preparations prep
  ON prep.command_candidate_id=o.command_id
  AND prep.attempt_id=o.attempt_id
  AND prep.core_task_id=o.core_task_id
  AND prep.hub_task_id=o.hub_task_id
JOIN ai_platform.ai_coding_tasks c ON c.id=prep.core_task_id
WHERE o.command_id=%s::uuid
  AND o.packet_sha256=%s::text
  AND o.delivery_state='HELD_NO_DISPATCH'
  AND o.worker_id='openclaw-dell-chatgpt-wake-dev'
  AND permit.verified_packet_sha256=o.packet_sha256
  AND permit.expires_at>clock_timestamp()+interval '1 second'
  AND prep.company_id='default'
  AND prep.expires_at>clock_timestamp()+interval '1 second'
  AND c.project_name='GPT02 DEV coding lifecycle'
  AND c.repository='Travelintrips/Core-AI-Foundation'
  AND c.branch='develop'
  AND c.status='PENDING'
  AND c.task_number=('GPT02DEV-'||o.hub_task_id::text||'-'||substr(prep.config_sha256,1,14))
  AND length(c.instruction) BETWEEN 1 AND 2000
  AND c.instruction !~ '[[:cntrl:]]'
  AND NOT EXISTS (
    SELECT 1 FROM ai_platform.ai_coding_bridge_commands previous
    WHERE previous.id=o.command_id
      OR (previous.source='ai-core'
          AND previous.external_command_id='gpt02-issue159:'||o.command_id::text)
      OR (
        previous.metadata_json ? 'gpt02Issue159PositivePermit'
        AND previous.metadata_json->'gpt02Issue159PositivePermit'->>'commandId'
          =o.command_id::text)
  )
RETURNING id::text,task_id::text,source,external_command_id,
          command_type,status,
          metadata_json->>'assignedClientId' AS assigned_client_id
"""

# Deliberately no UPDATE/DELETE, no ACK, no notify, no claim and no dispatch.
# A separate approved claim/lease issuer must be designed and tested after
# dedicated bridge staging is independently reviewed.


def _deny(code: str) -> None:
    raise BrokerAdmissionError(code)


def _canonical_uuid(value: Any) -> str:
    if not isinstance(value, str) or not UUID_RE.fullmatch(value):
        _deny("EXACT_COMMAND_UUID_REQUIRED")
    try:
        if str(uuid.UUID(value)) != value:
            _deny("EXACT_COMMAND_UUID_REQUIRED")
    except ValueError as exc:
        raise BrokerAdmissionError("EXACT_COMMAND_UUID_REQUIRED") from exc
    return value


def stage_exact_held_bridge_command(packet: dict[str, Any],
                                    connection: Any) -> dict[str, Any]:
    """One-shot stage, NEVER a worker dispatch or issuer authorization.

    Input packet is independently validated through the existing four-signer
    read-only verifier; all DB row values are fetched by INSERT..SELECT.
    Production-style configuration must provision an isolated role/connection
    (not present in live DEV). An explicitly enabled test alone cannot grant
    database rights because this role and privileges are not deployed.
    """
    if (os.environ.get("APP_ENV") != "development"
            or os.environ.get("GPT02_ISSUE159_HELD_STAGE_ENABLED") != "true"):
        _deny("HELD_STAGE_DISABLED")
    verified = _make_verified_request(packet)
    command_id = _canonical_uuid(verified["commandId"])
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute(ROLE_SQL)
            role = cursor.fetchone()
            if role != (STAGING_ROLE, STAGING_ROLE):
                _deny("EXCLUSIVE_BRIDGE_STAGE_ROLE_REQUIRED")
            cursor.execute(
                HELD_BRIDGE_INSERT_SQL,
                (command_id, verified["packetSha"]),
            )
            row = cursor.fetchone()
            if row is None:
                _deny("HELD_BRIDGE_INSERT_COLLISION_OR_EXPIRED")
            if (
                not isinstance(row, (tuple, list)) or len(row) != 7
                or row[0] != command_id
                or row[1] != verified["coreTaskId"]
                or row[2] != SOURCE
                or row[3] != "gpt02-issue159:" + command_id
                or row[4] != TYPE
                or row[5] != "RECEIVED"
                or row[6] is not None
            ):
                _deny("HELD_BRIDGE_INSERT_READBACK_MISMATCH")
    return {
        "environment": "DEV",
        "commandId": command_id,
        "stage": "BRIDGE_COMMAND_STORED_BUT_HELD",
        "durableCommandStored": True,
        "commandIdReplaced": False,
        "assignedClientId": None,
        "workerNotified": False,
        "workerClaimAuthorized": False,
        "dispatchPermitted": False,
        "finalAckVerified": False,
        "releaseDecision": "NO_GO",
    }
