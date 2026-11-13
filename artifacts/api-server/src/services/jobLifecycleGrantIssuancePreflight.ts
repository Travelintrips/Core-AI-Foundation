/** DEV Phase 4: review-only preflight for an explicitly authorized resume grant.
 * This is not a grant issuer and has no database writes, lease claims or dispatch.
 * All input must be assembled by a trusted server from persisted records.
 */
import { reviewBlockerEvidence } from "./jobLifecycleBlockerEvidence.js";
import { reviewResumeAuthorization, type ResumeGrantRecord } from "./jobLifecycleResumeAuthorization.js";
import type { LifecycleEvidenceRow } from "./jobLifecycleReadinessService.js";

export type IssuancePreflightReason =
  | "UNVERIFIED_DATABASE_SNAPSHOT" | "TERMINAL_OR_UNKNOWN_COMMAND"
  | "INCOMPLETE_HISTORY" | "MISSING_SIGNED_EVIDENCE"
  | "INVALID_BLOCKER" | "GRANT_REVIEW_DENIED" | "REVIEW_ONLY_VERIFIED";

export function reviewGrantIssuancePreflight(input:{
  commandId:string; commandStatus:string; workerId:string; now:Date;
  persistedRows:readonly LifecycleEvidenceRow[];
  /** Set only by trusted, authenticated DB reader; never by a worker. */
  databaseSnapshotVerified:boolean;
  responseHistoryComplete:boolean;
  /** Set only after issuer Ed25519 and browser receiver ACK verification. */
  signedCheckpointAndNativeAckVerified:boolean;
  /** Existing independently issued human grant (this service never issues one). */
  grant:ResumeGrantRecord|null; grantRecordVerified:boolean;
}):{
  eligibleForFurtherReview:boolean; reason:IssuancePreflightReason;
  blockerResponseId:string|null; checkpointResponseId:string|null;
  mayIssueGrant:false;mayDispatchWorker:false;mayCloseJob:false;
} {
  const deny=(reason:IssuancePreflightReason)=>({
    eligibleForFurtherReview:false,reason,
    blockerResponseId:null,checkpointResponseId:null,
    mayIssueGrant:false as const,mayDispatchWorker:false as const,mayCloseJob:false as const,
  });
  if(!input.databaseSnapshotVerified||!input.commandId||!input.workerId)
    return deny("UNVERIFIED_DATABASE_SNAPSHOT");
  if(input.commandStatus!=="RECEIVED"&&input.commandStatus!=="PROCESSING")
    return deny("TERMINAL_OR_UNKNOWN_COMMAND");
  if(!input.responseHistoryComplete||input.persistedRows.length>100)
    return deny("INCOMPLETE_HISTORY");
  if(!input.signedCheckpointAndNativeAckVerified)
    return deny("MISSING_SIGNED_EVIDENCE");
  const blocker=reviewBlockerEvidence(input.commandId,input.persistedRows);
  if(!blocker.valid||!blocker.blockerResponseId||!blocker.checkpointResponseId)
    return deny("INVALID_BLOCKER");
  const authorization=reviewResumeAuthorization({
    commandId:input.commandId,blockerResponseId:blocker.blockerResponseId,
    checkpointResponseId:blocker.checkpointResponseId,intendedWorkerId:input.workerId,
    grant:input.grant,serverRecordVerified:input.grantRecordVerified,now:input.now,
  });
  if(!authorization.validForFurtherReview)return deny("GRANT_REVIEW_DENIED");
  return {
    eligibleForFurtherReview:true,reason:"REVIEW_ONLY_VERIFIED" as const,
    blockerResponseId:blocker.blockerResponseId,checkpointResponseId:blocker.checkpointResponseId,
    mayIssueGrant:false as const,mayDispatchWorker:false as const,mayCloseJob:false as const,
  };
}
