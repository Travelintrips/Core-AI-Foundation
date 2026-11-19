import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
import {
  QA_DOMAIN,qaCanonicalBytes
} from "../../artifacts/api-server/src/lib/cstOneJobIndependentQaVerifier.ts";
import {reviewOneJobSignedHandoff}
  from "./cst-onejob-signed-handoff-review.ts";

const root=new URL("../../",import.meta.url);
const read=(relative)=>readFileSync(new URL(relative,root),"utf8");
const name="cst-qa-handoff-disposable-"+process.pid;
const fixtureDb="cst_onejob_signed_qa_fixture";
function exec(args,input,allowFailure=false){
  const p=spawnSync(args[0],args.slice(1),{
    input,encoding:"utf8",timeout:25_000,
  });
  if(p.error)throw p.error;
  if(p.status!==0&&!allowFailure)
    throw Error("DISPOSABLE_COMMAND_FAILED: "+(p.stderr||p.stdout).slice(-900));
  return p;
}
function sql(query,allowFailure=false) {
  return exec(["docker","exec","-i",name,"psql","-X","-qAt",
    "-v","ON_ERROR_STOP=1","-U","postgres","-d",fixtureDb],query,allowFailure);
}
const Q=(v)=>"'"+String(v).replaceAll("'","''")+"'";
function sha256(b){return createHash("sha256").update(b).digest("hex")}
function expectSqlDenied(q,code){
  const p=sql(q,true);
  assert.notEqual(p.status,0,"UNEXPECTEDLY_ACCEPTED_SQL_PROBE");
  assert.match(p.stderr,new RegExp(code));
}
function state(){
  const result=sql(`SELECT
    (SELECT status FROM ai_platform.ai_jobs WHERE id=483),
    (SELECT status FROM ai_platform.cst_onejob_owner_approvals WHERE job_id=483),
    (SELECT count(*) FROM cst_onejob_private.admission_receipt_consumptions),
    (SELECT count(*) FROM ai_platform.cst_onejob_signed_fixture_audit),
    (SELECT consumed_at IS NULL
      FROM cst_onejob_private.verified_admission_receipts WHERE job_id=483);`);
  return result.stdout.trim();
}
test("synthetic signed QA evidence -> one atomic PostgreSQL admission, injection rollback, replay denial",{
  timeout:90_000,
},async t=>{
  let started=false;
  try{
    const start=exec(["docker","run","-d","--rm","--name",name,"--network","none",
      "--memory","384m","--cpus","1",
      "-e","POSTGRES_DB="+fixtureDb,
      "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"]);
    assert.equal(start.status,0);
    started=true;
    t.after(()=>{exec(["docker","rm","-f",name],undefined,true)});
    let ready=false;
    for(let attempt=0;attempt<70;attempt++){
      const logs=exec(["docker","logs",name],undefined,true);
      if((logs.stderr+logs.stdout).includes(
        "PostgreSQL init process complete; ready for start up.")){
        const probe=sql("SELECT 1;",true);
        if(probe.status===0&&probe.stdout.trim()==="1"){ready=true;break}
      }
      await delay(300);
    }
    assert.ok(ready,"DISPOSABLE_POSTGRES_FINAL_SERVER_NOT_READY");

    const approvalId="123e4567-e89b-12d3-a456-426614174000";
    const jobId=483,sourceSha="a".repeat(40),imageId="sha256:"+"f".repeat(64);
    const requestId="cst-ai-team-company1-dev:pilot-"+"b".repeat(20);
    const workerName="cst-dev-dell-onejob-20261119-abcdef12";
    const verifierId="cst-independent-qa-disposableonly";
    const now=Date.now(),iso=(ms)=>new Date(ms).toISOString();
    const evidence=Buffer.from("independent-synthetic-review-source-v1");
    const approval={
      id:approvalId,jobId,approvedByUserId:1,status:"APPROVED",
      purpose:"CST_DEV_ONEJOB_MODEL",companyId:"1",
      modelId:"qwen2.5:3b",requestId,workerName,sourceSha,
      approvedAt:iso(now-120_000),expiresAt:iso(now+18*60_000),
      consumedAt:null,
    };
    const job={
      id:jobId,status:"waiting",jobType:"ollama_model_invocation",
      requiredCapability:"ollama_inference",modelId:"qwen2.5:3b",
      requestId,maxRetry:0,
    };
    const claims={
      domain:QA_DOMAIN,stage:"PRE_ADMISSION",
      project:"xssrfshdrtdfupgqwfdw",companyId:"1",
      approvalId,jobId,requestId,workerName,sourceSha,
      imageId,verifierId,nonce:"c".repeat(64),
      verifiedAt:iso(now-60_000),expiresAt:iso(now+180_000),
      evidenceDigest:sha256(evidence),
    };
    const keys=generateKeyPairSync("ed25519");
    const evil=generateKeyPairSync("ed25519");
    const qaPublicKey={
      project:claims.project,verifierId,
      publicKeyPem:keys.publicKey.export({type:"spki",format:"pem"}).toString(),
      fingerprint:sha256(keys.publicKey.export({type:"spki",format:"der"})),
    };
    const signWith=(key)=>({
      claims,signatureBase64:sign(null,qaCanonicalBytes(claims),key).toString("base64"),
      publicKeyFingerprint:qaPublicKey.fingerprint,
    });
    const signedReceipt=signWith(keys.privateKey);
    const receiptRow={
      approvalId,jobId,companyId:"1",requestId,workerName,
      imageSourceSha:sourceSha,imageId,verifierId,
      nonce:claims.nonce,proofDigest:sha256(qaCanonicalBytes(claims)),
      verifiedAt:claims.verifiedAt,expiresAt:claims.expiresAt,consumedAt:null,
    };
    const review=(signed=signedReceipt,row=receiptRow,bytes=evidence)=>
      reviewOneJobSignedHandoff({approval,job,receiptRow:row,
        signedReceipt:signed,qaPublicKey,
        independentlyCapturedEvidence:bytes});

    assert.equal(review(signWith(evil.privateKey)).status,"DENIED",
      "FORGED_QA_KEY_DID_NOT_FAIL");
    assert.equal(review(signedReceipt,{...receiptRow,nonce:"d".repeat(64)}).status,"DENIED",
      "MISMATCHED_DB_NONCE_DID_NOT_FAIL");
    assert.equal(review(signedReceipt,receiptRow,Buffer.from("tampered")).status,
      "DENIED","TAMPERED_EVIDENCE_DID_NOT_FAIL");

    sql(`CREATE SCHEMA ai_platform;
      CREATE SCHEMA cst_onejob_private;
      CREATE TABLE ai_platform.internal_users(
        id integer PRIMARY KEY,role text,status text,account_type text);
      CREATE TABLE ai_platform.ai_jobs(
        id integer PRIMARY KEY,status text NOT NULL,job_type text NOT NULL,
        required_capability text,max_retry integer,payload_json jsonb);
      INSERT INTO ai_platform.internal_users VALUES(1,'owner','active','internal');
      INSERT INTO ai_platform.ai_jobs VALUES(483,'waiting',
        'ollama_model_invocation','ollama_inference',0,
        jsonb_build_object('requestId',${Q(requestId)},'modelId','qwen2.5:3b'));`);
    sql(read("docs/dev/cst-onejob-owner-approval.PROPOSED.sql"));
    sql(read("docs/dev/cst-onejob-independent-receipts.PROPOSED.sql"));
    sql(read("scripts/dev/cst-onejob-signed-handoff.TESTONLY.sql"));
    sql(`INSERT INTO ai_platform.cst_onejob_owner_approvals
      (id,purpose,status,company_id,model_id,approved_by_user_id,
       request_id,worker_name,source_sha,job_id,approved_at,expires_at)
      VALUES (${Q(approvalId)},'CST_DEV_ONEJOB_MODEL','APPROVED','1',
       'qwen2.5:3b',1,${Q(requestId)},${Q(workerName)},${Q(sourceSha)},
       483,${Q(approval.approvedAt)}::timestamptz,
       ${Q(approval.expiresAt)}::timestamptz);
      INSERT INTO cst_onejob_private.verified_admission_receipts
      (approval_id,job_id,company_id,request_id,worker_name,
       image_source_sha,image_id,isolated_network_verified,
       scoped_dev_role_verified,event_audit_path_verified,
       subscriber_path_verified,independent_qa_available,nonce,proof_digest,
       verifier_id,verified_at,expires_at)
      VALUES (${Q(approvalId)},483,'1',${Q(requestId)},${Q(workerName)},
       ${Q(sourceSha)},${Q(imageId)},true,true,true,true,true,
       ${Q(claims.nonce)},${Q(receiptRow.proofDigest)},
       ${Q(verifierId)},${Q(claims.verifiedAt)}::timestamptz,
       ${Q(claims.expiresAt)}::timestamptz);`);

    assert.equal(state(),"waiting|APPROVED|0|0|t");
    expectSqlDenied(`SELECT cst_onejob_private.fixture_signed_handoff_admit(
      483,${Q("f".repeat(64))},${Q(receiptRow.proofDigest)});`,
      "FIXTURE_SIGNED_BINDING_NOT_ADMISSIBLE");
    assert.equal(state(),"waiting|APPROVED|0|0|t");

    const verified=review();
    assert.equal(verified.status,"BOUND_CRYPTO_REVIEW_ONLY",JSON.stringify(verified));
    assert.equal(verified.queueTransitionAuthorized,false);
    // Exercise fault injection after job UPDATE. Every write must roll back.
    expectSqlDenied(`SELECT cst_onejob_private.fixture_signed_handoff_admit(
      483,${Q(claims.nonce)},${Q(receiptRow.proofDigest)},'after_job');`,
      "FIXTURE_INJECTED_AFTER_JOB");
    assert.equal(state(),"waiting|APPROVED|0|0|t");

    // The positive branch is a synthetic TESTONLY function, not the real
    // broker. Its exact nonce and proof digest came from the verified
    // signature + independently rehashed evidence bytes above.
    sql(`SELECT cst_onejob_private.fixture_signed_handoff_admit(
      483,${Q(claims.nonce)},${Q(receiptRow.proofDigest)});`);
    assert.equal(state(),"queued|CONSUMED|1|1|f");
    expectSqlDenied(`SELECT cst_onejob_private.fixture_signed_handoff_admit(
      483,${Q(claims.nonce)},${Q(receiptRow.proofDigest)});`,
      "FIXTURE_SIGNED_BINDING_NOT_ADMISSIBLE");
    assert.equal(state(),"queued|CONSUMED|1|1|f");
    // Neither fixture function nor key has a path to any real CST-DEV DB.
    assert.equal(start.status,0);
  }finally{
    if(started){/* cleanup always registered via t.after */ }
  }
});
