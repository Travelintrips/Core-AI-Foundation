#!/usr/bin/env python3
"""CST-DEV GPT02 relock one-shot orchestration CANDIDATE, NOT INSTALLED.

This module has no CLI, SQL connection, systemd commands, credential loader,
signing or dispatch. It can act only via three independently reviewed adapters
which do not yet exist as live implementations. Do not use with PROD or legacy
Task 183 / Issue159 signed-one-read packets.

The Owner's recorded decision is distinct from a one-time executor grant.
A caller-supplied Boolean or manifest JSON is never authority.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

SCOPE = "GPT02_RELOCK_CST_DEV"
PROJECT = "xssrfshdrtdfupgqwfdw"
HOST = "srv1792369"
PRINCIPAL = "openclaw-vps-main"
OPERATIONS = (
    "DISABLE_ISSUE159_TIMER",
    "SET_EVIDENCE_ROLES_NOLOGIN_LIMIT0_PASSWORD_NULL",
    "SET_AUDITOR_NOLOGIN_LIMIT0_PRESERVE_PASSWORD",
)


class GateDenied(RuntimeError):
    pass


@dataclass(frozen=True)
class VerifiedDecision:
    """Only an installed, independent ledger reader may construct this."""
    challenge_id: str
    manifest_digest: str
    scope: str
    project: str
    owner_email: str
    decision: str
    challenge_status: str
    matching_decisions: int
    consumed_challenges: int
    operations: tuple[str, ...]


@dataclass(frozen=True)
class VerifiedExecutorGrant:
    """Result of an *independent cryptographic* executor grant verifier."""
    challenge_id: str
    manifest_digest: str
    executor_nonce: str
    scope: str
    project: str
    host: str
    principal: str
    operations: tuple[str, ...]
    grant_active: bool


@dataclass(frozen=True)
class RelockState:
    four_roles_match: bool
    sessions_remaining: int
    open_watchdog_rows: int
    timer_inactive_disabled: bool
    service_inactive: bool
    service_main_pid: int
    credential_metadata_match: bool


class LedgerVerifier(Protocol):
    def verify_recorded_owner_decision(self) -> VerifiedDecision: ...
    def verify_separate_executor_grant(self, decision: VerifiedDecision) -> VerifiedExecutorGrant: ...


class OneUseCustodian(Protocol):
    def claim_executor_nonce_once(self, grant: VerifiedExecutorGrant) -> str: ...
    def record_terminal_receipt(self, claim: str, result: str) -> None: ...


class RelockPort(Protocol):
    def read_state(self) -> RelockState: ...
    def apply_exact_relock_operations(self, grant: VerifiedExecutorGrant, claim: str) -> None: ...


def require_binding(decision: VerifiedDecision, grant: VerifiedExecutorGrant):
    if not isinstance(decision, VerifiedDecision) or not isinstance(grant, VerifiedExecutorGrant):
        raise GateDenied("TRUSTED_VERIFIER_REQUIRED")
    if (decision.scope != SCOPE or decision.project != PROJECT or
        decision.decision != "APPROVED" or decision.challenge_status != "CONSUMED" or
        decision.matching_decisions != 1 or decision.consumed_challenges != 1 or
        tuple(decision.operations) != OPERATIONS or
        len(decision.manifest_digest) != 64 or
        any(c not in "0123456789abcdef" for c in decision.manifest_digest) or
        not decision.challenge_id):
        raise GateDenied("OWNER_DECISION_BINDING_INVALID")
    if (grant.scope != SCOPE or grant.project != PROJECT or grant.host != HOST or
        grant.principal != PRINCIPAL or grant.challenge_id != decision.challenge_id or
        grant.manifest_digest != decision.manifest_digest or
        tuple(grant.operations) != OPERATIONS or
        grant.grant_active is not True or not grant.executor_nonce):
        raise GateDenied("EXECUTOR_GRANT_BINDING_INVALID")


def matching_postconditions(state: RelockState) -> bool:
    return (
        isinstance(state, RelockState) and
        state.four_roles_match is True and state.sessions_remaining == 0 and
        state.open_watchdog_rows == 0 and state.timer_inactive_disabled is True and
        state.service_inactive is True and state.service_main_pid == 0 and
        state.credential_metadata_match is True
    )


def run_once(
    ledger: LedgerVerifier,
    custodian: OneUseCustodian,
    relock: RelockPort,
) -> dict[str, object]:
    """Only dependency-injected, trusted live adapters could perform effects.

    Not an entrypoint. On claim or mutation failure do not automatically retry:
    one-use custodian must reconcile the terminal claim independently first.
    """
    decision = ledger.verify_recorded_owner_decision()
    grant = ledger.verify_separate_executor_grant(decision)
    require_binding(decision, grant)
    before = relock.read_state()
    if not isinstance(before, RelockState):
        raise GateDenied("NATIVE_STATE_EVIDENCE_REQUIRED")
    if before.sessions_remaining != 0 or before.open_watchdog_rows != 0:
        raise GateDenied("ACTIVE_SESSIONS_OR_WATCHDOG")
    if before.service_main_pid != 0:
        raise GateDenied("SERVICE_NOT_IDLE")

    # For already-locked relock state, return a read-only observation. It does
    # not consume a nonce, grant authority, or call this an execution success.
    if matching_postconditions(before):
        return {
            "scope": SCOPE, "status": "ALREADY_RELOCKED_READ_ONLY",
            "executionPerformed": False, "authorizationGranted": False,
            "signingPermitted": False, "dispatchPermitted": False,
            "releaseDecision": "NO_GO",
        }

    # No attempt is allowed until the separate grant exists, is verified,
    # and its one-use nonce is durably claimed in custody.
    claim = custodian.claim_executor_nonce_once(grant)
    if not isinstance(claim, str) or not claim:
        raise GateDenied("ATOMIC_NONCE_CLAIM_REQUIRED")
    try:
        relock.apply_exact_relock_operations(grant, claim)
        after = relock.read_state()
        if not matching_postconditions(after):
            raise GateDenied("INDEPENDENT_RELOCK_READBACK_FAILED")
    except Exception:
        # Do not release/reuse nonce after an ambiguous partial mutation.
        custodian.record_terminal_receipt(claim, "FAILED_RECONCILIATION_REQUIRED")
        raise
    custodian.record_terminal_receipt(claim, "RELOCK_READBACK_PASS")
    return {
        "scope": SCOPE, "status": "RELOCK_READBACK_PASS",
        "executionPerformed": True, "authorizationGranted": False,
        "signingPermitted": False, "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }
