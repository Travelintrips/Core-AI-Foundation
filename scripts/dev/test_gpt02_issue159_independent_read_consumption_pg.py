#!/usr/bin/env python3
"""Issue159 native database read-consumption attestation, DISPOSABLE ONLY.

Tests a COMMITTED one-read ledger queried by an independent, minimal
SECURITY DEFINER boolean function. Uses only a networkless PG16 container:
- bootstrap root_admin seeds synthetic tables (existing five-table fixture)
- independent non-superuser postgres migrator owns two immutable ledgers
- low privilege auditor receives only USAGE + EXECUTE on its private RPC
- reader cannot read/write either ledger, audit can only see one boolean
- an uncommitted / rolled-back / replayed / wrong-scope claim is rejected

This is NOT an operational one-shot broker, NOT a Supabase migration, and
does NOT issue any real credentials, signer keys or worker dispatch.
"""
from __future__ import annotations

from pathlib import Path
import secrets
import subprocess
import time
import uuid

from test_gpt02_issue159_minimal_catalog_auditor_pg import (
    AUDITOR, run, admin, login,
)
from test_gpt02_issue159_signed_scope_pg import make_candidate, quote
from test_gpt02_issue159_five_table_task_scope_pg import SQL as FIVE_TABLE_FIXTURE

ROOT = Path(__file__).resolve().parents[2]
BASE_SQL = ROOT / "docs/dev/gpt02-issue159-minimal-catalog-relock-auditor.PROPOSED.sql"
LEDGER_SQL = ROOT / "docs/dev/gpt02-issue159-one-read-consumption-attestation.PROPOSED.sql"
CONSUMER_SQL = ROOT / "docs/dev/gpt02-issue159-one-read-consumer-rpc.PROPOSED.sql"
FUNCTION = "gpt02_relock_audit.reader_consumption_persisted"
CONSUME_FUNCTION = "gpt02_relock_audit.consume_reader_once"
CONSUMER = "dev_gpt02_reader_claim_consumer"


def call(name, user, password, statement, check=True):
    return login(name, user, password, statement, check=check)


def attest(name, password, candidate, read_challenge, *, override=None, check=True):
    scope = candidate["scope"]
    fields = {
        "role": candidate["candidateRole"],
        "scope_sha": candidate["scopeSha256"],
        "packet_sha": candidate["verifiedPacketSha256"],
        "command": scope["command_id"],
        "attempt": scope["attempt_id"],
        "receipt": scope["receipt_id"],
        "fence": scope["fence_id"],
        "read_challenge": read_challenge,
    }
    if override:
        fields.update(override)
    query = (
        "SELECT " + FUNCTION + "("
        + quote(fields["role"]) + "::name,"
        + quote(fields["scope_sha"]) + ","
        + quote(fields["packet_sha"]) + ","
        + quote(fields["command"]) + "::uuid,"
        + quote(fields["attempt"]) + "::uuid,"
        + quote(fields["receipt"]) + "::uuid,"
        + quote(fields["fence"]) + "::uuid,"
        + quote(fields["read_challenge"]) + ")"
    )
    return call(name, AUDITOR, password, query, check=check)


def consume(name, password, candidate, read_challenge, *, override=None, check=True):
    scope = candidate["scope"]
    values = {
        "role": candidate["candidateRole"],
        "scope_sha": candidate["scopeSha256"],
        "packet_sha": candidate["verifiedPacketSha256"],
        "command": scope["command_id"],
        "attempt": scope["attempt_id"],
        "receipt": scope["receipt_id"],
        "fence": scope["fence_id"],
        "read_challenge": read_challenge,
    }
    if override:
        values.update(override)
    statement = (
        "SELECT " + CONSUME_FUNCTION + "("
        + quote(values["role"]) + "::name,"
        + quote(values["scope_sha"]) + ","
        + quote(values["packet_sha"]) + ","
        + quote(values["command"]) + "::uuid,"
        + quote(values["attempt"]) + "::uuid,"
        + quote(values["receipt"]) + "::uuid,"
        + quote(values["fence"]) + "::uuid,"
        + quote(values["read_challenge"]) + ")"
    )
    return call(name, CONSUMER, password, statement, check=check)


def main():
    candidate = make_candidate()
    role = candidate["candidateRole"]
    scope = candidate["scope"]
    if candidate["releaseDecision"] != "NO_GO":
        raise AssertionError("SIGNED_SCOPE_REVIEW_MUST_NOT_GRANT")
    draft = LEDGER_SQL.read_text(encoding="utf-8")
    active = "\n".join(
        line for line in draft.splitlines()
        if not line.lstrip().startswith("--")
    )
    if (
        "SECURITY DEFINER" not in active
        or "SET search_path = pg_catalog, pg_temp" not in active
        or "REVOKE ALL ON FUNCTION" not in active
        or "GRANT EXECUTE ON FUNCTION" not in active
        or "ENABLE ROW LEVEL SECURITY" not in active
        or "FORCE ROW LEVEL SECURITY" not in active
        or "NOLOGIN NOINHERIT" in active
        or "ALTER ROLE" in active
        or "PASSWORD " in active
    ):
        raise AssertionError("PRIVATE_CONSUMPTION_SQL_SOURCE_GUARD_FAILED")

    name = "issue159-ledger-audit-" + uuid.uuid4().hex[:10]
    auditor_password = secrets.token_urlsafe(32)
    consumer_password = secrets.token_urlsafe(32)
    read_challenge = secrets.token_hex(32)
    pg_password = "synthetic_pg_actor_only"
    try:
        run("docker", "run", "--rm", "-d", "--network", "none",
            "--name", name, "-e", "POSTGRES_USER=root_admin",
            "-e", "POSTGRES_PASSWORD=fixture_only", "postgres:16-alpine")
        for _ in range(120):
            r = run("docker", "exec", "-e", "PGPASSWORD=fixture_only",
                    name, "psql", "-X", "-w", "-h", "127.0.0.1",
                    "-U", "root_admin", "-d", "postgres", "-Atc", "SELECT 1",
                    check=False)
            if r.returncode == 0:
                break
            time.sleep(.25)
        else:
            raise RuntimeError("DISPOSABLE_PG_FINAL_TCP_NOT_READY")
        fixture = FIVE_TABLE_FIXTURE.replace("task170_reader", role)
        for old, new in (
            ("'n170'", quote(scope["approval_nonce"])),
            ("'d170'", quote(scope["approval_digest"])),
            ("'link170'", quote(scope["link_digest"])),
        ):
            if old not in fixture:
                raise AssertionError("SIGNED_FIVE_TABLE_FIXTURE_DRIFT")
            fixture = fixture.replace(old, new)
        seeded = admin(name, fixture)
        if "PASS_FIVE_TABLE_DIRECT_ENUMERATION_SCOPED" not in seeded.stderr:
            raise AssertionError("FIVE_TABLE_RLS_FIXTURE_NOT_VERIFIED")

        # Exact intended migrator shape, no PostgreSQL superuser.
        admin(name, """
CREATE ROLE postgres LOGIN CREATEROLE NOINHERIT
 PASSWORD 'synthetic_pg_actor_only';
GRANT CREATE ON DATABASE postgres TO postgres;
GRANT SELECT ON pg_catalog.pg_authid TO postgres;
GRANT pg_read_all_stats TO postgres;
CREATE ROLE unrelated_test LOGIN PASSWORD 'synthetic_unrelated';
""")
        if call(name, "postgres", pg_password,
                BASE_SQL.read_text(encoding="utf-8")).returncode != 0:
            raise AssertionError("BASE_MINIMAL_AUDITOR_PROPOSAL_FAILED")
        if call(name, "postgres", pg_password, draft).returncode != 0:
            raise AssertionError("DURABLE_CONSUMPTION_DRAFT_FAILED")
        if call(name, "postgres", pg_password,
                CONSUMER_SQL.read_text(encoding="utf-8")).returncode != 0:
            raise AssertionError("CONSUMER_ONLY_RPC_MIGRATION_FAILED")
        print("PASS_PRIVATE_IMMUTABLE_LEDGER_AND_BOOLEAN_FUNCTION_MIGRATED_BY_NON_SUPERUSER")
        privileged_consumer = admin(name,
            "SELECT NOT rolcanlogin AND NOT rolinherit AND NOT rolcreaterole "
            "AND NOT rolbypassrls AND rolconnlimit=0 "
            "FROM pg_roles WHERE rolname=" + quote(CONSUMER))
        if privileged_consumer.stdout.strip() != "t":
            raise AssertionError("READER_CONSUMER_NOT_DORMANT")
        admin(name, "ALTER ROLE " + CONSUMER +
              " LOGIN CONNECTION LIMIT 1 PASSWORD " +
              quote(consumer_password) + ";")
        # The source proposal never grants a LOGIN. This is strictly
        # a disposable fixture for native low-privilege SQL testing.
        consumer_privs = admin(name,
            "SELECT has_function_privilege(" + quote(CONSUMER) + ","
            + quote(CONSUME_FUNCTION + "(name,text,text,uuid,uuid,uuid,uuid,text)")
            + ",'EXECUTE'),has_function_privilege(" + quote(AUDITOR) + ","
            + quote(CONSUME_FUNCTION + "(name,text,text,uuid,uuid,uuid,uuid,text)")
            + ",'EXECUTE')")
        if consumer_privs.stdout.strip() not in ("true|false", "t|f"):
            raise AssertionError("CONSUMER_OR_AUDITOR_PRIVILEGES_ESCALATED")
        for forbidden in (
            "SELECT * FROM gpt02_relock_audit.reader_issuances",
            "SELECT * FROM gpt02_relock_audit.reader_consumptions",
            "INSERT INTO gpt02_relock_audit.reader_consumptions "
            "(scope_sha,read_challenge) VALUES (" +
             quote(candidate["scopeSha256"]) + "," + quote(read_challenge) + ")",
            "SELECT count(*) FROM gpt02_private.approvals",
            "SELECT rolpassword FROM pg_catalog.pg_authid",
            "ALTER ROLE " + role + " LOGIN",
        ):
            if call(name, CONSUMER, consumer_password, forbidden,
                    check=False).returncode == 0:
                raise AssertionError("CLAIM_CONSUMER_DIRECT_PRIVILEGE_LEAK")
        print("PASS_CONSUMER_RPC_ONLY_NO_DIRECT_LEDGER_OR_ROLE_PRIVILEGES")

        auditor_role = admin(name,
            "SELECT NOT rolsuper AND NOT rolcreaterole "
            "AND NOT rolinherit AND NOT rolcanlogin AND rolconnlimit=0 "
            "FROM pg_roles WHERE rolname=" + quote(AUDITOR))
        if auditor_role.stdout.strip() != "t":
            raise AssertionError("UNEXPECTED_AUDITOR_ROLE_PRIVILEGES")

        # No hash/ledger SELECT and no INSERT, even if temporarily LOGIN
        # in the DISPOSABLE PG fixture. Never do this on live Supabase.
        admin(name, "ALTER ROLE " + AUDITOR +
              " LOGIN CONNECTION LIMIT 1 PASSWORD " +
              quote(auditor_password) + ";")
        issued = "gpt02_relock_audit.reader_issuances"
        consumed = "gpt02_relock_audit.reader_consumptions"
        for sql in (
            "SELECT * FROM " + issued,
            "SELECT * FROM " + consumed,
            "INSERT INTO " + consumed + "(scope_sha,read_challenge) VALUES (" +
                quote(candidate["scopeSha256"]) + "," + quote(read_challenge) + ")",
            "SELECT rolpassword FROM pg_catalog.pg_authid",
            "ALTER ROLE " + role + " LOGIN",
        ):
            res = call(name, AUDITOR, auditor_password, sql, check=False)
            if res.returncode == 0:
                raise AssertionError("AUDITOR_UNEXPECTED_PRIVILEGE:" + sql[:55])
        has_rpc = admin(name,
            "SELECT has_function_privilege(" + quote(AUDITOR) + ","
            + quote(FUNCTION + "(name,text,text,uuid,uuid,uuid,uuid,text)")
            + ",'EXECUTE')::text,"
            "has_function_privilege('unrelated_test',"
            + quote(FUNCTION + "(name,text,text,uuid,uuid,uuid,uuid,text)")
            + ",'EXECUTE')::text")
        if has_rpc.stdout.strip() not in ("true|false", "t|f"):
            raise AssertionError("RPC_EXECUTE_NOT_RESTRICTED:" + has_rpc.stdout)
        print("PASS_AUDITOR_EXECUTES_ONLY_BOOL_NO_LEDGER_OR_PASSWORD_HASH_READ")

        # An asserted successful consumption with no committed DB row is
        # not proof, and an issuer-only record is insufficient too.
        absent = attest(name, auditor_password, candidate, read_challenge)
        if absent.stdout.strip() != "f":
            raise AssertionError("NONEXISTENT_CONSUMPTION_WAS_ACCEPTED")
        if consume(name, consumer_password, candidate, read_challenge).stdout.strip() != "f":
            raise AssertionError("LOW_PRIV_CONSUMER_MINTED_WITHOUT_ISSUANCE")
        print("PASS_CONSUMER_WITHOUT_OWNER_ISSUANCE_DENIED")
        issued_sql = (
            "INSERT INTO " + issued
            + "(scope_sha,packet_sha,role_name,task_id,company_id,"
            "command_id,attempt_id,receipt_id,fence_id,expires_at)"
            " VALUES ("
            + quote(candidate["scopeSha256"]) + ","
            + quote(candidate["verifiedPacketSha256"]) + ","
            + quote(role) + ","
            + str(scope["task_id"]) + ","
            + quote(scope["company_id"]) + ","
            + quote(scope["command_id"]) + "::uuid,"
            + quote(scope["attempt_id"]) + "::uuid,"
            + quote(scope["receipt_id"]) + "::uuid,"
            + quote(scope["fence_id"]) + "::uuid,"
            "clock_timestamp()+interval '3 minutes')"
        )
        call(name, "postgres", pg_password, issued_sql)
        issuer_only = attest(name, auditor_password, candidate, read_challenge)
        if issuer_only.stdout.strip() != "f":
            raise AssertionError("ISSUANCE_ONLY_NOT_A_CONSUMPTION")
        print("PASS_NO_CLAIM_OR_ISSUANCE_ONLY_CANNOT_FAKE_DB_CONSUMPTION")

        for wrong in (
            {"scope_sha": "f"*64},
            {"packet_sha": "e"*64},
            {"role": "dev_gpt02_task_171_ffffffffffff"},
            {"command": "11111111-1111-4111-8111-111111111111"},
            {"attempt": "22222222-2222-4222-8222-222222222222"},
            {"receipt": "33333333-3333-4333-8333-333333333333"},
            {"fence": "44444444-4444-4444-8444-444444444444"},
        ):
            bad = consume(name, consumer_password, candidate, read_challenge,
                          override=wrong)
            if bad.stdout.strip() != "f":
                raise AssertionError("WRONG_ISSUANCE_SCOPE_BURNED_READ_BUDGET")
        if consume(name, consumer_password, candidate, "invalid",
                   check=False).returncode == 0:
            raise AssertionError("MALFORMED_READ_CHALLENGE_ACCEPTED")
        if call(name, "postgres", pg_password,
                "SELECT " + CONSUME_FUNCTION + "("
                + quote(role) + "::name,"
                + quote(candidate["scopeSha256"]) + ","
                + quote(candidate["verifiedPacketSha256"]) + ","
                + quote(scope["command_id"]) + "::uuid,"
                + quote(scope["attempt_id"]) + "::uuid,"
                + quote(scope["receipt_id"]) + "::uuid,"
                + quote(scope["fence_id"]) + "::uuid,"
                + quote(read_challenge) + ")", check=False).returncode == 0:
            raise AssertionError("POSTGRES_SESSION_BYPASSED_CALLER_PIN")
        print("PASS_CONSUMER_WRONG_SIGNATURE_AND_CALLER_IDENTITY_DENIED")

        # Inject a transactional failure AFTER INSERT but BEFORE COMMIT:
        # the audit RPC must continue to show FALSE, with NO row persisted.
        rollback = (
            "BEGIN; INSERT INTO " + consumed + "(scope_sha,read_challenge) VALUES ("
            + quote(candidate["scopeSha256"]) + "," + quote(read_challenge) + ");"
            " DO $fail$ BEGIN RAISE EXCEPTION 'SYNTHETIC_PRECOMMIT_FAULT';"
            " END $fail$; COMMIT;"
        )
        failed = call(name, "postgres", pg_password, rollback, check=False)
        if failed.returncode == 0 or "SYNTHETIC_PRECOMMIT_FAULT" not in failed.stderr:
            raise AssertionError("EXPECTED_ROLLBACK_INJECTION_NOT_TRIGGERED")
        if attest(name, auditor_password, candidate, read_challenge).stdout.strip() != "f":
            raise AssertionError("UNCOMMITTED_CONSUMPTION_FALSE_POSITIVE")
        print("PASS_ROLLED_BACK_PRECOMMIT_CLAIM_NEVER_ATTESTS")

        # Two low-privilege native consumer sessions contend for the
        # exact one-use claim. The private UNIQUE primary key, not caller
        # locking privileges, serializes their writes.
        consumer_statement = (
            "SELECT " + CONSUME_FUNCTION + "("
            + quote(role) + "::name,"
            + quote(candidate["scopeSha256"]) + ","
            + quote(candidate["verifiedPacketSha256"]) + ","
            + quote(scope["command_id"]) + "::uuid,"
            + quote(scope["attempt_id"]) + "::uuid,"
            + quote(scope["receipt_id"]) + "::uuid,"
            + quote(scope["fence_id"]) + "::uuid,"
            + quote(read_challenge) + ")"
        )
        procs = [
            subprocess.Popen([
                "docker", "exec", "-e", "PGPASSWORD=" + consumer_password,
                name, "psql", "-X", "-w", "-v", "ON_ERROR_STOP=1",
                "-h", "127.0.0.1", "-U", CONSUMER, "-d", "postgres",
                "-Atc", consumer_statement,
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            for _ in range(2)
        ]
        outcomes = [proc.communicate(timeout=15) for proc in procs]
        if any(p.returncode != 0 for p in procs):
            raise AssertionError("CONSUMER_NATIVE_CALLS_FAILED")
        results = sorted(out[0].strip() for out in outcomes)
        if results != ["f", "t"]:
            raise AssertionError("CONCURRENT_CONSUMPTION_NOT_EXACTLY_ONCE:" + repr(results))
        first = attest(name, auditor_password, candidate, read_challenge)
        if first.stdout.strip() != "t":
            raise AssertionError("COMMITTED_MATCHING_DB_CLAIM_NOT_ATTESTED")
        print("PASS_TWO_CONCURRENT_CLAIMS_ONE_DB_COMMIT_ONE_REJECT_AND_AUDIT_TRUE")
        # Each attempted broker call gets a fresh unpredictable challenge.
        # A stale positive persisted row MUST NOT pass a future invocation.
        fresh_read_challenge = secrets.token_hex(32)
        if fresh_read_challenge == read_challenge:
            raise AssertionError("FRESH_CHALLENGE_REUSED")
        stale = attest(name, auditor_password, candidate, fresh_read_challenge)
        if stale.stdout.strip() != "f":
            raise AssertionError("OLD_COMMITTED_ROW_REPLAYED_FOR_NEW_CHALLENGE")
        print("PASS_OLD_COMMITTED_CONSUMPTION_CANNOT_ATTEST_FRESH_CHALLENGE")

        for variant in (
            {"role": "dev_gpt02_task_171_ffffffffffff"},
            {"scope_sha": "f" * 64},
            {"packet_sha": "e" * 64},
            {"command": "11111111-1111-4111-8111-111111111111"},
            {"attempt": "22222222-2222-4222-8222-222222222222"},
            {"receipt": "33333333-3333-4333-8333-333333333333"},
            {"fence": "44444444-4444-4444-8444-444444444444"},
            {"read_challenge": "f" * 64},
        ):
            invalid = attest(name, auditor_password, candidate, read_challenge, override=variant)
            if invalid.stdout.strip() != "f":
                raise AssertionError("WRONG_SIGNED_SCOPE_ATTESTED:" + repr(variant))
        invalid_role = attest(name, auditor_password, candidate, read_challenge,
                              override={"role": "postgres"}, check=False)
        if invalid_role.returncode == 0:
            raise AssertionError("ARBITRARY_ROLE_AUDIT_ACCEPTED")
        print("PASS_MISMATCHED_PACKET_TASK_COMMAND_ATTEMPT_RECEIPT_OR_FENCE_DENIED")

        # Current credential reuse before relock remains a separate risk:
        # this function only proves a committed claim exists.
        replay = consume(name, consumer_password, candidate, read_challenge)
        if replay.stdout.strip() != "f":
            raise AssertionError("PERSISTED_CONSUMPTION_REPLAY_SUCCEEDED")
        if attest(name, auditor_password, candidate, read_challenge).stdout.strip() != "t":
            raise AssertionError("REPLAY_MODIFIED_COMMITTED_AUDIT")
        for statement in (
            "DELETE FROM " + consumed,
            "TRUNCATE " + consumed,
            "UPDATE " + issued + " SET packet_sha='e' || substring(packet_sha,2)",
        ):
            if call(name, "postgres", pg_password, statement,
                    check=False).returncode == 0:
                raise AssertionError("IMMUTABLE_LEDGER_ACCEPTED_MUTATION")
        print("PASS_REPLAY_REJECTED_AND_LEDGER_UPDATE_DELETE_TRUNCATE_IMMUTABLE")

        if call(name, AUDITOR, auditor_password,
                "SELECT count(*) FROM gpt02_private.approvals",
                check=False).returncode == 0:
            raise AssertionError("AUDITOR_CAN_READ_ORIGINAL_FIVE_TABLE_LINEAGE")
        # Synthetic auditor/consumer return to NOLOGIN/password NULL.
        admin(name, "ALTER ROLE " + AUDITOR +
              " NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL; "
              "ALTER ROLE " + CONSUMER +
              " NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL;")
        print("PASS_MINIMAL_AUDITOR_NO_DATA_ACCESS_TEST_ROLE_RELOCKED")
        print("NO_LIVE_ISSUER_NO_CST_DEV_OR_PROD_CHANGES")
    finally:
        run("docker", "rm", "-f", name, check=False)


if __name__ == "__main__":
    main()
