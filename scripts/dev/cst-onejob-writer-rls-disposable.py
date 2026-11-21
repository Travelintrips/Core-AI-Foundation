#!/usr/bin/env python3
"""Disposable PG16 proof: narrow NOLOGIN one-job writer can stage WAITING only.
NEVER reaches CST-DEV or PROD; Docker --network none; removes container.
"""
from pathlib import Path
import json, os, re, subprocess, sys, time

ROOT=Path(__file__).resolve().parents[2]
NAME=f"cst-onejob-writer-rls-pg16-{os.getpid()}"
# Supabase real DEV uses database "postgres"; preserve that exact
# guard in the disposable network-none container, not a relaxed SQL test.
DB="postgres"
BASE=ROOT/"docs/dev/cst-onejob-owner-approval.PROPOSED.sql"
POLICY=ROOT/"docs/dev/cst-onejob-writer-rls.PROPOSED.sql"
MIGRATION=ROOT/"docs/dev/cst-onejob-ops-root-audit-guard.CSTDEV-ONLY.sql"
ROLLBACK=ROOT/"docs/dev/cst-onejob-ops-root-audit-guard.ROLLBACK-CSTDEV-ONLY.sql"
REQ1="cst-ai-team-company1-dev:pilot-"+"a"*20
REQ2="cst-ai-team-company1-dev:pilot-"+"b"*20
WORKER="cst-dev-dell-onejob-20261119-abcdef12"
SHA="a"*40
ROOT_FINGERPRINT="65aa7599c60cc0acc71d72f9f3bd5bd810873aad725fa64856e36639c995f71b"
INPUT=json.dumps({"version":1,
 "system":"DEV-only model liveness check. Reply exactly with the requested token.",
 "user":"Reply CST_DEV_ONEJOB_PROBE_OK"},separators=(",",":"))

def command(args, script=None, fail_ok=False):
    p=subprocess.run(args,input=script,text=True,capture_output=True,timeout=50)
    if p.returncode and not fail_ok:
        raise RuntimeError("COMMAND_ERROR:"+args[0]+" "+(p.stderr[-1500:] or p.stdout[-800:]))
    return p

def psql(query,fail_ok=False,dbuser="postgres"):
    return command(["docker","exec","-i",NAME,"psql","-qAt","-v","ON_ERROR_STOP=1",
                    "-U",dbuser,"-d",DB],query,fail_ok)

def denied(query,tag):
    p=psql("SET ROLE cst_team_model_pilot_writer;\n"+query,True)
    if p.returncode==0:
        raise RuntimeError("UNSAFE_ALLOWED_"+tag)
    message=(p.stderr or p.stdout).lower()
    if not any(s in message for s in ("permission denied","row-level security",
                                       "violates row-level","unique constraint")):
        raise RuntimeError("UNEXPECTED_DENIAL_"+tag+":"+message[-600:])

def payload(req):
    return json.dumps({"requestId":req,"modelId":"qwen2.5:3b","input":INPUT,
        "responseFormat":{"type":"text"},"maxOutputTokens":24},
        separators=(",",":")).replace("'","''")

def insert_job(req,code,extra=""):
    return f"""INSERT INTO ai_platform.ai_jobs
      (job_code,job_type,required_capability,payload_json,priority,priority_score,
       status,max_retry,retry_strategy,created_at,updated_at)
      VALUES ('{code}','ollama_model_invocation','ollama_inference',
        '{payload(req)}'::jsonb,70,70,'waiting',0,'immediate',now(),now())
      {extra};"""

def fixture():
    return """CREATE SCHEMA ai_platform;
      CREATE ROLE aicore_dev_runtime LOGIN NOINHERIT NOBYPASSRLS;
      CREATE TABLE ai_platform.internal_users(
        id integer PRIMARY KEY,role text NOT NULL,status text NOT NULL,
        account_type text NOT NULL);
      CREATE TABLE ai_platform.ai_jobs(
        id serial PRIMARY KEY,job_code text NOT NULL UNIQUE,
        job_type text NOT NULL,required_capability text,
        payload_json jsonb NOT NULL,priority int NOT NULL,
        priority_score numeric,status text NOT NULL,max_retry int NOT NULL,
        retry_strategy text NOT NULL,created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL);
      CREATE TABLE ai_platform.ai_audit_logs(
        id serial PRIMARY KEY,module text NOT NULL,action text NOT NULL,
        resource_type text,resource_id text,status text NOT NULL,
        details jsonb);
      ALTER TABLE ai_platform.internal_users ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ai_platform.ai_jobs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ai_platform.ai_audit_logs ENABLE ROW LEVEL SECURITY;
      INSERT INTO ai_platform.internal_users VALUES
        (1,'owner','active','internal'),
        (2,'admin','active','internal'),
        (3,'owner','inactive','internal');
      GRANT USAGE ON SCHEMA ai_platform TO aicore_dev_runtime;
      GRANT INSERT ON ai_platform.ai_jobs TO aicore_dev_runtime;
      -- Give generic runtime sequence access in this *disposable test only*,
      -- so it must fail because of RLS, not merely missing sequence grants.
      GRANT USAGE ON SEQUENCE ai_platform.ai_jobs_id_seq TO aicore_dev_runtime;
      CREATE POLICY existing_coding_insert ON ai_platform.ai_jobs
        FOR INSERT TO aicore_dev_runtime
        WITH CHECK (job_type='coding_repository_analyzer');
      CREATE UNIQUE INDEX ai_jobs_company1_pilot_request_unique
        ON ai_platform.ai_jobs((payload_json->>'requestId'))
        WHERE payload_json->>'requestId' LIKE 'cst-ai-team-company1-dev:pilot-%';
    """

def main():
    report={"test":"CST_DEV_ONEJOB_WRITER_RLS_DISPOSABLE",
      "environment":"postgres16_network_none","devDbTouched":False,
      "prodDbTouched":False,"result":"FAIL"}
    started=False
    try:
        command(["docker","run","-d","--rm","--name",NAME,"--network","none",
            "--memory","384m","--cpus","1",
            "-e","POSTGRES_DB="+DB,"-e","POSTGRES_HOST_AUTH_METHOD=trust",
            "postgres:16-alpine"])
        started=True
        for _ in range(70):
            p=command(["docker","exec",NAME,"pg_isready","-U","postgres","-d",DB],fail_ok=True)
            if p.returncode==0:
                break
            time.sleep(.4)
        else:raise RuntimeError("POSTGRES_NOT_READY")
        # Force final server readiness after image first-run init.
        for _ in range(70):
            p=psql("SELECT 1;",True)
            if p.returncode==0 and p.stdout.strip()=="1":break
            time.sleep(.4)
        else:raise RuntimeError("POSTGRES_FINAL_NOT_READY")
        psql(fixture())
        psql(BASE.read_text())
        # Exercise the ACTUAL guarded DEV-only migration against the old
        # permissive RLS baseline; never precreate the new restrictive policy.
        policy=POLICY.read_text()
        start=policy.index("CREATE POLICY cst_onejob_stage_ops_root_binding")
        end=policy.index(");\nGRANT USAGE ON SEQUENCE",start)+2
        psql(policy[:start]+policy[end:])
        psql("""CREATE ROLE cst_team_model_pilot_stage_login NOLOGIN
          NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
          NOBYPASSRLS CONNECTION LIMIT 1;
          GRANT cst_team_model_pilot_writer TO cst_team_model_pilot_stage_login
            WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;""")
        psql(MIGRATION.read_text())
        # Rollback must work only while no approval exists. Reapply to test
        # the actual runtime policy and later prove rollback becomes denied.
        psql(ROLLBACK.read_text())
        psql(MIGRATION.read_text())
        duplicate_migration=psql(MIGRATION.read_text(),True)
        if duplicate_migration.returncode==0 or            "ROOT_BINDING_POLICY_ALREADY_EXISTS" not in duplicate_migration.stderr:
            raise RuntimeError("DUPLICATE_ROOT_MIGRATION_NOT_DENIED")
        catalog=psql("""SELECT
          (SELECT NOT rolcanlogin AND NOT rolbypassrls AND NOT rolsuper
            FROM pg_roles WHERE rolname='cst_team_model_pilot_writer') AND
          (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r
            ON r.oid=m.roleid WHERE r.rolname='cst_team_model_pilot_writer')=1 AND
          (SELECT count(*) FROM pg_auth_members m
            JOIN pg_roles r ON r.oid=m.roleid
            JOIN pg_roles lo ON lo.oid=m.member
            WHERE r.rolname='cst_team_model_pilot_writer'
              AND lo.rolname='cst_team_model_pilot_stage_login'
              AND m.set_option AND NOT m.inherit_option AND NOT m.admin_option)=1 AND
          NOT has_table_privilege('cst_team_model_pilot_writer',
            'ai_platform.ai_jobs','UPDATE') AND
          NOT has_table_privilege('cst_team_model_pilot_writer',
            'ai_platform.internal_users','UPDATE') AND
          NOT has_table_privilege('cst_team_model_pilot_writer',
            'ai_platform.cst_onejob_owner_approvals','UPDATE') AND
          NOT has_table_privilege('cst_team_model_pilot_writer',
            'ai_platform.ai_audit_logs','DELETE');""").stdout.strip()
        if catalog!="t":raise RuntimeError("WRITER_PRIVILEGE_SCOPE_UNSAFE")
        visible=psql("""SET ROLE cst_team_model_pilot_writer;
          SELECT string_agg(id::text,',') FROM ai_platform.internal_users;
          RESET ROLE;""").stdout.strip()
        if visible!="1":raise RuntimeError("NON_OWNER_EXPOSED_TO_WRITER:"+visible)

        # Without a dedicated role, the shared runtime's existing coding
        # policy must not be enough to INSERT a pilot.
        # Connect as the actual unprivileged LOGIN role, not as postgres
        # followed by SET ROLE (which retains a superuser session_user).
        shared=psql(insert_job(REQ1,"OLLAMA-11111111"),
          True,"aicore_dev_runtime")
        if shared.returncode==0 or "row-level security" not in shared.stderr.lower():
            raise RuntimeError("SHARED_RUNTIME_NOT_PROVEN_RLS_DENIED:"+
              shared.stderr[-400:])

        # Generic runtime cannot SET ROLE into the NOLOGIN writer.
        escalation=psql("SET ROLE cst_team_model_pilot_writer;",
          True,"aicore_dev_runtime")
        if escalation.returncode==0 or "permission denied" not in escalation.stderr.lower():
            raise RuntimeError("SHARED_RUNTIME_CAN_IMPERSONATE_PILOT_WRITER")
        denied(insert_job(REQ1,"OLLAMA-11111111").replace(
            "'ollama_inference'","'unsafe_arbitrary_capability'"),
            "WRONG_CAPABILITY")
        denied(insert_job(REQ1,"OLLAMA-11111111").replace(
            "'waiting'","'queued'"),"PREMATURE_QUEUED")
        denied(insert_job(REQ1,"OLLAMA-11111111").replace(
            '"modelId":"qwen2.5:3b"','"modelId":"qwen2.5:72b"'),
            "WRONG_MODEL")
        denied("""UPDATE ai_platform.internal_users SET role='owner'
          WHERE id=2;""","OWNER_PROMOTION")
        denied("""UPDATE ai_platform.ai_jobs SET status='queued'
          WHERE id=1;""","PILOT_DIRECT_QUEUE")
        denied("""DELETE FROM ai_platform.ai_jobs WHERE id=1;""",
          "PILOT_DELETE")

        # Exercise the *real* separated login using PostgreSQL 16 role
        # membership SET TRUE, INHERIT FALSE. This credentialless fixture
        # uses --network none and trust auth; no live password is created.
        # The guard was installed while the stage principal was NOLOGIN;
        # enable it ONLY inside the disposable network-none fixture.
        psql("ALTER ROLE cst_team_model_pilot_stage_login LOGIN;")
        before=psql("SELECT id FROM ai_platform.internal_users;",
          True,"cst_team_model_pilot_stage_login")
        if before.returncode==0:
            raise RuntimeError("STAGE_LOGIN_INHERITED_TABLE_PRIVILEGES")
        local=psql("""BEGIN;
          SET TRANSACTION READ WRITE;
          SET LOCAL ROLE cst_team_model_pilot_writer;
          SELECT current_user||'|'||session_user;
          COMMIT;
          SELECT current_user;""",False,"cst_team_model_pilot_stage_login")
        lines=local.stdout.strip().splitlines()
        if lines != [
            "cst_team_model_pilot_writer|cst_team_model_pilot_stage_login",
            "cst_team_model_pilot_stage_login"
        ]:
            raise RuntimeError("TRANSACTION_LOCAL_WRITER_ROLE_NOT_RESET:"+str(lines))
        after_rollback=psql("""BEGIN;
          SET TRANSACTION READ WRITE;
          SET LOCAL ROLE cst_team_model_pilot_writer;
          ROLLBACK;
          SELECT current_user;""",
          False,"cst_team_model_pilot_stage_login").stdout.strip()
        if after_rollback!="cst_team_model_pilot_stage_login":
            raise RuntimeError("WRITER_ROLE_NOT_RESET_AFTER_ROLLBACK")
        for actor,target in [
          ("aicore_dev_runtime","cst_team_model_pilot_writer"),
          ("aicore_dev_runtime","cst_team_model_pilot_stage_login"),
          ("cst_team_model_pilot_stage_login","aicore_dev_runtime"),
        ]:
            attempt=psql("SET ROLE "+target+";",True,actor)
            if attempt.returncode==0 or "permission denied" not in attempt.stderr.lower():
                raise RuntimeError("FORBIDDEN_ROLE_SWITCH_ALLOWED_"+actor+"_"+target)

        # This is the same INSERT -> approval -> audit order as the stage
        # service, now issued by a real unprivileged LOGIN inside SET LOCAL.
        # Any failure means PostgreSQL rolls back the whole txn.
        positive=f"""BEGIN;
          SET TRANSACTION READ WRITE;
          SET LOCAL ROLE cst_team_model_pilot_writer;
          DO $stage$
          DECLARE j_id integer; a_id uuid;
          BEGIN
            {insert_job(REQ1,"OLLAMA-A1B2C3D4","RETURNING id INTO j_id")}
            INSERT INTO ai_platform.cst_onejob_owner_approvals
              (purpose,status,company_id,model_id,approved_by_user_id,
               request_id,worker_name,source_sha,job_id,expires_at)
              VALUES ('CST_DEV_ONEJOB_MODEL','APPROVED','1',
               'qwen2.5:3b',1,'{REQ1}','{WORKER}','{SHA}',j_id,
               now()+interval '20 minutes') RETURNING id INTO a_id;
            INSERT INTO ai_platform.ai_audit_logs
              (module,action,resource_type,resource_id,status,details)
              VALUES ('cst-onejob','owner_approved_waiting_job','ai_job',
                j_id::text,'success',
                jsonb_build_object('ownerUserId',1,'approvalId',a_id::text,
                  'requestId','{REQ1}','workerName','{WORKER}',
                  'sourceSha','{SHA}',
                  'operationsRootCandidateSha256','{ROOT_FINGERPRINT}',
                  'sameSuperAdminRootSelection',true,
                  'operationsRootTrusted',false,
                  'independentQaAdmissionVerified',false,
                  'dispatchPermitted',false));
          END $stage$;
          COMMIT;
          SELECT current_user;"""
        staged=psql(positive,False,"cst_team_model_pilot_stage_login")
        if staged.stdout.strip()!="cst_team_model_pilot_stage_login":
            raise RuntimeError("STAGE_ROLE_NOT_RESET_AFTER_COMMIT")

        state=psql("""SELECT
          (SELECT count(*) FROM ai_platform.ai_jobs
           WHERE status='waiting' AND job_type='ollama_model_invocation')=1
          AND (SELECT count(*) FROM ai_platform.cst_onejob_owner_approvals
           WHERE status='APPROVED')=1
          AND (SELECT count(*) FROM ai_platform.ai_audit_logs
           WHERE action='owner_approved_waiting_job')=1;""").stdout.strip()
        if state!="t":raise RuntimeError("ATOMIC_STAGING_POSTCONDITION_FAILED")
        # After the first real (disposable) Owner approval row exists, do
        # not permit weakening this RLS by applying the rollback.
        rejected_rollback=psql(ROLLBACK.read_text(),True)
        if rejected_rollback.returncode==0 or            "ROLLBACK_REQUIRES_EMPTY_CST_DEV_APPROVAL_LEDGER" not in rejected_rollback.stderr:
            raise RuntimeError("POST_APPROVAL_ROOT_POLICY_ROLLBACK_NOT_DENIED")
        bound=psql("""SELECT
          details->>'operationsRootCandidateSha256'=
             '65aa7599c60cc0acc71d72f9f3bd5bd810873aad725fa64856e36639c995f71b'
          AND details->>'sameSuperAdminRootSelection'='true'
          AND details->>'operationsRootTrusted'='false'
          AND details->>'independentQaAdmissionVerified'='false'
          AND details->>'dispatchPermitted'='false'
          FROM ai_platform.ai_audit_logs
          WHERE action='owner_approved_waiting_job';""").stdout.strip()
        if bound!="t":raise RuntimeError("OWNER_ROOT_SELECTION_NOT_AUDITED")
        def audit_mutation(value):
            return f"""INSERT INTO ai_platform.ai_audit_logs
              (module,action,resource_type,resource_id,status,details)
              SELECT module,action,resource_type,resource_id,status,
                jsonb_set(details,'{{operationsRootCandidateSha256}}',
                   to_jsonb('{value}'::text),false)
              FROM ai_platform.ai_audit_logs
              WHERE action='owner_approved_waiting_job';"""
        denied(audit_mutation('d'*64),"WRONG_ROOT_AUDIT_MUST_BE_DENIED")
        denied("""INSERT INTO ai_platform.ai_audit_logs
              (module,action,resource_type,resource_id,status,details)
              SELECT module,action,resource_type,resource_id,status,
                jsonb_set(details,'{operationsRootTrusted}',
                   'true'::jsonb,false)
              FROM ai_platform.ai_audit_logs
              WHERE action='owner_approved_waiting_job';""",
               "FAKE_ROOT_TRUST_MUST_BE_DENIED")

        # A separate active request with a unique ID must roll back the new
        # WAITING job after the second approval fails the single-active index.
        duplicate=f"""BEGIN;
          SET TRANSACTION READ WRITE;
          SET LOCAL ROLE cst_team_model_pilot_writer;
          {insert_job(REQ2,"OLLAMA-B1B2C3D4")}
          INSERT INTO ai_platform.cst_onejob_owner_approvals
              (purpose,status,company_id,model_id,approved_by_user_id,
               request_id,worker_name,source_sha,job_id,expires_at)
          VALUES ('CST_DEV_ONEJOB_MODEL','APPROVED','1','qwen2.5:3b',
             1,'{REQ2}','{WORKER}','{SHA}',currval('ai_platform.ai_jobs_id_seq'),
             now()+interval '20 minutes');
          COMMIT;"""
        failed=psql(duplicate,True,"cst_team_model_pilot_stage_login")
        if failed.returncode==0 or "cst_onejob_one_active_approval" not in failed.stderr:
            raise RuntimeError("SECOND_ACTIVE_APPROVAL_NOT_DENIED")
        rolled=psql("""SELECT
          (SELECT count(*) FROM ai_platform.ai_jobs)=1
          AND (SELECT count(*) FROM ai_platform.cst_onejob_owner_approvals)=1
          AND (SELECT count(*) FROM ai_platform.ai_audit_logs)=1;""").stdout.strip()
        if rolled!="t":raise RuntimeError("SECOND_STAGE_LEFT_ORPHAN_JOB")

        report.update(result="PASS",dedicatedRoleNoLogin=True,
            scopeNoTableUpdates=True,ownerReadOnlyActive=True,
            sharedRuntimePilotRlsDenied=True,sharedRoleEscalationDenied=True,badCapabilityDenied=True,
            prematureQueuedDenied=True,wrongModelDenied=True,
            ownerPromotionDenied=True,atomicWaitingStage=True,isolatedLoginSetLocalRole=True,autoResetAfterCommit=True,autoResetAfterRollback=True,
            distinctSecondStageRollback=True,auditBoundToApproval=True,
            candidateOperationsRootAudited=True,
            forgedRootDeniedByRestrictiveRls=True,
            fakeOperationsTrustDeniedByRls=True,
            guardedDevMigrationAppliedAndReadBack=True,
            zeroApprovalRollbackPassed=True,
            duplicateMigrationDenied=True,
            postApprovalRollbackDenied=True)
        print("ONEJOB_WRITER_RLS_DISPOSABLE_PASS",json.dumps(report))
        return 0
    except Exception as e:
        report["error"]=str(e)[:1200]
        print("ONEJOB_WRITER_RLS_DISPOSABLE_FAIL",json.dumps(report))
        return 1
    finally:
        if started:
            command(["docker","rm","-f",NAME],fail_ok=True)

if __name__=="__main__":
    sys.exit(main())
