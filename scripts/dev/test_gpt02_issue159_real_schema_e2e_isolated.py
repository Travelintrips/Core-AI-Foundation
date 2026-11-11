#!/usr/bin/env python3
"""Disposable PostgreSQL 16 test of candidate *real-schema* GPT02 RPCs.

This test never connects to Supabase. It uses fake task and signer evidence and
never authorizes signing/dispatch. It proves SQL transactional/role behavior.
"""
from __future__ import annotations

import concurrent.futures
import hashlib
import json
import re
import subprocess
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAME = f"gpt02-rpc-real-schema-{uuid.uuid4().hex[:10]}"
COMMAND = "10000000-0000-4000-8000-000000000001"
ATTEMPT = "20000000-0000-4000-8000-000000000002"
LINK = "30000000-0000-4000-8000-000000000003"
HUB = "40000000-0000-4000-8000-000000000004"
CORE = "50000000-0000-4000-8000-000000000005"
NONCE = "N" * 40
ADIGEST = "a" * 64
LDIGEST = "b" * 64

def run(*argv: str, ok: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if ok and result.returncode:
        raise AssertionError("COMMAND_FAILED: " + " ".join(argv[:4]) + "\n" + result.stderr[-2500:])
    return result

def sql_literal(data: object) -> str:
    value = data if isinstance(data,str) else json.dumps(data,ensure_ascii=False,separators=(",",":"))
    return "'" + value.replace("'", "''") + "'"

def query(stmt: str, role: str = "gpt02_core_prep_login", ok: bool = True) -> subprocess.CompletedProcess:
    return run("docker","exec",NAME,"psql","-U",role,"-d","postgres",
               "-v","ON_ERROR_STOP=1","-Atqc",stmt,ok=ok)

def prepare(task: int, command: str, attempt: str, link: str, hub: str, core: str):
    return query(
      "INSERT INTO gpt02_stage.core_preparations("
      "company_id,hub_task_id,member_id,member_audit_id,operator_subject,"
      "core_task_id,hub_execution_id,command_candidate_id,attempt_id,config_sha256,expires_at)"
      f" VALUES('default',{task},5,10,'test-super-admin','{core}','{hub}',"
      f"'{command}','{attempt}',repeat('c',64),clock_timestamp()+interval '5 minutes')",
      role="postgres"
    )

def signed_claims(now: int, task: int = 140, command: str = COMMAND,
                  attempt: str = ATTEMPT, link: str = LINK,
                  hub: str = HUB, core: str = CORE) -> tuple[dict,dict]:
    approval = {
        "v":2,"environment":"DEV","audience":"GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
        "taskId":task,"commandId":command,"attemptId":attempt,
        "nonce":NONCE,"operatorNamespace":"ai-task-hub.public.users",
        "superAdminId":"test-super-admin","companyId":"default",
        "issuedAt":now-1000,"expiresAt":now+90000,
    }
    link_claim = {
        "v":1,"environment":"DEV","audience":"GPT02_DUAL_ACCOUNT_COMMAND_LINK",
        "linkId":link,"companyId":"default","hubTaskId":task,
        "hubExecutionId":hub,"coreTaskId":core,"coreCommandId":command,
        "attemptId":attempt,"attemptNumber":1,"assigneeId":5,
        "accountableOwnerId":"test-super-admin",
        "hubOperatorNamespace":"ai-task-hub.public.users",
        "hubOperatorId":"test-super-admin","hubRole":"super_admin","hubActive":True,
        "coreOperatorNamespace":"ai-core.ai_platform.internal_users",
        "coreOperatorUserId":7,"coreRole":"admin","coreActive":True,
        "corePasswordChanged":True,"workerId":"openclaw-dell-chatgpt-wake-dev",
        "approvalDigest":ADIGEST,"nonce":NONCE,
        "issuedAt":now-500,"expiresAt":now+85000,
    }
    return approval,link_claim

def record(approval: dict, link_claim: dict, link_digest: str = LDIGEST) -> subprocess.CompletedProcess:
    return query("SELECT gpt02_private.record_linked_approval("
      f"{sql_literal(approval)}::jsonb,{sql_literal('A'*86)},'{ADIGEST}',"
      f"{sql_literal(link_claim)}::jsonb,{sql_literal('B'*86)},"
      f"{sql_literal('C'*86)},'{link_digest}')",ok=False)

def check(x: bool, code: str) -> None:
    if not x:raise AssertionError(code)

def main() -> None:
    run("docker","run","-d","--rm","--network","none","--name",NAME,
        "-e","POSTGRES_PASSWORD=fixture-only","postgres:16-alpine")
    try:
        for _ in range(150):
            probe=run("docker","exec",NAME,"psql","-U","postgres","-Atqc","SELECT 1",ok=False)
            if probe.returncode==0 and probe.stdout.strip()=="1":
                time.sleep(.3)
                probe2=run("docker","exec",NAME,"psql","-U","postgres","-Atqc","SELECT 1",ok=False)
                if probe2.returncode==0 and probe2.stdout.strip()=="1":
                    break
            time.sleep(.15)
        else:raise AssertionError("PG16_NOT_READY")

        paths=[
            ("gpt02_issue159_real_schema_disposable_seed.sql","seed.sql"),
            ("gpt02_issue159_operational_candidate_NOT_APPLIED.sql","migration.sql"),
        ]
        for file,dst in paths:
            run("docker","cp",str(ROOT/"scripts/dev"/file),f"{NAME}:/tmp/{dst}")
        for dst in ("seed.sql","migration.sql"):
            run("docker","exec",NAME,"psql","-U","postgres",
                "-v","ON_ERROR_STOP=1","-f",f"/tmp/{dst}")
        check(query("SELECT rolcanlogin FROM pg_roles WHERE rolname='gpt02_core_prep_login'",
                    "postgres").stdout.strip()=="f","WRITER_DORMANT_GATE")
        # Only disposable writer becomes a login so its session_user can run the actual RPC.
        query("ALTER ROLE gpt02_core_prep_login LOGIN CONNECTION LIMIT 3", "postgres")
        prepare(140,COMMAND,ATTEMPT,LINK,HUB,CORE)
        # No approval stored: the consumer cannot create its own nonce receipt.
        missing=query(f"SELECT gpt02_private.consume_linked_approval('{COMMAND}','{ATTEMPT}','{LINK}','{NONCE}')",ok=False)
        check(missing.returncode!=0 and "FRESH_APPROVAL_REQUIRED" in missing.stderr,
              "CONSUME_WITHOUT_APPROVAL_ALLOWED")
        ac,lc=signed_claims(int(time.time()*1000))
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:record(ac,lc), range(2)))
        ok_results=[r for r in results if r.returncode==0]
        check(len(ok_results)==1, "CONCURRENT_APPROVAL_DOUBLE_INSERT_OR_NONE")
        check(ok_results[0].stdout.strip()==LINK,"LINK_ID_MISMATCH")
        check(any("duplicate key" in x.stderr for x in results if x.returncode),
              "CONCURRENT_REPLAY_NOT_UNIQUE")
        check(query("SELECT count(*) FROM gpt02_private.approvals",
                   "postgres").stdout.strip()=="1","APPROVAL_ROW_COUNT")

        # Cross-table transaction rollback after approval insert but invalid link.
        cmd2="10000000-0000-4000-8000-000000000012"
        att2="20000000-0000-4000-8000-000000000013"
        link2="30000000-0000-4000-8000-000000000014"
        hub2="40000000-0000-4000-8000-000000000015"
        core2="50000000-0000-4000-8000-000000000016"
        prepare(141,cmd2,att2,link2,hub2,core2)
        ac2,lc2=signed_claims(int(time.time()*1000),141,cmd2,att2,link2,hub2,core2)
        ac2["nonce"]="M"*40
        lc2["nonce"]="M"*40
        lc2["accountableOwnerId"]=None
        fail=record(ac2,lc2, "d"*64)
        check(fail.returncode!=0 and "null value" in fail.stderr,
              "CROSS_TABLE_ROLLBACK_NOT_TRIGGERED: "+fail.stderr[-1000:])
        check(query(f"SELECT count(*) FROM gpt02_private.approvals WHERE command_id='{cmd2}'",
                    "postgres").stdout.strip()=="0","CROSS_TABLE_ROLLBACK_FAILED")

        # An approval with a different admin cannot be bound to an immutable preparation.
        cmd3="10000000-0000-4000-8000-000000000022"
        att3="20000000-0000-4000-8000-000000000023"
        link3="30000000-0000-4000-8000-000000000024"
        hub3="40000000-0000-4000-8000-000000000025"
        core3="50000000-0000-4000-8000-000000000026"
        prepare(142,cmd3,att3,link3,hub3,core3)
        ac3,lc3=signed_claims(int(time.time()*1000),142,cmd3,att3,link3,hub3,core3)
        ac3["nonce"]="Z"*40
        lc3["nonce"]="Z"*40
        ac3["superAdminId"]="other-super-admin"
        lc3["hubOperatorId"]="other-super-admin"
        bad=record(ac3,lc3,"f"*64)
        check(bad.returncode!=0 and "IMMUTABLE_PREPARATION_BINDING_REQUIRED" in bad.stderr,
              "UNBOUND_ADMIN_APPROVAL_ALLOWED")
        consumed=query(f"SELECT gpt02_private.consume_linked_approval('{COMMAND}','{ATTEMPT}','{LINK}','{NONCE}')")
        receipt=consumed.stdout.strip()
        check(re.fullmatch(r"[0-9a-f-]{36}",receipt) is not None,"NONCE_RECEIPT_INVALID")
        dup=query(f"SELECT gpt02_private.consume_linked_approval('{COMMAND}','{ATTEMPT}','{LINK}','{NONCE}')",ok=False)
        check(dup.returncode!=0 and "duplicate key" in dup.stderr,"NONCE_REPLAY_ALLOWED")
        wrong=query(f"SELECT gpt02_private.reserve_post_consumption_fence('{COMMAND}','{LINK}','{receipt}','other-worker')",ok=False)
        check(wrong.returncode!=0 and "FENCE_SCOPE_DENIED" in wrong.stderr,"WRONG_WORKER_ALLOWED")
        fence=query(f"SELECT gpt02_private.reserve_post_consumption_fence('{COMMAND}','{LINK}','{receipt}','openclaw-dell-chatgpt-wake-dev')").stdout.strip()
        check(re.fullmatch(r"[0-9a-f-]{36}",fence) is not None,"FENCE_ID_INVALID")
        times=query(f"SELECT floor(extract(epoch from lease_started_at)*1000)::bigint,"
                    f"floor(extract(epoch from lease_expires_at)*1000)::bigint "
                    f"FROM gpt02_private.post_consumption_fences WHERE fence_id='{fence}'",
                    "postgres").stdout.strip().split("|")
        check(len(times)==2,"FENCE_TIME_MISSING")
        issued=int(times[0])+200
        expires=int(times[1])-1000
        issuer={
            "v":1,"environment":"DEV","audience":"GPT02_ISSUER_LEASE_EVIDENCE_V1",
            "companyId":"default","hubTaskId":140,
            "hubExecutionId":HUB,"coreTaskId":CORE,"commandId":COMMAND,
            "attemptId":ATTEMPT,"workerId":"openclaw-dell-chatgpt-wake-dev",
            "receiptId":receipt,"linkId":LINK,"fenceId":fence,
            "approvalDigest":ADIGEST,
            "nonceDigest":hashlib.sha256(NONCE.encode()).hexdigest(),
            "issuerRole":"dev_gpt02_issuer_evidence","leaseEpoch":1,
            "issuedAt":issued,"expiresAt":expires,
        }
        invalid=dict(issuer)
        invalid["nonceDigest"]="0"*64
        failed=query("SELECT gpt02_private.record_issuer_evidence("
               f"{sql_literal(invalid)}::jsonb,{sql_literal('D'*86)},"
               f"{sql_literal('e'*64)})",ok=False)
        check(failed.returncode!=0 and "ISSUER_LINEAGE_MISMATCH" in failed.stderr,
              "INVALID_ISSUER_NONCE_DIGEST_ALLOWED")
        issuer_id=query("SELECT gpt02_private.record_issuer_evidence("
               f"{sql_literal(issuer)}::jsonb,{sql_literal('D'*86)},"
               f"{sql_literal('e'*64)})").stdout.strip()
        check(re.fullmatch(r"[0-9a-f-]{36}",issuer_id) is not None,"ISSUER_ID_INVALID")
        answer=query(f"SELECT gpt02_private.consume_issuer_lease('{COMMAND}','{issuer_id}','{fence}')")
        check(answer.stdout.strip()=="LEASE_CONSUMED_NO_DISPATCH","LEASE_CONSUMPTION_FAILED")
        dup=query(f"SELECT gpt02_private.consume_issuer_lease('{COMMAND}','{issuer_id}','{fence}')",ok=False)
        check(dup.returncode!=0 and "duplicate key" in dup.stderr,"LEASE_REPLAY_ALLOWED")
        counts=query("SELECT (SELECT count(*) FROM gpt02_private.approvals)::text||':'||"
          "(SELECT count(*) FROM gpt02_private.operator_links)::text||':'||"
          "(SELECT count(*) FROM gpt02_private.receipts)::text||':'||"
          "(SELECT count(*) FROM gpt02_private.core_identity_receipts)::text||':'||"
          "(SELECT count(*) FROM gpt02_private.post_consumption_fences)::text||':'||"
          "(SELECT count(*) FROM gpt02_private.issuer_evidences)::text||':'||"
          "(SELECT count(*) FROM gpt02_private.issuer_lease_consumptions)::text",
          "postgres").stdout.strip()
        check(counts=="1:1:1:1:1:1:1","LEDGER_COUNTS_"+counts)
        check(query("SELECT bool_and(NOT dispatch_allowed) FROM gpt02_private.post_consumption_fences",
                    "postgres").stdout.strip()=="t","DISPATCH_ALLOWED_IN_FENCE")
        check(query("SELECT bool_and(NOT dispatch_allowed) FROM gpt02_private.issuer_lease_consumptions",
                    "postgres").stdout.strip()=="t","DISPATCH_ALLOWED_IN_LEASE")
        # Direct writer DML stays denied; only reviewed SECDEF routines are reachable.
        privileges=query(
          "SELECT has_table_privilege('gpt02_core_prep_login','gpt02_private.approvals','INSERT')::int,"
          "has_table_privilege('gpt02_core_prep_login','gpt02_private.issuer_evidences','INSERT')::int,"
          "has_function_privilege('gpt02_core_prep_login',"
          "'gpt02_private.record_linked_approval(jsonb,text,text,jsonb,text,text,text)','EXECUTE')::int,"
          "has_function_privilege('anon',"
          "'gpt02_private.record_linked_approval(jsonb,text,text,jsonb,text,text,text)','EXECUTE')::int",
          "postgres").stdout.strip()
        check(privileges=="0|0|1|0","PRIVILEGE_DRIFT_"+privileges)
        # Every RPC must remain owned by a non-login role, SECURITY DEFINER,
        # fixed search_path=pg_catalog, and unavailable to anon/authenticated/service_role.
        security=query("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
          "WHERE ((n.nspname='gpt02_private' AND p.proname IN "
          "('record_linked_approval','consume_linked_approval','reserve_post_consumption_fence',"
          "'record_issuer_evidence','consume_issuer_lease')) "
          "OR (n.nspname='gpt02_stage' AND p.proname='prepare_core_task')) "
          "AND p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog']::text[] "
          "AND pg_get_userbyid(p.proowner) IN ('gpt02_store_owner','gpt02_core_prep_owner') "
          "AND NOT has_function_privilege('anon',p.oid,'EXECUTE') "
          "AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') "
          "AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')",
          "postgres").stdout.strip()
        check(security=="6","SIX_RPC_SECURITY_METADATA_DRIFT_"+security)
        # Even a PostgreSQL superuser cannot UPDATE/DELETE immutable issuer rows
        # without the native reject_mutation trigger vetoing the operation.
        for table in ("issuer_evidences","issuer_lease_consumptions"):
            for stmt in (f"DELETE FROM gpt02_private.{table}",
                         f"UPDATE gpt02_private.{table} SET dispatch_allowed=true"):
                attempted=query(stmt,"postgres",ok=False)
                check(attempted.returncode!=0 and "APPEND_ONLY_EVIDENCE" in attempted.stderr,
                      "APPEND_ONLY_MUTATION_ACCEPTED_"+table)
        # A different SQL session_user is forbidden even with PostgreSQL superuser privileges.
        fail=query("SELECT gpt02_private.consume_issuer_lease("
          f"'{COMMAND}','{issuer_id}','{fence}')","postgres",ok=False)
        check(fail.returncode!=0 and "LEASE_CONSUMER_IDENTITY_DENIED" in fail.stderr,
              "SESSION_USER_GUARD_BYPASSED")
        query("ALTER ROLE gpt02_core_prep_login NOLOGIN CONNECTION LIMIT 0","postgres")
        print("PASS: real-schema candidate 6 RPC transitions, atomic rollback,"
              " concurrency/replay denial, strict session identity,"
              " EXECUTE-only privilege and NO_DISPATCH (synthetic signatures,"
              " temporary PostgreSQL 16 only)")
    finally:
        run("docker","rm","-f",NAME,ok=False)


if __name__=="__main__":
    main()