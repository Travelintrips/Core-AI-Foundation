/**
 * Independent final-ACK transaction candidate; NOT a deployed issuer.
 * Must run only on a separately authorized, custodied QA/operations host.
 * No default HTTP route, credentials, keys, role grants or signer setup.
 */
import {createHash,createPublicKey,verify,randomUUID} from "node:crypto";
import {qaCanonicalBytes} from
  "../../artifacts/api-server/src/lib/cstOneJobIndependentQaVerifier.ts";
import {reviewCstOneJobPostExecution} from "./cst-onejob-postexecution-review.mjs";
import {reviewSignedSubscriberAck} from "./cst-onejob-subscriber-ack-review.mjs";

export const FINAL_ROLE="cst_onejob_finalack_writer";
export const FINAL_LOGIN="cst_onejob_finalack_login";
export const FINAL_DOMAIN="cst-onejob-final-ack/v1";
const PROJECT="xssrfshdrtdfupgqwfdw";
const SHA=/^[a-f0-9]{64}$/;
const U=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hash=x=>createHash("sha256").update(x).digest("hex");
const keys=["domain","project","approvalId","jobId","eventId","deliveryId",
  "postNonce","postProofDigest","finalAckId","issuedAt"];
export function finalAckCanonicalBytes(c){
  const out={};
  for(const k of keys)out[k]=c[k];
  return Buffer.from(JSON.stringify(out),"utf8");
}
// Query uses only real catalog column names verified against CST-DEV.
// All evidence is acquired under locks, never taken from caller JSON.
export const LOCK_POST_SQL=[
 "SELECT",
 "jsonb_build_object('id',a.id,'jobId',a.job_id,'companyId',a.company_id,",
 "'modelId',a.model_id,'requestId',a.request_id,'workerName',a.worker_name,",
 "'sourceSha',a.source_sha,'status',a.status,'consumedAt',a.consumed_at) approval,",
 "jsonb_build_object('id',j.id,'status',j.status,'jobType',j.job_type,",
 "'requestId',j.payload_json->>'requestId','modelId',j.payload_json->>'modelId',",
 "'resultJson',j.result_json) job,",
 "jsonb_build_object('approvalId',r.approval_id,'jobId',r.job_id,",
 "'companyId',r.company_id,'requestId',r.request_id,'workerName',r.worker_name,",
 "'imageSourceSha',r.image_source_sha,'imageId',r.image_id,",
 "'nonce',r.nonce,'proofDigest',r.proof_digest,'consumedAt',r.consumed_at) admission_receipt,",
 "jsonb_build_object('eventId',e.event_id,'correlationId',e.correlation_id,",
 "'eventType',e.event_type,'sourceModule',e.source_module,'sourceId',e.source_id,",
 "'status',e.status,'payloadJson',e.payload_json) event,",
 "jsonb_build_object('module',al.module,'action',al.action,'resourceId',al.resource_id,",
 "'status',al.status,'details',al.details) event_audit,",
 "jsonb_build_object('eventId',s.event_id,'jobId',s.job_id,'subscriberId',s.subscriber_id,",
 "'deliveryId',s.delivery_id,'correlationId',s.correlation_id,'status',s.status,",
 "'receivedAt',s.received_at,'deliveryDigest',s.delivery_digest,",
 "'ackNonce',s.ack_nonce,'ackSignatureBase64',s.ack_signature_base64,",
 "'ackIssuerFingerprint',s.ack_issuer_fingerprint) subscriber",
 "FROM ai_platform.cst_onejob_owner_approvals a",
 "JOIN ai_platform.ai_jobs j ON j.id=a.job_id",
 "JOIN cst_onejob_private.verified_admission_receipts r ON r.job_id=j.id AND r.approval_id=a.id",
 "JOIN ai_platform.ai_events e ON e.source_id=j.id::text AND e.event_id=$2",
 "JOIN ai_platform.ai_audit_logs al ON al.resource_id=e.event_id",
 "AND al.module='event-bus' AND al.action='event_published'",
 "JOIN cst_onejob_private.subscriber_delivery_receipts s ON s.job_id=j.id",
 "AND s.event_id::text=e.event_id AND s.approval_id=a.id",
 "WHERE j.id=$1",
 "FOR UPDATE OF a,j,r,e,al,s"
].join(" ");
export function reviewFinalEvidence({
  facts,signedSubscriberAck,subscriberTrust,deliveryBytes,
  signedPostReceipt,qaTrust,evidenceBytes,responseBytes,expectedSubscriberId
}){
  const blockers=[];
  const check=(ok,reason)=>{if(!ok)blockers.push(reason)};
  const a=facts?.approval,j=facts?.job,r=facts?.admission_receipt;
  const e=facts?.event,al=facts?.event_audit,s=facts?.subscriber;
  const post=reviewCstOneJobPostExecution({
    approval:a,job:j,admissionReceipt:r,event:e,eventAudit:al,subscriber:s,
    postExecutionSignedReceipt:signedPostReceipt,qaPublicKey:qaTrust,
    independentlyCapturedEvidence:evidenceBytes,
    independentlyCapturedResponse:responseBytes,expectedSubscriberId
  });
  check(post.status==="POST_EXECUTION_CORRELATION_REVIEW_ONLY",
    "POST_EXECUTION_QA_NOT_VERIFIED");
  const sub=reviewSignedSubscriberAck({
    signedAck:signedSubscriberAck,pinnedTrust:subscriberTrust,
    deliveredBytes:deliveryBytes,nowIso:new Date().toISOString(),
    expected:{jobId:j?.id,approvalId:a?.id,eventId:e?.eventId,
      deliveryId:s?.deliveryId,subscriberId:expectedSubscriberId,
      correlationId:e?.correlationId,deliveryDigest:s?.deliveryDigest}
  });
  check(sub.status==="CRYPTOGRAPHIC_SUBSCRIBER_ACK_VALID",
    "INDEPENDENT_SUBSCRIBER_SIGNATURE_NOT_VERIFIED");
  check(s?.ackNonce===signedSubscriberAck?.claims?.nonce&&
    s?.ackSignatureBase64===signedSubscriberAck?.signatureBase64&&
    s?.ackIssuerFingerprint===signedSubscriberAck?.publicKeyFingerprint&&
    s?.receivedAt===signedSubscriberAck?.claims?.acknowledgedAt,
    "PERSISTED_SUBSCRIBER_ACK_NOT_BOUND");
  check(j?.resultJson?.output?.type==="text"&&
    j.resultJson.output.text==="CST_DEV_ONEJOB_PROBE_OK"&&
    Buffer.isBuffer(responseBytes)&&
    responseBytes.toString("utf8").trim()===j.resultJson.output.text,
    "ACTUAL_MODEL_RESULT_NOT_BOUND");
  return {status:blockers.length?"DENIED":"INDEPENDENT_FINAL_RECONCILIATION_MATCH",
    blockers,finalAckIssued:false,dispatchPermitted:false};
}
export async function executeFinalAckCandidate({
  client,jobId,eventId,signedSubscriberAck,subscriberTrust,deliveryBytes,
  signedPostReceipt,qaTrust,evidenceBytes,responseBytes,expectedSubscriberId,
  signer,finalIssuerTrust
}){
  if(!Number.isSafeInteger(jobId)||jobId<1||jobId===482||!U.test(eventId))
    throw Error("INVALID_FINAL_JOB_OR_EVENT");
  let started=false;
  try{
    await client.query("BEGIN");started=true;
    await client.query("SET TRANSACTION READ WRITE");
    await client.query("SET LOCAL ROLE "+FINAL_ROLE);
    const ident=await client.query(
      "SELECT current_user AS role_name,session_user AS login_name,current_database() AS db");
    if(ident.rows?.length!==1||
       ident.rows[0].role_name!==FINAL_ROLE||
       ident.rows[0].login_name!==FINAL_LOGIN||ident.rows[0].db!=="postgres")
      throw Error("DEDICATED_FINAL_ACK_ROLE_NOT_VERIFIED");
    const locked=await client.query(LOCK_POST_SQL,[jobId,eventId]);
    if(locked.rows?.length!==1)throw Error("AUTHORITATIVE_FINAL_ROWS_MISSING");
    const facts=locked.rows[0];
    const review=reviewFinalEvidence({facts,signedSubscriberAck,
      subscriberTrust,deliveryBytes,signedPostReceipt,qaTrust,
      evidenceBytes,responseBytes,expectedSubscriberId});
    if(review.status!=="INDEPENDENT_FINAL_RECONCILIATION_MATCH")
      throw Error("INDEPENDENT_FINAL_RECONCILIATION_DENIED");
    if(typeof signer!=="function"||finalIssuerTrust?.project!==PROJECT||
       finalIssuerTrust?.use!=="CST_DEV_ONEJOB_FINAL_ACK_PUBLIC_PIN")
      throw Error("FINAL_ACK_ISSUER_NOT_CUSTODIED");
    const publicKey=createPublicKey(finalIssuerTrust.publicKeyPem);
    if(publicKey.asymmetricKeyType!=="ed25519"||
       hash(publicKey.export({type:"spki",format:"der"}))!==finalIssuerTrust.fingerprint)
      throw Error("FINAL_ACK_PUBLIC_KEY_NOT_PINNED");
    const ackId=randomUUID(),time=new Date().toISOString();
    const postClaims=signedPostReceipt.claims;
    const postDigest=hash(qaCanonicalBytes(postClaims));
    const claims={domain:FINAL_DOMAIN,project:PROJECT,
      approvalId:facts.approval.id,jobId,eventId,deliveryId:facts.subscriber.deliveryId,
      postNonce:postClaims.nonce,postProofDigest:postDigest,finalAckId:ackId,issuedAt:time};
    const bytes=finalAckCanonicalBytes(claims);
    const signature=await signer(bytes);
    if(typeof signature!=="string")throw Error("FINAL_ACK_SIGNATURE_REQUIRED");
    const raw=Buffer.from(signature,"base64");
    if(raw.length!==64||raw.toString("base64")!==signature||
       !verify(null,bytes,publicKey,raw))
      throw Error("FINAL_ACK_SIGNATURE_UNTRUSTED");

    // One-use constraints on jobId, approvalId, deliveryId, and post nonce.
    // A duplicate/replayed receipt aborts both inserts and the audit.
    const first=await client.query(
      "INSERT INTO cst_onejob_private.post_execution_qa_receipts "+
      "(approval_id,job_id,delivery_id,verifier_id,stage,nonce,proof_digest,"+
      "evidence_digest,verified_at,expires_at) "+
      "VALUES($1::uuid,$2::int,$3::uuid,$4,'POST_EXECUTION',$5,$6,$7,"+
      "$8::timestamptz,$9::timestamptz) RETURNING id",
      [facts.approval.id,jobId,facts.subscriber.deliveryId,postClaims.verifierId,
        postClaims.nonce,postDigest,postClaims.evidenceDigest,
        postClaims.verifiedAt,postClaims.expiresAt]
    );
    if(first.rows?.length!==1)throw Error("POST_EXECUTION_RECEIPT_NOT_INSERTED");
    const second=await client.query(
      "INSERT INTO cst_onejob_private.final_ack_reconciliations "+
      "(approval_id,job_id,delivery_id,post_receipt_id,final_ack_id,"+
      "independently_verified_by,issued_at,source_digest,ack_signature_base64,"+
      "issuer_public_fingerprint,ack_claims_digest) "+
      "VALUES($1::uuid,$2::int,$3::uuid,$4::uuid,$5::uuid,$6,$7::timestamptz,$8,$9,$10,$11) "+
      "RETURNING final_ack_id",
      [facts.approval.id,jobId,facts.subscriber.deliveryId,first.rows[0].id,
        ackId,finalIssuerTrust.issuerId,time,hash(evidenceBytes),signature,
        finalIssuerTrust.fingerprint,hash(bytes)]
    );
    if(second.rows?.length!==1||
       String(second.rows[0].final_ack_id)!==ackId)
      throw Error("FINAL_ACK_LEDGER_INSERT_FAILED");
    await client.query(
      "INSERT INTO ai_platform.ai_audit_logs"+
      "(module,action,resource_type,resource_id,status,details) "+
      "VALUES('cst-onejob','independent_final_ack','ai_job',$1,'success',"+
      "jsonb_build_object('finalAckId',$2::text,'deliveryId',$3::text,"+
      "'postReceiptId',$4::text,'signatureDigest',$5::text))",
      [String(jobId),ackId,facts.subscriber.deliveryId,String(first.rows[0].id),hash(bytes)]
    );
    await client.query("COMMIT");started=false;
    return {status:"FINAL_ACK_COMMITTED",jobId,finalAckId:ackId,
      finalAckIssued:true,dispatchPermitted:false};
  }catch(error){
    if(started)try{await client.query("ROLLBACK")}catch{}
    throw error;
  }
}
