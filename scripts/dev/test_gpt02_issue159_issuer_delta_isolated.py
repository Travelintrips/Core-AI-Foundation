#!/usr/bin/env python3
"""Disposable PG16 issuer-only migration test. Never connects to Supabase."""
import json
import concurrent.futures
import re
import subprocess
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAME = "gpt02-issuer-test-" + uuid.uuid4().hex[:9]
CMD = "10000000-0000-4000-8000-000000000001"
ATT = "20000000-0000-4000-8000-000000000002"
LINK = "30000000-0000-4000-8000-000000000003"
HUB = "40000000-0000-4000-8000-000000000004"
CORE = "50000000-0000-4000-8000-000000000005"
NONCE = "N"*40
WORKER = "openclaw-dell-chatgpt-wake-dev"

def run(*argv, required=True):
    r = subprocess.run(argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if required and r.returncode != 0:
        raise AssertionError("FAILED "+str(argv[:4])+"\n"+r.stderr[-2300:])
    return r

def sql(text, role="postgres", required=True):
    return run("docker","exec",NAME,"psql","-U",role,"-d","postgres",
               "-v","ON_ERROR_STOP=1","-Atqc",text,required=required)

def check(ok, why):
    if not ok: raise AssertionError(why)

def quote(s):
    return "'" + s.replace("'","''") + "'"

def main():
    run("docker","run","-d","--rm","--network","none","--name",NAME,
        "-e","POSTGRES_PASSWORD=fixture-only","postgres:16-alpine")
    try:
        for _ in range(110):
            probe=sql("SELECT 1",required=False)
            if probe.returncode==0 and probe.stdout.strip()=="1":
                time.sleep(.3)
                probe2=sql("SELECT 1",required=False)
                if probe2.returncode==0 and probe2.stdout.strip()=="1":
                    break
            time.sleep(.2)
        else: raise AssertionError("PG16_NOT_READY")
        seed=ROOT/"scripts/dev/gpt02_issue159_issuer_delta_disposable_seed.sql"
        candidate=ROOT/"scripts/dev/gpt02_issue159_issuer_delta_DEV_ONLY.sql"
        run("docker","cp",str(seed),NAME+":/tmp/seed.sql")
        # Only the disposable migrator name is changed; committed candidate
        # keeps literal postgres for actual Supabase migration verification.
        with __import__("tempfile").NamedTemporaryFile(mode="w",suffix=".sql") as f:
            f.write(candidate.read_text().replace("postgres","gpt02_fixture_migrator"))
            f.flush()
            run("docker","cp",f.name,NAME+":/tmp/delta.sql")
        run("docker","exec",NAME,"psql","-U","postgres","-v","ON_ERROR_STOP=1",
            "-f","/tmp/seed.sql")
        before=sql("""SELECT encode(pg_catalog.sha256(convert_to(
            string_agg(pg_get_functiondef(p.oid),'' ORDER BY p.oid::regprocedure::text),
            'UTF8')),'hex')
            FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE (n.nspname='gpt02_stage' AND p.proname='prepare_core_task')
               OR (n.nspname='gpt02_private' AND p.proname IN
            ('record_linked_approval','consume_linked_approval',
             'reserve_post_consumption_fence'))""").stdout.strip()
        run("docker","exec",NAME,"psql","-U","gpt02_fixture_migrator",
            "-d","postgres","-v","ON_ERROR_STOP=1","-f","/tmp/delta.sql")
        after=sql("""SELECT encode(pg_catalog.sha256(convert_to(
            string_agg(pg_get_functiondef(p.oid),'' ORDER BY p.oid::regprocedure::text),
            'UTF8')),'hex')
            FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE (n.nspname='gpt02_stage' AND p.proname='prepare_core_task')
               OR (n.nspname='gpt02_private' AND p.proname IN
            ('record_linked_approval','consume_linked_approval',
             'reserve_post_consumption_fence'))""").stdout.strip()
        check(before==after,"EXISTING_FOUR_RPC_MUTATED")
        check(sql("""SELECT pg_has_role('gpt02_fixture_migrator',
            'gpt02_store_owner','SET')""").stdout.strip()=="f",
              "STORE_OWNER_ROLE_SET_NOT_RESTORED")
        x=sql("""SELECT count(*) FROM pg_class c JOIN pg_namespace n
             ON n.oid=c.relnamespace WHERE n.nspname='gpt02_private'
             AND c.relname IN ('issuer_evidences','issuer_lease_consumptions')
             AND c.relrowsecurity AND c.relforcerowsecurity
             AND pg_get_userbyid(c.relowner)='gpt02_store_owner'""").stdout.strip()
        check(x=="2","ISSUER_FORCE_RLS_NOT_ENFORCED")
        for function in ["record_issuer_evidence(jsonb,text,text)",
                         "consume_issuer_lease(uuid,uuid,uuid)"]:
            sig="gpt02_private."+function
            check(sql("SELECT has_function_privilege('dev_gpt02_issuer_evidence',"
                      +quote(sig)+",'EXECUTE')::int").stdout.strip()=="1",
                  "ISSUER_EXECUTE_GRANT_MISSING")
            for role in ("anon","authenticated","service_role","gpt02_issuer_evidence_reader"):
                check(sql("SELECT has_function_privilege("
                          +quote(role)+","+quote(sig)+",'EXECUTE')::int"
                          ).stdout.strip()=="0","RPC_PUBLIC_EXECUTE_LEAK")
        check(sql("SELECT rolcanlogin FROM pg_roles WHERE rolname='dev_gpt02_issuer_evidence'"
                  ).stdout.strip()=="f","ISSUER_LOGIN_ENABLED")
        check(sql("SELECT has_table_privilege('dev_gpt02_issuer_evidence',"
                  "'gpt02_private.issuer_evidences','INSERT')::int").stdout.strip()=="0",
              "ISSUER_DIRECT_DML")
        check(sql("SELECT has_table_privilege('gpt02_issuer_evidence_reader',"
                  "'gpt02_private.issuer_evidences','SELECT')::int").stdout.strip()=="1",
              "READER_EVIDENCE_SELECT_NOT_GRANTED")

        # A second DDL application must refuse to overwrite existing issuer objects.
        duplicate=run("docker","exec",NAME,"psql","-U","gpt02_fixture_migrator",
             "-d","postgres","-v","ON_ERROR_STOP=1","-f","/tmp/delta.sql",
             required=False)
        check(duplicate.returncode!=0 and "ISSUER_FUNCTION_NAME_ALREADY_TAKEN"
              in duplicate.stderr+duplicate.stdout,
              "DUPLICATE_MIGRATION_NOT_REJECTED")
        # Insert synthetic persisted lineage via disposable superuser.
        setup = f"""
        INSERT INTO gpt02_stage.core_preparations(
          company_id,hub_task_id,member_id,member_audit_id,operator_subject,
          core_task_id,hub_execution_id,command_candidate_id,attempt_id,
          config_sha256,expires_at)
        VALUES('default',140,5,10,'fixture-super-admin','{CORE}','{HUB}',
          '{CMD}','{ATT}',repeat('c',64),clock_timestamp()+interval '5 minutes');
        INSERT INTO gpt02_private.approvals(command_id,attempt_id,nonce,task_id,
          company_id,approver_id,claims,signature,digest,expires_at,operator_namespace)
        VALUES('{CMD}','{ATT}',repeat('N',40),140,'default','fixture-super-admin',
          '{{"environment":"DEV"}}',repeat('A',86),repeat('a',64),
          clock_timestamp()+interval '5 minutes','ai-task-hub.public.users');
        INSERT INTO gpt02_private.operator_links(
          link_id,command_id,hub_execution_id,core_task_id,hub_task_id,
          attempt_id,attempt_number,company_id,assignee_id,accountable_owner_id,
          hub_operator_id,core_operator_user_id,approval_digest,link_digest,
          hub_signature,core_signature,claims,expires_at)
        VALUES('{LINK}','{CMD}','{HUB}','{CORE}',140,'{ATT}',1,'default',5,
          'fixture-super-admin','fixture-super-admin',7,
          repeat('a',64),repeat('b',64),repeat('B',86),repeat('C',86),
          '{{"environment":"DEV"}}',clock_timestamp()+interval '5 minutes');
        INSERT INTO gpt02_private.receipts(command_id,nonce,digest)
        VALUES('{CMD}',repeat('N',40),repeat('a',64));
        INSERT INTO gpt02_private.core_identity_receipts(
          receipt_id,command_id,link_id,operator_user_id,recorded_by,
          hub_operator_id,link_digest,
          binding_verified,may_dispatch_worker,may_issue_grant,
          may_close_job,core_ledger_written)
        SELECT r.id,r.command_id,'{LINK}',7,'internal:7',
          'fixture-super-admin',repeat('b',64),false,false,false,false,false
        FROM gpt02_private.receipts r;
        INSERT INTO gpt02_private.post_consumption_fences(
          receipt_id,command_id,link_id,hub_execution_id,core_task_id,attempt_id,
          worker_id,lease_epoch,lease_started_at,lease_expires_at,
          dispatch_allowed,core_ledger_written)
        SELECT r.id,r.command_id,'{LINK}','{HUB}','{CORE}','{ATT}',
          '{WORKER}',1,clock_timestamp(),clock_timestamp()+interval '14 seconds',
          false,false FROM gpt02_private.receipts r;
        """
        sql(setup)
        # Role becomes LOGIN *only on the disposable database*.
        sql("ALTER ROLE dev_gpt02_issuer_evidence LOGIN CONNECTION LIMIT 3")
        f=sql("SELECT fence_id::text,receipt_id::text,"
              "floor(extract(epoch from lease_started_at)*1000)::bigint,"
              "floor(extract(epoch from lease_expires_at)*1000)::bigint "
              "FROM gpt02_private.post_consumption_fences").stdout.strip().split("|")
        check(len(f)==4,"FENCE_NOT_SEEDED")
        fence,receipt,started,ends=f
        claim={
          "v":1,"environment":"DEV",
          "audience":"GPT02_ISSUER_LEASE_EVIDENCE_V1",
          "companyId":"default","hubTaskId":140,"hubExecutionId":HUB,
          "coreTaskId":CORE,"commandId":CMD,"attemptId":ATT,
          "workerId":WORKER,"receiptId":receipt,"linkId":LINK,"fenceId":fence,
          "approvalDigest":"a"*64,
          "nonceDigest":__import__("hashlib").sha256(NONCE.encode()).hexdigest(),
          "issuerRole":"dev_gpt02_issuer_evidence","leaseEpoch":1,
          "issuedAt":int(started)+100,"expiresAt":int(ends)-1000,
        }
        bad=dict(claim); bad["nonceDigest"]="0"*64
        bad_sql=("SELECT gpt02_private.record_issuer_evidence("+quote(json.dumps(bad))+
                "::jsonb,repeat('D',86),repeat('e',64))")
        wrong=sql(bad_sql,"dev_gpt02_issuer_evidence",required=False)
        check(wrong.returncode!=0 and "ISSUER_CLAIMS_NOT_BOUND_OR_EXPIRED" in wrong.stderr,
              "WRONG_NONCE_DIGEST_ACCEPTED "+wrong.stderr[:600])
        main_sql=("SELECT gpt02_private.record_issuer_evidence("+quote(json.dumps(claim))+
                 "::jsonb,repeat('D',86),repeat('e',64))")
        evidence=sql(main_sql,"dev_gpt02_issuer_evidence").stdout.strip()
        check(re.fullmatch(r"[0-9a-f-]{36}",evidence)!=None,"ISSUER_UUID_INVALID")
        again=sql(main_sql,"dev_gpt02_issuer_evidence",required=False)
        check(again.returncode!=0 and "duplicate key" in again.stderr,
              "ISSUER_EVIDENCE_REPLAY")
        consume=f"SELECT gpt02_private.consume_issuer_lease('{CMD}','{evidence}','{fence}')"
        # Concurrent consumers of the same immutable issuer evidence: exactly one
        # can commit the consumption row; the other must be refused by UNIQUE.
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            simultaneous=list(pool.map(
                lambda _:sql(consume,"dev_gpt02_issuer_evidence",required=False),
                range(2)))
        success=[r for r in simultaneous if r.returncode==0]
        failures=[r for r in simultaneous if r.returncode!=0]
        check(len(success)==1 and success[0].stdout.strip()=="LEASE_CONSUMED_NO_DISPATCH",
              "CONCURRENT_LEASE_NOT_EXACTLY_ONCE")
        check(len(failures)==1 and "duplicate key" in failures[0].stderr,
              "CONCURRENT_LEASE_REPLAY_NOT_REJECTED")
        again=sql(consume,"dev_gpt02_issuer_evidence",required=False)
        check(again.returncode!=0 and "duplicate key" in again.stderr,
              "LEASE_CONSUMPTION_REPLAY_ALLOWED")
        deny=sql(f"SELECT gpt02_private.consume_issuer_lease('{CMD}','{evidence}',"
                 "'ffffffff-ffff-4fff-8fff-ffffffffffff')",
                 "dev_gpt02_issuer_evidence",required=False)
        check(deny.returncode!=0 and "BOUND_ISSUER_EVIDENCE_REQUIRED" in deny.stderr,
              "WRONG_FENCE_ACCEPTED")
        # Existing independent issuer reader can inspect only the two DEV
        # scoped rows and has no table DML or privileged EXECUTE surface.
        for table in ("issuer_evidences","issuer_lease_consumptions"):
            value=sql("SELECT count(*) FROM gpt02_private."+table,
                      "gpt02_issuer_evidence_reader").stdout.strip()
            check(value=="1","SCOPED_READER_CANNOT_READ_"+table)
        counts=sql("""SELECT
        (SELECT count(*) FROM gpt02_private.issuer_evidences)::text||':'||
        (SELECT count(*) FROM gpt02_private.issuer_lease_consumptions)::text||':'||
        (SELECT bool_and(NOT dispatch_allowed AND NOT signing_grant)
          FROM gpt02_private.issuer_evidences)::text||':'||
        (SELECT bool_and(NOT dispatch_allowed)
          FROM gpt02_private.issuer_lease_consumptions)::text""").stdout.strip()
        check(counts=="1:1:true:true","EVIDENCE_LEDGER_OR_DISPATCH_DRIFT "+counts)
        for table in ["issuer_evidences","issuer_lease_consumptions"]:
            for statement in [f"DELETE FROM gpt02_private.{table}",
                              f"UPDATE gpt02_private.{table} SET dispatch_allowed=true"]:
                deny=sql(statement,required=False)
                check(deny.returncode!=0 and "APPEND_ONLY_EVIDENCE" in deny.stderr,
                      "APPEND_ONLY_BYPASS "+table)
        print("PASS: issuer-only incremental migration, four old RPC definitions"
              " unchanged; force RLS, no broad EXECUTE/DML, issuer evidence/lease"
              " single-use and non-dispatch; disposable PG16")
    finally:
        run("docker","rm","-f",NAME,required=False)

if __name__=="__main__":
    main()