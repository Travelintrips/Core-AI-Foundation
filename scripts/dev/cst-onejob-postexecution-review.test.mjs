import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {readFileSync} from "node:fs";
import {QA_DOMAIN,qaCanonicalBytes} from "../../artifacts/api-server/src/lib/cstOneJobIndependentQaVerifier.ts";
import {reviewCstOneJobPostExecution} from "./cst-onejob-postexecution-review.mjs";
const hash=x=>createHash("sha256").update(x).digest("hex");
const id="123e4567-e89b-12d3-a456-426614174000";
const eventId="123e4567-e89b-12d3-a456-426614174001";
const deliveryId="123e4567-e89b-12d3-a456-426614174002";
const req="cst-ai-team-company1-dev:pilot-"+"b".repeat(20);
const worker="cst-dev-dell-onejob-20261119-abcdef12";
const sourceSha="a".repeat(40),imageId="sha256:"+"f".repeat(64);
const verifierId="cst-independent-qa-disposableonly";
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const fingerprint=hash(publicKey.export({type:"spki",format:"der"}));
const trust={project:"xssrfshdrtdfupgqwfdw",verifierId,
  publicKeyPem:publicKey.export({type:"spki",format:"pem"}).toString(),fingerprint};
const response=Buffer.from("CST_DEV_ONEJOB_PROBE_OK");
function fixture(){
  const now=Date.now(),iso=ms=>new Date(ms).toISOString();
  const approval={id,jobId:483,companyId:"1",modelId:"qwen2.5:3b",
    requestId:req,workerName:worker,sourceSha,status:"CONSUMED",consumedAt:iso(now-10_000)};
  const job={id:483,status:"completed",jobType:"ollama_model_invocation",requestId:req,modelId:"qwen2.5:3b"};
  const admissionReceipt={approvalId:id,jobId:483,companyId:"1",requestId:req,
    workerName:worker,imageSourceSha:sourceSha,imageId,
    nonce:"c".repeat(64),proofDigest:"d".repeat(64),consumedAt:iso(now-8_000)};
  const event={eventId,correlationId:"123e4567-e89b-12d3-a456-426614174003",
    eventType:"job.completed",sourceModule:"job-engine",sourceId:"483",
    status:"processed",payloadJson:{jobId:483,jobType:"ollama_model_invocation"}};
  const eventAudit={module:"event-bus",action:"event_published",resourceId:eventId,
    status:"success",details:{eventType:"job.completed",correlationId:event.correlationId}};
  const subscriber={eventId,jobId:483,subscriberId:"cst-onejob-subscriber-pilot",
    deliveryId,correlationId:event.correlationId,status:"ACKNOWLEDGED",
    receivedAt:iso(now-4_000),deliveryDigest:"e".repeat(64)};
  const independentlyCapturedEvidence=Buffer.from(JSON.stringify({
    eventId,jobId:483,subscriberId:subscriber.subscriberId,deliveryId,
    responseDigest:hash(response)
  }));
  const claims={domain:QA_DOMAIN,stage:"POST_EXECUTION",project:trust.project,
    companyId:"1",approvalId:id,jobId:483,requestId:req,workerName:worker,
    sourceSha,imageId,verifierId,nonce:"f".repeat(64),
    verifiedAt:iso(now-4_000),expiresAt:iso(now+100_000),
    evidenceDigest:hash(independentlyCapturedEvidence)};
  const postExecutionSignedReceipt={
    claims,signatureBase64:sign(null,qaCanonicalBytes(claims),privateKey).toString("base64"),
    publicKeyFingerprint:fingerprint
  };
  return {approval,job,admissionReceipt,event,eventAudit,subscriber,
    independentlyCapturedEvidence,independentlyCapturedResponse:response,
    expectedSubscriberId:subscriber.subscriberId,qaPublicKey:trust,
    postExecutionSignedReceipt};
}
function review(patch){return reviewCstOneJobPostExecution({...fixture(),...patch})}
test("signed independent post execution + persisted event, audit, subscriber and reply correlate; never Final ACK",()=>{
  const result=review({});
  assert.equal(result.status,"POST_EXECUTION_CORRELATION_REVIEW_ONLY",JSON.stringify(result));
  assert.equal(result.independentFinalAckReady,true);
  assert.equal(result.finalAckIssued,false);
  assert.equal(result.dispatchPermitted,false);
  assert.equal(result.queueTransitionAuthorized,false);
});
test("tampered QA evidence, wrong reply, missing subscriber and changed event all deny",()=>{
  const baseline=fixture();
  for(const patch of [
    {independentlyCapturedEvidence:Buffer.from("tampered")},
    {independentlyCapturedResponse:Buffer.from("WRONG_REPLY")},
    {subscriber:{...baseline.subscriber,status:"PENDING"}},
    {subscriber:{...baseline.subscriber,subscriberId:"cst-onejob-subscriber-evil"}},
    {event:{...baseline.event,eventId:"123e4567-e89b-12d3-a456-426614174099"}},
    {eventAudit:{...baseline.eventAudit,resourceId:"123e4567-e89b-12d3-a456-426614174099"}},
    {approval:{...baseline.approval,status:"APPROVED"}},
    {job:{...baseline.job,id:482}},
    {postExecutionSignedReceipt:{...baseline.postExecutionSignedReceipt,claims:{
      ...baseline.postExecutionSignedReceipt.claims,stage:"PRE_ADMISSION"}}}
  ]){
    const r=reviewCstOneJobPostExecution({...baseline,...patch});
    assert.equal(r.status,"DENIED",JSON.stringify(patch));
    assert.equal(r.finalAckIssued,false);
  }
});
test("forged post-QA key and replayed pre-admission nonce deny",()=>{
  const p=fixture();
  const evil=generateKeyPairSync("ed25519");
  const forged={...p.postExecutionSignedReceipt,
    signatureBase64:sign(null,qaCanonicalBytes(p.postExecutionSignedReceipt.claims),
      evil.privateKey).toString("base64")};
  assert.equal(reviewCstOneJobPostExecution({...p,postExecutionSignedReceipt:forged}).status,"DENIED");
  const reusedClaims={...p.postExecutionSignedReceipt.claims,nonce:p.admissionReceipt.nonce};
  const reused={claims:reusedClaims,
    signatureBase64:sign(null,qaCanonicalBytes(reusedClaims),privateKey).toString("base64"),
    publicKeyFingerprint:fingerprint};
  assert.equal(reviewCstOneJobPostExecution({...p,postExecutionSignedReceipt:reused}).status,"DENIED");
});
test("subscriber and Core reconciliation ledgers stay private with forced RLS, no broad grants",()=>{
  const text=readFileSync(new URL("../../docs/dev/cst-onejob-postexecution-ledgers.PROPOSED.sql",import.meta.url),"utf8");
  for(const table of ["subscriber_delivery_receipts","post_execution_qa_receipts","core_signed_reconciliations"]){
    assert.match(text,new RegExp("ALTER TABLE cst_onejob_private\\."+table+" ENABLE ROW LEVEL SECURITY;"));
    assert.match(text,new RegExp("ALTER TABLE cst_onejob_private\\."+table+" FORCE ROW LEVEL SECURITY;"));
    assert.match(text,new RegExp("REVOKE ALL ON cst_onejob_private\\."+table+" FROM PUBLIC;"));
  }
  const sql=text.replace(/--[^\n]*/g,"");
  assert.doesNotMatch(sql,/\bGRANT\s+(?:ALL|INSERT|UPDATE|DELETE|EXECUTE)\b/i);
  assert.doesNotMatch(sql,/\bCREATE\s+POLICY\b/i);
});
