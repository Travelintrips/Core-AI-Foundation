/**
 * CST-DEV one-job POST_EXECUTION evidence reconciliation.
 * Read-only, independent-QA-shaped verifier. Does not deliver an event, issue
 * a Final ACK, open a database connection, enable signer, or dispatch a worker.
 * All rows must be independently acquired from authoritative sources; an API
 * response from the system being inspected is NOT trustworthy evidence.
 */
import {createHash} from "node:crypto";
import {reviewSignedIndependentQaReceipt} from
  "../../artifacts/api-server/src/lib/cstOneJobIndependentQaVerifier.ts";

const DEV="xssrfshdrtdfupgqwfdw";
const HASH=/^[a-f0-9]{64}$/;
const EVENT_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const EXPECTED_REPLY="CST_DEV_ONEJOB_PROBE_OK";
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const hex=bytes=>createHash("sha256").update(bytes).digest("hex");
const deny=(blockers)=>({
  status:"DENIED",blockers,
  independentFinalAckReady:false,finalAckIssued:false,
  queueTransitionAuthorized:false,dispatchPermitted:false
});

/** Returns a correlational proof only. Final ACK must be issued separately. */
export function reviewCstOneJobPostExecution(input) {
  const blockers=[];
  const check=(condition,code)=>{if(!condition)blockers.push(code)};
  const a=input?.approval,j=input?.job,r=input?.admissionReceipt;
  const event=input?.event,audit=input?.eventAudit,sub=input?.subscriber;
  const s=input?.postExecutionSignedReceipt,k=input?.qaPublicKey;
  const c=s?.claims;
  const response=input?.independentlyCapturedResponse;
  const proof=input?.independentlyCapturedEvidence;
  const expectedSubscriber=input?.expectedSubscriberId;
  check(obj(a)&&obj(j)&&obj(r),"AUTHORITATIVE_JOB_APPROVAL_RECEIPT_REQUIRED");
  check(obj(event)&&obj(audit)&&obj(sub),"PERSISTED_EVENT_AUDIT_SUBSCRIBER_REQUIRED");
  check(obj(c)&&obj(k),"SIGNED_POST_EXECUTION_QA_REQUIRED");
  check(typeof expectedSubscriber==="string"&&
    /^cst-onejob-subscriber-[a-z0-9_-]{4,64}$/.test(expectedSubscriber),
    "PINNED_SUBSCRIBER_REQUIRED");
  check(Buffer.isBuffer(response)&&response.length>0&&response.length<=2048&&
    response.toString("utf8").trim()===EXPECTED_REPLY,
    "MODEL_RESPONSE_NOT_INDEPENDENTLY_VERIFIED");
  check(Buffer.isBuffer(proof)&&proof.length>0&&proof.length<=65536,
    "INDEPENDENT_SOURCE_EVIDENCE_MISSING");
  if(a&&j&&r) {
    check(a.id===r.approvalId&&j.id===a.jobId&&j.id===r.jobId&&
      Number.isSafeInteger(j.id)&&j.id>0&&j.id!==482&&
      a.companyId==="1"&&a.modelId==="qwen2.5:3b"&&
      a.status==="CONSUMED"&&typeof a.consumedAt==="string"&&
      r.consumedAt!==null&&typeof r.consumedAt==="string"&&
      j.status==="completed"&&j.jobType==="ollama_model_invocation"&&
      j.requestId===a.requestId&&j.modelId===a.modelId,
      "COMPLETED_JOB_APPROVAL_OR_CONSUMPTION_MISMATCH");
    check(r.requestId===a.requestId&&r.workerName===a.workerName&&
      r.imageSourceSha===a.sourceSha&&r.companyId==="1"&&
      HASH.test(r.nonce)&&HASH.test(r.proofDigest),
      "PRE_ADMISSION_CONSUMPTION_NOT_BOUND");
  }
  if(event&&j) {
    check(EVENT_ID.test(event.eventId)&&event.eventType==="job.completed"&&
      event.sourceModule==="job-engine"&&event.sourceId===String(j.id)&&
      event.status==="processed"&&
      obj(event.payloadJson)&&event.payloadJson.jobId===j.id&&
      event.payloadJson.jobType==="ollama_model_invocation"&&
      EVENT_ID.test(event.correlationId),
      "PERSISTED_JOB_COMPLETION_EVENT_INVALID");
  }
  if(event&&audit) {
    check(audit.action==="event_published"&&audit.module==="event-bus"&&
      audit.resourceId===event.eventId&&audit.status==="success"&&
      obj(audit.details)&&audit.details.eventType===event.eventType&&
      audit.details.correlationId===event.correlationId,
      "PERSISTED_EVENT_AUDIT_MISMATCH");
  }
  if(event&&sub&&j) {
    check(sub.eventId===event.eventId&&sub.jobId===j.id&&
      sub.subscriberId===expectedSubscriber&&
      sub.correlationId===event.correlationId&&
      typeof sub.deliveryId==="string"&&EVENT_ID.test(sub.deliveryId)&&
      sub.status==="ACKNOWLEDGED"&&
      typeof sub.receivedAt==="string"&&
      Number.isFinite(Date.parse(sub.receivedAt))&&
      HASH.test(sub.deliveryDigest),
      "INDEPENDENT_SUBSCRIBER_RECEIPT_NOT_VERIFIED");
  }
  if(c&&a&&j&&r&&k) {
    const verified=reviewSignedIndependentQaReceipt(s,{
      project:DEV,approvalId:a.id,jobId:j.id,requestId:a.requestId,
      workerName:a.workerName,sourceSha:a.sourceSha,imageId:r.imageId,
      stage:"POST_EXECUTION",verifierId:k.verifierId,
      publicKeyPem:k.publicKeyPem,trustedFingerprint:k.fingerprint,
      nowIso:new Date().toISOString()
    });
    check(k.project===DEV&&verified.status==="CRYPTOGRAPHIC_BINDING_VALID",
      "POST_EXECUTION_QA_SIGNATURE_NOT_VERIFIED");
    check(c.nonce!==r.nonce,"PRE_ADMISSION_NONCE_REUSED");
  }
  // JSON evidence originated from independent QA, NOT the inspected API.
  // Ensure the signed bytes match the exact observed rows and reply digest.
  if(Buffer.isBuffer(proof)&&obj(event)&&obj(sub)&&obj(j)&&obj(c)) {
    check(hex(proof)===c.evidenceDigest,
      "POST_EXECUTION_EVIDENCE_DIGEST_MISMATCH");
    let observed=null;
    try{observed=JSON.parse(proof.toString("utf8"))}catch{}
    check(obj(observed)&&Object.keys(observed).sort().join(",")===
      ["eventId","jobId","subscriberId","deliveryId","responseDigest"].sort().join(",")&&
      observed.eventId===event.eventId&&observed.jobId===j.id&&
      observed.subscriberId===sub.subscriberId&&
      observed.deliveryId===sub.deliveryId&&
      Buffer.isBuffer(response)&&observed.responseDigest===hex(response),
      "POST_EXECUTION_SIGNED_BYTES_NOT_BOUND_TO_OBSERVATIONS");
  }
  return {
    status:blockers.length?"DENIED":"POST_EXECUTION_CORRELATION_REVIEW_ONLY",
    blockers,
    // Even this complete source correlation is not an independently issued
    // Final ACK; a later authorized writer must persist that ACK once.
    independentFinalAckReady:blockers.length===0,
    finalAckIssued:false,queueTransitionAuthorized:false,dispatchPermitted:false
  };
}
