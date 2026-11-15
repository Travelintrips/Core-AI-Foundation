#!/usr/bin/env python3
"""SOURCE-ONLY GPT02 Issue159 native PostgreSQL relock attestation (DEV).

Read-only proof for a separately authenticated privileged PostgreSQL session.
It does not connect by itself, issue credentials, run DDL, grant roles, read
password contents, sign, authorize, dispatch, or install a service.

A caller must independently establish an admin connection with libpq
verify-full TLS, pinned Supabase CST-DEV pooler host and trusted CA. This
module checks that connection's identity, then reads pg_authid, pg_roles,
pg_stat_activity, pg_auth_members and effective five-table privileges.
Returned metadata NEVER authorizes a new credential or release.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from typing import Any

from gpt02_issue159_writer_broker_contract import BrokerAdmissionError

PROJECT = "xssrfshdrtdfupgqwfdw"
HOST = "aws-1-ap-southeast-2.pooler.supabase.com"
PORT = "5432"
ADMIN_DB_USER = "postgres." + PROJECT
ROLE = re.compile(r"dev_gpt02_task_([1-9][0-9]*)_([a-f0-9]{12})\Z")
SHA = re.compile(r"[a-f0-9]{64}\Z")
SCOPE_KEYS = frozenset((
    "company_id", "task_id", "command_id", "attempt_id",
    "approval_digest", "approval_nonce", "link_id", "link_digest",
    "hub_execution_id", "core_task_id", "receipt_id", "fence_id",
    "lease_epoch", "worker_id",
))
TABLES = (
    "approvals", "operator_links", "receipts",
    "core_identity_receipts", "post_consumption_fences",
)

# Exact single, parameterized readback. Only the password-NULL boolean is
# selected from pg_authid; neither a password nor a hash leaves PostgreSQL.
# An admin must have explicit SELECT on pg_authid or this fails closed.
READBACK_SQL = """
SELECT
 session_user::text AS observed_session_user,
 current_user::text AS observed_current_user,
 r.rolname::text AS observed_role,
 (NOT r.rolcanlogin) AS no_login,
 (r.rolconnlimit = 0) AS connection_limit_zero,
 (a.rolpassword IS NULL) AS password_null,
 (NOT r.rolinherit) AS no_inherit,
 (NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
  AND NOT r.rolreplication AND NOT r.rolbypassrls) AS no_privileged_role,
 NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
  AS no_role_memberships,
 NOT EXISTS(SELECT 1 FROM pg_stat_activity sa
   WHERE sa.usename=r.rolname) AS zero_active_sessions,
 NOT has_schema_privilege(r.rolname,'gpt02_private','USAGE')
  AS schema_usage_revoked,
 NOT EXISTS(
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='gpt02_private'
     AND c.relname IN (
       'approvals','operator_links','receipts','core_identity_receipts',
       'post_consumption_fences'
     )
     AND (has_table_privilege(r.rolname,c.oid,'SELECT')
       OR has_any_column_privilege(r.rolname,c.oid,'SELECT'))
 ) AS five_table_read_revoked
FROM pg_roles r
JOIN pg_authid a ON a.oid=r.oid
WHERE r.rolname=%(role)s
"""
COLUMNS = (
    "observed_session_user", "observed_current_user", "observed_role",
    "no_login", "connection_limit_zero", "password_null", "no_inherit",
    "no_privileged_role", "no_role_memberships", "zero_active_sessions",
    "schema_usage_revoked", "five_table_read_revoked",
)


def _fail(reason: str) -> None:
    raise BrokerAdmissionError(reason)


def _target(candidate: Any) -> tuple[str, str]:
    """Derive the *relock* target only; never grant authority to this role.

    After expiry an old candidate is acceptable for checking cleanup, but
    never for issuing anything new. Recompute hash-to-role binding so a
    caller cannot substitute a different PostgreSQL role name.
    """
    if not isinstance(candidate, dict):
        _fail("RELOCK_SIGNED_SCOPE_CANDIDATE_MISSING")
    if (
        candidate.get("environment") != "DEV"
        or candidate.get("stage")
           != "FOUR_SIGNATURE_PERSISTED_LINEAGE_SCOPED_READER_REVIEW_ONLY"
        or candidate.get("releaseDecision") != "NO_GO"
        or candidate.get("credentialIssuancePermitted") is not False
        or candidate.get("databaseRoleProvisioned") is not False
        or candidate.get("authorizationGranted") is not False
        or candidate.get("signingPermitted") is not False
        or candidate.get("dispatchPermitted") is not False
        or candidate.get("persistedAdminApprovalReadBack") is not True
        or candidate.get("persistedLineageMatched") is not True
    ):
        _fail("RELOCK_INERT_SIGNED_SCOPE_REQUIRED")
    scope = candidate.get("scope")
    if not isinstance(scope, dict) or set(scope) != SCOPE_KEYS:
        _fail("RELOCK_SCOPE_SHAPE_INVALID")
    task = scope.get("task_id")
    if type(task) is not int or task <= 139 or scope.get("company_id") != "default":
        _fail("RELOCK_SCOPE_TASK_INVALID")
    packet_hash = candidate.get("verifiedPacketSha256")
    scope_hash = candidate.get("scopeSha256")
    if (
        not isinstance(packet_hash, str) or not SHA.fullmatch(packet_hash)
        or not isinstance(scope_hash, str) or not SHA.fullmatch(scope_hash)
    ):
        _fail("RELOCK_SCOPE_HASH_INVALID")
    canonical = json.dumps(
        scope, sort_keys=True, separators=(",", ":"),
        ensure_ascii=False, allow_nan=False,
    ).encode("utf-8")
    actual_hash = hashlib.sha256(
        b"GPT02_POSTLINEAGE_SCOPED_READER_V1\\n" +
        canonical + packet_hash.encode("ascii")
    ).hexdigest()
    role = candidate.get("candidateRole")
    expected = "dev_gpt02_task_" + str(task) + "_" + actual_hash[:12]
    if (
        actual_hash != scope_hash or role != expected
        or not isinstance(role, str) or ROLE.fullmatch(role) is None
        or len(role) >= 63
    ):
        _fail("RELOCK_ROLE_TO_SIGNED_SCOPE_MISMATCH")
    return role, actual_hash


def _require_pinned_admin_connection(connection: Any) -> None:
    """Verify native libpq connection metadata; do not trust caller flags."""
    info = getattr(connection, "info", None)
    if (
        info is None
        or getattr(info, "user", None) != ADMIN_DB_USER
        or getattr(info, "dbname", None) != "postgres"
        or getattr(info, "host", None) != HOST
        or str(getattr(info, "port", "")) != PORT
        or getattr(connection, "autocommit", None) is not False
    ):
        _fail("RELOCK_ADMIN_DATABASE_IDENTITY_INVALID")
    params_fn = getattr(info, "get_parameters", None)
    params = params_fn() if callable(params_fn) else None
    if (
        not isinstance(params, Mapping)
        or params.get("sslmode") != "verify-full"
        or not isinstance(params.get("sslrootcert"), str)
        or not params["sslrootcert"]
    ):
        _fail("RELOCK_ADMIN_TLS_VERIFY_FULL_REQUIRED")


def attest_native_relock(connection: Any, candidate: Any) -> dict[str, Any]:
    """Read native catalogs from a separately trusted admin DB connection.

    A missing role, a live session, role membership, any inherited read, a
    nonempty password, or a role that can login fails closed. A positive
    result is only evidence of cleanup at THIS instant, not a reusable
    grant, not future session monitoring, and not a release authorization.
    """
    role, scope_sha = _target(candidate)
    _require_pinned_admin_connection(connection)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '1500ms'")
            cursor.execute(READBACK_SQL, {"role": role})
            rows = cursor.fetchmany(2)
            actual_fields = tuple(col.name for col in cursor.description)
    finally:
        connection.rollback()
    if actual_fields != COLUMNS or len(rows) != 1 or len(rows[0]) != len(COLUMNS):
        _fail("RELOCK_NATIVE_CATALOG_CARDINALITY_OR_SHAPE_INVALID")
    found = dict(zip(COLUMNS, rows[0]))
    if (
        found["observed_session_user"] != "postgres"
        or found["observed_current_user"] != "postgres"
        or found["observed_role"] != role
        or any(found[name] is not True for name in COLUMNS[3:])
    ):
        _fail("RELOCK_NATIVE_ROLE_OR_CREDENTIAL_NOT_LOCKED")
    return {
        "environment": "DEV",
        "stage": "NATIVE_POSTGRES_RELOCK_READBACK_ONLY",
        "role": role,
        "scopeSha256": scope_sha,
        "noLogin": True,
        "passwordNull": True,
        "connectionLimitZero": True,
        "zeroActiveSessions": True,
        "grantsRevoked": True,
        "nativeCatalogReadBack": True,
        "credentialIssuancePermitted": False,
        "authorizationGranted": False,
        "signingPermitted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }



# Least-privilege alternative to a broad postgres-admin credential.
# Independent security review of the private SECURITY DEFINER boolean-only
# function in docs/dev/gpt02-issue159-minimal-catalog-relock-auditor.PROPOSED.sql
# is REQUIRED before any real auditor LOGIN can be provisioned.
AUDITOR_DB_USER = "dev_gpt02_relock_catalog_auditor." + PROJECT
BOOLEAN_READBACK_SQL = (
    "SELECT gpt02_relock_audit.scoped_reader_fully_locked("
    "%(role)s::name) AS fully_locked"
)


def _require_pinned_minimal_auditor(connection: Any) -> None:
    """The auditor cannot be postgres, service_role or existing issuer."""
    info = getattr(connection, "info", None)
    if (
        info is None
        or getattr(info, "user", None) != AUDITOR_DB_USER
        or getattr(info, "dbname", None) != "postgres"
        or getattr(info, "host", None) != HOST
        or str(getattr(info, "port", "")) != PORT
        or getattr(connection, "autocommit", None) is not False
    ):
        _fail("RELOCK_MINIMAL_AUDITOR_DB_IDENTITY_INVALID")
    params_fn = getattr(info, "get_parameters", None)
    params = params_fn() if callable(params_fn) else None
    if (
        not isinstance(params, Mapping)
        or params.get("sslmode") != "verify-full"
        or not isinstance(params.get("sslrootcert"), str)
        or not params["sslrootcert"]
    ):
        _fail("RELOCK_MINIMAL_AUDITOR_TLS_REQUIRED")


def attest_boolean_relock(connection: Any, candidate: Any) -> dict[str, Any]:
    """Read ONE database-computed boolean through the approved private RPC.

    The isolated DB routine alone may evaluate pg_authid password-null; this
    caller has NO direct pg_authid SELECT, DDL, role alteration or task reads.
    No credential/SQL function is installed by this source. Result represents
    native DB cleanup AT ONE INSTANT, never future authorization.
    """
    role, digest = _target(candidate)
    _require_pinned_minimal_auditor(connection)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '1500ms'")
            cursor.execute(BOOLEAN_READBACK_SQL, {"role": role})
            rows = cursor.fetchmany(2)
            cols = tuple(col.name for col in cursor.description)
    finally:
        connection.rollback()
    if (
        cols != ("fully_locked",)
        or len(rows) != 1
        or len(rows[0]) != 1
        or rows[0][0] is not True
    ):
        _fail("RELOCK_MINIMAL_CATALOG_BOOL_NOT_PROVEN")
    return {
        "environment": "DEV",
        "stage": "NATIVE_MINIMAL_BOOLEAN_RELOCK_READBACK_ONLY",
        "role": role,
        "scopeSha256": digest,
        "nativeCatalogReadBack": True,
        "noLogin": True,
        "passwordNull": True,
        "connectionLimitZero": True,
        "zeroActiveSessions": True,
        "grantsRevoked": True,
        "credentialIssuancePermitted": False,
        "authorizationGranted": False,
        "signingPermitted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }


# One-read ledger proof is distinct from the existing post-read RELOCK
# proof. Both use the SAME dedicated minimal auditor (never the postgres
# password or the attestor/issuer/lineage credentials). The SQL function is
# only a NOT-APPLIED independent-review Draft; no live database call exists.
CONSUMPTION_READBACK_SQL = (
    "SELECT gpt02_relock_audit.reader_consumption_persisted("
    "%(role)s::name,%(scope_sha)s,%(packet_sha)s,"
    "%(command_id)s::uuid,%(attempt_id)s::uuid,"
    "%(receipt_id)s::uuid,%(fence_id)s::uuid,"
    "%(read_challenge)s"
    ") AS consumption_persisted"
)


def attest_persisted_read_consumption(
    connection: Any, candidate: Any, read_challenge: str,
) -> dict[str, Any]:
    """Review-only native committed-claim check before one original read.

    Do not trust a supervisor's self-reported consumption receipt: a
    separately authenticated auditor reads the genuine PRIVATE DB ledger
    through one pinned, bounded, READ ONLY, boolean-only RPC. It compares
    the exact candidate role, all signed row identities and packet digest.
    Any FALSE/NULL/missing/extra/stale query is NO_GO. Even TRUE is NOT
    permission to issue credentials or dispatch; an independent live
    owner and custody review remains mandatory.
    """
    role, sha = _target(candidate)
    if (
        not isinstance(read_challenge, str)
        or SHA.fullmatch(read_challenge) is None
    ):
        _fail("ONE_READ_CHALLENGE_FORMAT_INVALID")
    _require_pinned_minimal_auditor(connection)
    scope = candidate["scope"]
    packet_sha = candidate["verifiedPacketSha256"]
    payload = {
        "role": role,
        "scope_sha": sha,
        "packet_sha": packet_sha,
        "command_id": scope["command_id"],
        "attempt_id": scope["attempt_id"],
        "receipt_id": scope["receipt_id"],
        "fence_id": scope["fence_id"],
        "read_challenge": read_challenge,
    }
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '1500ms'")
            cursor.execute(CONSUMPTION_READBACK_SQL, payload)
            rows = cursor.fetchmany(2)
            cols = tuple(col.name for col in cursor.description)
    finally:
        connection.rollback()
    if (
        cols != ("consumption_persisted",)
        or len(rows) != 1
        or len(rows[0]) != 1
        or rows[0][0] is not True
    ):
        _fail("ONE_READ_DB_COMMITTED_CONSUMPTION_NOT_PROVEN")
    return {
        "environment": "DEV",
        "stage": "NATIVE_ONE_READ_CONSUMPTION_DB_REVIEW_ONLY",
        "role": role,
        "scopeSha256": sha,
        "verifiedPacketSha256": packet_sha,
        "readChallenge": read_challenge,
        "consumptionPersistedInDatabase": True,
        "databaseWritePerformed": False,
        "credentialIssuancePermitted": False,
        "authorizationGranted": False,
        "signingPermitted": False,
        "dispatchPermitted": False,
        "releaseDecision": "NO_GO",
    }

if __name__ == "__main__":
    raise SystemExit("SOURCE_ONLY_NO_CONNECTION_NO_ROLE_CHANGE_NO_RELEASE")
