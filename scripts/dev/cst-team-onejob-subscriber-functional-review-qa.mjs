/**
 * Independent readback from disposable PG16 fixture ONLY.
 * Not an attestor for real CST-DEV, not a Final ACK or operational authority.
 * Public key is provisioned separately in the QA fixture, NOT copied from
 * the receipt row and NOT an accepted self-declared trust root.
 */
import assert from "node:assert/strict";
import { createHash, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { projectCstDevSubscriberReceiptEvidence } from "./cst-team-onejob-subscriber-receipt.mjs";

if(process.env.CST_ONEJOB_PG16_DISPOSABLE_QA!=="true")
  throw Error("DISPOSABLE_REVIEW_ONLY");
const [factsPath,pubPath]=process.argv.slice(2);
const facts=JSON.parse(readFileSync(factsPath,"utf8"));
const pem=readFileSync(pubPath,"utf8");
const publicKey=createPublicKey(pem);
const pin=createHash("sha256").update(
  publicKey.export({type:"spki",format:"der"})).digest("hex");
const j=facts.job,w=facts.worker,e=facts.event,a=facts.eventPublishedAudit;
assert.equal(facts.database,"cst_onejob_subscriber_functional_fixture");
assert.equal(facts.receiptCount,1);
assert.equal(facts.duplicateCount,1);
const canonical={
  job:{
    id:j.id,jobCode:j.job_code,status:j.status,
    jobType:j.job_type,requiredCapability:j.required_capability,
    payloadJson:j.payload_json,
  },
  worker:{
    id:w.id,workerName:w.worker_name,
    providerSlug:w.provider_slug,runtimeKind:w.runtime_kind,
    modelId:w.model_id,leaseOwner:w.lease_owner,
  },
  event:{
    eventId:e.event_id,eventType:e.event_type,
    sourceModule:e.source_module,sourceId:e.source_id,
    status:e.status,correlationId:e.correlation_id,
    publishedAt:new Date(e.published_at).toISOString(),
    payloadJson:e.payload_json,
  },
  eventPublishedAudit:{
    module:a.module,action:a.action,resourceId:a.resource_id,
    resourceType:a.resource_type,status:a.status,details:a.details,
  },
  receipt:facts.receipt,
};
const verdict=projectCstDevSubscriberReceiptEvidence(canonical,{
  subscriberId:"cst-dev-onejob-subscriber-20261120-abcdef12",
  publicKeyPem:pem,publicKeySha256:pin,
});
assert.equal(verdict.signedReceiptConsistent,true,JSON.stringify(verdict));
assert.equal(verdict.subscriberDeliveryVerified,false);
assert.equal(verdict.independentQaVerified,false);
assert.equal(verdict.independentFinalAckVerified,false);
assert.equal(verdict.sideEffects,"NONE");
console.log(JSON.stringify({
  result:"DISPOSABLE_PG16_SIGNED_RECEIPT_INDEPENDENT_READBACK_PASS",
  roleWasLimitedToOneEvent:true,immutableReceiptCount:1,
  pinnedEd25519SignatureValid:true,
  liveCstDevSubscriberDeliveryVerified:false,
  finalAckVerified:false,prodTouched:false,
}));
