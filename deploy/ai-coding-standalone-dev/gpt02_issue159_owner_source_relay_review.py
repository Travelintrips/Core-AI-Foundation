#!/usr/bin/env python3
"""Issue159 DEV: original signed Owner approval -> committed SQLite outbox review.

STAGE ONE of TWO, SOURCE ONLY. This module uses the ORIGINAL Ed25519
approval-domain verifier and EXISTING private SQLite approval-reader Unix
socket, now requiring the immutable outbox row in the same SQLite snapshot.
An Owner's already committed decision can be imported BEFORE issuer signing:
no fourth-signature dependency cycle and no second human approval.

No role issuance, PostgreSQL INSERT, live credential, signer or worker is here.
The returned data are bounded source-binding PARAMETERS ONLY, never authority.
"""
from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Callable
from typing import Any

from gpt02_issue159_approval_intent_contract import (
    validate_approval_claims, ApprovalIntentContractError,
)
from gpt02_issue159_writer_broker_contract import (
    BrokerAdmissionError, APPROVAL_FIELDS, _verify, UUID,
)
from gpt02_issue159_writer_broker_runtime import (
    _load_public_roots, DEFAULT_FINGERPRINT_MANIFEST,
)
from gpt02_issue159_positive_permit_handoff import VERIFIER_PUBLIC_ROOT_DIR
from gpt02_issue159_operational_signer import (
    APPROVAL_READER, _unix_json,
)

MAX_APPROVAL_READ_MS=1700

def _deny(code: str) -> None:
    raise BrokerAdmissionError(code)


def review_signed_owner_source(
    signed_approval: Any, *, pinned_public_roots: Any,
    observed_ms: int, read_owner_outbox: Callable[[dict,int],tuple[int,dict]],
) -> dict[str,Any]:
    """Purely source-authorized review; callers cannot mint DB permission.

    The operational wrapper below supplies BOTH pinned roots and the private
    socket reader internally. Unit fixtures may inject synthetic data here.
    """
    if (
        type(observed_ms) is not int or observed_ms<=0
        or not isinstance(signed_approval,dict)
        or set(signed_approval)!={"claims","signature"}
        or not isinstance(pinned_public_roots,dict)
        or set(pinned_public_roots)!={"approval","hub","core","issuer"}
        or not callable(read_owner_outbox)
    ):
        _deny("OWNER_SOURCE_INPUT_OR_ROOTS_INVALID")
    claims=signed_approval["claims"]
    try:validate_approval_claims(claims)
    except ApprovalIntentContractError:
        _deny("OWNER_SOURCE_CANONICAL_CLAIMS_INVALID")
    if (
        claims["taskId"]<=171 or claims["companyId"]!="default"
        or claims["operatorNamespace"]!="ai-task-hub.public.users"
        or claims["issuedAt"]>observed_ms
        or claims["expiresAt"]-observed_ms<3500
    ):
        _deny("OWNER_SOURCE_SCOPE_OR_LEASE_INVALID")
    digest=_verify("approval",claims,signed_approval["signature"],
                   pinned_public_roots["approval"],APPROVAL_FIELDS)
    # Distinct immutable decision, command and attempt. Only the root-owned
    # reader can witness whether this approved SQLite row AND outbox coexist.
    lookup={
        "claimsSha256":digest,"taskId":claims["taskId"],
        "commandId":claims["commandId"],"attemptId":claims["attemptId"],
        "companyId":claims["companyId"],
        "superAdminId":claims["superAdminId"],
    }
    returned=read_owner_outbox(lookup,observed_ms)
    if (not isinstance(returned,tuple) or len(returned)!=2 or
        returned[0]!=200 or not isinstance(returned[1],dict)):
        _deny("OWNER_SOURCE_PRIVATE_READBACK_UNAVAILABLE")
    envelope=returned[1]
    data=envelope.get("result")
    decision=data.get("decision") if isinstance(data,dict) else None
    if (
        envelope.get("ok") is not True
        or envelope.get("environment")!="DEV"
        or envelope.get("approvalReadOnly") is not True
        or envelope.get("decisionCreated") is not False
        or envelope.get("releaseDecision")!="NO_GO"
        or any(envelope.get(k) is not False for k in
               ("signingPermitted","authorizationGranted","dispatchPermitted"))
        or not isinstance(data,dict)
        or data.get("sourceOutboxMatched") is not True
        or data.get("persistedTrustedReadProven") is not True
        or data.get("approvalBindingMatched") is not True
        or data.get("adminApprovalMatched") is not True
        or data.get("releaseDecision")!="NO_GO"
        or not isinstance(decision,dict)
        or not isinstance(decision.get("decisionId"),str)
        or UUID.fullmatch(decision["decisionId"]) is None
        or decision.get("claimsSha256")!=digest
        or decision.get("actorId")!=claims["superAdminId"]
        or decision.get("roleAtDecision")!="super_admin"
        or decision.get("authMethod") not in
            ("supabase_admin_session","supabase_aal2")
        or decision.get("decision")!="APPROVE"
        or type(decision.get("recordedAt")) is not int
        or type(decision.get("expiresAt")) is not int
        or not claims["issuedAt"]<=decision["recordedAt"]<=observed_ms
        or decision["expiresAt"]!=claims["expiresAt"]
        or decision["recordedAt"]>=decision["expiresAt"]
    ):
        _deny("OWNER_SOURCE_AUTHENTIC_OUTBOX_NOT_PROVEN")
    return {
        "environment":"DEV",
        "stage":"SIGNED_PERSISTED_OWNER_SOURCE_REVIEW_ONLY",
        "sourceDecisionId":decision["decisionId"],
        "claimsSha256":digest,
        "ownerActorId":decision["actorId"],
        "authMethod":decision["authMethod"],
        "roleAtDecision":"super_admin",
        "companyId":"default","taskId":claims["taskId"],
        "commandId":claims["commandId"],
        "attemptId":claims["attemptId"],
        "recordedAtMs":decision["recordedAt"],
        "expiresAtMs":decision["expiresAt"],
        "outboxVerifiedInSQLite":True,
        "signatureVerifiedByOriginalRoot":True,
        "postgresFenceWritten":False,
        "credentialIssuancePermitted":False,
        "signingPermitted":False,
        "authorizationGranted":False,
        "dispatchPermitted":False,
        "releaseDecision":"NO_GO",
    }


def review_owner_source_from_existing_service(signed_approval: Any) -> dict:
    """No root, endpoint, role, or time from UI; exact existing socket only."""
    roots=_load_public_roots(
        VERIFIER_PUBLIC_ROOT_DIR,DEFAULT_FINGERPRINT_MANIFEST,
    )
    now=int(time.time()*1000)
    def read(lookup,at):
        return _unix_json(
            APPROVAL_READER,"/owner-outbox-intent",
            {"lookup":lookup,"observedAt":at},
            timeout=3,
        )
    return review_signed_owner_source(
        signed_approval,pinned_public_roots=roots,observed_ms=now,
        read_owner_outbox=read,
    )


if __name__=="__main__":
    raise SystemExit("OWNER_SOURCE_RELAY_REVIEW_ONLY_NO_DB_WRITE")
