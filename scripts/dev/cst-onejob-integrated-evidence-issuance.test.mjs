import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {QA_DOMAIN,qaCanonicalBytes} from
  "../../artifacts/api-server/src/lib/cstOneJobIndependentQaVerifier.ts";
import {signIndependentQaEvidence,persistIndependentPreAdmission,PRE_QA_SOURCE_SQL,
  QA_ROLE,QA_LOGIN,PROJECT}
  from "./cst-onejob-independent-evidence-issuers.mjs";
import {pullAndAcknowledgeOneJobCompletion,SUBSCRIBER_SOURCE_SQL,
  SUBSCRIBER_ROLE,SUBSCRIBER_LOGIN}
  from "./cst-onejob-independent-subscriber-pull.mjs";
import {executeTrustedAdmissionTransaction,LOCK_SQL}
  from "./cst-onejob-trusted-admission-bridge.mjs";
import {executeFinalAckCandidate,SOURCE_SNAPSHOT_SQL}
  from "./cst-onejob-final-ack-candidate.mjs";

const sha=b=>createHash("sha256").update(b).digest("hex");
const id="123e4567-e89b-12d3-a456-426614174000";
const eventId="123e4567-e89b-12d3-a456-426614174001";
const postId="123e4567-e89b-12d3-a456-426614174002";
const correlationId="123e4567-e89b-12d3-a456-426614174003";
const requestId="cst-ai-team-company1-dev:pilot-"+"b".repeat(20);
const worker="cst-dev-dell-onejob-20261120-abcdef12";
const sourceSha="a".repeat(40),imageId="sha256:"+"f".repeat(64);
const subscriberId="cst-onejob-subscriber-pilot";
const verifierId="cst-independent-qa-disposableonly";
const qa=generateKeyPairSync("ed25519"),sub=generateKeyPairSync("ed25519");
const final=generateKeyPairSync("ed25519");
function pinned(pair,use,idKey,idVal){
  return {use,project:PROJECT,[idKey]:idVal,
    publicKeyPem:pair.publicKey.export({type:"spki",format:"pem"}).toString(),
    fingerprint:sha(pair.publicKey.export({type:"spki",format:"der"}))}
}
const qaTrust=pinned(qa,"CST_DEV_ONEJOB_QA_PUBLIC_PIN","verifierId",verifierId);
const subTrust=pinned(sub,"CST_DEV_ONEJOB_SUBSCRIBER_PUBLIC_PIN","subscriberId",subscriberId);
const finalTrust=pinned(final,"CST_DEV_ONEJOB_FINAL_ACK_PUBLIC_PIN",
  "issuerId","cst-final-reconciler-dev");
const qaSigner=async data=>sign(null,data,qa.privateKey).toString("base64");
const subSigner=async data=>sign(null,data,sub.privateKey).toString("base64");
const finalSigner=async data=>sign(null,data,final.privateKey).toString("base64");
const response=Buffer.from("CST_DEV_ONEJOB_PROBE_OK");
const binding={project:PROJECT,companyId:"1",approvalId:id,jobId:483,
  requestId,workerName:worker,sourceSha,imageId};
function attestation(){
  return Buffer.from(JSON.stringify({
    scope:"CST_DEV_ONEJOB_PRE_ADMISSION",project:PROJECT,
    approvalId:id,jobId:483,workerName:worker,sourceSha,imageId,
    checks:{isolatedNetwork:true,scopedDevRole:true,eventAuditPath:true,
      subscriberPath:true,independentQaAvailable:true},
    capturedAt:new Date(Date.now()-1500).toISOString()
  }));
}
function approval(status="APPROVED"){
  return {id,jobId:483,purpose:"CST_DEV_ONEJOB_MODEL",status,companyId:"1",
    modelId:"qwen2.5:3b",requestId,workerName:worker,sourceSha,
    approvedAt:new Date(Date.now()-60_000).toISOString(),
    expiresAt:new Date(Date.now()+1_200_000).toISOString(),
    consumedAt:status==="CONSUMED"?new Date(Date.now()-9000).toISOString():null};
}
function job(status="waiting"){
  return {id:483,status,jobType:"ollama_model_invocation",
    capability:"ollama_inference",maxRetry:0,requestId,modelId:"qwen2.5:3b",
    resultJson:{output:{type:"text",text:"CST_DEV_ONEJOB_PROBE_OK"}}};
}
const event={eventId,eventType:"job.completed",sourceModule:"job-engine",
  sourceId:"483",correlationId,status:"processed",
  payloadJson:{jobId:483,jobType:"ollama_model_invocation",workerId:8}};
const eventAudit={module:"event-bus",action:"event_published",
  resourceId:eventId,status:"success",
  details:{eventType:"job.completed",correlationId}};
class QaDb{
  constructor(){this.calls=[];this.forcedRole=null}
  async query(sql,params=[]){
    this.calls.push({sql,params});
    if(sql.startsWith("SET LOCAL ROLE ")){this.forcedRole=sql.slice(15);return {rows:[]}}
    if(sql.includes("SELECT current_user AS role_name"))
      return {rows:[{role_name:this.forcedRole,login_name:QA_LOGIN,db:"postgres"}]};
    if(sql===PRE_QA_SOURCE_SQL)return {rows:[{approval:approval(),job:job()}]};
    if(sql.includes("INSERT INTO cst_onejob_private.verified_admission_receipts"))
      return {rows:[{id:"123e4567-e89b-12d3-a456-426614174004"}]};
    return {rows:[]};
  }
}
class BrokerDb{
  constructor(receipt){this.calls=[];this.receipt=receipt}
  async query(sql,params=[]){
    this.calls.push({sql,params});
    if(sql.includes("SELECT current_user AS role_name"))
      return {rows:[{role_name:"cst_onejob_admission_broker",
        login_name:"cst_onejob_broker_login",db:"postgres"}]};
    if(sql===LOCK_SQL){
      const a=approval(),j=job(),c=this.receipt.claims;
      return {rows:[{
        a_id:id,a_job_id:483,a_owner_id:1,a_status:a.status,
        a_purpose:a.purpose,a_company_id:"1",a_model_id:a.modelId,
        a_request_id:requestId,a_worker_name:worker,a_source_sha:sourceSha,
        a_approved_at:a.approvedAt,a_expires_at:a.expiresAt,a_consumed_at:null,
        j_id:483,j_status:j.status,j_type:j.jobType,j_capability:j.capability,
        j_max_retry:j.maxRetry,j_request_id:requestId,j_model_id:j.modelId,
        r_approval_id:id,r_job_id:483,r_company_id:"1",r_request_id:requestId,
        r_worker_name:worker,r_source_sha:sourceSha,r_image_id:imageId,
        r_verifier_id:verifierId,r_nonce:c.nonce,
        r_proof_digest:sha(qaCanonicalBytes(c)),
        r_verified_at:c.verifiedAt,r_expires_at:c.expiresAt,r_consumed_at:null
      }]};
    }
    if(sql.includes("SELECT cst_onejob_private.admit_verified_onejob"))
      return {rows:[{job_id:483}]};
    return {rows:[]};
  }
}
class SubDb{
  constructor({badSource=false,failAudit=false}={}){
    this.calls=[];this.forcedRole=null;this.badSource=badSource;this.failAudit=failAudit;
  }
  async query(sql,params=[]){
    this.calls.push({sql,params});
    if(sql.startsWith("SET LOCAL ROLE ")){this.forcedRole=sql.slice(15);return {rows:[]}}
    if(sql.includes("SELECT current_user AS role_name"))
      return {rows:[{role_name:this.forcedRole,login_name:SUBSCRIBER_LOGIN,db:"postgres"}]};
    if(sql===SUBSCRIBER_SOURCE_SQL)
      return {rows:[{approval:approval("CONSUMED"),job:job("completed"),
        event:{...event,eventType:this.badSource?"evil.event":event.eventType},
        event_audit:eventAudit}]};
    if(sql.includes("INSERT INTO cst_onejob_private.subscriber_delivery_receipts"))
      return {rows:[{id:"123e4567-e89b-12d3-a456-426614174005"}]};
    if(sql.includes("INSERT INTO ai_platform.ai_audit_logs")&&this.failAudit)
      throw Error("AUDIT_INJECTION_ROLLBACK");
    return {rows:[]};
  }
}
class FinalDb{
  constructor({receipt,ack}={}){
    this.calls=[];this.receipt=receipt;this.ack=ack;
  }
  async query(sql,params=[]){
    this.calls.push({sql,params});
    if(sql.includes("SELECT current_user AS role_name"))
      return {rows:[{role_name:"cst_onejob_finalack_writer",
        login_name:"cst_onejob_finalack_login",db:"postgres"}]};
    if(sql===SOURCE_SNAPSHOT_SQL){
      const a=approval("CONSUMED"),j=job("completed"),r=this.receipt.claims,
        c=this.ack.claims;
      return {rows:[{
        approval:a,job:j,
        admission_receipt:{approvalId:id,jobId:483,companyId:"1",
          requestId,workerName:worker,imageSourceSha:sourceSha,imageId,
          nonce:r.nonce,proofDigest:sha(qaCanonicalBytes(r)),
          consumedAt:new Date(Date.now()-8000).toISOString()},
        event,event_audit:eventAudit,
        subscriber:{eventId,jobId:483,subscriberId,
          deliveryId:c.deliveryId,correlationId,status:"ACKNOWLEDGED",
          receivedAt:c.acknowledgedAt,deliveryDigest:c.deliveryDigest,
          ackNonce:c.nonce,ackSignatureBase64:this.ack.signatureBase64,
          ackIssuerFingerprint:this.ack.publicKeyFingerprint}
      }]};
    }
    if(sql.includes("INSERT INTO cst_onejob_private.post_execution_qa_receipts"))
      return {rows:[{id:postId}]};
    if(sql.includes("INSERT INTO cst_onejob_private.final_ack_reconciliations"))
      return {rows:[{final_ack_id:params[4]}]};
    return {rows:[]};
  }
}

test("one integrated proof chain: independently signed PRE QA -> locked broker -> persisted signed PULL subscriber -> independently signed POST QA -> final ACK",async()=>{
  const capture=attestation(),qaDb=new QaDb();
  const pre=await persistIndependentPreAdmission({
    client:qaDb,jobId:483,imageId,evidenceBytes:capture,
    pinnedTrust:qaTrust,signBytes:qaSigner
  });
  assert.equal(pre.status,"QA_PRE_ADMISSION_PERSISTED_NO_ADMISSION");
  assert.equal(pre.queueTransitionAuthorized,false);
  assert.equal(qaDb.calls.at(-1).sql,"COMMIT");
  assert.equal(pre.signedReceipt.claims.stage,"PRE_ADMISSION");
  const broker=new BrokerDb(pre.signedReceipt);
  const admission=await executeTrustedAdmissionTransaction({
    client:broker,jobId:483,signedReceipt:pre.signedReceipt,
    evidenceBytes:capture,pinnedTrust:qaTrust,approvedSourceSha:sourceSha
  });
  assert.equal(admission.status,"ADMISSION_COMMITTED");
  assert.equal(admission.dispatchPermitted,false);
  const subscriberDb=new SubDb();
  const subStep=await pullAndAcknowledgeOneJobCompletion({
    client:subscriberDb,jobId:483,eventId,expectedSubscriberId:subscriberId,
    pinnedTrust:subTrust,signBytes:subSigner
  });
  assert.equal(subStep.status,"SUBSCRIBER_ACK_PERSISTED");
  assert.equal(subStep.signedAck.claims.deliveryDigest,sha(subStep.deliveryBytes));
  assert.equal(subscriberDb.calls.at(-1).sql,"COMMIT");
  assert.equal(subStep.finalAckIssued,false);
  const postEvidenceBytes=Buffer.from(JSON.stringify({
    eventId,jobId:483,subscriberId,deliveryId:subStep.deliveryId,
    responseDigest:sha(response)
  }));
  const post=await signIndependentQaEvidence({
    stage:"POST_EXECUTION",
    binding:{...binding,postBinding:{eventId,deliveryId:subStep.deliveryId,subscriberId}},
    evidenceBytes:postEvidenceBytes,pinnedTrust:qaTrust,signBytes:qaSigner
  });
  assert.equal(post.signedReceipt.claims.stage,"POST_EXECUTION");
  assert.notEqual(post.signedReceipt.claims.nonce,pre.signedReceipt.claims.nonce);
  const finalDb=new FinalDb({receipt:pre.signedReceipt,ack:subStep.signedAck});
  const finalAck=await executeFinalAckCandidate({
    client:finalDb,jobId:483,eventId,
    signedSubscriberAck:subStep.signedAck,subscriberTrust:subTrust,
    deliveryBytes:subStep.deliveryBytes,
    signedPostReceipt:post.signedReceipt,qaTrust,evidenceBytes:postEvidenceBytes,
    responseBytes:response,expectedSubscriberId:subscriberId,
    signer:finalSigner,finalIssuerTrust:finalTrust
  });
  assert.equal(finalAck.status,"FINAL_ACK_COMMITTED");
  assert.equal(finalAck.finalAckIssued,true);
  assert.equal(finalDb.calls.at(-1).sql,"COMMIT");
  assert.equal(finalAck.dispatchPermitted,false);
  assert.ok(qaDb.calls.some(q=>q.sql.includes("verified_admission_receipts")));
  assert.ok(subscriberDb.calls.some(q=>q.sql.includes("subscriber_delivery_receipts")));
  assert.ok(finalDb.calls.some(q=>q.sql.includes("final_ack_reconciliations")));
});
test("reject self-asserted or incomplete independent QA, forged signing key and historic job",async()=>{
  const wrong={...JSON.parse(attestation().toString("utf8"))};
  wrong.checks.subscriberPath=false;
  const signedData=Buffer.from(JSON.stringify(wrong));
  await assert.rejects(signIndependentQaEvidence({
    stage:"PRE_ADMISSION",binding,evidenceBytes:signedData,
    pinnedTrust:qaTrust,signBytes:qaSigner
  }),/NOT_INDEPENDENTLY_ATTESTED/);
  const forged=generateKeyPairSync("ed25519");
  await assert.rejects(signIndependentQaEvidence({
    stage:"PRE_ADMISSION",binding,evidenceBytes:attestation(),
    pinnedTrust:qaTrust,signBytes:async bytes=>
      sign(null,bytes,forged.privateKey).toString("base64")
  }),/EXTERNAL_SIGNATURE_NOT_VERIFIED/);
  await assert.rejects(persistIndependentPreAdmission({
    client:new QaDb(),jobId:482,imageId,evidenceBytes:attestation(),
    pinnedTrust:qaTrust,signBytes:qaSigner
  }),/QA_NEW_JOB_IMAGE_REQUIRED/);
});
test("subscriber denies false event origin and atomic audit failure; no false ACK on rollback",async()=>{
  const bad=new SubDb({badSource:true});
  await assert.rejects(pullAndAcknowledgeOneJobCompletion({
    client:bad,jobId:483,eventId,expectedSubscriberId:subscriberId,
    pinnedTrust:subTrust,signBytes:subSigner
  }),/NOT_INDEPENDENTLY_OBSERVED/);
  assert.equal(bad.calls.at(-1).sql,"ROLLBACK");
  assert.equal(bad.calls.some(q=>q.sql.includes("INSERT INTO cst_onejob_private.subscriber_delivery_receipts")),false);
  const failed=new SubDb({failAudit:true});
  await assert.rejects(pullAndAcknowledgeOneJobCompletion({
    client:failed,jobId:483,eventId,expectedSubscriberId:subscriberId,
    pinnedTrust:subTrust,signBytes:subSigner
  }),/AUDIT_INJECTION_ROLLBACK/);
  assert.equal(failed.calls.at(-1).sql,"ROLLBACK");
  assert.equal(failed.calls.some(q=>q.sql==="COMMIT"),false);
});

import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
const container="cst-onejob-issuers-pg-"+process.pid;
const database="cst_onejob_issuers_disposable";
function runCommand(argv,input,allow=false){
  const p=spawnSync(argv[0],argv.slice(1),{input,encoding:"utf8",timeout:25000});
  if(p.error)throw p.error;
  if(p.status!==0&&!allow)
    throw Error("PG_REHEARSAL_FAILED:"+(p.stderr||p.stdout).slice(-1600));
  return p;
}
function sqlPG(statement,allow=false){
  return runCommand(["docker","exec","-i",container,"psql","-X","-qAt",
    "-v","ON_ERROR_STOP=1","-U","postgres","-d",database],statement,allow);
}
const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
const read=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
test("one disposable network-none PostgreSQL role package compiles, SELECT-only source, QA/subscriber append-only, no broad authority",{
  timeout:90000
},async t=>{
  runCommand(["docker","run","-d","--rm","--name",container,"--network","none",
    "--memory","384m","--cpus","1","-e","POSTGRES_DB="+database,
    "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"]);
  t.after(()=>runCommand(["docker","rm","-f",container],undefined,true));
  let ready=false;
  for(let n=0;n<80;n++){
    const check=sqlPG("SELECT 1;",true);
    if(check.status===0&&check.stdout.trim()==="1"){ready=true;break}
    await delay(250);
  }
  assert.ok(ready,"PG_DISPOSABLE_NOT_READY");
  sqlPG("CREATE SCHEMA ai_platform;"+
    "CREATE SCHEMA cst_onejob_private;"+
    "CREATE TABLE ai_platform.internal_users(id integer PRIMARY KEY,role text,status text,account_type text);"+
    "CREATE TABLE ai_platform.ai_jobs(id integer PRIMARY KEY,status text,job_type text,"+
      "required_capability text,max_retry integer,payload_json jsonb,result_json jsonb);"+
    "CREATE TABLE ai_platform.ai_events(id serial PRIMARY KEY,event_id text,event_type text,"+
      "source_module text,source_id text,correlation_id text,status text,payload_json jsonb);"+
    "CREATE TABLE ai_platform.ai_audit_logs(id serial PRIMARY KEY,module text,action text,"+
      "resource_type text,resource_id text,status text,details jsonb);"+
    "ALTER TABLE ai_platform.internal_users ENABLE ROW LEVEL SECURITY;"+
    "ALTER TABLE ai_platform.ai_jobs ENABLE ROW LEVEL SECURITY;"+
    "ALTER TABLE ai_platform.ai_events ENABLE ROW LEVEL SECURITY;"+
    "ALTER TABLE ai_platform.ai_audit_logs ENABLE ROW LEVEL SECURITY;");
  sqlPG(read("docs/dev/cst-onejob-owner-approval.PROPOSED.sql"));
  sqlPG(read("docs/dev/cst-onejob-independent-receipts.PROPOSED.sql"));
  sqlPG(read("docs/dev/cst-onejob-postexecution-ledgers.PROPOSED.sql"));
  sqlPG(read("docs/dev/cst-onejob-independent-writers.CANDIDATE.sql"));
  sqlPG("INSERT INTO ai_platform.internal_users VALUES(1,'owner','active','internal');"+
    "INSERT INTO ai_platform.ai_jobs VALUES(483,'waiting','ollama_model_invocation',"+
      "'ollama_inference',0,jsonb_build_object('requestId',"+
      quote(requestId)+",'modelId','qwen2.5:3b'),NULL);"+
    "INSERT INTO ai_platform.cst_onejob_owner_approvals"+
    "(id,purpose,status,company_id,model_id,approved_by_user_id,request_id,"+
    "worker_name,source_sha,job_id,approved_at,expires_at) VALUES("+
      quote(id)+",'CST_DEV_ONEJOB_MODEL','APPROVED','1','qwen2.5:3b',1,"+
      quote(requestId)+","+quote(worker)+",repeat('a',40),483,"+
      "now()-interval '1 minute',now()+interval '18 minutes');");
  const qaRead=sqlPG("SET ROLE "+QA_ROLE+";"+
    PRE_QA_SOURCE_SQL.replaceAll("$1","483")+";");
  assert.match(qaRead.stdout,/CST_DEV_ONEJOB_MODEL/);
  assert.match(qaRead.stdout,/waiting/);
  const receiptSig=qaCanonicalBytes({
    domain:QA_DOMAIN,stage:"PRE_ADMISSION",project:PROJECT,
    companyId:"1",approvalId:id,jobId:483,requestId,
    workerName:worker,sourceSha,imageId,verifierId,nonce:"a".repeat(64),
    verifiedAt:new Date().toISOString(),
    expiresAt:new Date(Date.now()+100000).toISOString(),
    evidenceDigest:"f".repeat(64)
  });
  const digest=sha(receiptSig);
  const insertReceipt="SET ROLE "+QA_ROLE+";"+
    "INSERT INTO cst_onejob_private.verified_admission_receipts"+
    "(approval_id,job_id,company_id,request_id,worker_name,image_source_sha,image_id,"+
    "isolated_network_verified,scoped_dev_role_verified,event_audit_path_verified,"+
    "subscriber_path_verified,independent_qa_available,nonce,proof_digest,verifier_id,"+
    "verified_at,expires_at) VALUES("+
    quote(id)+",483,'1',"+quote(requestId)+","+quote(worker)+","+
    "repeat('a',40),"+quote(imageId)+","+
    "true,true,true,true,true,repeat('c',64),"+quote(digest)+","+
    quote(verifierId)+",now(),now()+interval '3 minutes') RETURNING id;";
  const receipt=sqlPG(insertReceipt);
  assert.match(receipt.stdout,/123e|[0-9a-f]{8}-[0-9a-f-]{27}/);
  assert.notEqual(sqlPG("SET ROLE "+QA_ROLE+";"+
    "UPDATE ai_platform.ai_jobs SET status='queued' WHERE id=483;",true).status,0);
  sqlPG("UPDATE ai_platform.ai_jobs SET status='completed',"+
    "result_json=jsonb_build_object('output',jsonb_build_object("+
    "'type','text','text','CST_DEV_ONEJOB_PROBE_OK')) WHERE id=483;"+
    "UPDATE ai_platform.cst_onejob_owner_approvals SET status='CONSUMED',"+
    "consumed_at=now() WHERE job_id=483;"+
    "INSERT INTO ai_platform.ai_events"+
    "(event_id,event_type,source_module,source_id,correlation_id,status,payload_json)"+
    "VALUES("+quote(eventId)+",'job.completed','job-engine','483',"+
    quote(correlationId)+",'processed',"+
    "jsonb_build_object('jobId',483,'jobType','ollama_model_invocation'));"+
    "INSERT INTO ai_platform.ai_audit_logs"+
    "(module,action,resource_type,resource_id,status,details)"+
    "VALUES('event-bus','event_published','ai_event',"+
    quote(eventId)+",'success',jsonb_build_object"+
    "('eventType','job.completed','correlationId',"+quote(correlationId)+"));");
  const subRead=sqlPG("SET ROLE "+SUBSCRIBER_ROLE+";"+
    SUBSCRIBER_SOURCE_SQL.replaceAll("$1","483")
      .replaceAll("$2",quote(eventId))+";");
  assert.match(subRead.stdout,/CST_DEV_ONEJOB_PROBE_OK/);
  assert.match(subRead.stdout,/job.completed/);
  const subInsert="SET ROLE "+SUBSCRIBER_ROLE+";"+
    "INSERT INTO cst_onejob_private.subscriber_delivery_receipts"+
    "(approval_id,job_id,event_id,delivery_id,subscriber_id,correlation_id,"+
    "delivery_digest,status,ack_nonce,ack_signature_base64,"+
    "ack_issuer_fingerprint,received_at) VALUES("+
    quote(id)+",483,"+quote(eventId)+","+
    quote("123e4567-e89b-12d3-a456-426614174019")+","+
    quote(subscriberId)+","+quote(correlationId)+","+
    "repeat('e',64),'ACKNOWLEDGED',repeat('f',64),"+
    quote(Buffer.alloc(64,3).toString("base64"))+",repeat('d',64),now()) RETURNING id;";
  const inserted=sqlPG(subInsert);
  assert.match(inserted.stdout,/[0-9a-f]{8}-[0-9a-f-]{27}/);
  assert.notEqual(sqlPG("SET ROLE "+SUBSCRIBER_ROLE+";"+
    "UPDATE ai_platform.ai_events SET status='failed' WHERE event_id="+
    quote(eventId)+";",true).status,0);
  for(const role of [QA_ROLE,SUBSCRIBER_ROLE]){
    const flags=sqlPG("SELECT rolcanlogin,rolbypassrls FROM pg_roles WHERE rolname="+
      quote(role)+";");
    assert.equal(flags.stdout.trim(),"f|f");
    for(const table of ["ai_platform.ai_jobs","ai_platform.ai_events",
      "ai_platform.cst_onejob_owner_approvals",
      "cst_onejob_private.verified_admission_receipts",
      "cst_onejob_private.subscriber_delivery_receipts"]){
      const write=sqlPG("SELECT has_table_privilege("+quote(role)+","+
        quote(table)+",'UPDATE');");
      assert.equal(write.stdout.trim(),"f","UNSAFE_UPDATE:"+role+":"+table);
    }
  }
  const anon=sqlPG("CREATE ROLE cst_untrusted_test NOLOGIN;"+
    "SELECT has_table_privilege('cst_untrusted_test',"+
      "'cst_onejob_private.subscriber_delivery_receipts','INSERT');");
  assert.equal(anon.stdout.trim(),"f");
});
