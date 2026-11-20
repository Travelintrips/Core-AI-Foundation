#!/usr/bin/env python3
"""Uninstalled DEV-only exact issuer command-ID staging client.

The dedicated stage role has NO direct DML rights. The database's existing
private store owner validates consumed permit/outbox/Core Task and stages one
HELD_NO_DISPATCH command through a narrowly scoped SECURITY DEFINER RPC.
No worker assignment, notification, claim, signer or gateway in this module.
"""
from __future__ import annotations

import os
import re
import uuid
from typing import Any

from gpt02_issue159_positive_release_broker import _make_verified_request
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError

STAGING_ROLE="dev_gpt02_bridge_stage_login"
SOURCE="ai-core"
TYPE="ISSUE159_HELD"
ROLE_SQL="SELECT session_user::text,current_user::text"
HELD_BRIDGE_STAGE_RPC_SQL=(
    "SELECT * FROM gpt02_private.stage_issue159_held_bridge_command("
    "%s::uuid,%s::text)"
)
UUID_RE=re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")


def _deny(code: str) -> None:
    raise BrokerAdmissionError(code)


def _canonical_uuid(value: Any) -> str:
    if not isinstance(value,str) or not UUID_RE.fullmatch(value):
        _deny("EXACT_COMMAND_UUID_REQUIRED")
    try:
        if str(uuid.UUID(value)) != value:
            _deny("EXACT_COMMAND_UUID_REQUIRED")
    except ValueError as exc:
        raise BrokerAdmissionError("EXACT_COMMAND_UUID_REQUIRED") from exc
    return value


def stage_exact_held_bridge_command(packet: dict[str,Any],
                                    connection: Any) -> dict[str,Any]:
    """One-shot private RPC only; NEVER worker dispatch.

    Depends on a real, independently reviewed dedicated database credential.
    No such role/credential is active or deployed on current CST-DEV.
    """
    if (os.environ.get("APP_ENV")!="development"
            or os.environ.get("GPT02_ISSUE159_HELD_STAGE_ENABLED")!="true"):
        _deny("HELD_STAGE_DISABLED")
    verified=_make_verified_request(packet)
    command_id=_canonical_uuid(verified["commandId"])
    try:
        core_id=_canonical_uuid(packet["coreLink"]["claims"]["coreTaskId"])
    except (KeyError,TypeError,AttributeError) as exc:
        raise BrokerAdmissionError("VERIFIED_CORE_TASK_ID_REQUIRED") from exc
    if (packet["coreLink"]["claims"]["coreCommandId"]!=command_id
            or packet["coreLink"]["claims"]["attemptId"]!=verified["attemptId"]):
        _deny("VERIFIED_CORE_COMMAND_BINDING_REQUIRED")
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute(ROLE_SQL)
            role=cursor.fetchone()
            if role!=(STAGING_ROLE,STAGING_ROLE):
                _deny("EXCLUSIVE_BRIDGE_STAGE_ROLE_REQUIRED")
            cursor.execute(HELD_BRIDGE_STAGE_RPC_SQL,
                           (command_id,verified["packetSha"]))
            row=cursor.fetchone()
            if row is None:
                _deny("HELD_BRIDGE_INSERT_COLLISION_OR_EXPIRED")
            if (not isinstance(row,(tuple,list)) or len(row)!=7
                    or row[0]!=command_id or row[1]!=core_id
                    or row[2]!=SOURCE
                    or row[3]!="gpt02-issue159:"+command_id
                    or row[4]!=TYPE or row[5]!="RECEIVED"
                    or row[6] is not None):
                _deny("HELD_BRIDGE_RPC_READBACK_MISMATCH")
    return {
        "environment":"DEV",
        "commandId":command_id,
        "stage":"BRIDGE_COMMAND_STORED_BUT_HELD",
        "durableCommandStored":True,
        "commandIdReplaced":False,
        "assignedClientId":None,
        "workerNotified":False,
        "workerClaimAuthorized":False,
        "dispatchPermitted":False,
        "finalAckVerified":False,
        "releaseDecision":"NO_GO",
    }
