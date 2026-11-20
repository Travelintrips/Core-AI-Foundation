/**
 * Core signed reconciliation candidate; NOT the four-agent FINAL ACK.
 * Independent Hub four-agent signatures + reviewer are still required
 * after this Core receipt. The result NEVER authorizes E2E PASS.
 * No default HTTP route, credentials, keys, role grants or signer setup.
 */
import {createHash,createPublicKey,verify,randomUUID} from "node:crypto";
import {qaCanonicalBytes} from
  "../../artifacts/api-server/src/lib/cstOneJobIndependentQaVerifier.ts";
import {reviewCstOneJobPostExecution} from "./cst-onejob-postexecution-review.mjs";
import {reviewSignedSubscriberAck} from "./cst-onejob-subscriber-ack-review.mjs";

export const CORE_RECONCILIATION_ROLE="cst_onejob_finalack_writer";
export const CORE_RECONCILIATION_LOGIN="cst_onejob_finalack_login";
export const CORE_RECONCILIATION_DOMAIN="cst-onejob-core-reconciliation/v1";
const PROJECT="xssrfshdrtdfupgqwfdw";
const SHA=/^[a-f0-9]{64}$/;
const U=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hash=x=>createHash("sha256").update(x).digest("hex");
const keys=["domain","project","approvalId","jobId","eventId","deliveryId",
  "postNonce","postProofDigest","reconciliationId","issuedAt"];
export function coreReconciliationCanonicalBytes(c){
  const out={};
  for(const k of keys)out[k]=c[k];
  return Buffer.from(JSON.stringify(out),"utf8");
}
// Query uses only real catalog column names verified against CST-DEV.
// Read source rows under one SERIALIZABLE snapshot, with a per-job
// transaction advisory lock for cooperating Core reconciliation issuers.
// Unlike SELECT FOR UPDATE, this needs no UPDATE grant on source tables.
// Immutable terminal evidence + UNIQUE job/approval/delivery ledger constraints
// are separately required; this is NOT proof of live role provisioning.
export const SOURCE_SNAPSHOT_SQL=[
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
 "WHERE j.id=$1"
].join(" ");
export function reviewCoreReconciliationEvidence({
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
    Number.isFinite(Date.parse(s?.receivedAt))&&
    Date.parse(s.receivedAt)===Date.parse(signedSubscriberAck?.claims?.acknowledgedAt),
    "PERSISTED_SUBSCRIBER_ACK_NOT_BOUND");
  check(j?.resultJson?.output?.type==="text"&&
    j.resultJson.output.text==="CST_DEV_ONEJOB_PROBE_OK"&&
    Buffer.isBuffer(responseBytes)&&
    responseBytes.toString("utf8").trim()===j.resultJson.output.text,
    "ACTUAL_MODEL_RESULT_NOT_BOUND");
  return {status:blockers.length?"DENIED":"INDEPENDENT_FINAL_RECONCILIATION_MATCH",
    blockers,finalAckIssued:false,dispatchPermitted:false};
}
export async function executeCoreReconciliationCandidate({
  client,jobId,eventId,signedSubscriberAck,subscriberTrust,deliveryBytes,
  signedPostReceipt,qaTrust,evidenceBytes,responseBytes,expectedSubscriberId,
  signer,finalIssuerTrust
}){
  if(!Number.isSafeInteger(jobId)||jobId<1||jobId===482||!U.test(eventId))
    throw Error("INVALID_FINAL_JOB_OR_EVENT");
  let started=false;
  try{
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");started=true;
    await client.query("SET TRANSACTION READ WRITE");
    await client.query("SET LOCAL ROLE "+CORE_RECONCILIATION_ROLE);
    const ident=await client.query(
      "SELECT current_user AS role_name,session_user AS login_name,current_database() AS db");
    if(ident.rows?.length!==1||
       ident.rows[0].role_name!==CORE_RECONCILIATION_ROLE||
       ident.rows[0].login_name!==CORE_RECONCILIATION_LOGIN||ident.rows[0].db!=="postgres")
      throw Error("DEDICATED_CORE_RECONCILIATION_ROLE_NOT_VERIFIED");
    // Advisory locks coordinate only participating issuers. SERIALIZABLE
    // supplies consistency checks, while unique constraints reject replay.
    await client.query(
      "SELECT pg_advisory_xact_lock($1::integer,$2::integer)",[20261120,jobId]);
    const locked=await client.query(SOURCE_SNAPSHOT_SQL,[jobId,eventId]);
    if(locked.rows?.length!==1)throw Error("AUTHORITATIVE_FINAL_ROWS_MISSING");
    const facts=locked.rows[0];
    const review=reviewCoreReconciliationEvidence({facts,signedSubscriberAck,
      subscriberTrust,deliveryBytes,signedPostReceipt,qaTrust,
      evidenceBytes,responseBytes,expectedSubscriberId});
    if(review.status!=="INDEPENDENT_FINAL_RECONCILIATION_MATCH")
      throw Error("INDEPENDENT_FINAL_RECONCILIATION_DENIED");
    if(typeof signer!=="function"||finalIssuerTrust?.project!==PROJECT||
       finalIssuerTrust?.use!=="CST_DEV_ONEJOB_CORE_RECONCILIATION_PUBLIC_PIN")
      throw Error("CORE_RECONCILIATION_ISSUER_NOT_CUSTODIED");
    const publicKey=createPublicKey(finalIssuerTrust.publicKeyPem);
    if(publicKey.asymmetricKeyType!=="ed25519"||
       hash(publicKey.export({type:"spki",format:"der"}))!==finalIssuerTrust.fingerprint)
      throw Error("CORE_RECONCILIATION_PUBLIC_KEY_NOT_PINNED");
    const reconciliationId=randomUUID(),time=new Date().toISOString();
    const postClaims=signedPostReceipt.claims;
    const postDigest=hash(qaCanonicalBytes(postClaims));
    const claims={domain:CORE_RECONCILIATION_DOMAIN,project:PROJECT,
      approvalId:facts.approval.id,jobId,eventId,deliveryId:facts.subscriber.deliveryId,
      postNonce:postClaims.nonce,postProofDigest:postDigest,reconciliationId:reconciliationId,issuedAt:time};
    const bytes=coreReconciliationCanonicalBytes(claims);
    const signature=await signer(bytes);
    if(typeof signature!=="string")throw Error("CORE_RECONCILIATION_SIGNATURE_REQUIRED");
    const raw=Buffer.from(signature,"base64");
    if(raw.length!==64||raw.toString("base64")!==signature||
       !verify(null,bytes,publicKey,raw))
      throw Error("CORE_RECONCILIATION_SIGNATURE_UNTRUSTED");

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
      "INSERT INTO cst_onejob_private.core_signed_reconciliations "+
      "(approval_id,job_id,delivery_id,post_receipt_id,reconciliation_id,"+
      "independently_verified_by,issued_at,source_digest,ack_signature_base64,"+
      "issuer_public_fingerprint,reconciliation_claims_digest) "+
      "VALUES($1::uuid,$2::int,$3::uuid,$4::uuid,$5::uuid,$6,$7::timestamptz,$8,$9,$10,$11) "+
      "RETURNING reconciliation_id",
      [facts.approval.id,jobId,facts.subscriber.deliveryId,first.rows[0].id,
        reconciliationId,finalIssuerTrust.issuerId,time,hash(evidenceBytes),signature,
        finalIssuerTrust.fingerprint,hash(bytes)]
    );
    if(second.rows?.length!==1||
       String(second.rows[0].reconciliation_id)!==reconciliationId)
      throw Error("CORE_RECONCILIATION_LEDGER_INSERT_FAILED");
    await client.query(
      "INSERT INTO ai_platform.ai_audit_logs"+
      "(module,action,resource_type,resource_id,status,details) "+
      "VALUES('cst-onejob','core_signed_reconciliation','ai_job',$1,'success',"+
      "jsonb_build_object('reconciliationId',$2::text,'deliveryId',$3::text,"+
      "'postReceiptId',$4::text,'signatureDigest',$5::text))",
      [String(jobId),reconciliationId,facts.subscriber.deliveryId,String(first.rows[0].id),hash(bytes)]
    );
    await client.query("COMMIT");started=false;
    return {status:"CORE_RECONCILIATION_COMMITTED",jobId,reconciliationId,
      coreReconciliationRecorded:true,finalAckIssued:false,
      fourAgentQuorumVerified:false,operationalE2EVerified:false,
      dispatchPermitted:false};
  }catch(error){
    if(started)try{await client.query("ROLLBACK")}catch{}
    throw error;
  }
}
