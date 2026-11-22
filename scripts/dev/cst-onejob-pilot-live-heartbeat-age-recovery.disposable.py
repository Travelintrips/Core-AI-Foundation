#!/usr/bin/env python3
"""Gate A DEV pilot: real PostgreSQL 16 age-recovery predicate, network none."""
import json,os,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
API=ROOT/"artifacts/api-server"
NAME="cst-pilot-live-recovery-qa-"+str(os.getpid())
NODE=r"""
import {sql} from "drizzle-orm";
import {PgDialect} from "drizzle-orm/pg-core";
import {excludeHealthyCstDevPilotFromAgeOnlyRecovery as guard} from "./src/lib/cstOneJobLiveWorkerRecoveryPredicate.ts";
const env={APP_ENV:process.argv[1],NODE_ENV:process.argv[2],
 CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED:process.argv[1]==="development" && process.argv[2]==="development"?"true":"false"};
const query=new PgDialect().sqlToQuery(sql\`
 SELECT id FROM ai_platform.ai_jobs
 WHERE status = 'running'
   AND started_at < NOW() - INTERVAL '10 minutes'
   @{guard(env)}
 ORDER BY id FOR UPDATE SKIP LOCKED\`);
if(query.params.length)throw new Error("UNEXPECTED_SQL_PARAMETERS");
console.log(query.sql);
"""
def run(argv,input=None,allow_failure=False,timeout=45,cwd=None):
    p=subprocess.run(argv,input=input,text=True,capture_output=True,timeout=timeout,cwd=cwd)
    if p.returncode and not allow_failure:
        raise RuntimeError("QA_COMMAND_"+str(argv[0])+"_EXIT_"+str(p.returncode)+"_"+p.stderr[-200:])
    return p
def query(sql):
    p=run(["docker","exec","-i",NAME,"psql","-X","-qAt","-v","ON_ERROR_STOP=1",
           "-U","postgres","-d","postgres"],input=sql)
    return [x.strip() for x in p.stdout.splitlines() if x.strip()]
def render(app_env,node_env):
    js=NODE.replace(chr(92)+chr(96),chr(96)).replace("@{","$"+"{")
    out=run(["node","--experimental-strip-types","--input-type=module","-e",
             js,app_env,node_env],cwd=API)
    return out.stdout.strip()
def check_rows(actual,expected,label):
    if actual!=expected:
        raise RuntimeError("QA_"+label+"_EXPECTED_"+str(expected)+"_GOT_"+str(actual))
def main():
    run(["docker","run","-d","--rm","--network","none","--name",NAME,
         "--memory","384m","--cpus","1",
         "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"],timeout=90)
    try:
        for _ in range(100):
            ready=run(["docker","exec",NAME,"psql","-X","-qAt","-U","postgres",
               "-d","postgres","-c","SELECT 1"],allow_failure=True)
            if ready.returncode==0 and ready.stdout.strip()=="1":break
            time.sleep(.2)
        else:raise RuntimeError("QA_PG16_NOT_READY")
        query("""
          CREATE SCHEMA ai_platform;
          CREATE TABLE ai_platform.ai_jobs(
             id int PRIMARY KEY,status text,started_at timestamptz,
             job_type text,payload_json jsonb);
          CREATE TABLE ai_platform.ai_workers(
             id int PRIMARY KEY,current_job int,running_jobs int,
             worker_name text,provider_slug text,runtime_kind text,
             model_id text,lease_owner text,node_id text,status text,
             lease_expires_at timestamptz,last_heartbeat timestamptz);
          INSERT INTO ai_platform.ai_jobs VALUES
           (1,'running',NOW()-INTERVAL '20 minutes','ollama_model_invocation',
              '{"requestId":"cst-ai-team-company1-dev:pilot-aaaaaaaaaaaaaaaaaaaa","_claimedByWorkerId":"1"}'),
           (2,'running',NOW()-INTERVAL '20 minutes','ollama_model_invocation',
              '{"requestId":"unrelated-job","_claimedByWorkerId":"1"}');
          INSERT INTO ai_platform.ai_workers VALUES
           (1,1,1,'cst-dev-dell-onejob-20261122-abcdef12','ollama',
              'ollama_remote_pull','qwen2.5:3b','ollama-remote:qa','qa',
              'busy',NOW()+INTERVAL '1 minute',NOW());
        """)
        dev=render("development","development")
        prod=render("production","production")
        check_rows(query(dev),["2"],"20MIN_LIVE_PILOT_NOT_FAILED")
        check_rows(query(prod),["1","2"],"PROD_PATH_NOT_CHANGED")
        query("UPDATE ai_platform.ai_workers SET last_heartbeat=NOW()-INTERVAL '90 seconds' WHERE id=1;")
        check_rows(query(dev),["1","2"],"STALE_HEARTBEAT_RECOVERED")
        query("UPDATE ai_platform.ai_workers SET last_heartbeat=NOW(),lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=1;")
        check_rows(query(dev),["1","2"],"EXPIRED_LEASE_RECOVERED")
        query("UPDATE ai_platform.ai_workers SET lease_expires_at=NOW()+INTERVAL '1 minute',status='offline' WHERE id=1;")
        check_rows(query(dev),["1","2"],"OFFLINE_WORKER_RECOVERED")
        print("CST_DEV_PILOT_LIVE_HEARTBEAT_AGE_PG16_PASS "+json.dumps({
           "disposableDb":True,"network":"none","jobAgeMinutes":20,
           "healthyPilotNotFailedByAge":True,"staleHeartbeatRecoverable":True,
           "expiredLeaseRecoverable":True,"offlineWorkerRecoverable":True,
           "unrelatedJobRecoverable":True,"prodBehaviorUnchanged":True,
           "actualSourceSqlRendered":True,"realCstDevTouched":False,
           "prodTouched":False,"operationalDecision":"NO_GO"},sort_keys=True))
    finally:
        run(["docker","rm","-f",NAME],allow_failure=True,timeout=30)
if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("CST_DEV_PILOT_LIVE_HEARTBEAT_AGE_PG16_FAIL "+str(exc)[:180],flush=True)
        sys.exit(2)
