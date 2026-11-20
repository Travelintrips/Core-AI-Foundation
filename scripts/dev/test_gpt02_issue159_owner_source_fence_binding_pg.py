#!/usr/bin/env python3
"""Native PostgreSQL 16/17 proof: genuine-source fence controls issuance.

Entirely isolated Docker PostgreSQL; its approval rows are SYNTHETIC and
cannot grant any live user authority. Full existing issuance/consumption,
server-clock and canonical approval SQL are reused before the add-only
source provenance gate, rather than replacing or weakening them.
"""
from __future__ import annotations
import os
import secrets
import time
import uuid

from test_gpt02_issue159_minimal_catalog_auditor_pg import admin, login, run
from test_gpt02_issue159_issuance_server_clock_pg import (
    AUDIT_SQL,LEDGER_SQL,CLOCK_SQL,CONSUMER_SQL,OWNER_PASSWORD,
    CONSUME_FN,insert_sql,owner,ROOT,
)
from test_gpt02_issue159_canonical_approval_fence_pg import (
    MODEL_SQL,GUARD_SQL,authority_insert,synthetic_scope,
)
from test_gpt02_issue159_signed_scope_pg import quote

SOURCE_SQL=ROOT/"docs/dev/gpt02-issue159-owner-source-fence-binding.REVIEW_ONLY.sql"
IMAGE=os.environ.get("GPT02_OWNER_SOURCE_TEST_PG_IMAGE","postgres:16-alpine")
if IMAGE not in ("postgres:16-alpine","postgres:17-alpine"):
    raise SystemExit("DISPOSABLE_POSTGRES_IMAGE_DENIED")
SRC="gpt02_relock_audit.owner_source_decisions"
LINK="gpt02_relock_audit.reader_owner_source_bindings"
ISSUANCES="gpt02_relock_audit.reader_issuances"
CONSUMPTIONS="gpt02_relock_audit.reader_consumptions"

def fail_if(condition,label):
    if condition: raise AssertionError(label)

def actor_source_insert(params, decision_id, digest, *,
                        now_ms=None,expires_offset=30000):
    now_ms=now_ms or int(time.time()*1000)
    return (
      f"INSERT INTO {SRC} "
      "(source_decision_id,claims_sha256,owner_actor_id,auth_method,"
      "role_at_decision,company_id,task_id,command_id,attempt_id,"
      "recorded_at_ms,expires_at_ms) VALUES ("+
      quote(decision_id)+"::uuid,"+quote(digest)+","+
      quote("synthetic_owner_pg_fixture")+",'supabase_admin_session',"+
      "'super_admin','default',"+
      str(params["task_id"])+","+quote(params["command_id"])+"::uuid,"+
      quote(params["attempt_id"])+"::uuid,"+
      str(now_ms-1000)+","+str(now_ms+expires_offset)+");"
    )

def binding_insert(params,decision):
    return (
        f"INSERT INTO {LINK}(scope_sha,source_decision_id,packet_sha) VALUES("+
        quote(params["scope_sha"])+","+quote(decision)+"::uuid,"+
        quote(params["packet_sha"])+");"
    )

def claim(params,char="a"):
    return (
      f"INSERT INTO {CONSUMPTIONS}(scope_sha,read_challenge) VALUES("+
      quote(params["scope_sha"])+","+quote(char*64)+");"
    )

def main():
    if not SOURCE_SQL.is_file():raise AssertionError("MISSING_BINDING_SQL")
    sql=SOURCE_SQL.read_text()
    for required in (
       "PERSISTED_OWNER_SOURCE_OR_FENCE_REQUIRED",
       "PERSISTED_OWNER_SOURCE_REVOKED_OR_EXPIRED",
       "source_decision_id uuid PRIMARY KEY",
       "reader_owner_source_bindings",
       "FOR SHARE OF b,s,f",
       "REVOKE ALL ON FUNCTION",
       "FORCE ROW LEVEL SECURITY",
    ):
        if required not in sql:raise AssertionError("MISSING_SOURCE_GUARD:"+required)
    name="issue159-owner-src-"+uuid.uuid4().hex[:9]
    try:
        run("docker","run","--rm","-d","--network","none",
          "--name",name,"-e","POSTGRES_USER=root_admin",
          "-e","POSTGRES_PASSWORD=fixture_only",IMAGE)
        for _ in range(100):
            p=run("docker","exec",name,"psql","-X","-w",
               "-U","root_admin","-d","postgres","-Atc","SELECT 1",check=False)
            if p.returncode==0 and p.stdout.strip()=="1":break
            time.sleep(.25)
        else:raise AssertionError("DISPOSABLE_POSTGRES_NOT_READY")
        admin(name,"""
CREATE SCHEMA gpt02_private;
REVOKE ALL ON SCHEMA gpt02_private FROM PUBLIC;
CREATE ROLE postgres LOGIN CREATEROLE NOINHERIT
 PASSWORD 'synthetic_clock_owner_only';
GRANT CREATE ON DATABASE postgres TO postgres;
GRANT SELECT ON pg_catalog.pg_authid TO postgres;
GRANT pg_read_all_stats TO postgres;
CREATE ROLE unrelated_test LOGIN PASSWORD 'synthetic_unrelated';
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
""")
        for stage in (
            AUDIT_SQL,LEDGER_SQL,CLOCK_SQL,CONSUMER_SQL,MODEL_SQL,GUARD_SQL,
            SOURCE_SQL,
        ):
            owner(name,stage.read_text(encoding="utf-8"))
        # A second installation would be schema drift and must not pass.
        replay=owner(name,sql,check=False)
        fail_if(replay.returncode==0,"MIGRATION_REPLAY_ALLOWED")
        print("PASS_SOURCE_FIRST_ADD_ONLY_PRECHECK_NO_REAPPLY",flush=True)

        no_reader=login(
            name,"unrelated_test","synthetic_unrelated",
            f"SELECT * FROM {SRC}",check=False,
        )
        fail_if(no_reader.returncode==0,"PUBLIC_CAN_READ_OWNER_DECISIONS")
        print("PASS_OWNER_PROVENANCE_PRIVATE_NO_PUBLIC_SELECT",flush=True)

        a=synthetic_scope("b",183)
        owner(name,authority_insert(a))
        # Synthetic canonical row alone is NOT a genuine Owner approval.
        missing=owner(name,insert_sql(
             a,"clock_timestamp()+interval '8 seconds'"),check=False)
        fail_if(missing.returncode==0 or
           "PERSISTED_OWNER_SOURCE_OR_FENCE_REQUIRED" not in missing.stderr,
           "CANONICAL_WITHOUT_REAL_SOURCE_WRONGLY_ISSUED")
        print("PASS_CANONICAL_FENCE_WITHOUT_OWNER_SOURCE_DENIED",flush=True)
        decision=str(uuid.uuid4()); digest="1"*64
        owner(name,actor_source_insert(a,decision,digest))
        no_binding=owner(name,insert_sql(
            a,"clock_timestamp()+interval '8 seconds'"),check=False)
        fail_if(no_binding.returncode==0,"OWNER_SOURCE_WITHOUT_SIGNED_LINK_ISSUED")
        owner(name,binding_insert(a,decision))
        good=owner(name,insert_sql(
            a,"clock_timestamp()+interval '8 seconds'"))
        fail_if(good.returncode!=0,"BOUND_SOURCE_ISSUANCE_REJECTED")
        self_count=owner(name,f"SELECT count(*) FROM {ISSUANCES}").stdout.strip()
        fail_if(self_count!="1","ISSUER_ROW_NOT_PERSISTED")
        # Native consumption is possible once while the source remains fresh.
        owner(name,claim(a,"a"))
        fail_if(owner(name,f"SELECT COUNT(*) FROM {CONSUMPTIONS}").stdout.strip()!="1",
          "ONE_SOURCE_CLAIM_NOT_COMMITTED")
        print("PASS_OWNER_SOURCE_EXACT_SCOPE_ISSUE_AND_CONSUME",flush=True)

        # Same human decision cannot be relinked to any second task/scope.
        b=synthetic_scope("c",184)
        owner(name,authority_insert(b))
        dup=owner(name,binding_insert(b,decision),check=False)
        fail_if(dup.returncode==0,"OWNER_DECISION_DUPLICATED_ACROSS_TASKS")
        print("PASS_ONE_OWNER_DECISION_CANNOT_BIND_TWO_TASKS",flush=True)

        # One-way revocation is effective even for an already issued scope.
        second_decision=str(uuid.uuid4())
        owner(name,actor_source_insert(b,second_decision,"2"*64))
        owner(name,binding_insert(b,second_decision))
        owner(name,insert_sql(b,"clock_timestamp()+interval '7 seconds'"))
        owner(name,f"UPDATE {SRC} SET revoked_at=clock_timestamp() "
                   f"WHERE source_decision_id={quote(second_decision)}::uuid")
        rejected_claim=owner(name,claim(b,"b"),check=False)
        fail_if(rejected_claim.returncode==0 or
           "PERSISTED_OWNER_SOURCE_REVOKED_OR_EXPIRED" not in rejected_claim.stderr,
           "REVOKED_SOURCE_CONSUMPTION_ACCEPTED")
        undone=owner(name,
            f"UPDATE {SRC} SET revoked_at=NULL "
            f"WHERE source_decision_id={quote(second_decision)}::uuid",
            check=False)
        deleted=owner(name,
            f"DELETE FROM {SRC} "
            f"WHERE source_decision_id={quote(second_decision)}::uuid",
            check=False)
        fail_if(undone.returncode==0 or deleted.returncode==0,
            "SOURCE_REACTIVATION_OR_DELETE_ALLOWED")
        print("PASS_REVOKED_SOURCE_CANNOT_CONSUME_OR_REACTIVATE",flush=True)

        # An expiry at or before native server clock is NOT permission,
        # even if a synthetic canonical fence has more time remaining.
        d=synthetic_scope("d",185)
        owner(name,authority_insert(d))
        old_decision=str(uuid.uuid4())
        owner(name,actor_source_insert(d,old_decision,"3"*64,
          now_ms=int(time.time()*1000)-10000,expires_offset=4000))
        owner(name,binding_insert(d,old_decision))
        stale=owner(name,insert_sql(
            d,"clock_timestamp()+interval '5 seconds'"),check=False)
        fail_if(stale.returncode==0,"EXPIRED_OWNER_SOURCE_ISSUED")
        print("PASS_EXPIRED_OWNER_SOURCE_DENIED",flush=True)
        print("ALL_DISPOSABLE_ONLY_NO_CST_DEV_PROD_OWNER_OR_DELL_WRITES_"+IMAGE,flush=True)
    finally:
        run("docker","rm","-f",name,check=False)

if __name__=="__main__":main()
