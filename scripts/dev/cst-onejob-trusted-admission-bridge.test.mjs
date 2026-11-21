import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {QA_DOMAIN,qaCanonicalBytes} from "../../artifacts/api-server/src/lib/cstOneJobIndependentQaVerifier.ts";
import {
  executeTrustedAdmissionTransaction,reviewAdmissionBeforeDatabase,
  reviewBrokerEnvironment,ADMISSION_SQL,main
} from "./cst-onejob-trusted-admission-bridge.mjs";
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
class FakeClient {
  constructor({wrongRole=false,capabilityDenied=false,wrongJob=false,emptyResult=false}={}){
    this.queries=[];
    this.wrongRole=wrongRole;
    this.capabilityDenied=capabilityDenied;
    this.wrongJob=wrongJob;
    this.emptyResult=emptyResult;
  }
  async query(statement,parameters=[]){
    this.queries.push({statement,parameters});
    if(statement.includes("FROM ai_platform.")||
       statement.includes("FROM cst_onejob_private.verified_admission_receipts")||
       statement.includes("FOR UPDATE"))
      throw Error("BROKER_DIRECT_TABLE_ACCESS_FORBIDDEN");
    if(statement.includes("SELECT current_user AS role_name"))
      return {rows:[{role_name:this.wrongRole?"aicore_dev_runtime":"cst_onejob_admission_broker",
        login_name:"cst_onejob_broker_login",db:"postgres"}]};
    if(statement===ADMISSION_SQL){
      if(this.capabilityDenied)throw Error("CAPABILITY_NOT_INSTALLED_OR_DENIED");
      if(this.emptyResult)return {rows:[]};
      return {rows:[{job_id:this.wrongJob?484:483}]};
    }
    return {rows:[]};
  }
}
const call=(client,receipt,patch={})=>executeTrustedAdmissionTransaction({
  client,jobId:483,signedReceipt:receipt,evidenceBytes:evidence,
  pinnedTrust:trust,approvedSourceSha:sourceSha,...patch
});
test("valid signed QA evidence is checked BEFORE SQL; broker calls ONLY bounded DB capability",async()=>{
  const {row,signedReceipt}=fixture();
  const client=new FakeClient();
  const preflight=reviewAdmissionBeforeDatabase({
    jobId:483,signedReceipt,evidenceBytes:evidence,pinnedTrust:trust,
    approvedSourceSha:sourceSha
  });
  assert.deepEqual(preflight,{jobId:483,nonce:row.r_nonce,proofDigest:row.r_proof_digest});
  const result=await call(client,signedReceipt);
  assert.equal(result.status,"ADMISSION_COMMITTED");
  assert.equal(result.dispatchPermitted,false);
  assert.equal(result.finalAckIssued,false);
  const ops=client.queries.map(x=>x.statement);
  assert.deepEqual(ops,[
    "BEGIN","SET TRANSACTION READ WRITE","SET LOCAL ROLE cst_onejob_admission_broker",
    "SELECT current_user AS role_name,session_user AS login_name,current_database() AS db",
    ADMISSION_SQL,"COMMIT"
  ]);
  assert.deepEqual(client.queries[4].parameters,[483,row.r_nonce,row.r_proof_digest]);
  assert.equal(ops.some(x=>x.includes("FOR UPDATE")||
    x.includes("FROM ai_platform.")||x.includes("UPDATE ai_platform")),false);
  assert.equal(ops.includes("SELECT cst_onejob_private.admit_verified_onejob($1::integer,$2::text,$3::text) AS job_id"),false);
});
test("fake, mutated, expired, wrong job, bad source, altered evidence: ZERO DB queries",async()=>{
  const {signedReceipt}=fixture();
  const fake=generateKeyPairSync("ed25519");
  const forged={...signedReceipt,signatureBase64:sign(null,
    qaCanonicalBytes(signedReceipt.claims),fake.privateKey).toString("base64")};
  const mutated={...signedReceipt,claims:{...signedReceipt.claims,
    requestId:"cst-ai-team-company1-dev:pilot-"+"d".repeat(20)}};
  const expiredClaims={...signedReceipt.claims,
    verifiedAt:new Date(Date.now()-360000).toISOString(),
    expiresAt:new Date(Date.now()-60000).toISOString()};
  const expired={...signedReceipt,claims:expiredClaims,
    signatureBase64:sign(null,qaCanonicalBytes(expiredClaims),privateKey).toString("base64")};
  const wrongProjectClaims={...signedReceipt.claims,project:"nzdweipzckfszczzqtuw"};
  const wrongProject={...signedReceipt,claims:wrongProjectClaims,
    signatureBase64:sign(null,qaCanonicalBytes(wrongProjectClaims),privateKey).toString("base64")};
  const cases=[
    {signedReceipt:forged},{signedReceipt:mutated},{signedReceipt:expired},
    {signedReceipt:wrongProject},{evidenceBytes:Buffer.from("TAMPERED")},
    {approvedSourceSha:"b".repeat(40)},{jobId:482},{jobId:484},
    {pinnedTrust:{...trust,fingerprint:"f".repeat(64)}},
    {pinnedTrust:{...trust,verifierId:"cst-independent-qa-wrong_verifier"}}
  ];
  for(const patch of cases){
    const client=new FakeClient();
    await assert.rejects(call(client,signedReceipt,patch));
    assert.deepEqual(client.queries,[],"No SQL before trusted proof has passed");
  }
});
test("wrong dedicated DB identity denies capability call and rolls back",async()=>{
  const {signedReceipt}=fixture();
  const client=new FakeClient({wrongRole:true});
  await assert.rejects(call(client,signedReceipt),/BROKER_SESSION_NOT_BOUND/);
  assert.equal(client.queries.at(-1).statement,"ROLLBACK");
  assert.equal(client.queries.some(x=>x.statement===ADMISSION_SQL),false);
});
test("missing or denied capability, wrong or absent return fail closed with rollback",async()=>{
  const {signedReceipt}=fixture();
  for(const opts of [
    {capabilityDenied:true},{wrongJob:true},{emptyResult:true}
  ]){
    const client=new FakeClient(opts);
    await assert.rejects(call(client,signedReceipt));
    assert.equal(client.queries.some(x=>x.statement==="COMMIT"),false);
    assert.equal(client.queries.at(-1).statement,"ROLLBACK");
  }
});
test("default-off dedicated broker config rejects missing credential, bad TLS or DEV mismatch",async()=>{
  const env={APP_ENV:"development",NODE_ENV:"development",
    SUPABASE_URL_DEV:"https://xssrfshdrtdfupgqwfdw.supabase.co",
    CST_DEV_ONEJOB_BROKER_ENABLED:"true",AI_DISPATCHER_ENABLED:"false",
    OLLAMA_WORKER_RUNTIME_ENABLED:"false",
    CST_TEAM_DEV_APPROVED_SOURCE_SHA:sourceSha,
    CST_DEV_ONEJOB_BROKER_DATABASE_URL:
      "postgresql://cst_onejob_broker_login.xssrfshdrtdfupgqwfdw:syntheticpasswordonly123@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=verify-full"};
  assert.equal(reviewBrokerEnvironment(env).ready,true);
  for(const patch of [
    {CST_DEV_ONEJOB_BROKER_ENABLED:"false"},
    {CST_DEV_ONEJOB_BROKER_DATABASE_URL:undefined},
    {CST_DEV_ONEJOB_BROKER_DATABASE_URL:env.CST_DEV_ONEJOB_BROKER_DATABASE_URL.replace("6543","5432")},
    {SUPABASE_PROD_DATABASE_URL:"present"},
    {CST_DEV_ONEJOB_BROKER_DATABASE_URL:env.CST_DEV_ONEJOB_BROKER_DATABASE_URL.replace(
      "aws-1-ap-southeast-2.pooler.supabase.com","aws-0-ap-southeast-1.pooler.supabase.com")}
  ])assert.equal(reviewBrokerEnvironment({...env,...patch}).ready,false);
  const denied=await main(["--nope"],env);
  assert.equal(denied.reason,"EXPLICIT_APPROVED_DEV_MODE_REQUIRED");
});
