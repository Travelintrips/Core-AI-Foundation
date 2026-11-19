import assert from "node:assert/strict";
import {
  createHash, generateKeyPairSync, sign,
} from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CST_DEV_PROJECT, SUBSCRIBER_RECEIPT_TYPE,
  serializeCstDevSubscriberReceipt,projectCstDevSubscriberReceiptEvidence,
} from "./cst-team-onejob-subscriber-receipt.mjs";

const keyPair=generateKeyPairSync("ed25519");
const otherKey=generateKeyPairSync("ed25519");
const subscriberId="cst-dev-onejob-subscriber-20261120-abcdef12";
const workerName="cst-dev-dell-onejob-20261120-fedcba98";
const requestId="cst-ai-team-company1-dev:pilot-"+"a".repeat(20);
const eventId="25745d53-9c8d-46ae-8afc-62bfbba92711";
const correlationId="24a5dc22-318b-42b4-aaed-a7c84e24cd21";
const clock=new Date("2026-11-20T00:02:00.000Z");
const fp=key=>createHash("sha256").update(
  key.export({type:"spki",format:"der"})).digest("hex");
const trusted=Object.freeze({
  subscriberId,
  publicKeyPem:keyPair.publicKey.export({type:"spki",format:"pem"}),
  publicKeySha256:fp(keyPair.publicKey),
});
const good={
  job:{
    id:483,status:"completed",jobCode:"CSTDEV-ONEJOB-483",
    jobType:"ollama_model_invocation",requiredCapability:"ollama_inference",
    payloadJson:{requestId,modelId:"qwen2.5:3b"},
  },
  worker:{
    id:991,workerName,providerSlug:"ollama",
    runtimeKind:"ollama_remote_pull",modelId:"qwen2.5:3b",
    leaseOwner:"ollama-remote:"+workerName,
  },
  event:{
    eventId,eventType:"job.completed",sourceModule:"job-engine",
    sourceId:"483",status:"published",correlationId,
    publishedAt:"2026-11-20T00:00:00.000Z",
    payloadJson:{
      jobId:483,jobCode:"CSTDEV-ONEJOB-483",
      jobType:"ollama_model_invocation",workerId:991,
    },
  },
  eventPublishedAudit:{
    module:"event-bus",action:"event_published",
    resourceId:eventId,resourceType:"ai_event",status:"success",
    details:{eventType:"job.completed",sourceModule:"job-engine",
      correlationId},
  },
};
const payload=Object.freeze({
  version:1,type:SUBSCRIBER_RECEIPT_TYPE,
  project:CST_DEV_PROJECT,companyId:"1",eventId,
  jobId:483,jobCode:"CSTDEV-ONEJOB-483",
  requestId,workerId:991,correlationId,
  subscriberId,deliveryState:"delivered",
  receivedAt:"2026-11-20T00:01:00.000Z",
  nonce:"c".repeat(32),
});
function envelope(p=payload,privateKey=keyPair.privateKey) {
  const signature=sign(null,serializeCstDevSubscriberReceipt(p),privateKey);
  return {payload:p,signatureBase64:signature.toString("base64")};
}
const valid={...good,receipt:envelope()};
const verdict=(input=valid,pin=trusted,date=clock)=>
  projectCstDevSubscriberReceiptEvidence(input,pin,date);
function reject(input,reason,pin=trusted,date=clock) {
  const v=verdict(input,pin,date);
  assert.equal(v.signedReceiptConsistent,false,JSON.stringify(v));
  assert.ok(v.blockers.includes(reason),JSON.stringify(v.blockers));
  assert.equal(v.subscriberDeliveryVerified,false);
  assert.equal(v.independentFinalAckVerified,false);
  assert.equal(v.sideEffects,"NONE");
}
const tamper=(change)=>{
 const x=structuredClone(valid);
 change(x);
 return x;
};

test("a correctly signed exact one-job receipt proves ONLY cryptographic lineage",()=>{
 const v=verdict();
 assert.equal(v.signedReceiptConsistent,true,JSON.stringify(v));
 assert.deepEqual(v.blockers,[]);
 assert.equal(v.mode,"SIGNED_RECEIPT_CRYPTOGRAPHIC_AND_LINEAGE_CHECK_ONLY");
 assert.equal(v.durableReceiptReadbackVerified,false);
 assert.equal(v.authenticatedSubscriberSessionVerified,false);
 assert.equal(v.subscriberDeliveryVerified,false);
 assert.equal(v.operationalE2EVerified,false);
 assert.equal(v.independentQaVerified,false);
 assert.equal(v.independentFinalAckVerified,false);
 assert.equal(v.sideEffects,"NONE");
});

test("no event, mismatched job, historic #482, other company cannot become proof",()=>{
 reject({...valid,receipt:null},"INDEPENDENT_SUBSCRIBER_LINEAGE_MISMATCH");
 reject(tamper(x=>x.job.id=482),"ONE_NEW_COMPANY1_MODEL_JOB_NOT_VERIFIED");
 reject(tamper(x=>x.job.status="queued"),"ONE_NEW_COMPANY1_MODEL_JOB_NOT_VERIFIED");
 reject(tamper(x=>x.job.payloadJson.modelId="qwen2.5-coder:7b"),"ONE_NEW_COMPANY1_MODEL_JOB_NOT_VERIFIED");
 reject(tamper(x=>x.job.payloadJson.requestId="cst-ai-team-company3-dev:pilot-"+ "a".repeat(20)),"ONE_NEW_COMPANY1_MODEL_JOB_NOT_VERIFIED");
 reject(tamper(x=>x.event.sourceId="482"),"PERSISTED_JOB_COMPLETED_EVENT_NOT_VERIFIED");
 reject(tamper(x=>x.event.status="failed"),"PERSISTED_JOB_COMPLETED_EVENT_NOT_VERIFIED");
 reject(tamper(x=>x.event.payloadJson.workerId=12345),"PERSISTED_JOB_COMPLETED_EVENT_NOT_VERIFIED");
 reject(tamper(x=>x.worker.leaseOwner="untrusted-claim"),"ONE_BOUNDED_WORKER_NOT_VERIFIED");
 reject(tamper(x=>x.worker.workerName="openclaw-vps-main"),"ONE_BOUNDED_WORKER_NOT_VERIFIED");
});

test("atomic event/audit persistence is not a subscriber receipt",()=>{
 reject({...valid,eventPublishedAudit:null},"ATOMIC_EVENT_PUBLISHED_AUDIT_NOT_VERIFIED");
 reject(tamper(x=>x.eventPublishedAudit.details.correlationId="wrong"),"ATOMIC_EVENT_PUBLISHED_AUDIT_NOT_VERIFIED");
 reject(tamper(x=>x.eventPublishedAudit.action="job_completed_received"),"ATOMIC_EVENT_PUBLISHED_AUDIT_NOT_VERIFIED");
 const x={...good}; // real event+audit exists, but subscriber has no receipt
 const v=verdict(x);
 assert.equal(v.signedReceiptConsistent,false);
 assert.equal(v.subscriberDeliveryVerified,false);
 assert.ok(v.blockers.includes("SIGNED_SUBSCRIBER_RECEIPT_NOT_VERIFIED"));
});

test("the trust root is separately pinned, never accepted from receipt fields",()=>{
 const x=tamper(q=>q.receipt.signatureBase64=envelope(payload,otherKey.privateKey).signatureBase64);
 reject(x,"SIGNED_SUBSCRIBER_RECEIPT_NOT_VERIFIED");
 reject(valid,"INDEPENDENT_SUBSCRIBER_TRUST_ROOT_NOT_PINNED",
  {...trusted,publicKeySha256:"f".repeat(64)});
 reject(valid,"INDEPENDENT_SUBSCRIBER_TRUST_ROOT_NOT_PINNED",
  {...trusted,publicKeyPem:otherKey.publicKey.export({type:"spki",format:"pem"})});
 reject(valid,"INDEPENDENT_SUBSCRIBER_TRUST_ROOT_NOT_PINNED",
  {...trusted,publicKeyPem:"BOGUS"});
 reject(valid,"INDEPENDENT_SUBSCRIBER_LINEAGE_MISMATCH",
  {...trusted,subscriberId:"cst-dev-onejob-subscriber-20261120-deadbeef"});
 const forged=tamper(x=>{
   x.receipt.payload.publicKeyPem=trusted.publicKeyPem;
 });
 reject(forged,"SIGNED_SUBSCRIBER_RECEIPT_NOT_VERIFIED");
});

test("signed content binds EXACT job, event, consumer, worker and company",()=>{
 const fields=[
  ["eventId","25745d53-9c8d-46ae-8afc-62bfbba92712"],
  ["jobId",484],["jobCode","WRONG-CODE"],["workerId",992],
  ["requestId","cst-ai-team-company1-dev:pilot-"+"b".repeat(20)],
  ["correlationId","24a5dc22-318b-42b4-aaed-a7c84e24cd22"],
  ["companyId","3"],["project","nzdweipzckfszczzqtuw"],
  ["subscriberId","cst-dev-onejob-subscriber-20261120-deadbeef"],
 ];
 for (const [field,value] of fields){
   const x=tamper(y=>{y.receipt.payload[field]=value});
   reject(x,"INDEPENDENT_SUBSCRIBER_LINEAGE_MISMATCH");
 }
 const reordered={...payload};
 const reversed=Object.fromEntries(Object.entries(reordered).reverse());
 assert.deepEqual(serializeCstDevSubscriberReceipt(reversed),
   serializeCstDevSubscriberReceipt(payload));
});

test("extra fields, self-declared certificate and malformed base64 are rejected",()=>{
 for(const extra of ["privateKey","publicKeyPem","signatureVerified","finalAckVerified","deliveredWithoutReceipt"]){
   const x=tamper(y=>{y.receipt.payload[extra]=true});
   reject(x,"SIGNED_SUBSCRIBER_RECEIPT_NOT_VERIFIED");
 }
 for(const b64 of ["","@@",Buffer.alloc(64).toString("base64")+"A","abc","not-a-key"]){
   reject(tamper(x=>{x.receipt.signatureBase64=b64}),
     "SIGNED_SUBSCRIBER_RECEIPT_NOT_VERIFIED");
 }
 const x=tamper(y=>{y.receipt.payload.deliveryState="pending"});
 reject(x,"SIGNED_SUBSCRIBER_RECEIPT_NOT_VERIFIED");
});

test("stale, reordered or future replay timestamps never count",()=>{
 const old=tamper(x=>{x.receipt.payload.receivedAt="2026-11-19T23:59:00.000Z"});
 reject(old,"RECEIPT_TIME_OR_REPLAY_WINDOW_INVALID");
 const late=tamper(x=>{x.receipt.payload.receivedAt="2026-11-20T00:11:00.000Z"});
 reject(late,"RECEIPT_TIME_OR_REPLAY_WINDOW_INVALID");
 reject(valid,"RECEIPT_TIME_OR_REPLAY_WINDOW_INVALID",trusted,new Date("2026-11-20T01:00:00.000Z"));
 reject(valid,"RECEIPT_TIME_OR_REPLAY_WINDOW_INVALID",trusted,new Date("2026-11-19T23:50:00.000Z"));
});

test("no side-effect source: verification never signs, dispatches or alters DB",()=>{
 const src=readFileSync(new URL("./cst-team-onejob-subscriber-receipt.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(src,/from ["']node:child_process|from ["']pg|from ["']@workspace\/db/);
 assert.doesNotMatch(src,/\bfetch\(|\bconnect\(|\bexecFile\(|\bspawn\(/);
 assert.doesNotMatch(src,/\b(?:CREATE|INSERT|UPDATE|DELETE|ALTER)\s+(?:INTO|TABLE|ROLE)\b/i);
 assert.match(src,/independentFinalAckVerified:false/);
 assert.match(src,/subscriberDeliveryVerified:false/);
 assert.match(src,/createPublicKey\(trusted\?\.publicKeyPem\)/);
 assert.match(src,/trusted\.publicKeySha256===pin/);
});
