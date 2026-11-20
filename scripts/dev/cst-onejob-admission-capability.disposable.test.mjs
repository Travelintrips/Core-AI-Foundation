import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawn,spawnSync} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
const root=new URL("../../",import.meta.url);
const read=p=>readFileSync(new URL(p,root),"utf8");
const container="cst-onejob-capability-disposable-"+process.pid;
const db="cst_onejob_capability_disposable";
const Q=x=>"'"+String(x).replaceAll("'","''")+"'";
function run(args,input,allow=false){
  const p=spawnSync(args[0],args.slice(1),{input,encoding:"utf8",timeout:25000});
  if(p.error)throw p.error;
  if(p.status!==0&&!allow)throw Error("TEST_COMMAND_FAIL:"+(p.stderr||p.stdout).slice(-1000));
  return p;
}
function sql(q,allow=false){
  return run(["docker","exec","-i",container,"psql","-X","-qAt",
    "-v","ON_ERROR_STOP=1","-U","postgres","-d",db],q,allow);
}
function queryAsync(q){
  return new Promise((resolve,reject)=>{
    const c=spawn("docker",["exec","-i",container,"psql","-X","-qAt",
      "-v","ON_ERROR_STOP=1","-U","postgres","-d",db],{stdio:["pipe","pipe","pipe"]});
    let stdout="",stderr="";
    const timeout=setTimeout(()=>c.kill("SIGKILL"),25000);
    c.stdout.setEncoding("utf8");c.stderr.setEncoding("utf8");
    c.stdout.on("data",x=>stdout+=x);c.stderr.on("data",x=>stderr+=x);
    c.on("error",e=>{clearTimeout(timeout);reject(e)});
    c.on("close",status=>{clearTimeout(timeout);resolve({status,stdout,stderr})});
    c.stdin.end(q);
  });
}
const nonce="c".repeat(64),digest="d".repeat(64);
const admission=(n=nonce,d=digest)=>
  "SET SESSION AUTHORIZATION cst_onejob_broker_login;"+
  "SET ROLE cst_onejob_admission_broker;"+
  "SELECT cst_onejob_private.admit_verified_onejob_capability(483,"+Q(n)+","+Q(d)+");";
const state=()=>sql("SELECT (SELECT status FROM ai_platform.ai_jobs WHERE id=483),"+
  "(SELECT status FROM ai_platform.cst_onejob_owner_approvals WHERE job_id=483),"+
  "(SELECT count(*) FROM cst_onejob_private.admission_receipt_consumptions),"+
  "(SELECT count(*) FROM cst_onejob_private.admission_event_outbox),"+
  "(SELECT count(*) FROM ai_platform.ai_audit_logs),"+
  "(SELECT consumed_at IS NULL FROM cst_onejob_private.verified_admission_receipts WHERE job_id=483);"
).stdout.trim();

test("network-none PostgreSQL: non-bypassable narrow executor capability, trusted PRE receipt fixture, audit rollback and replay",{
  timeout:90000
},async t=>{
  run(["docker","run","-d","--rm","--name",container,"--network","none",
    "--memory","384m","--cpus","1","-e","POSTGRES_DB="+db,
    "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"]);
  t.after(()=>run(["docker","rm","-f",container],undefined,true));
  let ready=false;
  for(let i=0;i<70;i++){
    const p=sql("SELECT 1;",true);
    if(p.status===0&&p.stdout.trim()==="1"){ready=true;break}
    await delay(300);
  }
  assert.ok(ready,"ISOLATED_POSTGRES_UNAVAILABLE");
  const id="123e4567-e89b-12d3-a456-426614174000";
  const req="cst-ai-team-company1-dev:pilot-"+"b".repeat(20);
  const worker="cst-dev-dell-onejob-20261119-abcdef12";
  sql("CREATE SCHEMA ai_platform; CREATE SCHEMA cst_onejob_private;"+
    "CREATE TABLE ai_platform.internal_users(id int PRIMARY KEY,role text,status text,account_type text,password_hash text);"+
    "CREATE TABLE ai_platform.ai_jobs(id int PRIMARY KEY,status text,job_type text,required_capability text,max_retry int,payload_json jsonb);"+
    "CREATE TABLE ai_platform.ai_audit_logs(id bigserial PRIMARY KEY,module text,action text,resource_type text,resource_id text,status text,details jsonb);"+
    "INSERT INTO ai_platform.internal_users VALUES(1,'owner','active','internal');"+
    "INSERT INTO ai_platform.ai_jobs VALUES(483,'waiting','ollama_model_invocation','ollama_inference',0,"+
    "jsonb_build_object('requestId',"+Q(req)+",'modelId','qwen2.5:3b'));");
  sql(read("docs/dev/cst-onejob-owner-approval.PROPOSED.sql"));
  sql(read("docs/dev/cst-onejob-independent-receipts.PROPOSED.sql"));
  sql(read("docs/dev/cst-onejob-broker-operational.CANDIDATE.sql"));
  sql("INSERT INTO ai_platform.cst_onejob_owner_approvals"+
    "(id,purpose,status,company_id,model_id,approved_by_user_id,request_id,worker_name,source_sha,job_id,approved_at,expires_at)"+
    " VALUES("+Q(id)+",'CST_DEV_ONEJOB_MODEL','APPROVED','1','qwen2.5:3b',1,"+
    Q(req)+","+Q(worker)+",repeat('a',40),483,now()-interval '2 minutes',now()+interval '18 minutes');"+
    "INSERT INTO cst_onejob_private.verified_admission_receipts"+
    "(approval_id,job_id,company_id,request_id,worker_name,image_source_sha,image_id,"+
    "isolated_network_verified,scoped_dev_role_verified,event_audit_path_verified,"+
    "subscriber_path_verified,independent_qa_available,nonce,proof_digest,verifier_id,verified_at,expires_at)"+
    " VALUES("+Q(id)+",483,'1',"+Q(req)+","+Q(worker)+","+
    "repeat('a',40),'sha256:'||repeat('f',64),true,true,true,true,true,"+
    Q(nonce)+","+Q(digest)+",'cst-independent-qa-disposableonly',"+
    "now()-interval '1 minute',now()+interval '3 minutes');");
  sql("SET cst.onejob_disposable_only = 'true';"+
      read("docs/dev/cst-onejob-admission-capability.DISPOSABLE-ONLY.sql"));
  const separation=sql("SELECT pg_has_role('cst_onejob_broker_login',"+
    "'cst_onejob_admission_executor','MEMBER'),"+
    "has_table_privilege('cst_onejob_admission_broker',"+
    "'ai_platform.ai_jobs','UPDATE'),"+
    "has_function_privilege('cst_onejob_admission_broker',"+
    "'cst_onejob_private.admit_verified_onejob_capability(integer,text,text)',"+
    "'EXECUTE');").stdout.trim();
  assert.equal(separation,"f|f|t","EXECUTOR_MEMBERSHIP_OR_RAW_DML_LEAK");
  const secretRead=sql("SET ROLE cst_onejob_admission_executor; "+
    "SELECT password_hash FROM ai_platform.internal_users WHERE id=1;",true);
  assert.notEqual(secretRead.status,0,"EXECUTOR_COULD_READ_PASSWORD_HASH");
  assert.match(secretRead.stderr,/permission denied/i);
  const scopedOwners=sql("SET ROLE cst_onejob_admission_executor; "+
    "SELECT count(*) FROM ai_platform.internal_users "+
    "WHERE role='owner' AND status='active';").stdout.trim();
  assert.equal(scopedOwners,"1","EXECUTOR_OWNER_SCOPE_NOT_VISIBLE");

  const wrongSessionUser=sql("SET ROLE cst_onejob_admission_broker;"+
    " SELECT cst_onejob_private.admit_verified_onejob_capability(483,"+
    Q(nonce)+","+Q(digest)+");",true);
  assert.notEqual(wrongSessionUser.status,0,
    "UNPINNED_SESSION_USER_WAS_ALLOWED");
  assert.match(wrongSessionUser.stderr,/ONEJOB_CAPABILITY_CALLER_DENIED/);
  const direct = sql("SET SESSION AUTHORIZATION cst_onejob_broker_login; "+
    "SET ROLE cst_onejob_admission_broker; "+
    "UPDATE ai_platform.ai_jobs SET status='queued' WHERE id=483;",true);
  assert.notEqual(direct.status,0,"BROKER_DIRECT_JOB_UPDATE_WAS_ALLOWED");
  assert.match(direct.stderr,/permission denied/i);
  const original = sql("SET SESSION AUTHORIZATION cst_onejob_broker_login; "+
    "SET ROLE cst_onejob_admission_broker; "+
    "SELECT cst_onejob_private.admit_verified_onejob(483,"+Q(nonce)+","+
    Q(digest)+");",true);
  assert.notEqual(original.status,0,"BROKER_RAW_INVOKER_FUNCTION_WAS_ALLOWED");
  assert.match(original.stderr,/permission denied/i);
  const executorEscalation=sql("SET SESSION AUTHORIZATION cst_onejob_broker_login; "+
    "SET ROLE cst_onejob_admission_executor;",true);
  assert.notEqual(executorEscalation.status,0,"BROKER_CAN_IMPERSONATE_EXECUTOR");
  assert.match(executorEscalation.stderr,/permission denied/i);
  const fakeConsumption=sql("SET SESSION AUTHORIZATION cst_onejob_broker_login; "+
    "SET ROLE cst_onejob_admission_broker; "+
    "INSERT INTO cst_onejob_private.admission_receipt_consumptions "+
    "(receipt_id,approval_id,job_id,project_id,verifier_id,nonce,proof_digest) "+
    "VALUES(gen_random_uuid(),"+Q(id)+",483,'xssrfshdrtdfupgqwfdw',"+
    "'forged',"+Q(nonce)+","+Q(digest)+");",true);
  assert.notEqual(fakeConsumption.status,0,"BROKER_CAN_MINT_RECEIPT_CONSUMPTION");
  assert.match(fakeConsumption.stderr,/permission denied/i);
  assert.equal(state(),"waiting|APPROVED|0|0|0|t");
  const bad=sql(admission("f".repeat(64)),true);
  assert.notEqual(bad.status,0);
  assert.match(bad.stderr,/ONEJOB_SIGNED_ADMISSION_NOT_BOUND/);
  assert.equal(state(),"waiting|APPROVED|0|0|0|t");

  sql("CREATE FUNCTION ai_platform.deny_audit() RETURNS trigger LANGUAGE plpgsql AS "+
    "$$BEGIN RAISE EXCEPTION 'AUDIT_INSERT_BLOCKED'; END$$;"+
    "CREATE TRIGGER deny_audit BEFORE INSERT ON ai_platform.ai_audit_logs "+
    "FOR EACH ROW EXECUTE FUNCTION ai_platform.deny_audit();");
  const failure=sql(admission(),true);
  assert.notEqual(failure.status,0);
  assert.match(failure.stderr,/AUDIT_INSERT_BLOCKED/);
  assert.equal(state(),"waiting|APPROVED|0|0|0|t");
  sql("DROP TRIGGER deny_audit ON ai_platform.ai_audit_logs;");

  const attempts=await Promise.all([queryAsync(admission()),queryAsync(admission())]);
  assert.deepEqual(attempts.map(x=>x.status===0).sort(),[false,true],
    "CONCURRENT_NONCE_ACCEPTED_TWICE");
  assert.match(attempts.find(x=>x.status!==0).stderr,/ONEJOB_SIGNED_ADMISSION_NOT_BOUND|ONEJOB_RECEIPT_REPLAY/);
  assert.equal(state(),"queued|CONSUMED|1|1|1|f");
  assert.notEqual(sql(admission(),true).status,0);
  assert.equal(state(),"queued|CONSUMED|1|1|1|f");
  sql("CREATE ROLE cst_untrusted_test NOLOGIN;"+
    "GRANT USAGE ON SCHEMA cst_onejob_private TO cst_untrusted_test;");
  const untrusted=sql("SET ROLE cst_untrusted_test; "+
    "SELECT cst_onejob_private.admit_verified_onejob_capability(483,"+
    Q(nonce)+","+Q(digest)+");",true);
  assert.notEqual(untrusted.status,0);
  assert.match(untrusted.stderr,/permission denied/i);
});
test("existing business RPC source remains SECURITY INVOKER, no raw broker DML grants",()=>{
  const raw=read("docs/dev/cst-onejob-broker-operational.CANDIDATE.sql");
  const code=raw.replace(/--[^\n]*/g,"");
  assert.match(raw,/LANGUAGE plpgsql SECURITY INVOKER/);
  assert.match(raw,/FORCE ROW LEVEL SECURITY/);
  assert.match(raw,/REVOKE ALL ON FUNCTION/);
  assert.match(raw,/FOR UPDATE/);
  assert.doesNotMatch(code,/SECURITY DEFINER|GRANT EXECUTE|ALTER ROLE|CREATE ROLE/);
});


test("capability wrapper is disposable-only and denies raw updates to broker",()=>{
  const sqlSource=read("docs/dev/cst-onejob-admission-capability.DISPOSABLE-ONLY.sql");
  assert.match(sqlSource,/CAPABILITY_FIXTURE_DISPOSABLE_ONLY/);
  assert.match(sqlSource,/SECURITY DEFINER/);
  assert.match(sqlSource,/cst_onejob_admission_executor NOLOGIN/);
  assert.match(sqlSource,/CREATE POLICY cst_capability_owner_read ON ai_platform.internal_users/);
  assert.match(sqlSource,/GRANT SELECT\(id,account_type,role,status\) ON ai_platform.internal_users/);
  assert.match(sqlSource,/REVOKE ALL ON FUNCTION[\s\S]*?admit_verified_onejob\(integer,text,text\)/);
  assert.match(sqlSource,/GRANT EXECUTE ON FUNCTION[\s\S]*?admit_verified_onejob_capability/);
  assert.doesNotMatch(sqlSource,/GRANT UPDATE[^;]+cst_onejob_admission_broker/s);
});
