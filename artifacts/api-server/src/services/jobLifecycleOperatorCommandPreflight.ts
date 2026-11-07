/** DEV-only readback of a real command's eligibility blockers for operator approval.
 * Calls the existing authenticated-database lifecycle reader. It does NOT
 * issue an approval, sign evidence, acquire a lease, or dispatch work.
 */
import { getDevCommandRecoveryReview } from "./jobLifecycleRecoveryReview.js";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function getDevResumeOperatorCommandPreflight(commandId:string) {
 const deny=(reason:string)=>({found:false as const,commandId,reason,
   grantIssuanceEnabled:false as const,mayIssueGrant:false as const,
   mayDispatchWorker:false as const,mayCloseJob:false as const});
 if(!uuid.test(commandId))return deny("INVALID_COMMAND_ID");
 const review=await getDevCommandRecoveryReview(commandId);
 if(!review.found)return deny("COMMAND_NOT_FOUND_OR_NOT_DEV");
 const prerequisites={
   commandNonTerminal:review.commandStatusReviewable,
   responseSnapshotComplete:review.responseSnapshotComplete,
   checkpointAttested:review.checkpointAttested,
   receiverAckVerified:review.receiverAckVerified,
   blockerEvidenceValid:review.blockerEvidenceValid,
   workerPresenceHealthy:review.workerPresenceHealthy,
   workerPresenceLeaseActive:review.workerPresenceLeaseActive,
   policyEnabled:review.recoveryPolicyEnabled,
   reviewFeatureEnabled:review.recoveryFeatureEnabled,
   commandAuthorizationPresent:review.commandResumeAuthorizationVerified,
   exclusiveLeasePresent:review.commandExclusiveLeaseVerified,
   rateLimitClearanceVerified:review.rateLimitClearanceVerified,
   retryBudgetVerified:review.retryBudgetVerified,
 };
 return {
   found:true as const,commandId,commandStatus:review.commandStatus,
   checkpointResponseId:review.checkpointResponseId,
   blockerResponseId:review.blockingResponseId,
   prerequisites,
   reviewReason:review.reviewReason,
   // There is no production-ready human approval + transactional grant issuer.
   // This response MUST NEVER be interpreted as authority to resume.
   grantIssuanceEnabled:false as const,mayIssueGrant:false as const,
   mayDispatchWorker:false as const,mayCloseJob:false as const,
 };
}
