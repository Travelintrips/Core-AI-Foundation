#!/usr/bin/env python3
"""Network-none PostgreSQL16 proof: common queue cannot promote GPT02 pilot.

This tests the exact source SQL exclusion predicate plus a simplified
replica of CST-DEV's already-existing coding-only UPDATE RLS. No actual
Supabase project credentials, signers, Owner decisions or server ports.
"""
import os,subprocess,time,json,sys,hashlib,re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
SRC=(ROOT/"artifacts/api-server/src/services/queueManagerService.ts").read_text()
PREFIX="cst-ai-team-company1-dev:pilot-"
NAME="cst-onejob-generic-queue-sql-disposable-"+str(os.getpid())
def run(args,stdin=None,allow=False):
 # A stable command tag identifies the failing synthetic fixture operation
 # without echoing its SQL or relying on CI runner timing.
 tag=("Q"+hashlib.sha256(stdin.encode()).hexdigest()[:10].upper()
   if stdin is not None else "DOCKER_"+(args[1].upper() if len(args)>1 else "CLI"))
 if os.environ.get("CST_QA_TRACE")=="1":
  print("DISPOSABLE_STEP_"+tag,flush=True)
 limit=90 if args[:2]==["docker","run"] else 25
 try:
  r=subprocess.run(args,input=stdin,text=True,capture_output=True,timeout=limit)
 except subprocess.TimeoutExpired:
  raise RuntimeError("FIXTURE_"+tag+"_TIMEOUT")
 if r.returncode!=0 and not allow:
  msg=r.stderr.lower()
  state=re.search(r"\bERROR:\s*([0-9A-Z]{5}):",r.stderr)
  if state:category="PG_SQLSTATE_"+state.group(1)
  elif "permission denied" in msg:category="PERMISSION"
  elif "row-level security" in msg:category="RLS"
  elif "syntax error" in msg:category="SQL_SYNTAX"
  elif "does not exist" in msg:category="MISSING"
  elif "not found" in msg:category="NOT_FOUND"
  elif "error response from daemon" in msg:category="DOCKER_DAEMON"
  elif "error:" in msg:category="PG_ERROR"
  else:category="COMMAND_EXIT"
  raise RuntimeError("FIXTURE_"+tag+"_"+category)
 return r
def psql(q,allow=False):
 return run(["docker","exec","-i",NAME,"psql","-X","-qAt",
  "-v","ON_ERROR_STOP=1","-v","VERBOSITY=verbose",
  "-U","postgres","-d","postgres"],q,allow)
def require(ok,code):
 if not ok:raise RuntimeError(code)
def main():
 require("CST_ONEJOB_RESERVED_REQUEST_PREFIX + '%'" in SRC,
  "LIVE_SOURCE_PREFIX_PREDICATE_NOT_PRESENT")
 require(SRC.count("nonReservedPilotJob")>=5,"NOT_ALL_GENERIC_WRITERS_GUARDED")
 run(["docker","run","-d","--rm","--name",NAME,"--network","none",
  "--memory","384m","--cpus","1","-e","POSTGRES_DB=postgres",
  "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"])
 try:
  ready=False
  # Cold CI image startup may take longer than warm VPS startup.
  # Keep all assertions identical; only the bounded readiness poll changes.
  for _ in range(90):
   r=psql("SELECT 1;",True)
   if r.returncode==0 and r.stdout.strip()=="1":ready=True;break
   time.sleep(.3)
  require(ready,"DISPOSABLE_POSTGRES_NOT_READY")
  psql("""CREATE SCHEMA ai_platform;
   CREATE TABLE ai_platform.ai_jobs(
     id integer PRIMARY KEY,status text NOT NULL,
     job_type text NOT NULL,payload_json jsonb NOT NULL);
   CREATE ROLE aicore_dev_runtime NOLOGIN NOINHERIT NOBYPASSRLS;
   CREATE ROLE synthetic_generic_queue_actor NOLOGIN NOINHERIT NOBYPASSRLS;
   GRANT USAGE ON SCHEMA ai_platform TO aicore_dev_runtime,synthetic_generic_queue_actor;
   GRANT SELECT ON ai_platform.ai_jobs TO aicore_dev_runtime,synthetic_generic_queue_actor;
   GRANT UPDATE(status) ON ai_platform.ai_jobs TO aicore_dev_runtime,synthetic_generic_queue_actor;
   ALTER TABLE ai_platform.ai_jobs ENABLE ROW LEVEL SECURITY;
   ALTER TABLE ai_platform.ai_jobs FORCE ROW LEVEL SECURITY;
   -- Mirror existing CST-DEV role boundaries in a minimal nonproduction schema:
   -- the shared role has UPDATE only for coding workstream, not model pilot.
   CREATE POLICY existing_dev_shared_coding_read ON ai_platform.ai_jobs
     FOR SELECT TO aicore_dev_runtime
     USING (job_type='coding_workstream_execution');
   CREATE POLICY existing_dev_shared_coding_update ON ai_platform.ai_jobs
     FOR UPDATE TO aicore_dev_runtime
     USING (job_type='coding_workstream_execution'
       AND status IN ('queued','waiting','retrying'))
     WITH CHECK (job_type='coding_workstream_execution' AND status='failed');
   -- Separate TEST-ONLY generic actor demonstrates that the source-level
   -- predicate protects the pilot even under otherwise broad update grants.
   CREATE POLICY generic_actor_select ON ai_platform.ai_jobs
     FOR SELECT TO synthetic_generic_queue_actor USING (true);
   CREATE POLICY generic_actor_update ON ai_platform.ai_jobs
     FOR UPDATE TO synthetic_generic_queue_actor USING (true) WITH CHECK (true);
   INSERT INTO ai_platform.ai_jobs VALUES
    (482,'completed','ollama_model_invocation',
      jsonb_build_object('requestId','cst-ai-team-company1-dev:pilot-historical482')),
    (483,'waiting','ollama_model_invocation',
      jsonb_build_object('requestId','cst-ai-team-company1-dev:pilot-aaaaaaaaaaaaaaaaaaaa')),
    (484,'waiting','coding_workstream_execution',
      jsonb_build_object('requestId','normal-coding-work')),
    (485,'queued','coding_workstream_execution',
      jsonb_build_object('requestId','normal-previously-queued'));""")
  guarded="""BEGIN;
    SET LOCAL ROLE synthetic_generic_queue_actor;
    UPDATE ai_platform.ai_jobs SET status='queued'
      WHERE status='waiting'
       AND COALESCE(payload_json->>'requestId','') NOT LIKE
         'cst-ai-team-company1-dev:pilot-%'
      RETURNING id::text||'|'||status;
    ROLLBACK;"""
  # Rollback first to show the exact set from a dry-run:
  output=psql(guarded).stdout.strip()
  require(output=="484|queued","GUARDED_QUEUE_RESUME_SELECTED_PILOT_OR_MISSED_NORMAL:"+output)
  # Apply the same query; only ordinary code is advanced.
  applied=psql("""SET ROLE synthetic_generic_queue_actor;
    UPDATE ai_platform.ai_jobs SET status='queued'
      WHERE status='waiting'
        AND COALESCE(payload_json->>'requestId','') NOT LIKE
          'cst-ai-team-company1-dev:pilot-%'
      RETURNING id::text||'|'||status;""").stdout.strip()
  require(applied=="484|queued","GENERIC_RESUME_RESULT_NOT_EXACT_NORMAL_JOB:"+applied)
  # Shared runtime coding worker path can still complete coding work.
  coding=psql("""SET ROLE aicore_dev_runtime;
    UPDATE ai_platform.ai_jobs SET status='failed'
      WHERE id=485 AND status='queued'
      RETURNING id::text||'|'||status;""").stdout.strip()
  require(coding=="485|failed","EXISTING_CODING_WORKFLOW_CHANGED:"+coding)
  # A direct attempt to promote a model pilot is filtered by baseline RLS.
  blocked=psql("""SET ROLE aicore_dev_runtime;
    UPDATE ai_platform.ai_jobs SET status='queued' WHERE id=483
    RETURNING id;""").stdout.strip()
  require(blocked=="","CSTDEV_BASELINE_SIMULATION_PILOT_PROMOTION_ALLOWED")
  # Even if a future generic actor had more privileges, the new source
  # exclusion blocks the reserved pilot. Without exclusion it WOULD match.
  protected=psql("""SET ROLE synthetic_generic_queue_actor;
    UPDATE ai_platform.ai_jobs SET status='queued'
      WHERE id=483 AND COALESCE(payload_json->>'requestId','')
           NOT LIKE 'cst-ai-team-company1-dev:pilot-%'
      RETURNING id;""").stdout.strip()
  require(protected=="","GENERIC_UPDATE_PILOT_EXCLUSION_FAILED")
  baseline=psql("""SELECT string_agg(id::text||'|'||status,',' ORDER BY id)
    FROM ai_platform.ai_jobs;""").stdout.strip()
  require(baseline=="482|completed,483|waiting,484|queued,485|failed",
   "PILOT_OR_HISTORICAL_JOB_STATE_DRIFT:"+baseline)
  # Negative demonstration is ROLLED BACK and does not grant authority.
  could_without_guard=psql("""BEGIN;
    SET LOCAL ROLE synthetic_generic_queue_actor;
    UPDATE ai_platform.ai_jobs SET status='queued'
      WHERE id=483 RETURNING id;
    ROLLBACK;""").stdout.strip()
  require(could_without_guard=="483",
    "SYNTHETIC_BROAD_ACTOR_NEGATIVE_CONTROL_NOT_EXERCISED")
  require(psql("SELECT status FROM ai_platform.ai_jobs WHERE id=483;").stdout.strip()=="waiting",
    "NEGATIVE_CONTROL_NOT_ROLLED_BACK")
  print("GENERIC_ONEJOB_QUEUE_SQL_DISPOSABLE_PASS "+json.dumps({
   "env":"postgres16_network_none","realDevChanged":False,"prodChanged":False,
   "existingHistoricalPilot482":"completed_unchanged",
   "protectedNewPilot483":"waiting_unchanged",
   "ordinaryResume484":"queued",
   "existingCodingRecovery485":"failed",
   "baselineSharedRolePilotUpdate":"DENIED",
   "syntheticBroadRoleWithSourceGuard":"DENIED",
   "withoutSourceGuardNegativeControl":"WOULD_PROMOTE_ROLLED_BACK",
   "signersActivated":False,"ownerApprovalCreated":False,
   "releaseDecision":"NO_GO"},sort_keys=True))
 finally:run(["docker","rm","-f",NAME],allow=True)
if __name__=="__main__":
 try:main()
 except Exception as e:
  print("GENERIC_ONEJOB_QUEUE_SQL_DISPOSABLE_FAIL "+str(e)[:230])
  sys.exit(2)
