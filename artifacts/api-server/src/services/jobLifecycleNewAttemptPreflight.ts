/**
 * DEV-only, pure preflight for creating a NEW GPT02 attempt from recovered
 * evidence. No database write, command enqueue, lease acquisition, grant or
 * worker dispatch. This does not resume the terminal FAILED command.
 */
export type NewAttemptPreflightReason =
  | "NOT_DEV" | "ORIGINAL_NOT_FAILED" | "MISSING_REVIEW"
  | "HUMAN_REVIEW_NOT_ACCEPTED" | "NO_RECOMMENDATION"
  | "REVIEWER_DENIED" | "ARTIFACT_NOT_VERIFIED" | "INVALID_ARTIFACT_HASH"
  | "JOB_BINDING_MISMATCH" | "COMMAND_BINDING_MISMATCH"
  | "NEW_COMMAND_ID_NOT_PROPOSED" | "COMMAND_REPLAY" | "DUPLICATE_ATTEMPT"
  | "WORKER_UNHEALTHY" | "RETRY_AFTER_ACTIVE"
  | "READY_FOR_SEPARATE_AUTHORIZATION";
export type NewAttemptPreflight = {
  environment: string;
  jobId: number;
  reviewJobId: number|null;
  originalCommandId: string;
  reviewCommandId: string|null;
  proposedNewCommandId: string;
  originalCommandStatus: string;
  humanReviewStatus: string|null;
  recommendation: "recommend_new_attempt"|"deny_new_attempt"|null;
  evidenceVerified: boolean;
  artifactSha256: string|null;
  existingAttemptCount: number;
  workerHealthy: boolean;
  retryAfterAt: Date|null;
  now: Date;
};
export function evaluateNewAttemptPreflight(x: NewAttemptPreflight):{
  readyForSeparateAuthorization: boolean;
  reason: NewAttemptPreflightReason;
  mayCreateCommand: false;
  mayDispatchWorker: false;
  mayCloseJob: false;
} {
  const deny = (reason: NewAttemptPreflightReason) => ({
    readyForSeparateAuthorization:false, reason,
    mayCreateCommand:false as const, mayDispatchWorker:false as const,mayCloseJob:false as const,
  });
  if(x.environment!=="development")return deny("NOT_DEV");
  if(x.originalCommandStatus!=="FAILED")return deny("ORIGINAL_NOT_FAILED");
  if(x.humanReviewStatus===null)return deny("MISSING_REVIEW");
  if(x.humanReviewStatus!=="accepted")return deny("HUMAN_REVIEW_NOT_ACCEPTED");
  if(x.reviewJobId!==x.jobId || !Number.isSafeInteger(x.jobId) || x.jobId<=0)return deny("JOB_BINDING_MISMATCH");
  if(!x.originalCommandId || x.reviewCommandId!==x.originalCommandId)return deny("COMMAND_BINDING_MISMATCH");
  if(x.recommendation===null)return deny("NO_RECOMMENDATION");
  if(x.recommendation==="deny_new_attempt")return deny("REVIEWER_DENIED");
  if(!x.evidenceVerified)return deny("ARTIFACT_NOT_VERIFIED");
  if(!x.artifactSha256 || !/^[a-f0-9]{64}$/.test(x.artifactSha256))return deny("INVALID_ARTIFACT_HASH");
  if(!x.proposedNewCommandId)return deny("NEW_COMMAND_ID_NOT_PROPOSED");
  if(x.proposedNewCommandId===x.originalCommandId)return deny("COMMAND_REPLAY");
  if(!Number.isSafeInteger(x.existingAttemptCount)||x.existingAttemptCount!==0)return deny("DUPLICATE_ATTEMPT");
  if(!x.workerHealthy)return deny("WORKER_UNHEALTHY");
  if(!Number.isFinite(x.now.getTime()) || (x.retryAfterAt &&
     (!Number.isFinite(x.retryAfterAt.getTime())||x.retryAfterAt.getTime()>x.now.getTime())))
     return deny("RETRY_AFTER_ACTIVE");
  // This is a planning signal only. It can never create a command or dispatch.
  return {readyForSeparateAuthorization:true,reason:"READY_FOR_SEPARATE_AUTHORIZATION",
    mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false};
}
