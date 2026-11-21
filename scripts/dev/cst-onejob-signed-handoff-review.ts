/**
 * DEV one-job signed receipt -> locked DB row binding REVIEW ONLY.
 *
 * This is the missing boundary between a valid Ed25519 signature and rows
 * which an eventual transaction-locked broker will consume. DB rows must be
 * acquired from the authoritative CST-DEV database WITH row locks by a
 * separately privileged, reviewed broker. Evidence bytes must be collected
 * independently from the inspected Core AI/DELL worker, not passed as a
 * self-asserted digest from the application under test.
 *
 * NO database connection, mutation, credential, key issuance or authorization.
 * Even matched evidence cannot produce a queue/dispatch permit or Final ACK.
 */
import {createHash} from "node:crypto";
import {
  reviewSignedIndependentQaReceipt,
  type SignedQaReceipt,
} from "../../artifacts/api-server/src/lib/cstOneJobIndependentQaVerifier.ts";

const DEV_PROJECT="xssrfshdrtdfupgqwfdw";
const HEX64=/^[a-f0-9]{64}$/;
const SHA=/^[a-f0-9]{40}$/;
const WORKER=/^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$/;
const REQUEST=/^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$/;

export type OneJobLockedApproval={
  id:string;jobId:number;approvedByUserId:number;status:string;
  purpose:string;companyId:string;modelId:string;requestId:string;
  workerName:string;sourceSha:string;approvedAt:string;expiresAt:string;
  consumedAt:string|null;
};
export type OneJobLockedJob={
  id:number;status:string;jobType:string;requiredCapability:string;
  modelId:string;requestId:string;maxRetry:number;
};
export type OneJobLockedReceipt={
  approvalId:string;jobId:number;companyId:string;requestId:string;
  workerName:string;imageSourceSha:string;imageId:string;verifierId:string;
  nonce:string;proofDigest:string;verifiedAt:string;expiresAt:string;
  consumedAt:string|null;
};
export type PinnedQaPublicKey={
  project:string;verifierId:string;publicKeyPem:string;fingerprint:string;
};
export type ReviewOneJobSignedHandoff={
  approval:OneJobLockedApproval|null;
  job:OneJobLockedJob|null;
  receiptRow:OneJobLockedReceipt|null;
  signedReceipt:SignedQaReceipt;
  qaPublicKey:PinnedQaPublicKey;
  // The exact independently collected evidence bytes, NOT a hash supplied
  // by the inspected system. Caller must establish source provenance.
  independentlyCapturedEvidence:Buffer;
};

/** Never accepts a client-provided clock. Invoked at the current review time. */
export function reviewOneJobSignedHandoff(input:ReviewOneJobSignedHandoff){
  const blockers:string[]=[];
  const check=(ok:boolean,code:string)=>{if(!ok)blockers.push(code)};
  const {approval:a,job:j,receiptRow:r,signedReceipt:s,qaPublicKey:k}=input;
  const c=s?.claims;
  const now=Date.now();
  check(Boolean(a&&j&&r&&c),"LOCKED_DB_AND_RECEIPT_EVIDENCE_REQUIRED");
  check(Boolean(k&&k.project===DEV_PROJECT&&
    /^cst-independent-qa-[a-z0-9_-]{8,80}$/.test(k.verifierId)),
    "QA_TRUST_PROJECT_OR_VERIFIER_INVALID");

  if(a){
    check(a.purpose==="CST_DEV_ONEJOB_MODEL"&&a.status==="APPROVED"&&
      a.consumedAt===null&&a.companyId==="1"&&a.modelId==="qwen2.5:3b"&&
      Number.isSafeInteger(a.approvedByUserId)&&a.approvedByUserId>0,
      "OWNER_APPROVAL_NOT_ACTIVE_OR_SCOPED");
    check(REQUEST.test(a.requestId)&&WORKER.test(a.workerName)&&
      SHA.test(a.sourceSha)&&a.jobId>0&&a.jobId!==482,
      "OWNER_APPROVAL_IDENTITY_INVALID");
    const approved=Date.parse(a.approvedAt),expiry=Date.parse(a.expiresAt);
    check(Number.isFinite(approved)&&Number.isFinite(expiry)&&
      approved<=now&&now<expiry&&expiry-approved<=30*60*1000&&expiry>approved,
      "OWNER_APPROVAL_EXPIRED");
  }
  if(j&&a){
    check(j.id===a.jobId&&j.id!==482&&j.status==="waiting"&&
      j.jobType==="ollama_model_invocation"&&
      j.requiredCapability==="ollama_inference"&&
      j.maxRetry===0&&j.modelId===a.modelId&&j.requestId===a.requestId,
      "WAITING_JOB_NOT_BOUND_TO_APPROVAL");
  }
  if(r&&a&&j){
    check(r.consumedAt===null&&r.approvalId===a.id&&
      r.jobId===j.id&&r.companyId==="1"&&
      r.requestId===a.requestId&&r.workerName===a.workerName&&
      r.imageSourceSha===a.sourceSha&&
      /^sha256:[a-f0-9]{64}$/.test(r.imageId),
      "PERSISTED_RECEIPT_SCOPE_MISMATCH_OR_CONSUMED");
    const start=Date.parse(r.verifiedAt),end=Date.parse(r.expiresAt);
    check(Number.isFinite(start)&&Number.isFinite(end)&&
      start<=now&&now<end&&end>start&&end-start<=5*60*1000,
      "PERSISTED_RECEIPT_EXPIRED");
  }
  let cryptographicStatus="DENIED";
  if(a&&j&&r&&c&&k){
    // Expected values come from locked, authoritative rows and an
    // independently pinned QA public key, NEVER from caller claims.
    const verified=reviewSignedIndependentQaReceipt(s,{
      project:DEV_PROJECT,approvalId:a.id,jobId:j.id,
      requestId:a.requestId,workerName:a.workerName,sourceSha:a.sourceSha,
      imageId:r.imageId,stage:"PRE_ADMISSION",verifierId:k.verifierId,
      publicKeyPem:k.publicKeyPem,trustedFingerprint:k.fingerprint,
      nowIso:new Date(now).toISOString(),
    });
    cryptographicStatus=verified.status;
    check(verified.status==="CRYPTOGRAPHIC_BINDING_VALID",
      "INDEPENDENT_QA_SIGNATURE_NOT_VALID");
    check(c.nonce===r.nonce&&c.verifierId===r.verifierId&&
      c.verifiedAt===r.verifiedAt&&c.expiresAt===r.expiresAt&&
      HEX64.test(r.proofDigest)&&
      verified.canonicalDigest===r.proofDigest,
      "SIGNED_RECEIPT_NOT_BOUND_TO_PERSISTED_NONCE_AND_DIGEST");
    const evidence=input.independentlyCapturedEvidence;
    check(Buffer.isBuffer(evidence)&&evidence.length>=1&&
      evidence.length<=64*1024&&
      createHash("sha256").update(evidence).digest("hex")===c.evidenceDigest,
      "INDEPENDENT_EVIDENCE_BYTES_DIGEST_MISMATCH");
  }
  return {
    review:"CST_DEV_SIGNED_RECEIPT_TO_LOCKED_DB_BINDING",
    status:blockers.length===0?"BOUND_CRYPTO_REVIEW_ONLY":"DENIED",
    cryptographicStatus,blockers,
    // A later broker must revalidate the actual trust custody and read
    // locked DB rows, consume one-time nonce, update job+approval and audit
    // atomically. This review is not that broker.
    queueTransitionAuthorized:false,dispatchPermitted:false,
    signerActivationPermitted:false,finalAckVerified:false,
  } as const;
}
