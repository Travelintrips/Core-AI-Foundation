import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {readFileSync} from "node:fs";
import {QA_DOMAIN,qaCanonicalBytes}
  from "../../artifacts/api-server/src/lib/cstOneJobIndependentQaVerifier.ts";
import {ACK_DOMAIN,subscriberAckCanonicalBytes,reviewSignedSubscriberAck}
  from "./cst-onejob-subscriber-ack-review.mjs";
import {executeFinalAckCandidate,reviewFinalEvidence,LOCK_POST_SQL,
  FINAL_DOMAIN,finalAckCanonicalBytes}
  from "./cst-onejob-final-ack-candidate.mjs";

const sha=x=>createHash("sha256").update(x).digest("hex");
const id="123e4567-e89b-12d3-a456-426614174000";
const eventId="123e4567-e89b-12d3-a456-426614174001";
const deliveryId="123e4567-e89b-12d3-a456-426614174002";
const correlationId="123e4567-e89b-12d3-a456-426614174003";
const postId="123e4567-e89b-12d3-a456-426614174004";
const requestId="cst-ai-team-company1-dev:pilot-"+"b".repeat(20);
const worker="cst-dev-dell-onejob-20261119-abcdef12";
const sourceSha="a".repeat(40),imageId="sha256:"+"f".repeat(64);
const project="xssrfshdrtdfupgqwfdw";
const subscriberId="cst-onejob-subscriber-pilot";
const verifierId="cst-independent-qa-disposableonly";
const qa=generateKeyPairSync("ed25519");
const sub=generateKeyPairSync("ed25519");
const final=generateKeyPairSync("ed25519");
const pinned=(pair,use,idField,idValue)=>({
  use,project,[idField]:idValue,
  publicKeyPem:pair.publicKey.export({type:"spki",format:"pem"}).toString(),
  fingerprint:sha(pair.publicKey.export({type:"spki",format:"der"}))
});
const qaTrust=pinned(qa,"CST_DEV_ONEJOB_QA_PUBLIC_PIN","verifierId",verifierId);
const subTrust=pinned(sub,"CST_DEV_ONEJOB_SUBSCRIBER_PUBLIC_PIN","subscriberId",subscriberId);
const finalTrust=pinned(final,"CST_DEV_ONEJOB_FINAL_ACK_PUBLIC_PIN","issuerId","cst-final-reconciler-dev");
const response=Buffer.from("CST_DEV_ONEJOB_PROBE_OK");
const delivery=Buffer.from("independently-captured-subscriber-delivery-event");
const finalSigner=async bytes=>sign(null,bytes,final.privateKey).toString("base64");

function fixture(){
  const now=Date.now(),iso=delta=>new Date(now+delta).toISOString();
  const approval={id,jobId:483,companyId:"1",modelId:"qwen2.5:3b",
    requestId,workerName:worker,sourceSha,status:"CONSUMED",
    consumedAt:iso(-10_000)};
  const job={id:483,status:"completed",jobType:"ollama_model_invocation",
    requestId,modelId:"qwen2.5:3b",
    resultJson:{output:{type:"text",text:"CST_DEV_ONEJOB_PROBE_OK"}}};
  const admission_receipt={approvalId:id,jobId:483,companyId:"1",requestId,
    workerName:worker,imageSourceSha:sourceSha,imageId,
    nonce:"c".repeat(64),proofDigest:"d".repeat(64),consumedAt:iso(-9_000)};
  const event={eventId,correlationId,eventType:"job.completed",
    sourceModule:"job-engine",sourceId:"483",status:"processed",
    payloadJson:{jobId:483,jobType:"ollama_model_invocation"}};
  const event_audit={module:"event-bus",action:"event_published",
    resourceId:eventId,status:"success",
    details:{eventType:"job.completed",correlationId}};
  const subClaims={domain:ACK_DOMAIN,project,companyId:"1",jobId:483,
    approvalId:id,eventId,deliveryId,subscriberId,correlationId,
    deliveryDigest:sha(delivery),nonce:"e".repeat(64),
    acknowledgedAt:iso(-4_000),expiresAt:iso(90_000)};
  const signedSubscriberAck={claims:subClaims,
    signatureBase64:sign(null,subscriberAckCanonicalBytes(subClaims),
      sub.privateKey).toString("base64"),
    publicKeyFingerprint:subTrust.fingerprint};
  const subscriber={eventId,jobId:483,subscriberId,deliveryId,correlationId,
    status:"ACKNOWLEDGED",receivedAt:subClaims.acknowledgedAt,
    deliveryDigest:subClaims.deliveryDigest,ackNonce:subClaims.nonce,
    ackSignatureBase64:signedSubscriberAck.signatureBase64,
    ackIssuerFingerprint:signedSubscriberAck.publicKeyFingerprint};
  const evidenceBytes=Buffer.from(JSON.stringify({
    eventId,jobId:483,subscriberId,deliveryId,responseDigest:sha(response)
  }));
  const postClaims={domain:QA_DOMAIN,stage:"POST_EXECUTION",
    project,companyId:"1",approvalId:id,jobId:483,requestId,
    workerName:worker,sourceSha,imageId,verifierId,nonce:"f".repeat(64),
    verifiedAt:iso(-3_000),expiresAt:iso(110_000),
    evidenceDigest:sha(evidenceBytes)};
  const signedPostReceipt={claims:postClaims,
    signatureBase64:sign(null,qaCanonicalBytes(postClaims),qa.privateKey).toString("base64"),
    publicKeyFingerprint:qaTrust.fingerprint};
  return {facts:{approval,job,admission_receipt,event,event_audit,subscriber},
    signedSubscriberAck,signedPostReceipt,evidenceBytes};
}
class Client{
  constructor(facts,{wrongRole=false,failWrite=false}={}){
    this.facts=facts;this.calls=[];this.wrongRole=wrongRole;this.failWrite=failWrite;
  }
  async query(sql,params=[]){
    this.calls.push({sql,params});
    if(sql.includes("SELECT current_user AS role_name"))
      return {rows:[{role_name:this.wrongRole?"aicore_dev_runtime":
        "cst_onejob_finalack_writer",login_name:"cst_onejob_finalack_login",db:"postgres"}]};
    if(sql===LOCK_POST_SQL)return {rows:[this.facts]};
    if(sql.includes("INSERT INTO cst_onejob_private.post_execution_qa_receipts"))
      return {rows:[{id:postId}]};
    if(sql.includes("INSERT INTO cst_onejob_private.final_ack_reconciliations"))
      return {rows:[{final_ack_id:params[4]}]};
    if(sql.includes("INSERT INTO ai_platform.ai_audit_logs")&&this.failWrite)
      throw Error("SYNTHETIC_AUDIT_DENIED");
    return {rows:[]};
  }
}
function args(override={}){
  const f=fixture();
  return {client:new Client(f.facts),jobId:483,eventId,
    signedSubscriberAck:f.signedSubscriberAck,subscriberTrust:subTrust,
    deliveryBytes:delivery,signedPostReceipt:f.signedPostReceipt,
    qaTrust,evidenceBytes:f.evidenceBytes,responseBytes:response,
    expectedSubscriberId:subscriberId,signer:finalSigner,
    finalIssuerTrust:finalTrust,...override};
}
test("subscriber signature binds real event delivery bytes and only the pinned subscriber",()=>{
  const p=fixture();
  const s=p.signedSubscriberAck;
  const expected={jobId:483,approvalId:id,eventId,deliveryId,subscriberId,
    correlationId,deliveryDigest:sha(delivery)};
  const base={signedAck:s,expected,pinnedTrust:subTrust,
    deliveredBytes:delivery,nowIso:new Date().toISOString()};
  assert.equal(reviewSignedSubscriberAck(base).status,
    "CRYPTOGRAPHIC_SUBSCRIBER_ACK_VALID");
  assert.equal(reviewSignedSubscriberAck({...base,deliveredBytes:Buffer.from("changed")}).status,"DENIED");
  assert.equal(reviewSignedSubscriberAck({...base,
    expected:{...expected,subscriberId:"cst-onejob-subscriber-other"}}).status,"DENIED");
  const forged=generateKeyPairSync("ed25519");
  assert.equal(reviewSignedSubscriberAck({...base,signedAck:{...s,
    signatureBase64:sign(null,subscriberAckCanonicalBytes(s.claims),
      forged.privateKey).toString("base64")}}).status,"DENIED");
});
test("independent QA + subscriber + persisted model output correlation is required",()=>{
  const p=fixture();
  const base={facts:p.facts,signedSubscriberAck:p.signedSubscriberAck,
    subscriberTrust:subTrust,deliveryBytes:delivery,
    signedPostReceipt:p.signedPostReceipt,qaTrust,evidenceBytes:p.evidenceBytes,
    responseBytes:response,expectedSubscriberId:subscriberId};
  assert.equal(reviewFinalEvidence(base).status,"INDEPENDENT_FINAL_RECONCILIATION_MATCH");
  const wrong={...p.facts,job:{...p.facts.job,
    resultJson:{output:{type:"text",text:"INCORRECT"}}}};
  assert.equal(reviewFinalEvidence({...base,facts:wrong}).status,"DENIED");
  const noAck={...p.facts,subscriber:{...p.facts.subscriber,
    ackSignatureBase64:"FORGED"}};
  assert.equal(reviewFinalEvidence({...base,facts:noAck}).status,"DENIED");
});
test("atomic Final ACK candidate only returns success after post-QA, final ledger and audit commit",async()=>{
  const a=args();
  const v=await executeFinalAckCandidate(a);
  assert.equal(v.status,"FINAL_ACK_COMMITTED");
  assert.equal(v.finalAckIssued,true);
  assert.equal(v.dispatchPermitted,false);
  assert.equal(a.client.calls[0].sql,"BEGIN");
  assert.equal(a.client.calls.at(-1).sql,"COMMIT");
  const stmts=a.client.calls.map(c=>c.sql);
  const lock=stmts.indexOf(LOCK_POST_SQL);
  const insert=stmts.findIndex(q=>q.includes("INSERT INTO cst_onejob_private.post_execution_qa_receipts"));
  const finalIx=stmts.findIndex(q=>q.includes("INSERT INTO cst_onejob_private.final_ack_reconciliations"));
  assert.ok(lock>0&&insert>lock&&finalIx>insert);
});
test("wrong signer, forged subscriber, wrong role, audit failure all roll back; no false Final ACK",async()=>{
  const p=fixture();
  const f=generateKeyPairSync("ed25519");
  const forged={...p.signedSubscriberAck,signatureBase64:sign(null,
    subscriberAckCanonicalBytes(p.signedSubscriberAck.claims),f.privateKey).toString("base64")};
  for(const changes of [
    {signer:async bytes=>sign(null,bytes,f.privateKey).toString("base64")},
    {signedSubscriberAck:forged},
    {client:new Client(p.facts,{wrongRole:true})},
    {client:new Client(p.facts,{failWrite:true})}
  ]){
    const a=args(changes);
    await assert.rejects(executeFinalAckCandidate(a));
    assert.equal(a.client.calls.at(-1).sql,"ROLLBACK");
    assert.equal(a.client.calls.some(x=>x.sql==="COMMIT"),false);
  }
});
test("postexecution ledgers enforce FORCE RLS and separate signed final ACK evidence",()=>{
  const src=readFileSync(new URL(
    "../../docs/dev/cst-onejob-postexecution-ledgers.PROPOSED.sql",import.meta.url),"utf8");
  for(const table of ["subscriber_delivery_receipts","post_execution_qa_receipts",
    "final_ack_reconciliations"]){
    assert.match(src,new RegExp("ALTER TABLE cst_onejob_private\\."+table+
      " FORCE ROW LEVEL SECURITY;"));
    assert.match(src,new RegExp("REVOKE ALL ON cst_onejob_private\\."+table+
      " FROM PUBLIC;"));
  }
  assert.match(src,/ack_signature_base64/);
  assert.match(src,/ack_claims_digest/);
  assert.match(src,/ack_nonce text NOT NULL UNIQUE/);
  const code=src.replace(/--[^\n]*/g,"");
  assert.doesNotMatch(code,/\bGRANT\s+(?:ALL|INSERT|UPDATE|DELETE|EXECUTE)/);
  assert.doesNotMatch(code,/\bCREATE POLICY/);
});
