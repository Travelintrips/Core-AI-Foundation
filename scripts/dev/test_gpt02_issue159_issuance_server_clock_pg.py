#!/usr/bin/env python3
"""Issue159 PRIVATE issuance server-clock + synthetic signed proof, PG16 only.

This is NOT operational issuance or live Super Admin approval. The upstream
persisted readback is simulated by an existing signed-packet fixture. Four
ephemeral Ed25519 signatures are verified by existing code; NO live keys/DB.
Networkless PG16 proves a DB-enforced 15s maximum, a committed once-only
issuance, rollback, replay denial, and downstream one-use consumption.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import secrets
import time
import uuid
from unittest.mock import patch

import gpt02_issue159_positive_permit_handoff as handoff
import gpt02_issue159_scoped_policy_proposal as proposal
import gpt02_issue159_writer_broker_runtime as broker
from gpt02_issue159_writer_broker_contract import (
    BrokerAdmissionError, verify_lifecycle_evidence_packet,
)
from test_gpt02_issue159_postlineage_reader_scope import (
    PostlineageReaderScopeOfflineTest,
)
from test_gpt02_issue159_minimal_catalog_auditor_pg import (
    admin, login, run, AUDITOR,
)
from test_gpt02_issue159_signed_scope_pg import quote

ROOT = Path(__file__).resolve().parents[2]
AUDIT_SQL = ROOT / "docs/dev/gpt02-issue159-minimal-catalog-relock-auditor.PROPOSED.sql"
LEDGER_SQL = ROOT / "docs/dev/gpt02-issue159-one-read-consumption-attestation.PROPOSED.sql"
CLOCK_SQL = ROOT / "docs/dev/gpt02-issue159-reader-issuance-server-clock.PROPOSED.sql"
CONSUMER_SQL = ROOT / "docs/dev/gpt02-issue159-one-read-consumer-rpc.PROPOSED.sql"
OWNER_PASSWORD = "synthetic_clock_owner_only"
CONSUMER = "dev_gpt02_reader_claim_consumer"
ISSUANCES = "gpt02_relock_audit.reader_issuances"
CONSUME_FN = "gpt02_relock_audit.consume_reader_once"
AUDIT_FN = "gpt02_relock_audit.reader_consumption_persisted"


def owner(name: str, sql: str, *, check: bool = True):
    return login(name, "postgres", OWNER_PASSWORD, sql, check=check)


def prepare_packet():
    """Resign the original four-key fixture relative to the CURRENT clock."""
    fixture = PostlineageReaderScopeOfflineTest()
    fixture.setUp()
    f = fixture.fixture
    now = int(time.time() * 1000)
    packet = copy.deepcopy(f.packet)
    f.now = now
    approval = packet["approval"]["claims"]
    approval["issuedAt"] = now - 1000
    approval["expiresAt"] = now + 120000
    for name in ("hubLink", "coreLink"):
        link = packet[name]["claims"]
        link["issuedAt"] = now - 900
        link["expiresAt"] = now + 90000
    issuer = packet["issuerEvidence"]["claims"]
    issuer["issuedAt"] = now - 100
    issuer["expiresAt"] = now + 14000
    f._resign_valid_packet(packet)
    verified = verify_lifecycle_evidence_packet(packet, f.roots, now)
    serialized = json.dumps(
        packet, sort_keys=True, separators=(",", ":"),
        ensure_ascii=False, allow_nan=False,
    ).encode("utf-8")
    proof = dict(fixture.proof)
    proof.update({
        "verifiedPacketSha256": hashlib.sha256(serialized).hexdigest(),
        "approvalDigest": verified["approvalDigest"],
        "hubLinkDigest": verified["hubLinkDigest"],
        "coreLinkDigest": verified["coreLinkDigest"],
    })

    def review(signed_packet, *, roots=f.roots):
        with patch.object(broker, "_load_public_roots", return_value=roots):
            # Both signed verifier and fresh persisted approval readback
            # remain synthetic in this disposable database fixture.
            with patch.object(
                handoff, "inspect_proposed_permit_candidate",
                return_value=proof,
            ):
                with patch.object(
                    broker, "_require_persisted_admin_decision",
                    return_value=now + 11000,
                ):
                    return proposal.review_issuance_bindings_from_authenticated_signed_packet(
                        signed_packet
                    )

    forged = copy.deepcopy(packet)
    forged["issuerEvidence"]["claims"]["receiptId"] = (
        "69999999-9999-4999-8999-999999999999"
    )
    try:
        review(forged)
    except BrokerAdmissionError:
        pass
    else:
        raise AssertionError("TAMPERED_PACKET_ADMITTED_FOR_DB_ISSUANCE")

    changed_roots = dict(f.roots)
    changed_roots["core"] = changed_roots["hub"]
    try:
        review(packet, roots=changed_roots)
    except BrokerAdmissionError:
        pass
    else:
        raise AssertionError("DUPLICATE_SIGNING_ROOT_ADMITTED")

    candidate = review(packet)
    if (
        candidate["releaseDecision"] != "NO_GO"
        or candidate["ownerIssuanceCommitted"] is not False
        or candidate["credentialIssuancePermitted"] is not False
        or candidate["databaseWritePerformed"] is not False
    ):
        raise AssertionError("REVIEW_VALUES_MUST_NOT_AUTHORIZE_ISSUANCE")
    print("PASS_SIGNED_PACKET_AND_SIMULATED_APPROVAL_READBACK_BIND_DB_INPUTS")
    return candidate


def insert_sql(params, expiry_expression, *, fake_issued_at=None):
    """Private fixture SQL; every value originates from signed REVIEW."""
    fields = [
        "scope_sha", "packet_sha", "role_name", "task_id", "company_id",
        "command_id", "attempt_id", "receipt_id", "fence_id",
    ]
    values = []
    for field in fields:
        value = params[field]
        if field == "task_id":
            values.append(str(value))
        elif field in ("command_id", "attempt_id", "receipt_id", "fence_id"):
            values.append(quote(value) + "::uuid")
        else:
            values.append(quote(value))
    columns = ",".join(fields)
    if fake_issued_at is not None:
        columns += ",issued_at"
        values.append(fake_issued_at)
    columns += ",expires_at"
    values.append(expiry_expression)
    return (
        "INSERT INTO " + ISSUANCES +
        "(" + columns + ") VALUES (" + ",".join(values) + ")"
    )


def main():
    name = "issue159-issuance-clock-" + uuid.uuid4().hex[:10]
    auditor_pwd = secrets.token_urlsafe(24)
    consumer_pwd = secrets.token_urlsafe(24)
    try:
        run(
            "docker", "run", "--rm", "-d", "--network", "none",
            "--name", name, "-e", "POSTGRES_USER=root_admin",
            "-e", "POSTGRES_PASSWORD=fixture_only", "postgres:16-alpine",
        )
        # pg_isready may briefly pass during the image's initdb temporary
        # server just before it shuts down. Require actual FINAL TCP SQL.
        for _ in range(120):
            r = run(
                "docker", "exec", "-e", "PGPASSWORD=fixture_only", name,
                "psql", "-X", "-w", "-h", "127.0.0.1",
                "-U", "root_admin", "-d", "postgres", "-Atc", "SELECT 1",
                check=False,
            )
            if r.returncode == 0 and r.stdout.strip() == "1":
                break
            time.sleep(.25)
        else:
            raise RuntimeError("DISPOSABLE_PG16_FINAL_TCP_NOT_READY")
        # The existing minimal-auditor migration verifies denial of
        # gpt02_private schema USAGE. Seed that schema only in this fixture.
        admin(name, """
CREATE SCHEMA gpt02_private;
REVOKE ALL ON SCHEMA gpt02_private FROM PUBLIC;
CREATE ROLE postgres LOGIN CREATEROLE NOINHERIT
 PASSWORD 'synthetic_clock_owner_only';
GRANT CREATE ON DATABASE postgres TO postgres;
GRANT SELECT ON pg_catalog.pg_authid TO postgres;
GRANT pg_read_all_stats TO postgres;
CREATE ROLE unrelated_test LOGIN PASSWORD 'fixture_unrelated_only';
""")
        for sqlfile in (AUDIT_SQL, LEDGER_SQL, CLOCK_SQL, CONSUMER_SQL):
            owner(name, sqlfile.read_text(encoding="utf-8"))
        print("PASS_NON_SUPERUSER_DORMANT_SERVER_CLOCK_LEDGER_PROPOSAL_APPLIED")

        constraints = owner(name, """
SELECT count(*) FROM pg_constraint c
WHERE c.conrelid='gpt02_relock_audit.reader_issuances'::regclass
 AND c.conname='reader_issuance_db_clock_ttl'
 AND c.convalidated;
""")
        if constraints.stdout.strip() != "1":
            raise AssertionError("MISSING_VALIDATED_SERVER_CLOCK_CONSTRAINT")
        unrelated = login(
            name, "unrelated_test", "fixture_unrelated_only",
            "SELECT count(*) FROM " + ISSUANCES, check=False,
        )
        if unrelated.returncode == 0:
            raise AssertionError("UNRELATED_LOGIN_READ_PRIVATE_ISSUANCE")
        print("PASS_DB_15_SECOND_CONSTRAINT_AND_NO_UNPRIVILEGED_LEDGER_READ")

        # The *new* signed packet is prepared after DB startup so its
        # short issuer lease stays fresh through the actual INSERT.
        reviewed = prepare_packet()
        params = reviewed["issuanceParameters"]
        expiry = "to_timestamp(" + str(params["expires_at_ms"]) + "/1000.0)"
        statement = insert_sql(params, expiry)

        # Explicit caller-set issued_at cannot extend the max TTL.
        forged_time = insert_sql(
            params, "clock_timestamp() + interval '60 seconds'",
            fake_issued_at="clock_timestamp() + interval '48 hours'",
        )
        failed = owner(name, forged_time, check=False)
        if (failed.returncode == 0
                or "READER_ISSUANCE_DB_CLOCK_TTL_DENIED" not in failed.stderr):
            raise AssertionError("FORGED_TIMESTAMP_OR_60S_ISSUANCE_ACCEPTED")
        for value in (
            "clock_timestamp() - interval '1 second'",
            "clock_timestamp() + interval '2 seconds'",
            "NULL",
        ):
            result = owner(name, insert_sql(params, value), check=False)
            if result.returncode == 0:
                raise AssertionError("EXPIRED_SHORT_NULL_ISSUANCE_ACCEPTED")
        if owner(name, "SELECT count(*) FROM " + ISSUANCES).stdout.strip() != "0":
            raise AssertionError("REJECTED_ISSUANCE_DURABLY_WRITTEN")
        print("PASS_DB_REJECTS_60S_FORGED_EXPIRED_SHORT_AND_NULL_ISSUANCES")

        # Attempt a genuine row INSERT followed by a simulated failure.
        # No independently committed row may remain after rollback.
        failed = owner(
            name, "BEGIN;" + statement +
            "; DO $fail$ BEGIN RAISE EXCEPTION 'CLOCK_PRECOMMIT_FAULT';"
            " END $fail$; COMMIT;", check=False,
        )
        if (failed.returncode == 0
                or "CLOCK_PRECOMMIT_FAULT" not in failed.stderr
                or owner(name, "SELECT count(*) FROM " + ISSUANCES)
                         .stdout.strip() != "0"):
            raise AssertionError("ROLLBACK_LEFT_ISSUANCE_ROW")
        print("PASS_UNCOMMITTED_SIGNED_ISSUANCE_ROLLS_BACK")

        # This is an isolated test of a PRIVILEGED owner INSERT, not an
        # operational issuance service. Database timestamp wins over input.
        owner(name, "BEGIN;" + insert_sql(
            params, expiry,
            fake_issued_at="clock_timestamp() + interval '48 hours'",
        ) + "; COMMIT;")
        metrics = owner(name, """
SELECT count(*),bool_and(
 issued_at BETWEEN clock_timestamp()-interval '5 seconds'
               AND clock_timestamp()+interval '1 second'
),bool_and(
 expires_at > issued_at + interval '3.5 seconds'
 AND expires_at <= issued_at + interval '15 seconds'
) FROM gpt02_relock_audit.reader_issuances;
""").stdout.strip()
        if metrics != "1|t|t":
            raise AssertionError("DB_ISSUANCE_CLOCK_NOT_INDEPENDENT:" + metrics)
        if owner(name, statement, check=False).returncode == 0:
            raise AssertionError("SIGNED_SCOPE_REISSUANCE_ACCEPTED")
        print("PASS_POSTGRES_GENERATED_ISSUED_AT_COMMITTED_ONCE_WITH_15S_TTL")

        # Existing dedicated consumer can claim exactly once, but cannot
        # view or write the private ledger. Audit requires committed row.
        admin(name, "ALTER ROLE " + CONSUMER +
              " LOGIN CONNECTION LIMIT 1 PASSWORD " + quote(consumer_pwd) +
              "; ALTER ROLE " + AUDITOR + " LOGIN CONNECTION LIMIT 1 PASSWORD " +
              quote(auditor_pwd) + ";")
        def rpc(fn, challenge):
            return (
                "SELECT " + fn + "(" +
                quote(params["role_name"]) + "::name," +
                quote(params["scope_sha"]) + "," +
                quote(params["packet_sha"]) + "," +
                quote(params["command_id"]) + "::uuid," +
                quote(params["attempt_id"]) + "::uuid," +
                quote(params["receipt_id"]) + "::uuid," +
                quote(params["fence_id"]) + "::uuid," +
                quote(challenge) + ")"
            )
        challenge = secrets.token_hex(32)
        claimed = login(name, CONSUMER, consumer_pwd, rpc(CONSUME_FN, challenge))
        if claimed.stdout.strip() != "t":
            raise AssertionError("COMMITTED_ONE_SHOT_CONSUMPTION_MISSING")
        result = login(name, AUDITOR, auditor_pwd, rpc(AUDIT_FN, challenge))
        if result.stdout.strip() != "t":
            raise AssertionError("AUDITOR_COULD_NOT_VERIFY_COMMITTED_CONSUMPTION")
        repeat = login(name, CONSUMER, consumer_pwd, rpc(CONSUME_FN, challenge))
        if repeat.stdout.strip() != "f":
            raise AssertionError("REPLAY_NOT_REJECTED")
        stale = login(name, AUDITOR, auditor_pwd, rpc(AUDIT_FN, secrets.token_hex(32)))
        if stale.stdout.strip() != "f":
            raise AssertionError("OLD_COMMIT_PASSED_FRESH_CHALLENGE")
        print("PASS_COMMITTED_SIGNED_ISSUANCE_TO_ONE_CONSUMPTION_AND_FRESH_AUDIT")

        admin(name, "ALTER ROLE " + AUDITOR +
              " NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL; ALTER ROLE " +
              CONSUMER + " NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL;")
        print("PASS_SYNTHETIC_AUDITOR_AND_CONSUMER_RELOCKED")
        print("NO_LIVE_APPROVAL_OR_DB_CREDENTIALS_NO_CST_DEV_OR_PROD_CHANGES")
    finally:
        run("docker", "rm", "-f", name, check=False)


if __name__ == "__main__":
    main()
