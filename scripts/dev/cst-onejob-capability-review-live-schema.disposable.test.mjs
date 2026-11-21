import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";

const root=new URL("../../",import.meta.url);
const read=p=>readFileSync(new URL(p,root),"utf8");
const name="cst-onejob-review-live-mirror-"+process.pid;
const db="cst_onejob_capability_disposable";
const allowGuardStrip=s=>{
  const regex=/-- CST_ONEJOB_REVIEW_ONLY_GUARD_BEGIN[\s\S]*?-- CST_ONEJOB_REVIEW_ONLY_GUARD_END\n/;
  assert.match(s,regex,"REVIEW_GUARD_MUST_EXIST_IN_DISTRIBUTED_SQL");
  return s.replace(regex,"-- GUARD STRIPPED ONLY INSIDE DISPOSABLE TEST\n");
};
const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
function run(args,input,allowFail=false){
 const p=spawnSync(args[0],args.slice(1),{input,encoding:"utf8",timeout:25000});
 if(p.error)throw p.error;
 if(p.status!==0&&!allowFail)throw Error("ISOLATED_SQL_FAILED:"+(
   p.stderr||p.stdout).slice(-2200));
 return p;
}
const sql=(q,allowFail=false)=>run([
 "docker","exec","-i",name,"psql","-X","-qAt","-v","ON_ERROR_STOP=1",
 "-U","postgres","-d",db
],q,allowFail);

test("review-only migration and rollback deny execution even in disposable database",()=>{
 const review=read("docs/dev/cst-onejob-admission-capability.REVIEW-ONLY.sql");
 const rollback=read("docs/dev/cst-onejob-admission-capability.ROLLBACK-REVIEW-ONLY.sql");
 assert.match(review,/CST_DEV_ADMISSION_CAPABILITY_NOT_AUTHORIZED_REVIEW_ONLY/);
 assert.match(rollback,/CST_DEV_ADMISSION_CAPABILITY_ROLLBACK_NOT_AUTHORIZED_REVIEW_ONLY/);
 assert.match(review,/CREATE ROLE cst_onejob_admission_executor\s+NOLOGIN/);
 assert.match(review,/SECURITY DEFINER[\s\S]*?SET search_path=pg_catalog,pg_temp/);
 assert.match(review,/REVOKE ALL ON FUNCTION[\s\S]*?admit_verified_onejob_capability/);
 assert.doesNotMatch(review,/CREATE ROLE cst_onejob_broker_login/);
 assert.doesNotMatch(review,/GRANT UPDATE[^;]+TO cst_onejob_admission_broker/s);
 assert.doesNotMatch(review,/ALTER TABLE\s+ai_platform\.(ai_jobs|internal_users)/);
 assert.doesNotMatch(review,/ALTER ROLE|PASSWORD|SUPABASE_PROD_DATABASE_URL/);
 assert.match(rollback,/DROP ROLE cst_onejob_admission_executor/);
 assert.match(rollback,/ROLLBACK_REQUIRES_INDEPENDENT_RECEIPT_RECONCILIATION/);
});
test("PG16 network-none: live schema mirror, denied default, reviewed exact SQL, rollback and replay",{
 timeout:110000
},async t=>{
 run(["docker","run","-d","--rm","--name",name,"--network","none",
  "--memory","384m","--cpus","1","-e","POSTGRES_DB="+db,
  "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"]);
 t.after(()=>run(["docker","rm","-f",name],undefined,true));
 let ready=false;
 for(let n=0;n<70;n++){
   const r=sql("SELECT 1;",true);
   if(r.status===0&&r.stdout.trim()==="1"){ready=true;break}
   await delay(250);
 }
 assert.ok(ready,"ISOLATED_POSTGRES_UNAVAILABLE");
 sql("CREATE SCHEMA ai_platform; CREATE SCHEMA cst_onejob_private;"+
   "CREATE TABLE ai_platform.internal_users(id int PRIMARY KEY,role text,"+
   "status text,account_type text,password_hash text);"+
   "CREATE TABLE ai_platform.ai_jobs(id int PRIMARY KEY,status text,job_type text,"+
   "required_capability text,max_retry int,payload_json jsonb);"+
   "CREATE TABLE ai_platform.ai_audit_logs(id bigserial PRIMARY KEY,module text,"+
   "action text,resource_type text,resource_id text,status text,details jsonb);"+
   "ALTER TABLE ai_platform.internal_users ENABLE ROW LEVEL SECURITY;"+
   "ALTER TABLE ai_platform.ai_jobs ENABLE ROW LEVEL SECURITY;"+
   "ALTER TABLE ai_platform.ai_audit_logs ENABLE ROW LEVEL SECURITY;");
 sql(read("docs/dev/cst-onejob-owner-approval.PROPOSED.sql"));
 sql(read("docs/dev/cst-onejob-independent-receipts.PROPOSED.sql"));
 sql(read("docs/dev/cst-onejob-broker-operational.CANDIDATE.sql"));
 sql("CREATE ROLE cst_onejob_admission_broker NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;"+
   "CREATE ROLE cst_onejob_broker_login NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;"+
   "GRANT cst_onejob_admission_broker TO cst_onejob_broker_login "+
   "WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;");
 const review=read("docs/dev/cst-onejob-admission-capability.REVIEW-ONLY.sql");
 const rollback=read("docs/dev/cst-onejob-admission-capability.ROLLBACK-REVIEW-ONLY.sql");
 const denied=sql(review,true);
 assert.notEqual(denied.status,0);
 assert.match(denied.stderr,/CST_DEV_ADMISSION_CAPABILITY_NOT_AUTHORIZED_REVIEW_ONLY/);
 assert.equal(sql("SELECT count(*) FROM pg_roles WHERE rolname='cst_onejob_admission_executor';").stdout.trim(),"0");
 sql(allowGuardStrip(review));
 const rights=sql("SELECT has_table_privilege('cst_onejob_admission_broker',"+
   "'ai_platform.ai_jobs','UPDATE'),"+
   "has_table_privilege('cst_onejob_admission_broker','ai_platform.ai_jobs','SELECT'),"+
   "has_function_privilege('cst_onejob_admission_broker',"+
   "'cst_onejob_private.admit_verified_onejob_capability(integer,text,text)','EXECUTE'),"+
   "pg_has_role('cst_onejob_broker_login','cst_onejob_admission_executor','MEMBER');"
 ).stdout.trim();
 assert.equal(rights,"f|f|t|f");
 assert.equal(sql("SELECT rolcanlogin,rolbypassrls,rolconnlimit FROM pg_roles "+
   "WHERE rolname='cst_onejob_admission_executor';").stdout.trim(),"f|f|0");

 const beforeRollback=sql(rollback,true);
 assert.notEqual(beforeRollback.status,0);
 assert.match(beforeRollback.stderr,/CST_DEV_ADMISSION_CAPABILITY_ROLLBACK_NOT_AUTHORIZED_REVIEW_ONLY/);
 sql(allowGuardStrip(rollback));
 assert.equal(sql("SELECT count(*) FROM pg_roles WHERE rolname='cst_onejob_admission_executor';").stdout.trim(),"0");
 assert.equal(sql("SELECT to_regprocedure("+
   quote("cst_onejob_private.admit_verified_onejob_capability(integer,text,text)")+
   ") IS NULL;").stdout.trim(),"t");
 // Re-application is permitted in a fresh isolated test context after relock.
 sql(allowGuardStrip(review));

 const approvalId="123e4567-e89b-12d3-a456-426614174000";
 const requestId="cst-ai-team-company1-dev:pilot-"+"b".repeat(20);
 const worker="cst-dev-dell-onejob-20261121-abcdef12";
 const nonce="c".repeat(64),digest="d".repeat(64);
 sql("INSERT INTO ai_platform.internal_users VALUES(1,'owner','active','internal','DUMMY_NOT_REAL');"+
   "INSERT INTO ai_platform.ai_jobs VALUES(483,'waiting','ollama_model_invocation',"+
   "'ollama_inference',0,jsonb_build_object('requestId',"+quote(requestId)+
   ",'modelId','qwen2.5:3b'));"+
   "INSERT INTO ai_platform.cst_onejob_owner_approvals "+
   "(id,purpose,status,company_id,model_id,approved_by_user_id,request_id,"+
   "worker_name,source_sha,job_id,approved_at,expires_at) VALUES("+
   quote(approvalId)+",'CST_DEV_ONEJOB_MODEL','APPROVED','1','qwen2.5:3b',1,"+
   quote(requestId)+","+quote(worker)+",repeat('a',40),483,"+
   "now()-interval '2 minutes',now()+interval '18 minutes');");

 const admit=(n=nonce,d=digest)=>
   "SET SESSION AUTHORIZATION cst_onejob_broker_login;"+
   "SET ROLE cst_onejob_admission_broker;"+
   "SELECT cst_onejob_private.admit_verified_onejob_capability(483,"+
   quote(n)+","+quote(d)+");";
 const missing=sql(admit(),true);
 assert.notEqual(missing.status,0);
 assert.match(missing.stderr,/ONEJOB_SIGNED_ADMISSION_NOT_BOUND/);

 sql("INSERT INTO cst_onejob_private.verified_admission_receipts "+
   "(approval_id,job_id,company_id,request_id,worker_name,image_source_sha,image_id,"+
   "isolated_network_verified,scoped_dev_role_verified,event_audit_path_verified,"+
   "subscriber_path_verified,independent_qa_available,nonce,proof_digest,verifier_id,"+
   "verified_at,expires_at) VALUES("+quote(approvalId)+",483,'1',"+
   quote(requestId)+","+quote(worker)+",repeat('a',40),'sha256:'||repeat('f',64),"+
   "true,true,true,true,true,"+quote(nonce)+","+quote(digest)+
   ",'cst-independent-qa-disposableonly',now()-interval '1 minute',now()+interval '3 minutes');");
 const wrong=sql(admit("f".repeat(64)),true);
 assert.notEqual(wrong.status,0);
 const initial=sql("SELECT status FROM ai_platform.ai_jobs WHERE id=483;").stdout.trim();
 assert.equal(initial,"waiting");
 const accepted=sql(admit());
 assert.equal(accepted.stdout.trim(),"483");
 const result=sql("SELECT "+
   "(SELECT status FROM ai_platform.ai_jobs WHERE id=483),"+
   "(SELECT status FROM ai_platform.cst_onejob_owner_approvals WHERE job_id=483),"+
   "(SELECT count(*) FROM cst_onejob_private.admission_receipt_consumptions),"+
   "(SELECT count(*) FROM cst_onejob_private.admission_event_outbox);").stdout.trim();
 assert.equal(result,"queued|CONSUMED|1|1");
 assert.notEqual(sql(admit(),true).status,0,"REPLAY_WAS_ADMITTED");
 const cannotRollback=sql(allowGuardStrip(rollback),true);
 assert.notEqual(cannotRollback.status,0);
 assert.match(cannotRollback.stderr,/ROLLBACK_REQUIRES_INDEPENDENT_RECEIPT_RECONCILIATION/);
 assert.equal(sql("SELECT count(*) FROM pg_roles WHERE rolname='cst_onejob_admission_executor';").stdout.trim(),"1");
});
