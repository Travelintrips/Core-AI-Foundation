#!/usr/bin/env python3
"""GPT02 Issue159 canonical approval revocation SERIALIZATION, PG16 ONLY.

IMPORTANT: this tests a PROPOSED PostgreSQL-only canonical-authority model,
not real SQLite -> PostgreSQL synchronization or live Super Admin issuance.
All role passwords, packet keys and approvals are disposable fixtures.
No live DB, real token, service, signer, DELL or PROD calls.
"""
from __future__ import annotations

import secrets
import subprocess
import time
import uuid

from test_gpt02_issue159_minimal_catalog_auditor_pg import admin, login, run
from test_gpt02_issue159_issuance_server_clock_pg import (
    AUDIT_SQL, LEDGER_SQL, CLOCK_SQL, CONSUMER_SQL,
    OWNER_PASSWORD, CONSUMER, ISSUANCES, CONSUME_FN,
    owner, insert_sql, prepare_packet, ROOT, AUDIT_FN,
)
from test_gpt02_issue159_signed_scope_pg import quote

MODEL_SQL = (ROOT / "docs/dev" /
             "gpt02-issue159-canonical-approval-fence.PROPOSED.sql")
AUTHORITY = "gpt02_relock_audit.reader_approval_fences"
CONSUMPTIONS = "gpt02_relock_audit.reader_consumptions"
GUARD_SQL = ROOT / "docs/dev/gpt02-issue159-canonical-reader-guard.PROPOSED.sql"
GUARD_USER = "dev_gpt02_reader_admission_guard"
GUARD_FN = "gpt02_relock_audit.canonical_reader_current_guard"


def assert_true(label: str, value: bool):
    if not value:
        raise AssertionError(label)


def authority_insert(params: dict) -> str:
    keys = (
        "scope_sha", "packet_sha", "role_name", "task_id", "company_id",
        "command_id", "attempt_id", "receipt_id", "fence_id",
    )
    values = []
    for key in keys:
        value = params[key]
        if key == "task_id":
            values.append(str(value))
        elif key in ("command_id", "attempt_id", "receipt_id", "fence_id"):
            values.append(quote(value) + "::uuid")
        else:
            values.append(quote(value))
    # Synthetic approval interval; in operational mode it would have to
    # come from a genuine current canonical approval transaction.
    return (
        "INSERT INTO " + AUTHORITY + " (" + ",".join(keys) +
        ",approval_expires_at) VALUES (" + ",".join(values) +
        ",clock_timestamp()+interval '45 seconds');"
    )


def synthetic_scope(letter: str, task: int) -> dict:
    """Database-only negative control — deliberately NOT a signed claim."""
    assert letter in ("b", "c", "d", "e")
    return {
        "scope_sha": letter * 64,
        "packet_sha": {"b": "e", "c": "f", "d": "a", "e": "0"}[letter] * 64,
        "role_name": f"dev_gpt02_task_{task}_{letter * 12}",
        "task_id": task,
        "company_id": "default",
        "command_id": f"00000000-0000-0000-0000-{task:012d}",
        "attempt_id": f"00000000-0000-0000-0000-{task + 100:012d}",
        "receipt_id": f"00000000-0000-0000-0000-{task + 200:012d}",
        "fence_id": f"00000000-0000-0000-0000-{task + 300:012d}",
    }


def revoke_sql(params: dict) -> str:
    return (
        "UPDATE " + AUTHORITY +
        " SET revoked_at=clock_timestamp() WHERE scope_sha=" +
        quote(params["scope_sha"]) + ";"
    )


def claim_sql(params: dict, challenge: str) -> str:
    return (
        "SELECT " + CONSUME_FN + "(" +
        quote(params["role_name"]) + "::name," +
        quote(params["scope_sha"]) + "," +
        quote(params["packet_sha"]) + "," +
        quote(params["command_id"]) + "::uuid," +
        quote(params["attempt_id"]) + "::uuid," +
        quote(params["receipt_id"]) + "::uuid," +
        quote(params["fence_id"]) + "::uuid," +
        quote(challenge) + ")"
    )


def main():
    name = "issue159-canonical-fence-" + uuid.uuid4().hex[:9]
    pw = secrets.token_urlsafe(32)
    hold = None
    try:
        run(
            "docker", "run", "--rm", "-d", "--network", "none",
            "--name", name, "-e", "POSTGRES_USER=root_admin",
            "-e", "POSTGRES_PASSWORD=fixture_only", "postgres:16-alpine",
        )
        for _ in range(120):
            ready = run(
                "docker", "exec", "-e", "PGPASSWORD=fixture_only", name,
                "psql", "-X", "-w", "-h", "127.0.0.1",
                "-U", "root_admin", "-d", "postgres", "-Atc", "SELECT 1",
                check=False,
            )
            if ready.returncode == 0 and ready.stdout.strip() == "1":
                break
            time.sleep(.25)
        else:
            raise AssertionError("DISPOSABLE_POSTGRES_NOT_READY")
        admin(name, """
CREATE SCHEMA gpt02_private;
REVOKE ALL ON SCHEMA gpt02_private FROM PUBLIC;
CREATE ROLE postgres LOGIN CREATEROLE NOINHERIT
 PASSWORD 'synthetic_clock_owner_only';
GRANT CREATE ON DATABASE postgres TO postgres;
GRANT SELECT ON pg_catalog.pg_authid TO postgres;
GRANT pg_read_all_stats TO postgres;
CREATE ROLE unrelated_test LOGIN PASSWORD 'synthetic_unrelated';
""")
        for src in (AUDIT_SQL, LEDGER_SQL, CLOCK_SQL, CONSUMER_SQL, MODEL_SQL, GUARD_SQL):
            owner(name, src.read_text(encoding="utf-8"))
        count = owner(
            name, "SELECT count(*) FROM pg_trigger t WHERE "
            "t.tgname IN ('issuance_approval_fence','consume_approval_fence')"
        ).stdout.strip()
        assert_true("MISSING_SERIALIZED_AUTHORITY_TRIGGERS", count == "2")
        leaked = login(
            name, "unrelated_test", "synthetic_unrelated",
            "SELECT count(*) FROM " + AUTHORITY, check=False,
        )
        assert_true("UNRELATED_LOGIN_READ_CANONICAL_AUTHORITY",
                    leaked.returncode != 0)
        print("PASS_CANONICAL_OWNER_ONLY_AUTHORITY_AND_ROW_LOCK_TRIGGERS")

        # A revoked canonical row must never mint a new private issuance.
        before = synthetic_scope("b", 171)
        owner(name, authority_insert(before))
        owner(name, revoke_sql(before))
        denied = owner(
            name, insert_sql(
                before, "clock_timestamp()+interval '8 seconds'",
            ), check=False,
        )
        assert_true("REVOKED_BEFORE_ISSUE_ACCEPTED",
                    denied.returncode != 0 and
                    "CANONICAL_ISSUANCE_REVOKED_OR_SCOPE_DENIED" in denied.stderr)
        assert_true("REVOKED_ISSUANCE_PERSISTED", owner(
            name, "SELECT count(*) FROM " + ISSUANCES
        ).stdout.strip() == "0")
        print("PASS_CANONICAL_REVOKE_BEFORE_ISSUE_DENIED_NO_ROW")

        # A revocation held uncommitted in another native PostgreSQL session
        # must win before the competing issuance can COMMIT. PostgreSQL's
        # SELECT FOR SHARE lock waits and rechecks under READ COMMITTED.
        competing = synthetic_scope("c", 172)
        owner(name, authority_insert(competing))
        update_then_commit = (
            "BEGIN; " + revoke_sql(competing) +
            " SELECT pg_sleep(2.5); COMMIT;"
        )
        hold = subprocess.Popen(
            ["docker", "exec", "-e", "PGPASSWORD=" + OWNER_PASSWORD,
             name, "psql", "-X", "-w", "-h", "127.0.0.1",
             "-U", "postgres", "-d", "postgres",
             "-v", "ON_ERROR_STOP=1", "-Atc", update_then_commit],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        active = False
        for _ in range(60):
            current = owner(
                name, "SELECT count(*) FROM pg_stat_activity "
                "WHERE usename='postgres' AND pid<>pg_backend_pid() "
                "AND state='active' AND query LIKE '%pg_sleep(2.5)%'"
            ).stdout.strip()
            if current == "1":
                active = True
                break
            if hold.poll() is not None:
                break
            time.sleep(.05)
        assert_true("REVOCATION_LOCK_NOT_HELD_IN_PARALLEL", active)
        blocked = owner(
            name, insert_sql(
                competing, "clock_timestamp()+interval '8 seconds'",
            ), check=False,
        )
        output, errors = hold.communicate(timeout=12)
        hold = None
        assert_true("CONCURRENT_REVOKER_FAILED", "UPDATE 1" in output
                    and not errors)
        assert_true("WAITING_ISSUE_ESCAPED_REVOCATION",
                    blocked.returncode != 0 and
                    "CANONICAL_ISSUANCE_REVOKED_OR_SCOPE_DENIED"
                    in blocked.stderr)
        assert_true("CONCURRENT_REVOKE_ISSUANCE_PERSISTED", owner(
            name, "SELECT count(*) FROM " + ISSUANCES
        ).stdout.strip() == "0")
        print("PASS_CONCURRENT_REVOKE_SERIALIZES_BEFORE_ISSUANCE_COMMIT")

        # Genuine ephemeral four-root fixture (approval readback remains
        # explicitly simulated) demonstrates valid issuance, then
        # post-issuance revocation denies a *new* consumption claim.
        reviewed, packet = prepare_packet()
        params = reviewed["issuanceParameters"]
        assert_true("SOURCE_PREVIEW_MINTED_AUTHORITY",
                    reviewed["releaseDecision"] == "NO_GO"
                    and not reviewed["ownerIssuanceCommitted"])
        owner(name, authority_insert(params))
        issued = owner(
            name, insert_sql(
                params, "to_timestamp(" +
                str(params["expires_at_ms"]) + "/1000.0)",
            ),
        )
        assert_true("SIGNED_REVIEW_INSERT_NOT_RECORDED",
                    issued.returncode == 0)
        assert_true("ISSUE_ROW_COUNT_MISMATCH", owner(
            name, "SELECT count(*) FROM " + ISSUANCES
        ).stdout.strip() == "1")
        owner(name, revoke_sql(params))
        admin(
            name, "ALTER ROLE " + CONSUMER +
            " LOGIN CONNECTION LIMIT 1 PASSWORD " + quote(pw) + ";"
        )
        denied_claim = login(
            name, CONSUMER, pw,
            claim_sql(params, secrets.token_hex(32)), check=False,
        )
        assert_true("CONSUMPTION_AFTER_CANONICAL_REVOKE_ACCEPTED",
                    denied_claim.returncode != 0 and
                    "CANONICAL_CONSUME_REVOKED_OR_SCOPE_DENIED"
                    in denied_claim.stderr)
        assert_true("REVOKED_CONSUMPTION_PERSISTED", owner(
            name, "SELECT count(*) FROM " + CONSUMPTIONS
        ).stdout.strip() == "0")
        admin(name, "ALTER ROLE " + CONSUMER +
              " NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL;")
        print("PASS_REVOKE_AFTER_ISSUE_DENIES_CONSUME_AND_RELOCKS_CONSUMER")

        # The canonical approval cannot be silently reactivated or rebound.
        reset = owner(
            name, "UPDATE " + AUTHORITY + " SET revoked_at=NULL WHERE "
            "scope_sha=" + quote(params["scope_sha"]), check=False,
        )
        altered = owner(
            name, "UPDATE " + AUTHORITY + " SET task_id=999 WHERE "
            "scope_sha=" + quote(params["scope_sha"]), check=False,
        )
        deleted = owner(
            name, "DELETE FROM " + AUTHORITY + " WHERE scope_sha=" +
            quote(params["scope_sha"]), check=False,
        )
        assert_true("CANONICAL_REACTIVATION_OR_MUTATION_ALLOWED",
                    reset.returncode != 0 and altered.returncode != 0
                    and deleted.returncode != 0)
        print("PASS_NO_REACTIVATION_REBIND_OR_DELETE_OF_APPROVAL_FENCE")

        # Positive consumption control while canonical approval is active.
        # Then revoke and verify that the ORIGINAL boolean-only readback
        # is still TRUE: its implementation has no canonical fence check.
        # This is an EXPECTED last-mile gap, NOT successful final admission.
        after_claim = synthetic_scope("d", 173)
        owner(name, authority_insert(after_claim))
        owner(name, insert_sql(
            after_claim, "clock_timestamp()+interval '9 seconds'",
        ))
        admin(
            name, "ALTER ROLE " + CONSUMER +
            " LOGIN CONNECTION LIMIT 1 PASSWORD " + quote(pw) + ";"
            "ALTER ROLE dev_gpt02_relock_catalog_auditor "
            "LOGIN CONNECTION LIMIT 1 PASSWORD " + quote(pw) + ";"
            "ALTER ROLE " + GUARD_USER +
            " LOGIN CONNECTION LIMIT 1 PASSWORD " + quote(pw) + ";"
        )
        challenge = secrets.token_hex(32)
        claim = login(
            name, CONSUMER, pw,
            claim_sql(after_claim, challenge),
        )
        assert_true("ACTIVE_CANONICAL_CONSUMPTION_BLOCKED",
                    claim.stdout.strip() == "t")
        def audit():
            return login(
                name, "dev_gpt02_relock_catalog_auditor", pw,
                claim_sql(after_claim, challenge).replace(
                    CONSUME_FN, AUDIT_FN, 1,
                ),
            )
        assert_true("ACTIVE_AUDITOR_READBACK_UNAVAILABLE",
                    audit().stdout.strip() == "t")
        guard_query = claim_sql(after_claim, challenge).replace(
            CONSUME_FN, GUARD_FN, 1,
        )
        guard_before = login(name, GUARD_USER, pw, guard_query)
        assert_true("ACTIVE_CANONICAL_GUARD_FALSE",
                    guard_before.stdout.strip() == "t")
        denied_owner_guard = owner(name, guard_query, check=False)
        assert_true("WRONG_NATIVE_GUARD_CALLER_ACCEPTED",
                    denied_owner_guard.returncode != 0 and
                    "CANONICAL_FINAL_READER_GUARD_CALLER_INVALID"
                    in denied_owner_guard.stderr)
        owner(name, revoke_sql(after_claim))
        assert_true("POSTREVOKE_OLD_AUDITOR_NOT_STALE",
                    audit().stdout.strip() == "t")
        guard_after = login(name, GUARD_USER, pw, guard_query)
        assert_true("POSTREVOKE_CURRENT_GUARD_WAS_STALE",
                    guard_after.stdout.strip() == "f")
        print("PASS_CANONICAL_GUARD_CURRENT_APPROVAL_DENIES_STALE_AUDIT")

        # A canonical revoker must NOT COMMIT in the middle of one bounded
        # guarded read. This is a proxy SELECT pg_sleep, not a real task row.
        # The guard SQL function takes FOR SHARE; caller holds that lock in
        # its explicit transaction until the bounded operation completes.
        held_read = synthetic_scope("e", 174)
        owner(name, authority_insert(held_read))
        owner(name, insert_sql(
            held_read, "clock_timestamp()+interval '14 seconds'",
        ))
        held_challenge = secrets.token_hex(32)
        valid_claim = login(
            name, CONSUMER, pw, claim_sql(held_read, held_challenge),
        )
        assert_true("BOUNDED_GUARD_FIXTURE_CLAIM_REJECTED",
                    valid_claim.stdout.strip() == "t")
        held_query = claim_sql(held_read, held_challenge).replace(
            CONSUME_FN, GUARD_FN, 1,
        )
        hold_sql = (
            "BEGIN;"
            "SET LOCAL statement_timeout='3500ms';"
            "SET LOCAL idle_in_transaction_session_timeout='4500ms';"
            + held_query +
            ";SELECT pg_sleep(2.3);ROLLBACK;"
        )
        hold = subprocess.Popen(
            ["docker", "exec", "-e", "PGPASSWORD=" + pw, name,
             "psql", "-X", "-w", "-h", "127.0.0.1",
             "-U", GUARD_USER, "-d", "postgres",
             "-v", "ON_ERROR_STOP=1", "-Atc", hold_sql],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        guard_lock_observed = False
        for _ in range(60):
            locks = owner(name,
                "SELECT count(*) FROM pg_locks l "
                "JOIN pg_stat_activity a ON a.pid=l.pid "
                "WHERE a.usename=" + quote(GUARD_USER) +
                " AND l.relation=" + quote(AUTHORITY) + "::regclass"
                " AND l.mode='RowShareLock' AND l.granted"
            ).stdout.strip()
            if locks == "1":
                guard_lock_observed = True
                break
            if hold.poll() is not None:
                break
            time.sleep(.05)
        assert_true("BOUNDED_READER_ROW_SHARE_LOCK_MISSING",
                    guard_lock_observed and hold.poll() is None)
        # A short competing revocation UPDATE must time out instead of
        # committing behind the explicit guard's still-open transaction.
        competing_revoke = owner(
            name, "SET statement_timeout='550ms';" +
            revoke_sql(held_read), check=False,
        )
        assert_true("REVOCATION_COMMITTED_DURING_GUARDED_READ",
                    competing_revoke.returncode != 0 and
                    "canceling statement due to statement timeout"
                    in competing_revoke.stderr)
        assert_true("CANONICAL_REVOKE_MOVED_WHILE_GUARD_HELD",
                    owner(name, "SELECT revoked_at IS NULL FROM " +
                          AUTHORITY + " WHERE scope_sha=" +
                          quote(held_read["scope_sha"])).stdout.strip()
                    == "t")
        out, err = hold.communicate(timeout=12)
        assert_true("GUARDED_BOUNDED_READ_DID_NOT_COMPLETE",
                    hold.returncode == 0 and
                    any(line.strip()=="t" for line in out.splitlines()) and
                    not err)
        hold = None
        print("PASS_GUARDED_TRANSACTION_BLOCKS_REVOKE_UNTIL_BOUND_READ_DONE")
        assert_true("CANONICAL_ISSUANCE_EXPIRED_BEFORE_REVOKE_PROOF",
                    owner(name, "SELECT expires_at>clock_timestamp() "
                               "FROM " + ISSUANCES + " WHERE scope_sha=" +
                               quote(held_read["scope_sha"])).stdout.strip()
                    == "t")
        owner(name, revoke_sql(held_read))
        assert_true("POSTREVOKE_BOUND_GUARD_STILL_TRUE",
                    login(name, GUARD_USER, pw, held_query).stdout.strip()
                    == "f")
        print("PASS_GUARD_RECHECK_DENIES_AFTER_BOUNDED_READ_REVOKED")
        admin(
            name, "ALTER ROLE " + CONSUMER +
            " NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL;"
            "ALTER ROLE dev_gpt02_relock_catalog_auditor "
            "NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL;"
            "ALTER ROLE " + GUARD_USER +
            " NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL;"
        )
        print("PASS_CANONICAL_ACTIVE_APPROVAL_ALLOWS_SINGLE_CONSUMPTION")
        print("EXPECTED_GAP_COMMITTED_CLAIM_AUDIT_STALE_AFTER_REVOKE_NO_GO")
        print("CANONICAL_POSTGRES_ONLY_MODEL_NOT_LIVE_SQLITE_MIGRATION")
        print("FINAL_READER_ADMISSION_AND_CRASH_FENCE_STILL_NO_GO")
    finally:
        if hold is not None and hold.poll() is None:
            hold.kill()
            hold.communicate(timeout=5)
        run("docker", "rm", "-f", name, check=False)


if __name__ == "__main__":
    main()
