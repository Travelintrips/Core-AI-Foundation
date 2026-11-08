/** DEV-only, pure/read-only verification of a persisted operator review intent.
 * A database FK or proof_json shape check is NOT a cryptographic signature.
 * This assessor must never grant execution authority or dispatch a worker.
 */
import { verifyOperatorApprovalProof } from "./jobLifecycleOperatorApprovalProof.js";

export type StoredReviewSnapshot={
 id:string;commandId:string;checkpointResponseId:string;blockerResponseId:string;
 workerId:string;operatorUserId:number;operatorRole:string;nonce:string;
 signedAt:Date;expiresAt:Date;proof:unknown;
};
export type CurrentOperatorSnapshot={
 id:number;role:string;status:string;accountType:string;mustChangePassword:boolean;
};
export type CurrentCommandEvidence={
 commandId:string;commandStatus:string;checkpointResponseId:string|null;
 blockerResponseId:string|null;workerId:string;
 responseSnapshotComplete:boolean;checkpointAttested:boolean;
 nativeReceiverAckVerified:boolean;blockerEvidenceValid:boolean;
};
export function assessStoredDevOperatorReview(input:{
 review:StoredReviewSnapshot|null;operator:CurrentOperatorSnapshot|null;
 evidence:CurrentCommandEvidence|null;now:Date;trustedPublicKeyDerBase64:string|undefined;
}):{reviewVerified:boolean;reason:string;mayIssueGrant:false;mayDispatchWorker:false}{
 const deny=(reason:string)=>({reviewVerified:false,reason,
  mayIssueGrant:false as const,mayDispatchWorker:false as const});
 const {review:r,operator:o,evidence:e}=input;
 if(!r)return deny("STORED_REVIEW_MISSING");
 if(!o||o.id!==r.operatorUserId||o.role!==r.operatorRole||
    o.status!=="active"||o.accountType!=="internal"||
    o.mustChangePassword||(o.role!=="admin"&&o.role!=="owner"))
  return deny("CURRENT_OPERATOR_NOT_AUTHORIZED");
 if(!e||e.commandStatus!=="PROCESSING"||!e.responseSnapshotComplete||
    !e.checkpointAttested||!e.nativeReceiverAckVerified||!e.blockerEvidenceValid||
    e.commandId!==r.commandId||e.checkpointResponseId!==r.checkpointResponseId||
    e.blockerResponseId!==r.blockerResponseId||e.workerId!==r.workerId)
  return deny("CURRENT_COMMAND_EVIDENCE_MISMATCH");
 if(!(input.now instanceof Date)||!Number.isFinite(input.now.getTime())||
    !(r.signedAt instanceof Date)||!(r.expiresAt instanceof Date)||
    !Number.isFinite(r.signedAt.getTime())||!Number.isFinite(r.expiresAt.getTime())||
    r.signedAt.getTime()>input.now.getTime()||
    r.expiresAt.getTime()<=input.now.getTime()||
    r.expiresAt.getTime()<=r.signedAt.getTime()||
    r.expiresAt.getTime()-r.signedAt.getTime()>120_000)
  return deny("STORED_REVIEW_EXPIRED_OR_INVALID");
 if(!r.proof||typeof r.proof!=="object"||Array.isArray(r.proof))
  return deny("STORED_PROOF_MISSING");
 const p=r.proof as Record<string,unknown>;
 if(p["commandId"]!==r.commandId||p["checkpointResponseId"]!==r.checkpointResponseId||
    p["blockerResponseId"]!==r.blockerResponseId||p["workerId"]!==r.workerId||
    p["operatorId"]!=="internal:"+r.operatorUserId||
    p["operatorRole"]!==r.operatorRole||p["nonce"]!==r.nonce||
    p["issuedAt"]!==r.signedAt.toISOString()||
    p["expiresAt"]!==r.expiresAt.toISOString())
  return deny("STORED_PROOF_COLUMN_MISMATCH");
 const checked=verifyOperatorApprovalProof({
  proof:r.proof,expectedCommandId:r.commandId,
  expectedCheckpointResponseId:r.checkpointResponseId,
  expectedBlockerResponseId:r.blockerResponseId,
  expectedWorkerId:r.workerId,now:input.now,
  serverPublicKeyDerBase64:input.trustedPublicKeyDerBase64,
 });
 if(!checked.validForReview)return deny("STORED_PROOF_"+checked.reason);
 // Even a fully valid signed historical review cannot mint a grant here.
 return {reviewVerified:true,reason:"SIGNED_STORED_REVIEW_VERIFIED_NOT_A_GRANT",
  mayIssueGrant:false,mayDispatchWorker:false};
}
