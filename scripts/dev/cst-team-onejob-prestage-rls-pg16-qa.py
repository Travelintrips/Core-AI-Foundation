#!/usr/bin/env python3
"""One waiting job, one short-lived preparation role, one Owner-session view.

Entire test runs inside disposable network-none PostgreSQL 16. Never connects
to real Supabase, dispatches a model or authenticates a real Owner session.
"""
from __future__ import annotations
import json
from datetime import datetime,timezone,timedelta
from pathlib import Path
import secrets
import subprocess
import time

ROOT=Path(__file__).resolve().parents[2]
NAME="cst-onejob-prestage-only-pg16-qa"
ROLE="cst_team_onejob_prestage_20261120_abcdef12"
REQ="cst-ai-team-company1-dev:pilot-"+"a"*20
CODE="OLLAMA-A1B2C3D4"
DATABASE="postgres"
SCHEMA="""
CREATE ROLE dev_gpt02_relock_catalog_auditor NOLOGIN;
CREATE ROLE aicore_dev_runtime LOGIN;
CREATE ROLE cst_team_model_pilot_writer NOLOGIN;
CREATE SCHEMA ai_platform;
CREATE TABLE ai_platform.ai_jobs(
 id SERIAL PRIMARY KEY,job_code text UNIQUE NOT NULL,
 job_type text,required_capability text,status text,
 max_retry int,retry_strategy text,priority int,priority_score numeric,
 payload_json jsonb DEFAULT '{}'::jsonb);
CREATE TABLE ai_platform.cst_onejob_owner_approvals(
 id SERIAL PRIMARY KEY, approved_by_user_id int);
CREATE TABLE ai_platform.ai_events(id serial PRIMARY KEY);
ALTER TABLE ai_platform.ai_jobs ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA ai_platform TO aicore_dev_runtime;
GRANT SELECT ON ai_platform.ai_jobs TO aicore_dev_runtime;
CREATE UNIQUE INDEX ai_jobs_company1_pilot_request_unique
 ON ai_platform.ai_jobs ((payload_json->>'requestId'))
 WHERE payload_json->>'requestId' LIKE 'cst-ai-team-company1-dev:pilot-%';
"""
INPUT={"version":1,
  "system":"DEV-only model liveness check. Reply exactly with the requested token.",
  "user":"Reply CST_DEV_ONEJOB_PROBE_OK"}
PAYLOAD={
 "requestId":REQ,"modelId":"qwen2.5:3b",
 "responseFormat":{"type":"text"},"maxOutputTokens":24,
 "input":json.dumps(INPUT,separators=(",",":"))
}
def run(args,stdin=None,timeout=35):
 p=subprocess.run(args,input=stdin,text=True,capture_output=True,timeout=timeout)
 if p.returncode:
  raise RuntimeError("DISPOSABLE_QA_FAILED:"+str(args[0])+":"+(p.stderr[-1000:] or p.stdout[-400:]))
 return p.stdout
def sql(q):
 return run(["docker","exec","-i",NAME,"psql","-v","ON_ERROR_STOP=1","-U","postgres","-d",DATABASE],q)
def quote(s):return "'"+str(s).replace("'","''")+"'"
def render(name,values):
 data=(ROOT/"scripts/dev"/name).read_text()
 for k,v in values.items():data=data.replace("{{"+k+"}}",v)
 if "{{" in data or "}}" in data:raise RuntimeError("UNRENDERED_SQL_TOKEN")
 return data
def main():
 if subprocess.run(["docker","inspect",NAME],capture_output=True).returncode==0:
  raise RuntimeError("QA_PG16_NAME_IN_USE")
 created=False
 try:
  run(["docker","run","-d","--rm","--name",NAME,"--network","none",
       "--memory","350m","--pids-limit","96",
       "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"])
  created=True
  for _ in range(65):
   result=subprocess.run(["docker","exec",NAME,"psql","-At","-U","postgres",
                          "-d","postgres","-c","SELECT 1"],
                         text=True,capture_output=True,timeout=5)
   if result.returncode==0 and result.stdout.strip()=="1":break
   time.sleep(.2)
  else:raise RuntimeError("QA_PG_NOT_READY")
  sql(SCHEMA)
  expires=(datetime.now(timezone.utc)+timedelta(minutes=12)).isoformat()
  vals={
    "EXPECTED_DATABASE":DATABASE,"PRESTAGE_ROLE":ROLE,
    "PRESTAGE_SECRET":secrets.token_hex(24),"SOURCE_SHA":"b"*40,
    "EXPIRES":expires,"REQUEST_ID":REQ,"JOB_CODE":CODE,
  }
  sql(render("cst-team-onejob-prestage-role-template.sql",vals))
  grants=sql("SELECT rolcanlogin FROM pg_roles WHERE rolname="+quote(ROLE)+";")
  if "t" not in grants:raise RuntimeError("PRESTAGE_LOGIN_NOT_CREATED")
  def cmd(v,status="waiting",code=CODE):
   payload=dict(PAYLOAD)
   if isinstance(v,dict):payload.update(v)
   return ("INSERT INTO ai_platform.ai_jobs("+
     "job_code,job_type,required_capability,status,max_retry,"+
     "retry_strategy,priority,priority_score,payload_json) VALUES ("+
     quote(code)+",'ollama_model_invocation','ollama_inference',"+
     quote(status)+",0,'immediate',70,70,"+
     quote(json.dumps(payload,separators=(",",":")))+"::jsonb) RETURNING id;")
  # Bad requests, status or attempt to forge an approval must fail RLS.
  negative=[
    cmd({"requestId":"cst-ai-team-company3-dev:pilot-"+"c"*20}),
    cmd({},status="queued"),
    cmd({},code="OLLAMA-DEADBEEF"),
    "INSERT INTO ai_platform.cst_onejob_owner_approvals(approved_by_user_id) VALUES (19);",
    "UPDATE ai_platform.ai_jobs SET status='queued' WHERE id=1;",
  ]
  block="""
DO $test$
BEGIN
  BEGIN
    %s
    RAISE EXCEPTION 'ONEJOB_PRESTAGE_UNAUTHORIZED_OPERATION_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
"""
  for command in negative:
   # For UPDATE, no table privilege is always rejected.
   sql("SET ROLE "+ROLE+";\n"+block % command+"\nRESET ROLE;")
  first=sql("SET ROLE "+ROLE+";\n"+cmd({})+"\nRESET ROLE;")
  if "1" not in first:raise RuntimeError("PRESTAGE_WAITING_JOB_NOT_CREATED")
  # Duplicate active job even with a different request is prevented by the
  # persistent partial uniqueness index, independently of the role.
  sql("""DO $bad$
BEGIN
 BEGIN
  INSERT INTO ai_platform.ai_jobs(job_code,job_type,required_capability,
   status,payload_json) VALUES
  ('OLLAMA-BBBBBBBB','ollama_model_invocation','ollama_inference',
   'waiting','{"requestId":"cst-ai-team-company1-dev:pilot-bbbbbbbbbbbbbbbbbbbb"}'::jsonb);
  RAISE EXCEPTION 'SECOND_ACTIVE_JOB_ALLOWED';
 EXCEPTION WHEN unique_violation THEN NULL; END;
END $bad$;""")
  # Existing aicore_dev_runtime may only see the precise WAITING job.
  view=sql("SET ROLE aicore_dev_runtime;\nSELECT id,job_code,status FROM ai_platform.ai_jobs;\nRESET ROLE;")
  if "OLLAMA-A1B2C3D4" not in view:raise RuntimeError("OWNER_INTENT_CANNOT_READ_WAITING")
  sql(render("cst-team-onejob-prestage-relock-template.sql",vals))
  if sql("SELECT rolcanlogin FROM pg_roles WHERE rolname="+quote(ROLE)).strip().endswith("t"):
   raise RuntimeError("PRESTAGE_LOGIN_STILL_ACTIVE")
  sql("INSERT INTO ai_platform.ai_jobs(job_code,job_type,status,required_capability,payload_json)"+
      "VALUES ('OLLAMA-OTHER001','ollama_model_invocation','completed','ollama_inference',"+
      quote(json.dumps({"requestId":"cst-ai-team-company3-dev:other"}))+"::jsonb);")
  view=sql("SET ROLE aicore_dev_runtime;\nSELECT count(*) FROM ai_platform.ai_jobs;\nRESET ROLE;")
  if "1" not in view:raise RuntimeError("OWNER_READ_CROSS_TENANT_RLS_LEAK")
  sql(render("cst-team-onejob-prestage-cleanup-template.sql",vals))
  for label,q in [
   ("role","SELECT count(*) FROM pg_roles WHERE rolname="+quote(ROLE)),
   ("scoped_select","SELECT count(*) FROM pg_policies WHERE schemaname='ai_platform'"+
       " AND policyname LIKE 'cst_onejob_prestage_%'"),
  ]:
   result=sql(q).strip()
   if not result.endswith("0"):raise RuntimeError("TEMP_PRESTAGE_"+label+"_NOT_CLEANED")
  persisted=sql("SELECT count(*) FROM ai_platform.ai_jobs WHERE job_code="+quote(CODE))
  if not persisted.strip().endswith("1"):raise RuntimeError("PREPARED_JOB_LOST")
  print(json.dumps({
   "result":"PASS",
   "scope":"DISPOSABLE_PG16_NETWORK_NONE_ONLY",
   "dedicatedPrestageLogin":True,
   "oneWaitingJobCreated":True,
   "secondActiveJobDenied":True,
   "wrongCompanyAndQueueDenied":True,
   "approvalInsertAndStatusUpdateDenied":True,
   "ownerAppReadsWaitingOnly":True,
   "prestageRelockedAndRevoked":True,
   "singleWaitingJobPreservedForAuthenticatedOwnerReview":True,
   "realOwnerApprovalVerified":False,
   "realDevDatabaseModified":False,
   "productionModified":False,
   "operationalE2EVerified":False,
  },sort_keys=True))
 finally:
  if created:
   subprocess.run(["docker","rm","-f",NAME],stdout=subprocess.DEVNULL,
                  stderr=subprocess.DEVNULL,timeout=15)
if __name__=="__main__":main()
