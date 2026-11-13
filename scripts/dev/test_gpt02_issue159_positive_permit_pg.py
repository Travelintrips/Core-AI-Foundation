#!/usr/bin/env python3
"""Disposable PostgreSQL-only contract. NEVER connects to a live Supabase project.

Only the PostgreSQL permit writer boundary is tested. This fixture does NOT
perform detached Ed25519 verification; that is a separate required prerequisite
before a production-style writer connection may ever be enabled on DEV.
"""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
NAME = "gpt02-positive-permit-" + uuid.uuid4().hex[:10]
MIGRATOR = "gpt02_fixture_migrator"
CMD = "10000000-0000-4000-8000-000000000001"
ATT = "20000000-0000-4000-8000-000000000002"
LINK = "30000000-0000-4000-8000-000000000003"
HUB = "40000000-0000-4000-8000-000000000004"
CORE = "50000000-0000-4000-8000-000000000005"
WORKER = "openclaw-dell-chatgpt-wake-dev"


def run(*args, required=True):
    p = subprocess.run(args, text=True, capture_output=True)
    if required and p.returncode != 0:
        raise AssertionError(f"failed {args[:4]}\n{p.stderr[-1800:]}")
    return p


def sql(text, role="postgres", required=True):
    return run("docker", "exec", NAME, "psql", "-U", role, "-d", "postgres",
               "-v", "ON_ERROR_STOP=1", "-Atqc", text, required=required)


def ensure(condition, reason):
    if not condition:
        raise AssertionError(reason)


def apply_file(path: Path, target: str, role="postgres", replace_migrator=False):
    source = path.read_text()
    # Only disposable PG fixture uses its non-superuser migrator identity.
    if replace_migrator:
        source = source.replace("postgres", MIGRATOR)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".sql") as tmp:
        tmp.write(source)
        tmp.flush()
        run("docker", "cp", tmp.name, NAME + ":" + target)
    return run("docker", "exec", NAME, "psql", "-U", role, "-d", "postgres",
               "-v", "ON_ERROR_STOP=1", "-f", target)


def main():
    run("docker", "run", "--rm", "-d", "--network", "none", "--name", NAME,
        "-e", "POSTGRES_PASSWORD=fixture-only", "postgres:16-alpine")
    try:
        for _ in range(100):
            ready = sql("SELECT 1", required=False)
            if ready.returncode == 0 and ready.stdout.strip() == "1":
                # postgres:16-alpine bootstrap can briefly accept connections
                # before terminating its temporary server and starting the
                # final one; require two stable probes before loading the seed.
                time.sleep(.45)
                stable = sql("SELECT 1", required=False)
                if stable.returncode == 0 and stable.stdout.strip() == "1":
                    break
            time.sleep(.25)
        else:
            raise AssertionError("POSTGRES_16_DISPOSABLE_NOT_READY")

        apply_file(ROOT / "scripts/dev/gpt02_issue159_issuer_delta_disposable_seed.sql",
                   "/tmp/seed.sql")
        apply_file(ROOT / "scripts/dev/gpt02_issue159_issuer_delta_DEV_ONLY.sql",
                   "/tmp/issuer.sql", MIGRATOR, replace_migrator=True)
        candidate = ROOT / "docs/dev/gpt02-issue159-positive-dispatch-permit.PROPOSED.sql"
        apply_file(candidate, "/tmp/positive.sql", MIGRATOR, replace_migrator=True)

        roles = sql("""SELECT string_agg(rolname||':'||rolcanlogin::text,',' ORDER BY rolname)
            FROM pg_roles WHERE rolname IN
            ('dev_gpt02_release_writer','dev_gpt02_release_reader')""").stdout.strip()
        ensure(roles == "dev_gpt02_release_reader:false,dev_gpt02_release_writer:false",
               "RELEASE_ROLES_MUST_BE_NOLOGIN")
        for role in ("dev_gpt02_release_writer", "dev_gpt02_release_reader"):
            actual = sql("SELECT has_schema_privilege('" + role +
                         "','gpt02_private','USAGE')").stdout.strip()
            ensure(actual == "t", "RELEASE_PRIVATE_SCHEMA_USAGE_MISSING_" + role)
            conn_limit = sql("SELECT rolconnlimit FROM pg_roles WHERE rolname='" +
                             role + "'").stdout.strip()
            ensure(conn_limit == "0", "DORMANT_RELEASE_CONNECTION_LIMIT_MUST_BE_ZERO")
        n = sql("""SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='gpt02_private' AND c.relname IN
             ('positive_dispatch_permits','positive_dispatch_consumptions')
             AND c.relrowsecurity AND c.relforcerowsecurity""").stdout.strip()
        ensure(n == "2", "POSITIVE_LEDGER_MUST_FORCE_RLS")
        for fn in ("reserve_positive_dispatch_permit(uuid,uuid,text)",
                   "consume_positive_dispatch_permit(uuid,uuid,text)"):
            signature = "gpt02_private." + fn
            for role in ("anon", "authenticated", "service_role", "dev_gpt02_issuer_evidence"):
                allowed = sql("SELECT has_function_privilege('" + role + "','" +
                              signature + "','EXECUTE')").stdout.strip()
                ensure(allowed == "f", "RELEASE_EXECUTE_LEAK_" + role)
            allowed = sql("SELECT has_function_privilege('dev_gpt02_release_writer','" +
                          signature + "','EXECUTE')").stdout.strip()
            ensure(allowed == "t", "RELEASE_RPC_NOT_SCOPED_TO_WRITER")
        for table in ("positive_dispatch_permits", "positive_dispatch_consumptions"):
            for role in ("anon", "authenticated", "service_role", "dev_gpt02_release_writer"):
                allowed = sql("SELECT has_table_privilege('" + role + "','gpt02_private." +
                              table + "','INSERT,UPDATE,DELETE')").stdout.strip()
                ensure(allowed == "f", "DIRECT_RELEASE_DML_LEAK")
        legacy = sql("""SELECT count(*) FROM pg_constraint con
             JOIN pg_class c ON c.oid=con.conrelid
             JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='gpt02_private' AND
             ((c.relname='issuer_evidences' AND con.conname IN
                ('issuer_evidences_signing_grant_check','issuer_evidences_dispatch_allowed_check'))
             OR (c.relname='issuer_lease_consumptions' AND
                con.conname='issuer_lease_consumptions_dispatch_allowed_check')
             OR (c.relname='post_consumption_fences' AND
                con.conname='post_consumption_fences_dispatch_allowed_check'))
             AND pg_get_constraintdef(con.oid) LIKE '%false%'""").stdout.strip()
        ensure(legacy == "4", "HISTORIC_NO_DISPATCH_CONSTRAINTS_CHANGED")
        restored = sql("SELECT pg_has_role('" + MIGRATOR +
                       "','gpt02_store_owner','SET')").stdout.strip()
        ensure(restored == "f", "MIGRATOR_OWNER_PRIVILEGE_NOT_RESTORED")

        # Only on this disposable fixture, make writer eligible to exercise RPCs.
        sql("ALTER ROLE dev_gpt02_release_writer LOGIN CONNECTION LIMIT 3")
        bad = sql("SELECT gpt02_private.reserve_positive_dispatch_permit('" +
                  CMD + "',gen_random_uuid(),'0')", "dev_gpt02_release_writer",
                  required=False)
        ensure(bad.returncode != 0 and "TRUSTED_RELEASE_WRITER_AND_PACKET_REQUIRED"
               in bad.stderr, f"BAD_PACKET_HASH_ACCEPTED status={bad.returncode} stderr={bad.stderr[-1400:]} stdout={bad.stdout[-500:]}")
        missing = sql("SELECT gpt02_private.reserve_positive_dispatch_permit('" +
                      CMD + "',gen_random_uuid(),repeat('a',64))",
                      "dev_gpt02_release_writer", required=False)
        ensure(missing.returncode != 0 and "PERSISTED_LINKED_ISSUER_PROOF_REQUIRED"
               in missing.stderr, f"MISSING_LINKED_LINEAGE_ACCEPTED status={missing.returncode} stderr={missing.stderr[-1400:]} stdout={missing.stdout[-500:]}")

        # Synthetic parent evidence is inserted by disposable fixture superuser.
        # This does not count as a real four-signer packet or live DEV approval.
        setup = f"""
        INSERT INTO gpt02_stage.core_preparations
          (company_id,hub_task_id,member_id,member_audit_id,operator_subject,
           core_task_id,hub_execution_id,command_candidate_id,attempt_id,config_sha256,expires_at)
        VALUES ('default',140,5,10,'fixture-super-admin','{CORE}','{HUB}','{CMD}',
          '{ATT}',repeat('c',64),clock_timestamp()+interval '5 minutes');
        INSERT INTO gpt02_private.approvals
          (command_id,attempt_id,nonce,task_id,company_id,approver_id,claims,
           signature,digest,expires_at,operator_namespace)
        VALUES ('{CMD}','{ATT}',repeat('N',40),140,'default','fixture-super-admin',
           '{{"environment":"DEV"}}',repeat('A',86),repeat('a',64),
           clock_timestamp()+interval '5 minutes','ai-task-hub.public.users');
        INSERT INTO gpt02_private.operator_links
          (link_id,command_id,hub_execution_id,core_task_id,hub_task_id,attempt_id,
           attempt_number,company_id,assignee_id,accountable_owner_id,hub_operator_id,
           core_operator_user_id,approval_digest,link_digest,hub_signature,
           core_signature,claims,expires_at)
        VALUES ('{LINK}','{CMD}','{HUB}','{CORE}',140,'{ATT}',1,'default',5,
           'fixture-super-admin','fixture-super-admin',7,repeat('a',64),repeat('b',64),
           repeat('B',86),repeat('C',86),'{{"environment":"DEV"}}',
           clock_timestamp()+interval '5 minutes');
        INSERT INTO gpt02_private.receipts(command_id,nonce,digest)
        VALUES ('{CMD}',repeat('N',40),repeat('a',64));
        INSERT INTO gpt02_private.core_identity_receipts
          (receipt_id,command_id,link_id,operator_user_id,recorded_by,
           hub_operator_id,link_digest,binding_verified,may_dispatch_worker,
           may_issue_grant,may_close_job,core_ledger_written)
        SELECT id,command_id,'{LINK}',7,'internal:7','fixture-super-admin',
           repeat('b',64),false,false,false,false,false
        FROM gpt02_private.receipts;
        INSERT INTO gpt02_private.post_consumption_fences
          (receipt_id,command_id,link_id,hub_execution_id,core_task_id,attempt_id,
           worker_id,lease_epoch,lease_started_at,lease_expires_at,
           dispatch_allowed,core_ledger_written)
        SELECT id,command_id,'{LINK}','{HUB}','{CORE}','{ATT}',
           '{WORKER}',1,clock_timestamp(),clock_timestamp()+interval '14 seconds',
           false,false FROM gpt02_private.receipts;
        INSERT INTO gpt02_private.issuer_evidences
          (company_id,hub_task_id,command_id,fence_id,link_id,receipt_id,attempt_id,
           claims,signature,digest,expires_at,signing_grant,dispatch_allowed)
        SELECT 'default',140,'{CMD}',f.fence_id,'{LINK}',f.receipt_id,'{ATT}',
           jsonb_build_object('environment','DEV',
             'audience','GPT02_ISSUER_LEASE_EVIDENCE_V1',
             'commandId','{CMD}','attemptId','{ATT}'),
           repeat('D',86),repeat('e',64),f.lease_expires_at,false,false
        FROM gpt02_private.post_consumption_fences f;
        INSERT INTO gpt02_private.issuer_lease_consumptions
          (evidence_id,company_id,hub_task_id,command_id,fence_id,lease_epoch,
           dispatch_allowed)
        SELECT evidence_id,'default',140,'{CMD}',fence_id,1,false
        FROM gpt02_private.issuer_evidences;
        """
        sql(setup)
        evidence = sql("SELECT evidence_id FROM gpt02_private.issuer_evidences").stdout.strip()
        permit = sql("SELECT gpt02_private.reserve_positive_dispatch_permit('" +
                     CMD + "','" + evidence + "',repeat('a',64))",
                     "dev_gpt02_release_writer").stdout.strip()
        ensure(re.fullmatch(r"[0-9a-f-]{36}", permit) is not None,
               "POSITIVE_PERMIT_UUID_MISSING")
        again = sql("SELECT gpt02_private.reserve_positive_dispatch_permit('" +
                    CMD + "','" + evidence + "',repeat('a',64))",
                    "dev_gpt02_release_writer", required=False)
        ensure(again.returncode != 0 and "duplicate key" in again.stderr,
               "DUPLICATE_PERMIT_RESERVATION_ACCEPTED")
        consume = ("SELECT gpt02_private.consume_positive_dispatch_permit('" +
                   permit + "','" + CMD + "',repeat('a',64))")
        with ThreadPoolExecutor(max_workers=2) as pool:
            attempts = list(pool.map(lambda _: sql(
                consume, "dev_gpt02_release_writer", required=False), range(2)))
        ensure(sum(x.returncode == 0 for x in attempts) == 1,
               "CONCURRENT_CONSUMPTIONS_NOT_EXACTLY_ONCE")
        ensure(sum(x.returncode != 0 for x in attempts) == 1,
               "CONCURRENT_CONSUMPTION_REPLAY_NOT_BLOCKED")
        check_count = sql("SELECT count(*) FROM gpt02_private.positive_dispatch_consumptions"
                          ).stdout.strip()
        ensure(check_count == "1", "CONSUMPTION_LEDGER_WRONG_COUNT")
        check_legacy = sql("SELECT signing_grant::text||':'||dispatch_allowed::text "
                           "FROM gpt02_private.issuer_evidences").stdout.strip()
        ensure(check_legacy == "false:false", "HISTORIC_NO_DISPATCH_PROOF_MUTATED")
        print("PASS: disposable PG16 positive-permit migration; dormant roles, "
              "forced RLS, legacy NO_DISPATCH retained, exact lineage, "
              "one-use concurrency and replay denied; NOT live E2E")
    finally:
        run("docker", "rm", "-f", NAME, required=False)


if __name__ == "__main__":
    main()
