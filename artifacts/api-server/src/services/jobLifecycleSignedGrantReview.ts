/** DEV-only integration of read-only grant review and cryptographic operator approval.
 * No service or database mutations. An attested approval still CANNOT dispatch.
 */
import { reviewGrantIssuancePreflight } from "./jobLifecycleGrantIssuancePreflight.js";
import { verifyOperatorApprovalProof } from "./jobLifecycleOperatorApprovalProof.js";
import type { ResumeGrantRecord } from "./jobLifecycleResumeAuthorization.js";
import type { LifecycleEvidenceRow } from "./jobLifecycleReadinessService.js";

export function reviewSignedDevResumeGrant(input: {
  commandId:string; commandStatus:string; workerId:string; now:Date;
  persistedRows:readonly LifecycleEvidenceRow[];
  databaseSnapshotVerified:boolean; responseHistoryComplete:boolean;
  signedCheckpointAndNativeAckVerified:boolean;
  grant:ResumeGrantRecord|null; grantRecordVerified:boolean;
  /** Server-owned public key and separately persisted proof, never worker flags. */
  approvalProof:unknown; trustedApprovalPublicKey:string|undefined;
}): {
  eligibleForFurtherReview:boolean; reason:string;
  checkpointResponseId:string|null; blockerResponseId:string|null;
  mayIssueGrant:false;mayDispatchWorker:false;mayCloseJob:false;
} {
  const deny=(reason:string)=>({eligibleForFurtherReview:false,reason,
    checkpointResponseId:null,blockerResponseId:null,
    mayIssueGrant:false as const,mayDispatchWorker:false as const,mayCloseJob:false as const});
  const prior=reviewGrantIssuancePreflight(input);
  if(!prior.eligibleForFurtherReview||!prior.checkpointResponseId||!prior.blockerResponseId)
    return deny(prior.reason);
  const signed=verifyOperatorApprovalProof({
    proof:input.approvalProof,expectedCommandId:input.commandId,
    expectedCheckpointResponseId:prior.checkpointResponseId,
    expectedBlockerResponseId:prior.blockerResponseId,expectedWorkerId:input.workerId,
    now:input.now,serverPublicKeyDerBase64:input.trustedApprovalPublicKey,
  });
  if(!signed.validForReview)return deny("OPERATOR_PROOF_"+signed.reason);
  const proof=input.approvalProof as {operatorId:string;issuedAt:string};
  // Grant approver attribution must match the signed operator exactly.
  // Approvals remain review-only until issuer authentication is implemented.
  if(!input.grant||input.grant.approvedBy!==proof.operatorId)
    return deny("APPROVER_ATTRIBUTION_MISMATCH");
  const proofIssuedAt=Date.parse(proof.issuedAt);
  // A proof cannot be stamped after the persisted approval it allegedly
  // authorized; permit only a small clock precision difference.
  if(!Number.isFinite(proofIssuedAt)||
     input.grant.approvedAt.getTime()<proofIssuedAt-1000)
    return deny("APPROVAL_PRECEDES_SIGNED_PROOF");
  return {eligibleForFurtherReview:true,reason:"SIGNED_GRANT_REVIEW_VALID",
    checkpointResponseId:prior.checkpointResponseId,
    blockerResponseId:prior.blockerResponseId,
    mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false};
}
