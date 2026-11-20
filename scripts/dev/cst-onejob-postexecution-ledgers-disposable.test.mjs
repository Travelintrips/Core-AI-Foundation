import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
const sqlSource=readFileSync(new URL(
  "../../docs/dev/cst-onejob-postexecution-ledgers.PROPOSED.sql",import.meta.url),"utf8");
const name="cst-onejob-finalack-ledger-sql-"+process.pid;
const db="finalack_schema_test";
const Q=x=>"'"+String(x).replaceAll("'","''")+"'";
function exec(cmd,input,allow=false){
  const p=spawnSync(cmd[0],cmd.slice(1),{input,encoding:"utf8",timeout:25_000});
  if(p.error)throw p.error;
  if(p.status!==0&&!allow)throw Error("ISOLATED_SQL_FAILED:"+(p.stderr||p.stdout).slice(-950));
  return p;
}
const sql=(s,allow=false)=>exec(["docker","exec","-i",name,"psql","-X","-qAt",
  "-v","ON_ERROR_STOP=1","-U","postgres","-d",db],s,allow);
const uuid=(n)=>"123e4567-e89b-12d3-a456-42661417400"+n;
test("post-execution schema compiles once on isolated PostgreSQL, rejects replay and prevents public writes",{
  timeout:90_000
},async t=>{
  exec(["docker","run","-d","--rm","--name",name,"--network","none",
    "--memory","384m","--cpus","1","-e","POSTGRES_DB="+db,
    "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"]);
  t.after(()=>exec(["docker","rm","-f",name],undefined,true));
  let ready=false;
  for(let i=0;i<70;i++){
    const p=sql("SELECT 1;",true);
    if(p.status===0&&p.stdout.trim()==="1"){ready=true;break}
    await delay(300);
  }
  assert.ok(ready,"POSTGRES_DISPOSABLE_NOT_READY");
  const id=uuid(0),eventId=uuid(1),deliveryId=uuid(2),postId=uuid(3);
  sql("CREATE SCHEMA ai_platform;"+
    "CREATE TABLE ai_platform.internal_users(id integer PRIMARY KEY);"+
    "CREATE TABLE ai_platform.ai_jobs(id integer PRIMARY KEY);"+
    "CREATE TABLE ai_platform.cst_onejob_owner_approvals("+
      "id uuid PRIMARY KEY,job_id integer REFERENCES ai_platform.ai_jobs(id));"+
    "INSERT INTO ai_platform.ai_jobs VALUES(483);"+
    "INSERT INTO ai_platform.cst_onejob_owner_approvals VALUES("+Q(id)+",483);"+
    "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;");
  sql(sqlSource);
  for(const table of ["subscriber_delivery_receipts","post_execution_qa_receipts",
    "core_signed_reconciliations"]){
    const p=sql("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
      "WHERE oid=to_regclass("+Q("cst_onejob_private."+table)+");");
    assert.equal(p.stdout.trim(),"t","RLS_NOT_FORCED:"+table);
    const denied=sql("SELECT has_table_privilege('anon',"+
      Q("cst_onejob_private."+table)+",'INSERT');");
    assert.equal(denied.stdout.trim(),"f","PUBLIC_WRITE_GRANTED:"+table);
  }
  const sig=Buffer.alloc(64,11).toString("base64");
  sql("INSERT INTO cst_onejob_private.subscriber_delivery_receipts "+
    "(approval_id,job_id,event_id,delivery_id,subscriber_id,correlation_id,"+
    "delivery_digest,status,ack_nonce,reconciliation_signature_base64,ack_issuer_fingerprint,received_at)"+
    "VALUES("+Q(id)+",483,"+Q(eventId)+","+Q(deliveryId)+","+
    "'cst-onejob-subscriber-pilot',"+Q(uuid(4))+","+
    Q("a".repeat(64))+",'ACKNOWLEDGED',"+Q("b".repeat(64))+","+
    Q(sig)+","+Q("c".repeat(64))+",clock_timestamp());");
  assert.notEqual(sql("INSERT INTO cst_onejob_private.subscriber_delivery_receipts "+
    "(approval_id,job_id,event_id,delivery_id,subscriber_id,correlation_id,"+
    "delivery_digest,status,ack_nonce,reconciliation_signature_base64,ack_issuer_fingerprint,received_at)"+
    "VALUES("+Q(id)+",483,"+Q(uuid(5))+","+Q(uuid(6))+","+
    "'cst-onejob-subscriber-pilot',"+Q(uuid(4))+","+
    Q("d".repeat(64))+",'ACKNOWLEDGED',"+Q("b".repeat(64))+","+
    Q(sig)+","+Q("c".repeat(64))+",clock_timestamp());",true).status,0,
    "SUBSCRIBER_REPLAY_ACCEPTED");
  assert.notEqual(sql("INSERT INTO cst_onejob_private.post_execution_qa_receipts "+
    "(approval_id,job_id,delivery_id,verifier_id,stage,nonce,proof_digest,"+
    "evidence_digest,verified_at,expires_at) VALUES("+Q(id)+",483,"+
    Q(deliveryId)+",'cst-independent-qa-fixturetest','POST_EXECUTION',"+
    Q("e".repeat(64))+","+Q("f".repeat(64))+","+Q("0".repeat(64))+","+
    "now(),now()+interval '6 minutes');",true).status,0,"UNBOUNDED_TTL_ACCEPTED");
  sql("INSERT INTO cst_onejob_private.post_execution_qa_receipts "+
    "(id,approval_id,job_id,delivery_id,verifier_id,stage,nonce,proof_digest,"+
    "evidence_digest,verified_at,expires_at) VALUES("+Q(postId)+","+
    Q(id)+",483,"+Q(deliveryId)+",'cst-independent-qa-fixturetest',"+
    "'POST_EXECUTION',"+Q("e".repeat(64))+","+Q("f".repeat(64))+","+
    Q("0".repeat(64))+",now(),now()+interval '4 minutes');");
  sql("INSERT INTO cst_onejob_private.core_signed_reconciliations "+
    "(approval_id,job_id,delivery_id,post_receipt_id,reconciliation_id,"+
    "independently_verified_by,issued_at,source_digest,"+
    "reconciliation_signature_base64,issuer_public_fingerprint,reconciliation_claims_digest) VALUES("+
    Q(id)+",483,"+Q(deliveryId)+","+Q(postId)+","+Q(uuid(7))+","+
    "'cst-final-reconciler-dev',clock_timestamp(),"+Q("1".repeat(64))+","+
    Q(sig)+","+Q("2".repeat(64))+","+Q("3".repeat(64))+");");
  const state=sql("SELECT (SELECT count(*) FROM cst_onejob_private.subscriber_delivery_receipts),"+
    "(SELECT count(*) FROM cst_onejob_private.post_execution_qa_receipts),"+
    "(SELECT count(*) FROM cst_onejob_private.core_signed_reconciliations);");
  assert.equal(state.stdout.trim(),"1|1|1");
  assert.notEqual(sql("INSERT INTO cst_onejob_private.core_signed_reconciliations "+
    "(approval_id,job_id,delivery_id,post_receipt_id,reconciliation_id,"+
    "independently_verified_by,issued_at,source_digest,"+
    "reconciliation_signature_base64,issuer_public_fingerprint,reconciliation_claims_digest) VALUES("+
    Q(id)+",483,"+Q(deliveryId)+","+Q(postId)+","+Q(uuid(8))+","+
    "'cst-final-reconciler-dev',clock_timestamp(),"+Q("1".repeat(64))+","+
    Q(sig)+","+Q("2".repeat(64))+","+Q("4".repeat(64))+");",true).status,0,
    "DOUBLE_FINAL_ACK_ACCEPTED");
  assert.equal(sql("SELECT count(*) FROM cst_onejob_private.core_signed_reconciliations;").stdout.trim(),"1");
});
