import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {QA_DOMAIN,qaCanonicalBytes} from "../../artifacts/api-server/src/lib/cstOneJobIndependentQaVerifier.ts";
import {executeTrustedAdmissionTransaction,reviewBrokerEnvironment,LOCK_SQL,main}
  from "./cst-onejob-trusted-admission-bridge.mjs";
const hash=x=>createHash("sha256").update(x).digest("hex");
const approvalId="123e4567-e89b-12d3-a456-426614174000";
const requestId="cst-ai-team-company1-dev:pilot-"+"b".repeat(20);
const workerName="cst-dev-dell-onejob-20261119-abcdef12";
const sourceSha="a".repeat(40),imageId="sha256:"+"f".repeat(64);
const verifierId="cst-independent-qa-disposableonly";
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const trust={project:"xssrfshdrtdfupgqwfdw",verifierId,
  publicKeyPem:publicKey.export({type:"spki",format:"pem"}).toString(),
  fingerprint:hash(publicKey.export({type:"spki",format:"der"}))};
const evidence=Buffer.from("separate-QA-source-bytes");
function fixture(){
  const now=Date.now(),iso=ms=>new Date(ms).toISOString();
  const row={
    a_id:approvalId,a_job_id:483,a_owner_id:1,a_status:"APPROVED",
    a_purpose:"CST_DEV_ONEJOB_MODEL",a_company_id:"1",a_model_id:"qwen2.5:3b",
    a_request_id:requestId,a_worker_name:workerName,a_source_sha:sourceSha,
    a_approved_at:iso(now-120000),a_expires_at:iso(now+1200000),a_consumed_at:null,
    j_id:483,j_status:"waiting",j_type:"ollama_model_invocation",
    j_capability:"ollama_inference",j_max_retry:0,j_request_id:requestId,
    j_model_id:"qwen2.5:3b",
    r_approval_id:approvalId,r_job_id:483,r_company_id:"1",
    r_request_id:requestId,r_worker_name:workerName,r_source_sha:sourceSha,
    r_image_id:imageId,r_verifier_id:verifierId,
    r_nonce:"c".repeat(64),r_proof_digest:"",
    r_verified_at:iso(now-60000),r_expires_at:iso(now+180000),r_consumed_at:null
  };
  const claims={domain:QA_DOMAIN,stage:"PRE_ADMISSION",project:trust.project,
    companyId:"1",approvalId,jobId:483,requestId,workerName,sourceSha,imageId,
    verifierId,nonce:row.r_nonce,verifiedAt:row.r_verified_at,
    expiresAt:row.r_expires_at,evidenceDigest:hash(evidence)};
  row.r_proof_digest=hash(qaCanonicalBytes(claims));
  const signedReceipt={claims,
    signatureBase64:sign(null,qaCanonicalBytes(claims),privateKey).toString("base64"),
    publicKeyFingerprint:trust.fingerprint};
  return {row,signedReceipt};
}
class FakeClient{
  constructor(row,{wrongRole=false}={}){this.row=row;this.queries=[];this.wrongRole=wrongRole}
  async query(statement,parameters=[]){
    this.queries.push({statement,parameters});
    if(statement.includes("SELECT current_user AS role_name"))
      return {rows:[{role_name:this.wrongRole?"aicore_dev_runtime":"cst_onejob_admission_broker",
        login_name:"cst_onejob_broker_login",db:"postgres"}]};
    if(statement===LOCK_SQL)return {rows:[this.row]};
    if(statement.includes("SELECT cst_onejob_private.admit_verified_onejob"))
      return {rows:[{job_id:483}]};
    return {rows:[]};
  }
}
const call=(client,receipt,patch={})=>executeTrustedAdmissionTransaction({
  client,jobId:483,signedReceipt:receipt,evidenceBytes:evidence,
  pinnedTrust:trust,approvedSourceSha:sourceSha,...patch
});
test("valid signed QA proof is checked after FOR UPDATE and before same-transaction consumption",async()=>{
  const {row,signedReceipt}=fixture();
  const client=new FakeClient(row);
  const result=await call(client,signedReceipt);
  assert.equal(result.status,"ADMISSION_COMMITTED");
  assert.equal(result.dispatchPermitted,false);
  assert.equal(result.finalAckIssued,false);
  const ops=client.queries.map(x=>x.statement);
  const locked=ops.indexOf(LOCK_SQL);
  const consumed=ops.findIndex(x=>x.includes("SELECT cst_onejob_private.admit_verified_onejob"));
  assert.ok(ops[0]==="BEGIN"&&ops.includes("SET LOCAL ROLE cst_onejob_admission_broker"));
  assert.ok(locked>0&&consumed>locked&&ops.at(-1)==="COMMIT");
  assert.deepEqual(client.queries[consumed].parameters,[483,row.r_nonce,row.r_proof_digest]);
});
test("forged QA signature, changed bytes, wrong role and image SHA cannot reach broker SQL",async()=>{
  const {row,signedReceipt}=fixture();
  const fake=generateKeyPairSync("ed25519");
  const forged={...signedReceipt,signatureBase64:sign(null,
    qaCanonicalBytes(signedReceipt.claims),fake.privateKey).toString("base64")};
  for(const patch of [
    {signedReceipt:forged},
    {evidenceBytes:Buffer.from("TAMPERED")},
    {approvedSourceSha:"b".repeat(40)},
    {jobId:482}
  ]){
    const client=new FakeClient(row);
    await assert.rejects(call(client,signedReceipt,patch));
    assert.equal(client.queries.some(x=>x.statement.includes("admit_verified_onejob")),false);
    assert.equal(client.queries.some(x=>x.statement==="COMMIT"),false);
    if(patch.jobId!==482)assert.equal(client.queries.at(-1).statement,"ROLLBACK");
  }
  const client=new FakeClient(row,{wrongRole:true});
  await assert.rejects(call(client,signedReceipt));
  assert.equal(client.queries.at(-1).statement,"ROLLBACK");
});
test("default-off dedicated broker config rejects missing credential, bad TLS or DEV mismatch",async()=>{
  const env={APP_ENV:"development",NODE_ENV:"development",
    SUPABASE_URL_DEV:"https://xssrfshdrtdfupgqwfdw.supabase.co",
    CST_DEV_ONEJOB_BROKER_ENABLED:"true",AI_DISPATCHER_ENABLED:"false",
    OLLAMA_WORKER_RUNTIME_ENABLED:"false",
    CST_TEAM_DEV_APPROVED_SOURCE_SHA:sourceSha,
    CST_DEV_ONEJOB_BROKER_DATABASE_URL:
      "postgresql://cst_onejob_broker_login.xssrfshdrtdfupgqwfdw:syntheticpasswordonly123@aws-0-test.pooler.supabase.com:6543/postgres?sslmode=verify-full"};
  assert.equal(reviewBrokerEnvironment(env).ready,true);
  for(const patch of [
    {CST_DEV_ONEJOB_BROKER_ENABLED:"false"},
    {CST_DEV_ONEJOB_BROKER_DATABASE_URL:undefined},
    {CST_DEV_ONEJOB_BROKER_DATABASE_URL:env.CST_DEV_ONEJOB_BROKER_DATABASE_URL.replace("6543","5432")},
    {SUPABASE_PROD_DATABASE_URL:"present"}
  ])assert.equal(reviewBrokerEnvironment({...env,...patch}).ready,false);
  const denied=await main(["--nope"],env);
  assert.equal(denied.reason,"EXPLICIT_APPROVED_DEV_MODE_REQUIRED");
});
