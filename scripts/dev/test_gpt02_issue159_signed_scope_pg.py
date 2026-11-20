#!/usr/bin/env python3
"""DEV Issue159 integrated *synthetic* four-signer proof -> exact RLS -> query.

Reuses the original signed-packet fixture, exact five-table RLS fixture, and
original canonical lineage SQL. Re-signs a synthetic Task 170 with ephemeral
fixture private keys, derives the inert role scope through existing handoff,
then proves one-task SELECT and wrong-task/digest denial on networkless PG16.

NO live Supabase, no real credentials, no role issuer, no service or dispatch.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
import subprocess
import time
import uuid
from unittest.mock import patch

import gpt02_issue159_positive_permit_handoff as handoff
from gpt02_issue159_lineage_readback_contract import TRUSTED_LINEAGE_SQL
from gpt02_issue159_writer_broker_contract import verify_lifecycle_evidence_packet
from test_gpt02_issue159_writer_broker_contract import WriterBrokerContractTest
from test_gpt02_issue159_five_table_task_scope_pg import SQL as FIVE_TABLE_FIXTURE


CMD = "00000000-0000-0000-0000-000000000170"
ATT = "00000000-0000-0000-0000-000000000270"
LINK = "00000000-0000-0000-0000-000000000370"
EXECUTION = "00000000-0000-0000-0000-000000000470"
CORE = "00000000-0000-0000-0000-000000000570"
RECEIPT = "00000000-0000-0000-0000-000000000670"
FENCE = "00000000-0000-0000-0000-000000000770"


def make_candidate():
    f = WriterBrokerContractTest(
        methodName="test_four_domain_signatures_verify_but_no_authority"
    )
    f.setUp()
    p = copy.deepcopy(f.packet)
    a = p["approval"]["claims"]
    a["taskId"] = 170
    a["commandId"] = CMD
    a["attemptId"] = ATT
    for name in ("hubLink", "coreLink"):
        l = p[name]["claims"]
        l["hubTaskId"] = 170
        l["coreCommandId"] = CMD
        l["attemptId"] = ATT
        l["linkId"] = LINK
        l["hubExecutionId"] = EXECUTION
        l["coreTaskId"] = CORE
    i = p["issuerEvidence"]["claims"]
    i.update({
        "hubTaskId": 170, "commandId": CMD, "attemptId": ATT,
        "linkId": LINK, "hubExecutionId": EXECUTION, "coreTaskId": CORE,
        "receiptId": RECEIPT, "fenceId": FENCE,
        "nonceDigest": hashlib.sha256(a["nonce"].encode()).hexdigest(),
    })
    f._resign_valid_packet(p)
    verified = verify_lifecycle_evidence_packet(p, f.roots, f.now)
    payload = json.dumps(
        p, sort_keys=True, separators=(",", ":"),
        ensure_ascii=False, allow_nan=False,
    ).encode()
    envelope = {
        "stage": "FOUR_SIGNATURE_PERSISTED_LINEAGE_REVIEWED",
        "hubTaskId": 170, "commandId": CMD, "attemptId": ATT,
        "fenceId": FENCE, "verifiedPacketSha256": hashlib.sha256(payload).hexdigest(),
        "approvalDigest": verified["approvalDigest"],
        "hubLinkDigest": verified["hubLinkDigest"],
        "coreLinkDigest": verified["coreLinkDigest"],
        "verifiedByExistingReader": True,
        "positivePermitCreated": False, "databaseWritePerformed": False,
        "signingPermitted": False, "authorizationGranted": False,
        "dispatchPermitted": False, "releaseDecision": "NO_GO",
    }
    with patch.object(handoff, "inspect_proposed_permit_candidate",
                      return_value=envelope):
        with patch.object(handoff.time, "time", return_value=f.now / 1000):
            candidate = handoff.inspect_postlineage_scoped_reader_candidate(
                p, f.roots
            )
    assert candidate["persistedLineageMatched"] is True
    assert candidate["credentialIssuancePermitted"] is False
    assert candidate["databaseRoleProvisioned"] is False
    return candidate


def quote(value: str) -> str:
    # In this disposable test all values come from the independently
    # signature-verified candidate. Escape nonetheless; never interpolate
    # arbitrary user-supplied SQL into an operational database.
    return "'" + value.replace("'", "''") + "'"


def run(*args, stdin=None, check=True):
    p = subprocess.run(args, input=stdin, text=True,
                       capture_output=True, timeout=60)
    if check and p.returncode:
        raise RuntimeError(p.stderr[-1800:])
    return p


def pg(name, sql):
    return run("docker", "exec", "-i", name, "psql", "-X",
               "-v", "ON_ERROR_STOP=1", "-U", "postgres",
               "-d", "postgres", "-At", stdin=sql)


def bound_query(scope):
    params = {
        "company_id": scope["company_id"],
        "task_id": str(scope["task_id"]),
        "command_id": scope["command_id"],
        "attempt_id": scope["attempt_id"],
        "approval_digest": scope["approval_digest"],
    }
    statement = TRUSTED_LINEAGE_SQL
    for key, value in params.items():
        statement = statement.replace(
            "%(" + key + ")s",
            value if key == "task_id" else quote(value)
        )
    if "%(" in statement:
        raise AssertionError("UNBOUND_QUERY_PARAMETER")
    return statement.strip().rstrip(";")


def main():
    candidate = make_candidate()
    scope = candidate["scope"]
    if (
        scope["task_id"] != 170
        or scope["command_id"] != CMD or scope["attempt_id"] != ATT
        or scope["link_id"] != LINK or scope["receipt_id"] != RECEIPT
        or scope["fence_id"] != FENCE
        or not re.fullmatch(r"dev_gpt02_task_170_[0-9a-f]{12}",
                            candidate["candidateRole"])
    ):
        raise AssertionError("SIGNED_FIXTURE_SCOPE_CHANGED")
    print("PASS_FOUR_SIGNATURE_PACKET_TO_INERT_ONE_TASK_ROLE_SCOPE")

    # Reuse prior exact five-table fixture and its independently tested
    # RLS policy, substituting ONLY signed synthetic identities and digests.
    sql = FIVE_TABLE_FIXTURE
    sql = sql.replace("task170_reader", candidate["candidateRole"])
    for original, signed in (
        ("'n170'", quote(scope["approval_nonce"])),
        ("'d170'", quote(scope["approval_digest"])),
        ("'link170'", quote(scope["link_digest"])),
    ):
        if original not in sql:
            raise AssertionError("FIXTURE_SLOT_MISSING_" + original)
        sql = sql.replace(original, signed)

    name = "issue159-signed-scope-" + uuid.uuid4().hex[:10]
    try:
        run("docker", "run", "-d", "--rm", "--network", "none",
            "--name", name, "-e", "POSTGRES_PASSWORD=fixture_only",
            "postgres:16-alpine")
        for _ in range(120):
            ready = run(
                "docker", "exec", "-e", "PGPASSWORD=fixture_only", name,
                "psql", "-X", "-w", "-h", "127.0.0.1",
                "-U", "postgres", "-d", "postgres", "-Atc", "SELECT 1",
                check=False,
            )
            if ready.returncode == 0:
                break
            time.sleep(.25)
        else:
            raise RuntimeError("FINAL_PG_NOT_READY")

        created = pg(name, sql)
        for marker in (
            "PASS_FIVE_TABLE_DIRECT_ENUMERATION_SCOPED",
            "PASS_EXACT_FIVE_TABLE_JOIN",
            "PASS_SAME_COMPANY_OTHER_TASK_DENIED",
            "PASS_NO_MEMBERSHIP_WRITES_OR_PRIVILEGED_ROUTINE",
        ):
            if marker not in created.stderr:
                raise AssertionError("MISSING_SCOPE_MARKER:" + marker)
        print("PASS_FIVE_TABLE_RLS_FROM_SIGNED_PACKET_IDENTITIES")

        query = bound_query(scope)
        role = candidate["candidateRole"]
        for requested_task, digest, expected in (
            (170, scope["approval_digest"], "1"),
            (172, scope["approval_digest"], "0"),
            (170, "f" * 64, "0"),
        ):
            altered = query.replace("a.task_id = 170",
                                    "a.task_id = " + str(requested_task))
            altered = altered.replace(quote(scope["approval_digest"]),
                                      quote(digest))
            result = pg(name, "SET ROLE " + role +
                        "; SELECT count(*) FROM (" + altered +
                        ") AS verified_lineage; RESET ROLE;")
            counts = [v.strip() for v in result.stdout.splitlines()
                      if v.strip() in ("0", "1")]
            if counts != [expected]:
                raise AssertionError(
                    "SIGNED_LINEAGE_QUERY_WRONG_CARDINALITY:"
                    + str((requested_task, digest, counts))
                )
        print("PASS_SIGNED_SCOPE_CANONICAL_SQL_VALID_OTHER_TASK_WRONG_DIGEST")
        print("SYNTHETIC_ONLY_NO_CREDENTIAL_ISSUANCE_NO_LIVE_PERMISSION")
    finally:
        run("docker", "rm", "-f", name, check=False)


if __name__ == "__main__":
    main()
