#!/usr/bin/env python3
"""CST-DEV owner approval seven-day SQL migration disposable PostgreSQL16 QA.

No real Supabase, credentials, PROD, operational LOGIN, signer or dispatcher.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
NAME="cst-onejob-approval-7day-qa-"+str(os.getpid())
MIG=ROOT/"docs/dev/cst-onejob-owner-approval-seven-day.CSTDEV-ONLY.sql"
ROLL=ROOT/"docs/dev/cst-onejob-owner-approval-seven-day.ROLLBACK-CSTDEV-ONLY.sql"

def run(argv,input=None,allow_fail=False,timeout=45):
    p=subprocess.run(argv,input=input,text=True,capture_output=True,timeout=timeout)
    if p.returncode and not allow_fail:
        raise RuntimeError("QA_COMMAND_FAILED_"+str(p.returncode)+"_"+p.stderr[-160:])
    return p

def sql(q,allow_fail=False):
    return run(["docker","exec","-i",NAME,"psql","-X","-qAt",
        "-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres"],input=q,allow_fail=allow_fail)

def assert_equal(actual,expected,why):
    if actual!=expected:raise AssertionError(why+"_"+str(actual)+"_EXPECTED_"+str(expected))

SCHEMA=r"""
CREATE ROLE cst_team_model_pilot_stage_login NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 1;
CREATE ROLE cst_team_model_pilot_writer NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE cst_unrelated_qa_role NOLOGIN NOBYPASSRLS;
CREATE SCHEMA ai_platform;
CREATE TABLE ai_platform.internal_users(id int PRIMARY KEY,role text,status text,account_type text);
CREATE TABLE ai_platform.ai_jobs(id int PRIMARY KEY,status text,job_type text,payload_json jsonb);
CREATE TABLE ai_platform.cst_onejob_owner_approvals(
 id int PRIMARY KEY,purpose text NOT NULL,status text NOT NULL,
 company_id text NOT NULL,model_id text NOT NULL,approved_by_user_id int NOT NULL,
 request_id text NOT NULL,worker_name text NOT NULL,source_sha text NOT NULL,
 job_id int NOT NULL,approved_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,consumed_at timestamptz,
 CONSTRAINT cst_onejob_owner_approvals_check CHECK
 (expires_at>approved_at AND expires_at<=approved_at+interval '30 minutes')
);
INSERT INTO ai_platform.internal_users VALUES(19,'owner','active','internal');
INSERT INTO ai_platform.ai_jobs VALUES(
 483,'waiting','ollama_model_invocation',
 '{"requestId":"cst-ai-team-company1-dev:pilot-aaaaaaaaaaaaaaaaaaaa","modelId":"qwen2.5:3b"}');
GRANT USAGE ON SCHEMA ai_platform TO cst_team_model_pilot_writer;
GRANT SELECT ON ai_platform.internal_users,ai_platform.ai_jobs TO cst_team_model_pilot_writer;
GRANT INSERT ON ai_platform.cst_onejob_owner_approvals TO cst_team_model_pilot_writer;
ALTER TABLE ai_platform.cst_onejob_owner_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.cst_onejob_owner_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY cst_onejob_stage_approval_insert
 ON ai_platform.cst_onejob_owner_approvals
 FOR INSERT TO cst_team_model_pilot_writer
 WITH CHECK (
   purpose='CST_DEV_ONEJOB_MODEL'
   AND status='APPROVED' AND consumed_at IS NULL
   AND company_id='1' AND model_id='qwen2.5:3b'
   AND request_id ~ '^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$'
   AND worker_name ~ '^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$'
   AND source_sha ~ '^[a-f0-9]{40}$'
   AND expires_at>approved_at AND expires_at<=approved_at+interval '30 minutes'
   AND EXISTS (
     SELECT 1 FROM ai_platform.internal_users u
     WHERE u.id=approved_by_user_id AND u.role='owner'
       AND u.status='active' AND u.account_type='internal'
   )
   AND EXISTS (
     SELECT 1 FROM ai_platform.ai_jobs j
     WHERE j.id=job_id AND j.status='waiting'
       AND j.job_type='ollama_model_invocation'
       AND j.payload_json->>'requestId'=request_id
       AND j.payload_json->>'modelId'=model_id
   )
 );
"""

def insert(duration,*,worker="cst-dev-dell-onejob-20261122-abcdef12",
           job_id=483, id=1, now_offset="0 minutes"):
    return f"""SET ROLE cst_team_model_pilot_writer;
INSERT INTO ai_platform.cst_onejob_owner_approvals(
 id,purpose,status,company_id,model_id,approved_by_user_id,
 request_id,worker_name,source_sha,job_id,approved_at,expires_at)
 VALUES ({id},'CST_DEV_ONEJOB_MODEL','APPROVED','1','qwen2.5:3b',19,
 'cst-ai-team-company1-dev:pilot-aaaaaaaaaaaaaaaaaaaa',
 '{worker}',repeat('a',40),{job_id},
 now()-interval '{now_offset}',
 now()-interval '{now_offset}'+interval '{duration}');
RESET ROLE;"""

def constraint():
    return sql("""SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid='ai_platform.cst_onejob_owner_approvals'::regclass
         AND conname='cst_onejob_owner_approvals_check'""").stdout.strip()

def policy():
    return sql("""SELECT with_check FROM pg_policies
       WHERE schemaname='ai_platform' AND tablename='cst_onejob_owner_approvals'
         AND policyname='cst_onejob_stage_approval_insert'""").stdout.strip()

def main():
    run(["docker","run","-d","--rm","--network","none","--name",NAME,
      "--memory","384m","--cpus","1","-e","POSTGRES_HOST_AUTH_METHOD=trust",
      "postgres:16-alpine"],timeout=90)
    try:
        for _ in range(110):
            ping=run(["docker","exec",NAME,"psql","-X","-qAt","-U","postgres",
             "-d","postgres","-c","SELECT 1"],allow_fail=True)
            if ping.returncode==0 and ping.stdout.strip()=="1":break
            time.sleep(.2)
        else:raise RuntimeError("PG16_NOT_READY")
        sql(SCHEMA)
        assert "00:30:00" in constraint()
        assert sql(insert("7 days"),allow_fail=True).returncode!=0
        sql(MIG.read_text())
        assert "7 days" in constraint()
        assert "7 days" in policy()
        assert_equal(sql("SELECT rolcanlogin::int FROM pg_roles WHERE rolname='cst_team_model_pilot_stage_login'").stdout.strip(),"0","STAGE_LOGIN_DRIFT")
        assert_equal(sql("SELECT rolcanlogin::int FROM pg_roles WHERE rolname='cst_unrelated_qa_role'").stdout.strip(),"0","UNRELATED_ROLE_DRIFT")
        # Bad scope still denied by the preserved restrictive RLS policy.
        assert sql(insert("7 days",worker="unrecognized-worker"),allow_fail=True).returncode!=0
        assert sql(insert("7 days",job_id=999),allow_fail=True).returncode!=0
        assert sql(insert("8 days"),allow_fail=True).returncode!=0
        sql(insert("7 days"))
        assert_equal(sql("SELECT count(*) FROM ai_platform.cst_onejob_owner_approvals").stdout.strip(),"1","7DAY_ROW_NOT_ADMITTED")
        # Cannot silently downgrade while a 7-day consent exists.
        assert sql(ROLL.read_text(),allow_fail=True).returncode!=0
        assert "7 days" in constraint()
        sql("DELETE FROM ai_platform.cst_onejob_owner_approvals WHERE id=1")
        sql(ROLL.read_text())
        assert "00:30:00" in constraint()
        assert "00:30:00" in policy()
        assert sql(insert("7 days"),allow_fail=True).returncode!=0
        print("CST_DEV_OWNER_APPROVAL_7DAY_PG16_DISPOSABLE_PASS "+
          json.dumps({"initial30minDenied7day":True,
          "migrated7dayAccepted":True,"8dayDenied":True,
          "wrongWorkerDenied":True,"wrongJobDenied":True,
          "rollbackBlockedWith7dayRow":True,"rollbackAfterDeletionPass":True,
          "noProductionConnection":True,"stageRoleStillNoLogin":True,
          "noExternalNetwork":True,"operationalDecision":"NO_GO"},sort_keys=True))
    finally:
        run(["docker","rm","-f",NAME],allow_fail=True,timeout=30)

if __name__=="__main__":
    try:main()
    except Exception as e:
        print("CST_DEV_OWNER_APPROVAL_7DAY_PG16_DISPOSABLE_FAIL "+str(e)[:180])
        sys.exit(2)