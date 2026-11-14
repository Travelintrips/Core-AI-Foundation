#!/usr/bin/env python3
"""Disposable PostgreSQL-only contract. NEVER connects to a live Supabase project.

Only the PostgreSQL permit writer boundary is tested. This fixture does NOT
perform detached Ed25519 verification; that is a separate required prerequisite
before a production-style writer connection may ever be enabled on DEV.
"""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
import hashlib
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
        # The disposable source runner substitutes its restricted migrator
        # identity for "postgres". Mirror the LIVE pgcrypto schema owner
        # relationship: the fixture migrator, not fixture postgres, must own
        # the extensions schema before granting narrow SHA-256 USAGE.
        sql("ALTER SCHEMA extensions OWNER TO " + MIGRATOR)
        apply_file(ROOT / "scripts/dev/gpt02_issue159_issuer_delta_DEV_ONLY.sql",
                   "/tmp/issuer.sql", MIGRATOR, replace_migrator=True)
        candidate = ROOT / "docs/dev/gpt02-issue159-positive-dispatch-permit.PROPOSED.sql"
        apply_file(candidate, "/tmp/positive.sql", MIGRATOR, replace_migrator=True)
        # Exact shape of the existing AI Core bridge / Core Task columns needed
        # for a disposable-only HELD command insert. No external database.
        sql("""
          CREATE SCHEMA ai_platform;
          CREATE TABLE ai_platform.ai_settings (
            key text PRIMARY KEY,
            value text NOT NULL,
            category text NOT NULL,
            is_secret boolean NOT NULL DEFAULT false
          );
          INSERT INTO ai_platform.ai_settings (key,value,category,is_secret)
          VALUES
            ('dev.chatgpt_wake.enabled','true','guardrail',false),
            ('dev.chatgpt_wake.account_bindings',
             jsonb_build_object('version',1,'bindings',
               jsonb_build_array(
                jsonb_build_object('accountAlias','GPT02',
                  'ownerChannel','ai-engine-oauth:'||repeat('c',64),
                  'targetConversationId','6adc4295-e2ac-83ec-a1e1-2aea7d0c1326',
                  'workerId','openclaw-dell-chatgpt-wake-dev',
                  'browserProfile','gpt02-dell','enabled',true),
                jsonb_build_object('accountAlias','GPT02',
                  'ownerChannel','ai-engine-oauth:'||repeat('c',64),
                  'targetConversationId','88888888-8888-4888-8888-888888888888',
                  'workerId','openclaw-pchp-dev',
                  'browserProfile','gpt02-pchp','enabled',true)
               ))::text,'guardrail',false);
          CREATE TABLE ai_platform.ai_coding_tasks (
            id uuid PRIMARY KEY,
            task_number text NOT NULL,
            project_name text NOT NULL, repository text NOT NULL,
            branch text NOT NULL, instruction text NOT NULL,
            status text NOT NULL
          );
          CREATE TABLE ai_platform.ai_coding_bridge_commands (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id uuid REFERENCES ai_platform.ai_coding_tasks(id),
            external_command_id text NOT NULL,
            source text NOT NULL,
            command_type text NOT NULL,
            instruction text NOT NULL,
            authority_json jsonb NOT NULL DEFAULT '{}'::jsonb,
            metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
            status text NOT NULL DEFAULT 'RECEIVED'
              CHECK (status IN ('RECEIVED','PROCESSING','COMPLETED','FAILED','CANCELLED')),
            UNIQUE(source,external_command_id)
          );
          ALTER SCHEMA ai_platform OWNER TO gpt02_fixture_migrator;
          ALTER TABLE ai_platform.ai_settings OWNER TO gpt02_fixture_migrator;
          ALTER TABLE ai_platform.ai_settings ENABLE ROW LEVEL SECURITY;
          ALTER TABLE ai_platform.ai_coding_tasks OWNER TO gpt02_fixture_migrator;
          ALTER TABLE ai_platform.ai_coding_bridge_commands OWNER TO gpt02_fixture_migrator;
          ALTER TABLE ai_platform.ai_coding_tasks ENABLE ROW LEVEL SECURITY;
          ALTER TABLE ai_platform.ai_coding_bridge_commands ENABLE ROW LEVEL SECURITY;
        """)
        apply_file(ROOT /
          "docs/dev/gpt02-issue159-exact-bridge-stage-role.PROPOSED.sql",
          "/tmp/stage-role.sql", MIGRATOR, replace_migrator=True)
        apply_file(ROOT /
          "docs/dev/gpt02-issue159-release-claim-fence.PROPOSED.sql",
          "/tmp/claim-fence.sql", MIGRATOR, replace_migrator=True)
        apply_file(ROOT /
          "docs/dev/gpt02-issue159-held-claim-readback.PROPOSED.sql",
          "/tmp/held-readback.sql", MIGRATOR, replace_migrator=True)
        ensure(sql("""SELECT has_function_privilege('dev_gpt02_claim_gate_login',
          'gpt02_private.read_issue159_held_for_claim(uuid,uuid,text)',
          'EXECUTE')""").stdout.strip()=="t",
          "HELD_READBACK_CLAIM_ROLE_MISSING")
        for restricted_role in ("anon","authenticated","service_role",
                                "dev_gpt02_release_writer"):
            ensure(sql("SELECT has_function_privilege('"+restricted_role+
                "','gpt02_private.read_issue159_held_for_claim(uuid,uuid,text)',"+
                "'EXECUTE')").stdout.strip()=="f",
                "HELD_READBACK_FUNCTION_PRIVILEGE_LEAK_"+restricted_role)
        claim_role_state = sql("""SELECT rolcanlogin::text||':'||rolconnlimit::text
             FROM pg_roles WHERE rolname='dev_gpt02_claim_gate_login'""").stdout.strip()
        ensure(claim_role_state == "false:0", "CLAIM_ROLE_NOT_DORMANT")
        for table in ("issue159_release_claim_intents",):
            for privilege in ("SELECT","INSERT","UPDATE","DELETE"):
                allowed = sql("SELECT has_table_privilege('dev_gpt02_claim_gate_login',"
                    "'gpt02_private."+table+"','"+privilege+"')").stdout.strip()
                ensure(allowed=="f","CLAIM_ROLE_DIRECT_DML_LEAK_"+privilege)
        allowed = sql("""SELECT has_function_privilege('dev_gpt02_claim_gate_login',
          'gpt02_private.reserve_issue159_release_claim(uuid,uuid,text,text,text,text,text,uuid,text,text,bigint,bigint)',
          'EXECUTE')""").stdout.strip()
        ensure(allowed=="t", "CLAIM_GATE_RPC_NOT_SCOPED")
        role_state = sql("""SELECT rolcanlogin::text||':'||rolconnlimit::text
                 FROM pg_roles WHERE rolname='dev_gpt02_bridge_stage_login'""").stdout.strip()
        ensure(role_state=="false:0", "STAGE_ROLE_NOT_DORMANT")
        ensure(sql("""SELECT has_table_privilege('dev_gpt02_bridge_stage_login',
                  'ai_platform.ai_coding_bridge_commands','UPDATE')""").stdout.strip()=="f",
               "STAGE_ROLE_BROAD_WRITE_GRANT")
        ensure(sql("""SELECT has_table_privilege('dev_gpt02_bridge_stage_login',
                  'ai_platform.ai_coding_bridge_commands','INSERT')""").stdout.strip()=="f",
               "STAGE_ROLE_DIRECT_INSERT_MUST_BE_DENIED")
        ensure(sql("""SELECT has_function_privilege('dev_gpt02_bridge_stage_login',
                  'gpt02_private.stage_issue159_held_bridge_command(uuid,text)',
                  'EXECUTE')""").stdout.strip()=="t",
               "STAGE_ROLE_PRIVATE_RPC_GRANT_MISSING")

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
             ('positive_dispatch_permits','positive_dispatch_consumptions','positive_dispatch_outbox')
             AND c.relrowsecurity AND c.relforcerowsecurity""").stdout.strip()
        ensure(n == "3", "ALL_POSITIVE_LEDGERS_MUST_FORCE_RLS")
        for fn in ("reserve_positive_dispatch_permit(uuid,text,text,text)",
                   "consume_positive_dispatch_permit(uuid,uuid,text)"):
            signature = "gpt02_private." + fn
            for role in ("anon", "authenticated", "service_role", "dev_gpt02_issuer_evidence"):
                allowed = sql("SELECT has_function_privilege('" + role + "','" +
                              signature + "','EXECUTE')").stdout.strip()
                ensure(allowed == "f", "RELEASE_EXECUTE_LEAK_" + role)
            allowed = sql("SELECT has_function_privilege('dev_gpt02_release_writer','" +
                          signature + "','EXECUTE')").stdout.strip()
            ensure(allowed == "t", "RELEASE_RPC_NOT_SCOPED_TO_WRITER")
        for table in ("positive_dispatch_permits", "positive_dispatch_consumptions", "positive_dispatch_outbox"):
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
                  CMD + "','0',repeat('e',64),repeat('D',86))", "dev_gpt02_release_writer",
                  required=False)
        ensure(bad.returncode != 0 and "TRUSTED_RELEASE_WRITER_AND_PACKET_REQUIRED"
               in bad.stderr, f"BAD_PACKET_HASH_ACCEPTED status={bad.returncode} stderr={bad.stderr[-1400:]} stdout={bad.stdout[-500:]}")
        missing = sql("SELECT gpt02_private.reserve_positive_dispatch_permit('" +
                      CMD + "',repeat('a',64),repeat('e',64),repeat('D',86))",
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
        INSERT INTO ai_platform.ai_coding_tasks
          (id,task_number,project_name,repository,branch,instruction,status)
        VALUES ('{CORE}','GPT02DEV-140-'||repeat('c',14),
          'GPT02 DEV coding lifecycle','Travelintrips/Core-AI-Foundation',
          'develop','Synthetic DEV owner-approved task fixture','PENDING');
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
             'commandId','{CMD}','attemptId','{ATT}',
             'hubTaskId',140,'hubExecutionId','{HUB}','coreTaskId','{CORE}',
             'linkId','{LINK}','fenceId',f.fence_id::text,
             'receiptId',f.receipt_id::text,'approvalDigest',repeat('a',64)),
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
        bad_issuer_digest = sql(
            "SELECT gpt02_private.reserve_positive_dispatch_permit('" + CMD +
            "',repeat('a',64),repeat('0',64),repeat('D',86))",
            "dev_gpt02_release_writer", required=False)
        ensure(bad_issuer_digest.returncode != 0 and
               "PERSISTED_LINKED_ISSUER_PROOF_REQUIRED" in bad_issuer_digest.stderr,
               "ISSUER_DIGEST_SUBSTITUTION_ALLOWED")
        bad_issuer_sig = sql(
            "SELECT gpt02_private.reserve_positive_dispatch_permit('" + CMD +
            "',repeat('a',64),repeat('e',64),repeat('E',86))",
            "dev_gpt02_release_writer", required=False)
        ensure(bad_issuer_sig.returncode != 0 and
               "PERSISTED_LINKED_ISSUER_PROOF_REQUIRED" in bad_issuer_sig.stderr,
               "ISSUER_SIGNATURE_SUBSTITUTION_ALLOWED")
        permit = sql("SELECT gpt02_private.reserve_positive_dispatch_permit('" +
                     CMD + "',repeat('a',64),repeat('e',64),repeat('D',86))",
                     "dev_gpt02_release_writer").stdout.strip()
        ensure(re.fullmatch(r"[0-9a-f-]{36}", permit) is not None,
               "POSITIVE_PERMIT_UUID_MISSING")
        again = sql("SELECT gpt02_private.reserve_positive_dispatch_permit('" +
                    CMD + "',repeat('a',64),repeat('e',64),repeat('D',86))",
                    "dev_gpt02_release_writer", required=False)
        ensure(again.returncode != 0 and "duplicate key" in again.stderr,
               "DUPLICATE_PERMIT_RESERVATION_ACCEPTED")
        consume = ("SELECT gpt02_private.consume_positive_dispatch_permit('" +
                   permit + "','" + CMD + "',repeat('a',64))")
        # Inject a disposable failure AFTER the consumption insert, at the
        # outbox insert. The whole RPC must roll back; no orphan consumed permit.
        sql("""CREATE FUNCTION public.reject_outbox_fixture()
               RETURNS trigger LANGUAGE plpgsql AS $$
               BEGIN RAISE EXCEPTION 'OUTBOX_SYNTHETIC_FAILURE'; END $$;
               CREATE TRIGGER reject_outbox_fixture
               BEFORE INSERT ON gpt02_private.positive_dispatch_outbox
               FOR EACH ROW EXECUTE FUNCTION public.reject_outbox_fixture();""")
        rejected = sql(consume, "dev_gpt02_release_writer", required=False)
        ensure(rejected.returncode != 0 and "OUTBOX_SYNTHETIC_FAILURE" in rejected.stderr,
               "INJECTED_OUTBOX_FAILURE_NOT_OBSERVED")
        rollback_counts = sql("""SELECT
          (SELECT count(*) FROM gpt02_private.positive_dispatch_consumptions)::text
          ||':'||
          (SELECT count(*) FROM gpt02_private.positive_dispatch_outbox)::text""").stdout.strip()
        ensure(rollback_counts == "0:0", "CONSUMPTION_NOT_ROLLED_BACK_WITH_OUTBOX")
        sql("""DROP TRIGGER reject_outbox_fixture
               ON gpt02_private.positive_dispatch_outbox;
               DROP FUNCTION public.reject_outbox_fixture();""")
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
        outbox = sql("""SELECT command_id::text||':'||attempt_id::text||':'||
             hub_task_id::text||':'||core_task_id::text||':'||
             delivery_state||':'||packet_sha256
             FROM gpt02_private.positive_dispatch_outbox""").stdout.strip()
        ensure(outbox == (CMD+":"+ATT+":140:"+CORE+":HELD_NO_DISPATCH:"+("a"*64)),
               "EXACT_COMMAND_OUTBOX_NOT_DURABLY_LINKED")
        # Only in disposable fixture enable role LOGIN; live DEV unchanged.
        sql("ALTER ROLE dev_gpt02_bridge_stage_login LOGIN CONNECTION LIMIT 3")
        direct = sql("""INSERT INTO ai_platform.ai_coding_bridge_commands
          (id,task_id,external_command_id,source,command_type,instruction)
          VALUES(gen_random_uuid(),'50000000-0000-4000-8000-000000000005'::uuid,
           'unauthorized-direct:1','ai-core','ISSUE159_HELD','bad')""",
           "dev_gpt02_bridge_stage_login",required=False)
        ensure(direct.returncode!=0 and
               "permission denied" in direct.stderr.lower(),
               "DIRECT_BRIDGE_INSERT_BYPASSED_PRIVATE_OWNER_RPC")
        def stage_sql(command=CMD,packet_sha="a"*64):
            return ("SELECT * FROM gpt02_private.stage_issue159_held_bridge_command('"+
                    command+"','" + packet_sha + "')")
        wrong_hash = sql(stage_sql(packet_sha="f"*64), "dev_gpt02_bridge_stage_login")
        ensure(wrong_hash.stdout.strip()=="",
               "UNVERIFIED_PACKET_HASH_COULD_STAGE_COMMAND")
        wrong_id = sql(stage_sql(command="ffffffff-ffff-4fff-8fff-ffffffffffff"), "dev_gpt02_bridge_stage_login")
        ensure(wrong_id.stdout.strip()=="","UNRELATED_ISSUER_UUID_STAGED")
        staged = sql(stage_sql(), "dev_gpt02_bridge_stage_login")
        ensure(staged.stdout.strip().startswith(
            CMD+"|"+CORE+"|ai-core|gpt02-issue159:"+CMD+"|ISSUE159_HELD|RECEIVED|"),
            "EXACT_HELD_BRIDGE_INSERT_MISSING_OR_ID_CHANGED: "+
            staged.stdout[-180:])
        # An exact-ID, SHORT-LIVED claim intent can be reserved only by its
        # dedicated role. It still cannot claim the generic worker/send.
        sql("ALTER ROLE dev_gpt02_claim_gate_login LOGIN CONNECTION LIMIT 3")
        held_read=("SELECT gpt02_private.read_issue159_held_for_claim('"+
                   CMD+"','"+permit+"',repeat('a',64))::text")
        held_output=sql(held_read,"dev_gpt02_claim_gate_login").stdout.strip()
        held=json.loads(held_output)
        ensure(held["id"]==CMD and held["taskId"]==CORE and
               held["source"]=="ai-core" and
               held["commandType"]=="ISSUE159_HELD" and
               held["status"]=="RECEIVED" and
               held["instruction"]=="Synthetic DEV owner-approved task fixture" and
               held["metadata"].get("assignedClientId") is None and
               held["metadata"]["gpt02Issue159PositivePermit"]["commandId"]==CMD,
               "AUTHENTICATED_HELD_READBACK_NOT_BOUND_TO_CORE_TASK")
        wrong_held=sql("SELECT gpt02_private.read_issue159_held_for_claim('"+
           CMD+"','"+permit+"',repeat('f',64))",
           "dev_gpt02_claim_gate_login",required=False)
        ensure(wrong_held.returncode!=0 and
               "PERSISTED_HELD_CLAIM_READBACK_UNAVAILABLE" in wrong_held.stderr,
               "FORGED_HELD_PACKET_SHA_ACCEPTED")
        invalid_held_role=sql(held_read,"dev_gpt02_release_writer",
                              required=False)
        ensure(invalid_held_role.returncode!=0,
               "HELD_READBACK_SHARED_ROLE_BYPASS")
        target = "6adc4295-e2ac-83ec-a1e1-2aea7d0c1326"
        event = hashlib.sha256(("gpt02-issue159-event/v1"+chr(10)+CMD+chr(10)+
                                ATT+chr(10)+permit).encode()).hexdigest()
        challenge = hashlib.sha256(("gpt02-issue159-challenge/v1"+chr(10)+
                                    CMD+chr(10)+("a"*64)+chr(10)+target).encode()).hexdigest()
        owner = "ai-engine-oauth:"+("c"*64)
        instruction_sha = hashlib.sha256(
            b"Synthetic DEV owner-approved task fixture").hexdigest()
        permit_expiry_ms = int(sql("""SELECT floor(extract(epoch from expires_at)*1000)
          FROM gpt02_private.positive_dispatch_permits
          WHERE command_id='"""+CMD+"'").stdout.strip())
        now_ms=int(time.time()*1000)
        issued_ms=now_ms-500
        expires_ms=min(now_ms+3000,permit_expiry_ms-150)
        ensure(expires_ms>now_ms+1200,
               "DISPOSABLE_CLAIM_FIXTURE_EXPIRED_BEFORE_RESERVATION")
        def claim_sql(event_id=event,challenge_id=challenge,
                      command=CMD,packet_sha="a"*64,release_sha="d"*64):
            args=[
                "'"+command+"'::uuid", "'"+permit+"'::uuid",
                "'"+packet_sha+"'", "'"+release_sha+"'", "repeat('e',64)",
                "'"+instruction_sha+"'", "'"+owner+"'", "'"+target+"'::uuid",
                "'"+event_id+"'", "'"+challenge_id+"'",
                str(issued_ms)+"::bigint",str(expires_ms)+"::bigint",
            ]
            return ("SELECT gpt02_private.reserve_issue159_release_claim("+
                    ",".join(args)+")")
        # The SAME DB transaction reads central GPT02 owner/target registry.
        # A signed-looking release with the wrong owner/target/worker,
        # disabled binding, or duplicate DELL mapping must not reserve.
        registry_before = sql("""SELECT value FROM ai_platform.ai_settings
          WHERE key='dev.chatgpt_wake.account_bindings'""").stdout.strip()
        registry_enabled = ("UPDATE ai_platform.ai_settings SET value='false'"+
                            " WHERE key='dev.chatgpt_wake.enabled'")
        sql(registry_enabled)
        denied_off = sql(claim_sql(),"dev_gpt02_claim_gate_login",required=False)
        ensure(denied_off.returncode!=0 and
               "DEV_GPT02_TRUSTED_REGISTRY_NOT_READY" in denied_off.stderr,
               "DISABLED_CENTRAL_REGISTRY_ACCEPTED")
        sql("""UPDATE ai_platform.ai_settings SET value='true'
          WHERE key='dev.chatgpt_wake.enabled'""")
        sql("""UPDATE ai_platform.ai_settings
          SET value=jsonb_set(value::jsonb,'{bindings,0,ownerChannel}',
                    to_jsonb('ai-engine-oauth:'||repeat('e',64)))::text
          WHERE key='dev.chatgpt_wake.account_bindings'""")
        denied_owner=sql(claim_sql(),"dev_gpt02_claim_gate_login",
                         required=False)
        ensure(denied_owner.returncode!=0 and
               "DEV_GPT02_OWNER_TARGET_REGISTRY_MISMATCH" in denied_owner.stderr,
               "UNREGISTERED_OWNER_ACCEPTED")
        sql("UPDATE ai_platform.ai_settings SET value="+
            "'" + registry_before.replace("'","''") + "'" +
            " WHERE key='dev.chatgpt_wake.account_bindings'")
        sql("""UPDATE ai_platform.ai_settings
          SET value=jsonb_set(value::jsonb,'{bindings,0,enabled}','false'::jsonb)::text
          WHERE key='dev.chatgpt_wake.account_bindings'""")
        denied_disabled=sql(claim_sql(),"dev_gpt02_claim_gate_login",
                            required=False)
        ensure(denied_disabled.returncode!=0 and
               "DEV_GPT02_OWNER_TARGET_REGISTRY_MISMATCH" in denied_disabled.stderr,
               "DISABLED_DELL_BINDING_ACCEPTED")
        sql("UPDATE ai_platform.ai_settings SET value="+
            "'" + registry_before.replace("'","''") + "'" +
            " WHERE key='dev.chatgpt_wake.account_bindings'")
        sql("""UPDATE ai_platform.ai_settings
          SET value=jsonb_set(value::jsonb,'{bindings,1,workerId}',
                '"openclaw-dell-chatgpt-wake-dev"'::jsonb)::text
          WHERE key='dev.chatgpt_wake.account_bindings'""")
        denied_duplicate=sql(claim_sql(),"dev_gpt02_claim_gate_login",
                             required=False)
        ensure(denied_duplicate.returncode!=0 and
               "DEV_GPT02_OWNER_TARGET_REGISTRY_MISMATCH" in denied_duplicate.stderr,
               "DUPLICATE_DELL_TARGET_ACCEPTED")
        sql("UPDATE ai_platform.ai_settings SET value="+
            "'" + registry_before.replace("'","''") + "'" +
            " WHERE key='dev.chatgpt_wake.account_bindings'")
        # Protect against an otherwise well-formed signed release with a
        # switched conversation or a malformed configuration version.
        sql("""UPDATE ai_platform.ai_settings
          SET value=jsonb_set(value::jsonb,'{bindings,0,targetConversationId}',
              '"99999999-9999-4999-8999-999999999999"'::jsonb)::text
          WHERE key='dev.chatgpt_wake.account_bindings'""")
        denied_target=sql(claim_sql(),"dev_gpt02_claim_gate_login",required=False)
        ensure(denied_target.returncode!=0 and
               "DEV_GPT02_OWNER_TARGET_REGISTRY_MISMATCH" in denied_target.stderr,
               "UNREGISTERED_TARGET_CONVERSATION_ACCEPTED")
        sql("UPDATE ai_platform.ai_settings SET value="+
            "'" + registry_before.replace("'","''") + "'" +
            " WHERE key='dev.chatgpt_wake.account_bindings'")
        sql("""UPDATE ai_platform.ai_settings
          SET value=(value::jsonb - 'version')::text
          WHERE key='dev.chatgpt_wake.account_bindings'""")
        missing_version=sql(claim_sql(),"dev_gpt02_claim_gate_login",required=False)
        ensure(missing_version.returncode!=0 and
               "DEV_GPT02_TRUSTED_REGISTRY_NOT_READY" in missing_version.stderr,
               "MISSING_CONFIG_VERSION_ACCEPTED")
        sql("UPDATE ai_platform.ai_settings SET value="+
            "'" + registry_before.replace("'","''") + "'" +
            " WHERE key='dev.chatgpt_wake.account_bindings'")
        ensure(sql("SELECT has_table_privilege('dev_gpt02_claim_gate_login',"+
                   "'ai_platform.ai_settings','SELECT')").stdout.strip()=="f",
               "CLAIM_LOGIN_CAN_DIRECTLY_READ_REGISTRY")

        bad_event = sql(claim_sql(event_id="0"*64),
                        "dev_gpt02_claim_gate_login",required=False)
        ensure(bad_event.returncode!=0 and
               "RELEASE_CLAIM_SIGNED_CONTEXT_OR_LEASE_MISMATCH" in bad_event.stderr,
               "FORGED_RELEASE_EVENT_ACCEPTED: rc="+str(bad_event.returncode)+
               " stderr="+bad_event.stderr[-1200:])
        # Two simultaneous admission attempts, one immutable claim row.
        with ThreadPoolExecutor(max_workers=2) as pool:
            claim_attempts=list(pool.map(lambda _:
                sql(claim_sql(),"dev_gpt02_claim_gate_login",required=False),
                range(2)))
        ensure(sum(x.returncode==0 for x in claim_attempts)==1,
               "RELEASE_CLAIM_CONCURRENT_EXACTLY_ONCE_FAILED")
        ensure(sum(x.returncode!=0 for x in claim_attempts)==1,
               "RELEASE_CLAIM_REPLAY_ACCEPTED")
        receipt=sql("""SELECT command_id::text||':'||permit_id::text||':'||
            event_id||':'||challenge||':'||claim_state
            FROM gpt02_private.issue159_release_claim_intents""").stdout.strip()
        ensure(receipt==CMD+":"+permit+":"+event+":"+challenge+
               ":RESERVED_NO_DISPATCH","RELEASE_CLAIM_LEDGER_IDENTITY_DRIFT")
        ensure(sql("SELECT count(*) FROM gpt02_private.issue159_release_claim_intents"
                   ).stdout.strip()=="1", "RELEASE_CLAIM_NOT_EXACTLY_ONCE")
        # A previously committed reservation never permits a second send.
        # Missing/non-matching claims also do not confer dispatch authority.
        read_claim = ("SELECT gpt02_private.inspect_issue159_release_claim('"+
                      CMD+"',repeat('d',64),'"+event+"')")
        found = sql(read_claim, "dev_gpt02_claim_gate_login").stdout.strip()
        ensure(found=="RECORDED_NO_DISPATCH_GATEWAY_LOOKUP_REQUIRED",
               "CRASH_READBACK_DID_NOT_REQUIRE_GATEWAY_RECONCILIATION")
        no_match = sql("SELECT gpt02_private.inspect_issue159_release_claim('"+
                 CMD+"',repeat('d',64),repeat('0',64))",
                 "dev_gpt02_claim_gate_login").stdout.strip()
        ensure(no_match=="NO_MATCHING_CLAIM_DO_NOT_SEND",
               "UNBOUND_RELEASE_READBACK_COULD_AUTHORIZE_SEND")
        public_reader = sql(read_claim, "dev_gpt02_release_writer",
                            required=False)
        ensure(public_reader.returncode!=0,
               "NON_CLAIM_ROLE_COULD_READ_RELEASE_CLAIM")
        denied_claim_mutation=sql("""UPDATE gpt02_private.issue159_release_claim_intents
           SET claim_state='DISPATCHED'""",required=False)
        ensure(denied_claim_mutation.returncode!=0 and
               "APPEND_ONLY_EVIDENCE" in denied_claim_mutation.stderr,
               "RELEASE_CLAIM_IMMUTABILITY_NOT_ENFORCED")
        check = sql("""SELECT
          id::text||':'||task_id::text||':'||source||':'||command_type
          ||':'||status||':'||(metadata_json ? 'assignedClientId')::text
          ||':'||(metadata_json ? 'gpt02Issue159PositivePermit')::text
          FROM ai_platform.ai_coding_bridge_commands""").stdout.strip()
        ensure(check==CMD+":"+CORE+":ai-core:ISSUE159_HELD:RECEIVED:false:true",
               "HELD_BRIDGE_COMMAND_COULD_BE_GENERIC_CLAIMED")
        duplicate = sql(stage_sql(), "dev_gpt02_bridge_stage_login")
        ensure(duplicate.stdout.strip()=="","HELD_BRIDGE_REPLAY_INSERTED_DUPLICATE")
        ensure(sql("SELECT count(*) FROM ai_platform.ai_coding_bridge_commands"
                   ).stdout.strip()=="1","HELD_BRIDGE_NOT_EXACTLY_ONCE")
        denied_update = sql("""UPDATE gpt02_private.positive_dispatch_outbox
               SET delivery_state='SENT'""", required=False)
        ensure(denied_update.returncode!=0 and "APPEND_ONLY_EVIDENCE" in denied_update.stderr,
               "OUTBOX_IMMUTABILITY_BYPASSED")
        check_legacy = sql("SELECT signing_grant::text||':'||dispatch_allowed::text "
                           "FROM gpt02_private.issuer_evidences").stdout.strip()
        ensure(check_legacy == "false:false", "HISTORIC_NO_DISPATCH_PROOF_MUTATED")
        print("PASS: disposable PG16 positive-permit migration; dormant roles, "
              "forced RLS, legacy NO_DISPATCH retained, exact lineage, "
              "one-use concurrency, signed-context claim fence, rollback and replay denied; outbox stays HELD_NO_DISPATCH; NOT live E2E")
    finally:
        run("docker", "rm", "-f", NAME, required=False)


if __name__ == "__main__":
    main()
