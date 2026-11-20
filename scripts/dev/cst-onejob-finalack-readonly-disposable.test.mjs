import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
import {SOURCE_SNAPSHOT_SQL} from "./cst-onejob-final-ack-candidate.mjs";
const name="cst-onejob-finalack-readonly-"+process.pid;
const database="cst_onejob_finalack_readonly";
const root=new URL("../../",import.meta.url);
const Q=x=>"'"+String(x).replaceAll("'","''")+"'";
function command(args,input,allowFailure=false){
  const r=spawnSync(args[0],args.slice(1),{input,encoding:"utf8",timeout:25000});
  if(r.error)throw r.error;
  if(r.status!==0&&!allowFailure)
    throw Error("POSTGRES_SQL_FAILURE:"+(r.stderr||r.stdout).slice(-1200));
  return r;
}
const sql=(statement,allowFailure=false)=>command(
  ["docker","exec","-i",name,"psql","-X","-qAt",
   "-v","ON_ERROR_STOP=1","-U","postgres","-d",database],
  statement,allowFailure
);
test("real final ACK source snapshot works under SELECT-only privileges without granting UPDATE",{
  timeout:90000
},async t=>{
  command(["docker","run","-d","--rm","--name",name,
    "--network","none","--memory","384m","--cpus","1",
    "-e","POSTGRES_DB="+database,
    "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"]);
  t.after(()=>command(["docker","rm","-f",name],undefined,true));
  let ready=false;
  for(let i=0;i<70;i++){
    const p=sql("SELECT 1;",true);
    if(p.status===0&&p.stdout.trim()==="1"){ready=true;break;}
    await delay(300);
  }
  assert.ok(ready,"NETWORK_NONE_POSTGRES_NOT_READY");
  const approval="123e4567-e89b-12d3-a456-426614174000";
  const event="123e4567-e89b-12d3-a456-426614174001";
  const delivery="123e4567-e89b-12d3-a456-426614174002";
  const correlation="123e4567-e89b-12d3-a456-426614174003";
  const request="cst-ai-team-company1-dev:pilot-"+"b".repeat(20);
  const worker="cst-dev-dell-onejob-20261119-abcdef12";
  sql("CREATE SCHEMA ai_platform;"+
    "CREATE TABLE ai_platform.ai_jobs("+
      "id integer PRIMARY KEY,status text,job_type text,payload_json jsonb,result_json jsonb);"+
    "CREATE TABLE ai_platform.cst_onejob_owner_approvals("+
      "id uuid PRIMARY KEY,job_id integer REFERENCES ai_platform.ai_jobs(id),"+
      "company_id text,model_id text,request_id text,worker_name text,"+
      "source_sha text,status text,consumed_at timestamptz);"+
    "CREATE TABLE ai_platform.ai_events("+
      "id integer PRIMARY KEY,event_id text,event_type text,source_module text,"+
      "source_id text,correlation_id text,status text,payload_json jsonb);"+
    "CREATE TABLE ai_platform.ai_audit_logs("+
      "id integer PRIMARY KEY,module text,action text,resource_id text,"+
      "status text,details jsonb);"+
    "CREATE SCHEMA cst_onejob_private;"+
    "CREATE TABLE cst_onejob_private.verified_admission_receipts("+
      "approval_id uuid,job_id integer,company_id text,request_id text,"+
      "worker_name text,image_source_sha text,image_id text,"+
      "nonce text,proof_digest text,consumed_at timestamptz);");
  const proposed=readFileSync(new URL(
    "docs/dev/cst-onejob-postexecution-ledgers.PROPOSED.sql",root),"utf8");
  sql(proposed);
  sql("INSERT INTO ai_platform.ai_jobs VALUES"+
    "(483,'completed','ollama_model_invocation',"+
      "jsonb_build_object('requestId',"+Q(request)+",'modelId','qwen2.5:3b'),"+
      "jsonb_build_object('output',jsonb_build_object('type','text','text',"+
        "'CST_DEV_ONEJOB_PROBE_OK')));"+
    "INSERT INTO ai_platform.cst_onejob_owner_approvals VALUES("+
      Q(approval)+",483,'1','qwen2.5:3b',"+Q(request)+","+
      Q(worker)+",repeat('a',40),'CONSUMED',now());"+
    "INSERT INTO cst_onejob_private.verified_admission_receipts VALUES("+
      Q(approval)+",483,'1',"+Q(request)+","+Q(worker)+","+
      "repeat('a',40),'sha256:'||repeat('f',64),"+
      "repeat('c',64),repeat('d',64),now());"+
    "INSERT INTO ai_platform.ai_events VALUES(1,"+Q(event)+","+
      "'job.completed','job-engine','483',"+Q(correlation)+","+
      "'processed',jsonb_build_object('jobId',483,'jobType','ollama_model_invocation'));"+
    "INSERT INTO ai_platform.ai_audit_logs VALUES(1,'event-bus','event_published',"+
      Q(event)+",'success',jsonb_build_object('eventType','job.completed',"+
      "'correlationId',"+Q(correlation)+"));"+
    "INSERT INTO cst_onejob_private.subscriber_delivery_receipts"+
    "(approval_id,job_id,event_id,delivery_id,subscriber_id,correlation_id,"+
    "delivery_digest,status,ack_nonce,ack_signature_base64,ack_issuer_fingerprint,received_at)"+
    "VALUES("+Q(approval)+",483,"+Q(event)+","+Q(delivery)+","+
      "'cst-onejob-subscriber-pilot',"+Q(correlation)+","+
      "repeat('e',64),'ACKNOWLEDGED',repeat('f',64),"+
      Q(Buffer.alloc(64,11).toString("base64"))+",repeat('a',64),now());");
  sql("CREATE ROLE cst_onejob_finalack_readonly NOLOGIN NOINHERIT;"+
    "GRANT USAGE ON SCHEMA ai_platform,cst_onejob_private TO cst_onejob_finalack_readonly;"+
    "GRANT SELECT ON ALL TABLES IN SCHEMA ai_platform TO cst_onejob_finalack_readonly;"+
    "GRANT SELECT ON cst_onejob_private.verified_admission_receipts,"+
      "cst_onejob_private.subscriber_delivery_receipts TO cst_onejob_finalack_readonly;"+
    "CREATE POLICY cst_onejob_finalack_test_select ON"+
      " cst_onejob_private.subscriber_delivery_receipts"+
      " FOR SELECT TO cst_onejob_finalack_readonly USING (job_id=483);");
  // Approval/job/event/audit/receipt SELECT is all this reader has.
  for(const path of [
    "ai_platform.ai_jobs","ai_platform.cst_onejob_owner_approvals",
    "ai_platform.ai_events","ai_platform.ai_audit_logs",
    "cst_onejob_private.verified_admission_receipts",
    "cst_onejob_private.subscriber_delivery_receipts"
  ]){
    assert.equal(sql("SELECT has_table_privilege('cst_onejob_finalack_readonly',"+
      Q(path)+",'UPDATE');").stdout.trim(),"f","SOURCE_UPDATE_GRANTED:"+path);
  }
  assert.doesNotMatch(SOURCE_SNAPSHOT_SQL,/\bFOR (UPDATE|SHARE|KEY SHARE|NO KEY UPDATE)\b/i);
  const rendered=SOURCE_SNAPSHOT_SQL.replaceAll("$1","483").replaceAll("$2",Q(event));
  const success=sql("SET ROLE cst_onejob_finalack_readonly;"+
    "BEGIN ISOLATION LEVEL SERIALIZABLE;"+
    "SELECT pg_advisory_xact_lock(20261120,483);"+
    rendered+"; ROLLBACK;");
  assert.match(success.stdout,/CST_DEV_ONEJOB_PROBE_OK/);
  assert.match(success.stdout,/cst-onejob-subscriber-pilot/);
  assert.equal(sql("SET ROLE cst_onejob_finalack_readonly;"+
    SOURCE_SNAPSHOT_SQL.replaceAll("$1","483").replaceAll("$2",Q(delivery))+
    ";").stdout.trim(),"","WRONG_EVENT_MATCHED");
  const denied=sql("SET ROLE cst_onejob_finalack_readonly;"+
    "SELECT id FROM ai_platform.ai_jobs WHERE id=483 FOR UPDATE;",true);
  assert.notEqual(denied.status,0,"SOURCE_FOR_UPDATE_SUCCEEDED_WITHOUT_GRANT");
  assert.match(denied.stderr,/permission denied/i);
});
