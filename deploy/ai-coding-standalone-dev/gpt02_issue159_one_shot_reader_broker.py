#!/usr/bin/env python3
"""UNINSTALLED Issue159 signed one-shot reader broker REVIEW contract (DEV).

This is NOT an operational service, credential issuer or permission token.
There is deliberately no CLI, server listener, DSN, private key, supervisor
implementation, or dispatch path. It reuses existing *pinned* verifier,
bounded canonical readback, and signed row validation. A separately audited
privileged supervisor must eventually provide native identity custody,
atomic one-use issuance and verified relock. That supervisor DOES NOT EXIST.

Any returned result is read-only review evidence with releaseDecision=NO_GO,
not an authorization. Never expose this module through a web/API route.
"""
from __future__ import annotations

from collections.abc import Mapping
import time
from typing import Any

from gpt02_issue159_lineage_db_reader import read_lineage_once
from gpt02_issue159_native_relock_attestation import attest_boolean_relock
from gpt02_issue159_lineage_readback_contract import validate_trusted_lineage_row
from gpt02_issue159_positive_permit_handoff import (
    VERIFIER_PUBLIC_ROOT_DIR, inspect_postlineage_scoped_reader_candidate,
)
from gpt02_issue159_writer_broker_runtime import (
    _load_public_roots, DEFAULT_FINGERPRINT_MANIFEST,
)
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError

PROJECT = "xssrfshdrtdfupgqwfdw"
POOLER_USER_SUFFIX = "." + PROJECT
POOLER_HOST = "aws-1-ap-southeast-2.pooler.supabase.com"
POOLER_PORT = "5432"
MIN_BUDGET_MS = 2500


def _fail(reason: str) -> None:
    raise BrokerAdmissionError(reason)


def _verified_cleanup(cleanup: Any, candidate: dict) -> bool:
    """Only a shape check, NOT native DB attestation or issuance authority."""
    return (
        isinstance(cleanup, dict)
        and set(cleanup) == {
            "role", "scopeSha256", "noLogin", "passwordNull",
            "connectionLimitZero", "zeroActiveSessions", "grantsRevoked",
        }
        and cleanup["role"] == candidate["candidateRole"]
        and cleanup["scopeSha256"] == candidate["scopeSha256"]
        and all(cleanup[k] is True for k in (
            "noLogin", "passwordNull", "connectionLimitZero",
            "zeroActiveSessions", "grantsRevoked",
        ))
    )


def _review_consumption_binding(consumption: Any, candidate: dict) -> bool:
    """Inert receipt-shape check; NOT native proof of a committed DB write.

    Only a separately authenticated, independently reviewed supervisor may
    atomically consume a one-use reader claim in PostgreSQL. The supervisor
    implementation does NOT exist; these fields cannot mint credentials or
    authorize dispatch. Returning a self-reported receipt is insufficient
    without independent ledger and custody review before live activation.
    """
    if not isinstance(consumption, dict) or set(consumption) != {
        "scopeSha256", "verifiedPacketSha256", "role",
        "commandId", "attemptId", "receiptId", "fenceId",
        "consumedExactlyOnce", "releaseDecision",
    }:
        return False
    scope = candidate["scope"]
    return (
        consumption["scopeSha256"] == candidate["scopeSha256"]
        and consumption["verifiedPacketSha256"] == candidate["verifiedPacketSha256"]
        and consumption["role"] == candidate["candidateRole"]
        and consumption["commandId"] == scope["command_id"]
        and consumption["attemptId"] == scope["attempt_id"]
        and consumption["receiptId"] == scope["receipt_id"]
        and consumption["fenceId"] == scope["fence_id"]
        and consumption["consumedExactlyOnce"] is True
        and consumption["releaseDecision"] == "NO_GO"
    )


def review_one_shot_reader_readback(packet: dict, supervisor: Any) -> dict:
    """Source-only one-query transaction + mandatory cleanup REVIEW contract.

    The supervisor is an INTERNAL TEST/REVIEW dependency, NOT authority.
    A source-only return never licenses DB role creation or changes release.
    No caller override of roots, role, task, command or lookup is permitted.
    """
    roots = _load_public_roots(
        VERIFIER_PUBLIC_ROOT_DIR, DEFAULT_FINGERPRINT_MANIFEST,
    )
    candidate = inspect_postlineage_scoped_reader_candidate(packet, roots)
    if (
        candidate.get("environment") != "DEV"
        or candidate.get("stage")
          != "FOUR_SIGNATURE_PERSISTED_LINEAGE_SCOPED_READER_REVIEW_ONLY"
        or candidate.get("persistedAdminApprovalReadBack") is not True
        or candidate.get("persistedLineageMatched") is not True
        or candidate.get("databaseRoleProvisioned") is not False
        or candidate.get("credentialIssuancePermitted") is not False
        or candidate.get("databaseWritePerformed") is not False
        or candidate.get("authorizationGranted") is not False
        or candidate.get("signingPermitted") is not False
        or candidate.get("dispatchPermitted") is not False
        or candidate.get("releaseDecision") != "NO_GO"
    ):
        _fail("ONE_SHOT_INERT_POSTLINEAGE_EVIDENCE_REQUIRED")
    now_ms = int(time.time() * 1000)
    if (type(candidate.get("expiresAt")) is not int
            or candidate["expiresAt"] - now_ms < MIN_BUDGET_MS):
        _fail("ONE_SHOT_SIGNED_LEASE_INSUFFICIENT")
    scope = candidate["scope"]
    expected_user = candidate["candidateRole"] + POOLER_USER_SUFFIX
    # No user-supplied fields can override the signed lookup.
    lookup = {
        "company_id": scope["company_id"],
        "task_id": scope["task_id"],
        "command_id": scope["command_id"],
        "attempt_id": scope["attempt_id"],
        "approval_digest": scope["approval_digest"],
    }
    if not callable(getattr(supervisor, "consume_scope_once", None)):
        _fail("ONE_SHOT_DURABLE_CONSUMPTION_SUPERVISOR_MISSING")
    if not callable(getattr(supervisor, "open_one_scoped_connection", None)):
        _fail("ONE_SHOT_SUPERVISOR_MISSING")
    if not callable(getattr(supervisor, "relock_and_verify", None)):
        _fail("ONE_SHOT_RELOCK_NOT_AVAILABLE")
    if not callable(getattr(supervisor, "open_minimal_auditor_connection", None)):
        _fail("ONE_SHOT_NATIVE_ADMIN_READBACK_NOT_AVAILABLE")

    result = None
    error = None
    # The consumption claim must COMMIT before even attempting the reader
    # connection. Otherwise a replayed approval could reopen the same role.
    # A failed consumption, replay or partial external commit still enters
    # mandatory relock; it MUST NEVER proceed to SELECT.
    # This is a SOURCE-ONLY trust contract, not a deployed ledger writer.
    try:
        try:
            consumed = supervisor.consume_scope_once(candidate)
            if not _review_consumption_binding(consumed, candidate):
                _fail("ONE_SHOT_CONSUMPTION_BINDING_NOT_PROVEN")
            with supervisor.open_one_scoped_connection(candidate) as conn:
                info = getattr(conn, "info", None)
                if (
                    info is None
                    or getattr(info, "user", None) != expected_user
                    or getattr(info, "dbname", None) != "postgres"
                    or getattr(info, "host", None) != POOLER_HOST
                    or str(getattr(info, "port", "")) != POOLER_PORT
                    or getattr(conn, "autocommit", None) is not False
                ):
                    _fail("ONE_SHOT_NATIVE_READER_IDENTITY_OR_TXN_INVALID")
                # libpq's verify-full validates the negotiated server
                # certificate and hostname at connect-time. Check the
                # effective parameters, not a caller-supplied 'tlsVerified'
                # boolean. No secrets or connection strings are returned.
                get_params = getattr(info, "get_parameters", None)
                params = get_params() if callable(get_params) else None
                if (
                    not isinstance(params, Mapping)
                    or params.get("sslmode") != "verify-full"
                    or not isinstance(params.get("sslrootcert"), str)
                    or not params["sslrootcert"]
                ):
                    _fail("ONE_SHOT_TLS_VERIFY_FULL_REQUIRED")
                rows = read_lineage_once(conn, lookup)
                if int(time.time() * 1000) >= candidate["expiresAt"]:
                    _fail("ONE_SHOT_SIGNED_LEASE_EXPIRED_DURING_READ")
                # Genuine signature+persisted row shape and lease checks from
                # the EXISTING trusted lineage contract, no replacement.
                validate_trusted_lineage_row(
                    packet, roots, int(time.time() * 1000), rows,
                )
                result = len(rows) == 1
        except Exception as exc:
            error = exc
    finally:
        cleanup = supervisor.relock_and_verify(candidate)
        if not _verified_cleanup(cleanup, candidate):
            _fail("ONE_SHOT_POSTREAD_RELOCK_NOT_PROVEN")
        # A cleanup report alone is untrusted. A *separate* low-privilege
        # auditor connection may execute only the restricted DB-owned
        # boolean function; it cannot SELECT pg_authid or lineage tables.
        # In the isolated DB function, postgres inspects the native catalogs
        # and returns only whether the exact scoped role is fully relocked.
        with supervisor.open_minimal_auditor_connection(candidate) as audit_conn:
            native = attest_boolean_relock(audit_conn, candidate)
        if (
            native.get("nativeCatalogReadBack") is not True
            or native.get("role") != candidate["candidateRole"]
            or native.get("scopeSha256") != candidate["scopeSha256"]
            or native.get("releaseDecision") != "NO_GO"
        ):
            _fail("ONE_SHOT_NATIVE_RELOCK_ATTESTATION_INVALID")

    if error is not None:
        raise error
    if result is not True:
        _fail("ONE_SHOT_TRUSTED_READBACK_NOT_PROVEN")
    # NEVER return private rows, role credentials, or authorization.
    return {
        "environment": "DEV",
        "stage": "SIGNED_SCOPED_READER_CLEANUP_REVIEW_ONLY",
        "oneCanonicalReadReviewed": True,
        "preReadConsumptionClaimReviewed": True,
        "postReadRelockReported": True,
        "postReadRelockVerifiedByNativePostgres": True,
        "databaseRoleProvisioned": False,
        "credentialIssuancePermitted": False,
        "databaseWritePerformed": False,
        "authorizationGranted": False,
        "signingPermitted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }


if __name__ == "__main__":
    raise SystemExit("UNINSTALLED_REVIEW_ONLY_NO_CREDENTIAL_OR_DB_DISPATCH")
