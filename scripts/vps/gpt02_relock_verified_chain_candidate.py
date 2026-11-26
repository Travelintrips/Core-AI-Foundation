#!/usr/bin/env python3
"""Inert integration glue for verified GPT02 Owner relock one-shot.

There is NO CLI, no service unit, no key-generation facility, and no DB/host
connection created here. The caller *must* separately install verified
ledger-connection and pinned public-key custody implementations.
"""
from __future__ import annotations
from collections.abc import Callable

from gpt02_relock_once_candidate import (
    VerifiedDecision, VerifiedExecutorGrant, GateDenied,
)
from gpt02_owner_ledger_reader_candidate import (
    ReadOnlyLedgerCursor, verify_owner_ledger_record,
)
from gpt02_relock_grant_verifier_candidate import verify_signed_executor_grant


class VerifiedRelockDecisionAndGrant:
    """Composes ledger and signature checks; cannot create an authorization."""

    def __init__(
        self, *,
        read_only_ledger: ReadOnlyLedgerCursor,
        challenge_id: str,
        load_pinned_executor_root: Callable[[], bytes],
        load_signed_grant_envelope: Callable[[], object],
        clock_ms: Callable[[], int],
    ):
        if not all(callable(fn) for fn in (
            load_pinned_executor_root, load_signed_grant_envelope, clock_ms
        )):
            raise GateDenied("INDEPENDENT_EXECUTOR_CUSTODY_REQUIRED")
        self._ledger = read_only_ledger
        self._challenge_id = challenge_id
        self._root = load_pinned_executor_root
        self._envelope = load_signed_grant_envelope
        self._clock = clock_ms

    def verify_recorded_owner_decision(self) -> VerifiedDecision:
        return verify_owner_ledger_record(self._ledger, self._challenge_id)

    def verify_separate_executor_grant(
        self, decision: VerifiedDecision
    ) -> VerifiedExecutorGrant:
        # The pinned root must originate from independently controlled
        # deployment custody. An untrusted user field is NEVER a trust root.
        try:
            root = self._root()
            envelope = self._envelope()
            now = self._clock()
        except Exception:
            raise GateDenied("EXECUTOR_TRUST_CUSTODY_UNAVAILABLE") from None
        return verify_signed_executor_grant(envelope, root, decision, now)
