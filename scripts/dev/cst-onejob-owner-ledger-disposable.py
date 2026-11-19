#!/usr/bin/env python3
"""Disposable PostgreSQL 16 proof for the PROPOSED Owner one-job ledger.
Never connects to CST-DEV or PROD, exposes no ports, uses --network none.
"""
from pathlib import Path
import json, os, subprocess, sys, time

ROOT=Path(__file__).resolve().parents[2]
DDL=ROOT/"docs/dev/cst-onejob-owner-approval.PROPOSED.sql"
BROKER=ROOT/"docs/dev/cst-onejob-waiting-admission-broker.PROPOSED.sql"
NAME=f"cst-onejob-owner-ledger-qa-{os.getpid()}"
DB="cst_onejob_owner_ledger_fixture"

def run(args,stdin=None,timeout=30):
    p=subprocess.run(args,input=stdin,capture_output=True,text=True,timeout=timeout)
    if p.returncode:
        raise RuntimeError("COMMAND_FAILED "+args[0]+" "+(p.stderr[-800:] or p.stdout[-500:]))
    return p.stdout

def psql(script):
    return run(["docker","exec","-i",NAME,"psql","-v","ON_ERROR_STOP=1",
                "-U","postgres","-d",DB],script)

def main():
    report={"test":"CST_DEV_OWNER_ONEJOB_LEDGER_DISPOSABLE",
            "db":"isolated_postgres16_network_none","devDbTouched":False,
            "prodDbTouched":False,"result":"FAIL"}
    started=False
    try:
        if not DDL.exists():
            raise RuntimeError("DDL_NOT_FOUND")
        run(["docker","run","-d","--rm","--name",NAME,"--network","none",
             "--memory","384m","--cpus","1",
             "-e","POSTGRES_DB="+DB,"-e","POSTGRES_HOST_AUTH_METHOD=trust",
             "postgres:16-alpine"],timeout=20)
        started=True
        for _ in range(70):
            logs=subprocess.run(["docker","logs",NAME],capture_output=True,text=True,timeout=3)
            final="PostgreSQL init process complete; ready for start up." in (logs.stdout+logs.stderr)
            if final:
                p=subprocess.run(["docker","exec",NAME,"psql","-U","postgres","-d",DB,
                    "-At","-c","SELECT 1"],capture_output=True,text=True,timeout=3)
                if p.returncode==0 and p.stdout.strip()=="1":break
            time.sleep(.4)
        else:raise RuntimeError("PG16_FINAL_SERVER_NOT_READY")
        psql("""CREATE SCHEMA ai_platform;
        CREATE TABLE ai_platform.internal_users(id integer PRIMARY KEY);
        CREATE TABLE ai_platform.ai_jobs(id integer PRIMARY KEY);
        INSERT INTO ai_platform.internal_users VALUES (1);
        INSERT INTO ai_platform.ai_jobs VALUES (483),(484),(485);
        CREATE ROLE cst_onejob_unprivileged NOINHERIT LOGIN;""")
        psql(DDL.read_text())
        common="""'CST_DEV_ONEJOB_MODEL','APPROVED','1','qwen2.5:3b',
            1,'cst-ai-team-company1-dev:pilot-aaaaaaaaaaaaaaaaaaaa',
            'cst-dev-dell-onejob-20261119-abcdef12',
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',"""
        psql(f"""INSERT INTO ai_platform.cst_onejob_owner_approvals
          (purpose,status,company_id,model_id,approved_by_user_id,
           request_id,worker_name,source_sha,job_id,expires_at)
          VALUES ({common}483,now()+interval '20 minutes');""")
        # No policy exists, so even explicit INSERT grants cannot bypass FORCE RLS.
        psql("""GRANT USAGE ON SCHEMA ai_platform TO cst_onejob_unprivileged;
            GRANT INSERT,SELECT ON ai_platform.cst_onejob_owner_approvals TO cst_onejob_unprivileged;
            SET ROLE cst_onejob_unprivileged;
            DO $deny$
            BEGIN
              BEGIN
                INSERT INTO ai_platform.cst_onejob_owner_approvals
                (company_id,model_id,approved_by_user_id,request_id,worker_name,
                 source_sha,job_id,expires_at)
                VALUES ('1','qwen2.5:3b',1,
                 'cst-ai-team-company1-dev:pilot-bbbbbbbbbbbbbbbbbbbb',
                 'cst-dev-dell-onejob-20261119-abcdef12',
                 repeat('a',40),484,now()+interval '20 minutes');
                RAISE EXCEPTION 'RLS_DENIAL_MISSING';
              EXCEPTION WHEN insufficient_privilege THEN NULL;
              END;
            END $deny$;
            RESET ROLE;""")
        # Even different job IDs and independently random request IDs must
        # not create a second active pilot. PostgreSQL's partial UNIQUE index
        # enforces this across concurrent transactions, not application memory.
        psql("""DO $single_active$
        DECLARE failed_constraint text;
        BEGIN
          BEGIN
            INSERT INTO ai_platform.cst_onejob_owner_approvals
             (company_id,model_id,approved_by_user_id,request_id,worker_name,
              source_sha,job_id,expires_at)
            VALUES ('1','qwen2.5:3b',1,
              'cst-ai-team-company1-dev:pilot-ffffffffffffffffffff',
              'cst-dev-dell-onejob-20261119-abcdef12',
              repeat('a',40),484,now()+interval '20 minutes');
            RAISE EXCEPTION 'SECOND_ACTIVE_PILOT_WAS_ALLOWED';
          EXCEPTION WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS failed_constraint=CONSTRAINT_NAME;
            IF failed_constraint <> 'cst_onejob_one_active_approval'
            THEN RAISE EXCEPTION 'WRONG_CONSTRAINT_BLOCKED_SECOND_PILOT: %',failed_constraint; END IF;
          END;
        END $single_active$;""")
        # Simulate the same transaction shape as the staging service.
        # The second approval must abort the transaction and roll back the
        # newly created waiting job rather than leaving an orphan job row.
        try:
            psql("""BEGIN;
              INSERT INTO ai_platform.ai_jobs(id) VALUES (486);
              INSERT INTO ai_platform.cst_onejob_owner_approvals
               (company_id,model_id,approved_by_user_id,request_id,worker_name,
                source_sha,job_id,expires_at)
              VALUES ('1','qwen2.5:3b',1,
                'cst-ai-team-company1-dev:pilot-99999999999999999999',
                'cst-dev-dell-onejob-20261119-abcdef12',
                repeat('a',40),486,now()+interval '20 minutes');
              COMMIT;""")
            raise RuntimeError("SECOND_APPROVAL_TRANSACTION_UNEXPECTEDLY_COMMITTED")
        except RuntimeError as e:
            if 'duplicate key value violates unique constraint "cst_onejob_one_active_approval"' not in str(e):
                raise
        if "NO_ORPHAN_JOB_PASS" not in psql("""
            SELECT CASE WHEN count(*)=0 THEN 'NO_ORPHAN_JOB_PASS'
                   ELSE 'ORPHAN_JOB_FOUND' END
            FROM ai_platform.ai_jobs WHERE id=486;"""):
            raise RuntimeError("SECOND_APPROVAL_LEFT_ORPHAN_JOB")

        # Close the active-only fixture before testing other independent
        # constraints: otherwise the single-active unique index masks the FK
        # and TTL violations that those tests are intended to exercise.
        psql("""UPDATE ai_platform.cst_onejob_owner_approvals
                SET status='EXPIRED' WHERE job_id=483;""")
        # A privileged fixture owner must also be denied duplicate request/job,
        # wrong owner, and excessive approval TTL by database constraints.
        psql(f"""DO $deny$
        BEGIN
          BEGIN
            INSERT INTO ai_platform.cst_onejob_owner_approvals
             (purpose,status,company_id,model_id,approved_by_user_id,request_id,
              worker_name,source_sha,job_id,expires_at)
            VALUES ({common}484,now()+interval '20 minutes');
            RAISE EXCEPTION 'DUPLICATE_REQUEST_ALLOWED';
          EXCEPTION WHEN unique_violation THEN NULL; END;
          BEGIN
            INSERT INTO ai_platform.cst_onejob_owner_approvals
             (company_id,model_id,approved_by_user_id,request_id,worker_name,
              source_sha,job_id,expires_at)
            VALUES ('1','qwen2.5:3b',1,
              'cst-ai-team-company1-dev:pilot-cccccccccccccccccccc',
              'cst-dev-dell-onejob-20261119-abcdef12',
              repeat('a',40),483,now()+interval '20 minutes');
            RAISE EXCEPTION 'DUPLICATE_JOB_ALLOWED';
          EXCEPTION WHEN unique_violation THEN NULL; END;
          BEGIN
            INSERT INTO ai_platform.cst_onejob_owner_approvals
             (company_id,model_id,approved_by_user_id,request_id,worker_name,
              source_sha,job_id,expires_at)
            VALUES ('1','qwen2.5:3b',999,
              'cst-ai-team-company1-dev:pilot-dddddddddddddddddddd',
              'cst-dev-dell-onejob-20261119-abcdef12',
              repeat('a',40),484,now()+interval '20 minutes');
            RAISE EXCEPTION 'FORGED_OWNER_ALLOWED';
          EXCEPTION WHEN foreign_key_violation THEN NULL; END;
          BEGIN
            INSERT INTO ai_platform.cst_onejob_owner_approvals
             (company_id,model_id,approved_by_user_id,request_id,worker_name,
              source_sha,job_id,expires_at)
            VALUES ('1','qwen2.5:3b',1,
              'cst-ai-team-company1-dev:pilot-eeeeeeeeeeeeeeeeeeee',
              'cst-dev-dell-onejob-20261119-abcdef12',
              repeat('a',40),485,now()+interval '40 minutes');
            RAISE EXCEPTION 'UNBOUNDED_TTL_ALLOWED';
          EXCEPTION WHEN check_violation THEN NULL; END;
        END $deny$;""")
        state=psql("""SELECT
          (SELECT count(*) FROM ai_platform.cst_onejob_owner_approvals)=1
          AND (SELECT relrowsecurity AND relforcerowsecurity
               FROM pg_class WHERE oid='ai_platform.cst_onejob_owner_approvals'::regclass)
          AND (SELECT count(*) FROM pg_policies WHERE schemaname='ai_platform'
               AND tablename='cst_onejob_owner_approvals')=0
          AS pass;""")
        if "t" not in state.split():
            raise RuntimeError("LEDGER_POSTCONDITION_FAILED")
        # Candidate admission broker is a separate NOLOGIN role without
        # direct table grants. Even its verified caller must fail closed until
        # independently persisted readiness receipts are implemented.
        psql("""ALTER TABLE ai_platform.internal_users
            ADD COLUMN role text DEFAULT 'owner',
            ADD COLUMN status text DEFAULT 'active',
            ADD COLUMN account_type text DEFAULT 'internal';
          ALTER TABLE ai_platform.ai_jobs
            ADD COLUMN status text DEFAULT 'waiting',
            ADD COLUMN job_type text DEFAULT 'ollama_model_invocation',
            ADD COLUMN required_capability text DEFAULT 'ollama_inference',
            ADD COLUMN max_retry int DEFAULT 0,
            ADD COLUMN payload_json jsonb DEFAULT '{}'::jsonb;
          UPDATE ai_platform.ai_jobs SET payload_json=
            jsonb_build_object('requestId',
              'cst-ai-team-company1-dev:pilot-cccccccccccccccccccc',
              'modelId','qwen2.5:3b')
            WHERE id=484;
          CREATE UNIQUE INDEX ai_jobs_company1_pilot_request_unique
            ON ai_platform.ai_jobs((payload_json->>'requestId'))
            WHERE payload_json->>'requestId'
              LIKE 'cst-ai-team-company1-dev:pilot-%';""")
        psql("""INSERT INTO ai_platform.cst_onejob_owner_approvals
          (company_id,model_id,approved_by_user_id,request_id,worker_name,
           source_sha,job_id,expires_at)
          VALUES ('1','qwen2.5:3b',1,
            'cst-ai-team-company1-dev:pilot-cccccccccccccccccccc',
            'cst-dev-dell-onejob-20261119-abcdef12',
            repeat('a',40),484,now()+interval '20 minutes');""")
        psql(BROKER.read_text())
        psql("""DO $assert$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles
              WHERE rolname='cst_onejob_admission_broker' AND NOT rolcanlogin
               AND NOT rolbypassrls AND NOT rolsuper AND NOT rolinherit)
            THEN RAISE EXCEPTION 'BROKER_ROLE_UNSAFE'; END IF;
            IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
              WHERE r.rolname='cst_onejob_admission_broker')
            THEN RAISE EXCEPTION 'BROKER_HAS_MEMBERS'; END IF;
            IF has_table_privilege('cst_onejob_admission_broker',
               'ai_platform.ai_jobs','UPDATE')
             OR has_table_privilege('cst_onejob_admission_broker',
               'ai_platform.cst_onejob_owner_approvals','UPDATE')
            THEN RAISE EXCEPTION 'BROKER_HAS_DIRECT_WRITES'; END IF;
          END $assert$;""")
        approval_id=psql("""SELECT id FROM ai_platform.cst_onejob_owner_approvals
          WHERE job_id=484;""").strip().splitlines()[-1].strip()
        if len(approval_id)!=36:
            raise RuntimeError("BROKER_APPROVAL_FIXTURE_ID_INVALID")
        psql(f"""SET ROLE cst_onejob_unprivileged;
          DO $deny$
          BEGIN
            BEGIN
              PERFORM cst_onejob_private.admit_waiting_job(
                '{approval_id}'::uuid,484,
                'cst-ai-team-company1-dev:pilot-cccccccccccccccccccc',
                'cst-dev-dell-onejob-20261119-abcdef12',repeat('a',40));
              RAISE EXCEPTION 'UNPRIVILEGED_BROKER_CALL_ALLOWED';
            EXCEPTION WHEN insufficient_privilege THEN NULL; END;
          END $deny$;
          RESET ROLE;""")
        psql(f"""SET ROLE cst_onejob_admission_broker;
          DO $deny$
          BEGIN
            BEGIN
              PERFORM cst_onejob_private.admit_waiting_job(
                '{approval_id}'::uuid,484,
                'cst-ai-team-company1-dev:pilot-cccccccccccccccccccc',
                'cst-dev-dell-onejob-20261119-abcdef12',repeat('a',40));
              RAISE EXCEPTION 'BROKER_DISPATCHED_WITHOUT_READINESS_PROOF';
            EXCEPTION WHEN raise_exception THEN
              IF SQLERRM <> 'ONEJOB_INDEPENDENT_READINESS_PROOF_MISSING'
              THEN RAISE; END IF;
            END;
          END $deny$;
          RESET ROLE;""")
        state_broker=psql("""SELECT CASE WHEN
           (SELECT status FROM ai_platform.ai_jobs WHERE id=484)='waiting'
           AND (SELECT status FROM ai_platform.cst_onejob_owner_approvals
                WHERE job_id=484)='APPROVED'
           THEN 'BROKER_NO_SIDE_EFFECT_PASS' ELSE 'BROKER_MUTATED_DATA' END;""")
        if "BROKER_NO_SIDE_EFFECT_PASS" not in state_broker:
            raise RuntimeError("BROKER_UNAUTHORIZED_TRANSITION_LEFT_EFFECT")
        report.update(result="PASS",validRows=1,rlsForced=True,
          userPolicyPresent=False,duplicateRequestDenied=True,
          duplicateJobDenied=True,forgedOwnerDenied=True,excessiveTtlDenied=True,
          unprivilegedWriterDenied=True,secondDistinctActivePilotDenied=True,secondApprovalRollbackNoOrphanJob=True,brokerNoLogin=True,brokerNoDirectWrites=True,brokerNoTransition=True)
        print("ONEJOB_OWNER_LEDGER_DISPOSABLE_PASS",json.dumps(report))
        return 0
    except Exception as e:
        report["error"]=str(e)[:700]
        print("ONEJOB_OWNER_LEDGER_DISPOSABLE_FAIL",json.dumps(report))
        return 1
    finally:
        if started:
            subprocess.run(["docker","rm","-f",NAME],capture_output=True,text=True,timeout=15)

if __name__=="__main__":
    sys.exit(main())
