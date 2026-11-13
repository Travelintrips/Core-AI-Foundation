#!/usr/bin/env python3
"""Fail-closed pg16 regression for GPT02 approval JSON length repair."""
import hashlib
import json
import re
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
NAME="gpt02-approval-jsonlen-"+uuid.uuid4().hex[:10]
SIGNATURE="gpt02_private.record_linked_approval(jsonb,text,text,jsonb,text,text,text)"
OLD_SHA="a70b5b77df3da58ffe1f34e7ff3fb6a18cce535483e9f7e378560bc0fcab2447"
CMD="10000000-0000-4000-8000-000000000001"
ATTEMPT="20000000-0000-4000-8000-000000000002"
LINK="30000000-0000-4000-8000-000000000003"
HUB="40000000-0000-4000-8000-000000000004"
CORE="50000000-0000-4000-8000-000000000005"

def run(*args,check=True):
    r=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if check and r.returncode:
        raise AssertionError("COMMAND_FAILED "+str(args[:4])+"\n"+r.stderr[-2500:])
    return r

def query(q,role="postgres",check=True):
    return run("docker","exec",NAME,"psql","-U",role,"-d","postgres",
               "-v","ON_ERROR_STOP=1","-Atqc",q,check=check)

def assert_that(ok,why):
    if not ok:raise AssertionError(why)

def literal(s):
    return "'"+s.replace("'","''")+"'"

def main():
    run("docker","run","-d","--rm","--network","none","--name",NAME,
        "-e","POSTGRES_PASSWORD=fixture-only","postgres:16-alpine")
    try:
        for _ in range(130):
            r=query("SELECT 1",check=False)
            if r.returncode==0 and r.stdout.strip()=="1":
                time.sleep(.3)
                r=query("SELECT 1",check=False)
                if r.returncode==0 and r.stdout.strip()=="1":break
            time.sleep(.2)
        else:raise AssertionError("PG_NOT_READY")
        files=[
          ("gpt02_issue159_approval_jsonlen_disposable_seed.sql","/tmp/seed.sql"),
          ("gpt02_issue159_approval_original_fixture_ONLY.sql","/tmp/original.sql"),
        ]
        for source,dst in files:
            run("docker","cp",str(ROOT/"scripts/dev"/source),NAME+":"+dst)
        for script in ("/tmp/seed.sql","/tmp/original.sql"):
            run("docker","exec",NAME,"psql","-U","postgres",
                "-v","ON_ERROR_STOP=1","-f",script)
        before=query("SELECT pg_get_functiondef("+literal(SIGNATURE)+"::regprocedure)").stdout
        assert_that(before.count("jsonb_object_length(")==2,
                    "OLD_FUNCTION_NOT_REPRODUCED")
        fixture_sha=query("SELECT encode(pg_catalog.sha256("
            "pg_catalog.convert_to(pg_get_functiondef("
            +literal(SIGNATURE)+"::regprocedure),'UTF8')),'hex')"
            ).stdout.strip()
        assert_that(re.fullmatch("[0-9a-f]{64}",fixture_sha) is not None,
                    "FIXTURE_HASH_MISSING")
        migration=(ROOT/"scripts/dev/gpt02_issue159_approval_jsonlen_DEV_ONLY.sql").read_text()
        assert_that(OLD_SHA in migration,"LIVE_OLD_SHA_NOT_PINNED")
        projected=migration.replace("postgres","gpt02_fixture_migrator").replace(
            OLD_SHA,fixture_sha)
        # The original fixture is compiled on a different PostgreSQL version;
        # the projected SHA is for the disposable seed only. The committed
        # migration retains the live DEV SHA and strict drift guard.
        with tempfile.NamedTemporaryFile(mode="w",suffix=".sql") as f:
            f.write(projected)
            f.flush()
            run("docker","cp",f.name,NAME+":/tmp/patch.sql")
        # Synthetic preparation and identity (no real task, JWT or admin).
        query(f"""INSERT INTO gpt02_stage.core_preparations(
          company_id,hub_task_id,command_candidate_id,attempt_id,
          hub_execution_id,core_task_id,member_id,operator_subject,expires_at)
          VALUES('default',141,'{CMD}','{ATTEMPT}','{HUB}','{CORE}',
          5,'fixture-super-admin',clock_timestamp()+interval '5 minutes')""")
        query("ALTER ROLE dev_gpt02_attestor_evidence LOGIN CONNECTION LIMIT 2")
        now=int(time.time()*1000)
        a={
          "v":2,"environment":"DEV",
          "audience":"GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
          "taskId":141,"commandId":CMD,"attemptId":ATTEMPT,
          "nonce":"N"*40,"operatorNamespace":"ai-task-hub.public.users",
          "superAdminId":"fixture-super-admin","companyId":"default",
          "issuedAt":now-1000,"expiresAt":now+90000
        }
        l={
          "v":1,"environment":"DEV","audience":"GPT02_DUAL_ACCOUNT_COMMAND_LINK",
          "linkId":LINK,"companyId":"default","hubTaskId":141,
          "hubExecutionId":HUB,"coreTaskId":CORE,"coreCommandId":CMD,
          "attemptId":ATTEMPT,"attemptNumber":1,"assigneeId":5,
          "accountableOwnerId":"fixture-super-admin",
          "hubOperatorNamespace":"ai-task-hub.public.users",
          "hubOperatorId":"fixture-super-admin","hubRole":"super_admin",
          "hubActive":True,"coreOperatorNamespace":"ai-core.ai_platform.internal_users",
          "coreOperatorUserId":7,"coreRole":"admin","coreActive":True,
          "corePasswordChanged":True,"workerId":"openclaw-dell-chatgpt-wake-dev",
          "approvalDigest":"a"*64,"nonce":"N"*40,
          "issuedAt":now-500,"expiresAt":now+80000,
        }
        def statement(link_digest="b"*64):
            return ("SELECT "+SIGNATURE[:SIGNATURE.index("(")]+"("+
                literal(json.dumps(a))+"::jsonb,"+
                literal("A"*86)+","+literal("a"*64)+","+
                literal(json.dumps(l))+"::jsonb,"+
                literal("B"*86)+","+literal("C"*86)+","+
                literal(link_digest)+")")
        old=query(statement(),"dev_gpt02_attestor_evidence",check=False)
        assert_that(old.returncode!=0 and "jsonb_object_length" in old.stderr,
                    "EXISTING_JSON_LENGTH_BUG_NOT_REPRODUCED")
        assert_that(query("SELECT count(*) FROM gpt02_private.approvals").stdout.strip()=="0",
                    "OLD_ERROR_WROTE_APPROVAL")
        # Live migration requires the actual attestor to remain NOLOGIN.
        query("ALTER ROLE dev_gpt02_attestor_evidence NOLOGIN CONNECTION LIMIT 0")
        # Patch as non-superuser with temporary SET privilege, then restore it.
        run("docker","exec",NAME,"psql","-U","gpt02_fixture_migrator",
            "-d","postgres","-v","ON_ERROR_STOP=1","-f","/tmp/patch.sql")
        assert_that(query("SELECT pg_has_role('gpt02_fixture_migrator',"
                          "'gpt02_store_owner','SET')::int").stdout.strip()=="0",
                    "MIGRATOR_SET_ROLE_NOT_RESTORED")
        after=query("SELECT pg_get_functiondef("+literal(SIGNATURE)+"::regprocedure)").stdout
        assert_that(after.count("pg_catalog.jsonb_object_keys(")==2
                    and "jsonb_object_length" not in after,
                    "PATCHED_FUNCTION_MISSING")
        assert_that(after.replace(
          "(SELECT count(*) FROM pg_catalog.jsonb_object_keys(p_approval))",
          "jsonb_object_length(p_approval)").replace(
          "(SELECT count(*) FROM pg_catalog.jsonb_object_keys(p_link))",
          "jsonb_object_length(p_link)"
          )==before,
          "FUNCTION_CHANGED_BEYOND_TWO_EXPRESSIONS")
        # Allow synthetic calls only after the migration has completed.
        query("ALTER ROLE dev_gpt02_attestor_evidence LOGIN CONNECTION LIMIT 2")
        success=query(statement(),"dev_gpt02_attestor_evidence")
        assert_that(success.stdout.strip()=="t","APPROVAL_RECORD_NOT_SUCCESS")
        retry=query(statement(),"dev_gpt02_attestor_evidence")
        assert_that(retry.stdout.strip()=="t","IDENTICAL_IDEMPOTENT_APPROVAL_FAILED")
        mismatch=query(statement("c"*64),"dev_gpt02_attestor_evidence",check=False)
        assert_that(mismatch.returncode!=0 and "LINKED_APPROVAL_CONFLICT" in mismatch.stderr,
                    "DIFFERENT_LINK_DIGEST_NOT_REJECTED")
        counts=query("""SELECT
          (SELECT count(*) FROM gpt02_private.approvals)::text||':'||
          (SELECT count(*) FROM gpt02_private.operator_links)::text""").stdout.strip()
        assert_that(counts=="1:1","APPROVAL_LINK_ROWS_NOT_ATOMIC")
        checks=query("SELECT "
          "has_function_privilege('dev_gpt02_attestor_evidence',"+literal(SIGNATURE)
          +",'EXECUTE')::int,"
          "has_function_privilege('dev_gpt02_issuer_evidence',"+literal(SIGNATURE)
          +",'EXECUTE')::int,"
          "has_function_privilege('authenticated',"+literal(SIGNATURE)
          +",'EXECUTE')::int").stdout.strip()
        assert_that(checks=="1|0|0","OLD_EXECUTE_GRANTS_CHANGED")
        print("PASS: exact two-expression approval JSON length fix,"
              " synthetic persisted approval + operator link, identical replay"
              " idempotent, changed link rejected; owner/grants unchanged,"
              " migrator owner SET restored; disposable PG16 only")
    finally:
        run("docker","rm","-f",NAME,check=False)

if __name__=="__main__":
    main()