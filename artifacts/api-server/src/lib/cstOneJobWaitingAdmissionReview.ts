/** 
 * Read-only gate for a FUTURE waiting -> queued transition.
 * Reuses prior Owner consent. No new approval is requested.
 * A positive review never mutates DB, dispatches, or claims the job.
 */
export type OneJobAdmissionReview = {
  environment: string;
  nodeEnvironment: string;
  approval: {
    status:string; companyId:string; modelId:string;
    requestId:string; workerName:string; sourceSha:string;
    jobId:number; approvedByUserId:number;
    approvedAt:string; expiresAt:string; consumedAt:string|null;
  } | null;
  job: {
    id:number; status:string; jobType:string; requiredCapability:string;
    requestId:string; modelId:string; maxRetry:number;
  } | null;
  expectedWorkerName:string;
  candidateBuildSha:string;
  uniqueRequestIndexVerified:boolean;
  candidateHealthy:boolean;
  candidateInternalNetworkVerified:boolean;
  candidateDatabaseRoleVerified:boolean;
  candidateDbScopeVerified:boolean;
  jobRequestCardinality:number;
  auditReady:boolean;
  eventAndReceiptPathReady:boolean;
  independentQaAvailable:boolean;
  otherActivePilotCount:number;
  nowIso:string;
};

const REQUEST=/^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$/;
const WORKER=/^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$/;
const SHA=/^[a-f0-9]{40}$/;

export function reviewOneJobWaitingAdmission(input:OneJobAdmissionReview) {
  const blockers:string[]=[];
  const check=(ok:boolean,reason:string)=>{if(!ok)blockers.push(reason)};
  check(input.environment==="development" && input.nodeEnvironment==="development","DEV_ONLY");
  const a=input.approval,j=input.job;
  check(Boolean(a),"OWNER_APPROVAL_MISSING");
  check(Boolean(j),"WAITING_JOB_MISSING");
  if(a) {
    const t=Date.parse(input.nowIso),start=Date.parse(a.approvedAt),end=Date.parse(a.expiresAt);
    check(a.status==="APPROVED" && a.consumedAt===null,"OWNER_APPROVAL_ALREADY_USED");
    check(a.companyId==="1" && a.modelId==="qwen2.5:3b","APPROVAL_SCOPE_INVALID");
    check(REQUEST.test(a.requestId) && WORKER.test(a.workerName),"APPROVAL_IDENTITIES_INVALID");
    check(Number.isSafeInteger(a.approvedByUserId) && a.approvedByUserId>0,"APPROVER_MISSING");
    check(Number.isFinite(t) && Number.isFinite(start) && Number.isFinite(end) &&
      start<=t && t<end && end>start && end-start<=30*60*1000,"APPROVAL_EXPIRED");
    check(SHA.test(input.candidateBuildSha) && a.sourceSha===input.candidateBuildSha,
      "APPROVAL_SOURCE_SHA_MISMATCH");
    check(a.workerName===input.expectedWorkerName,"WORKER_MISMATCH");
  }
  if(j) {
    check(Number.isSafeInteger(j.id) && j.id>0 && j.id!==482 &&
      j.status==="waiting" && j.jobType==="ollama_model_invocation" &&
      j.requiredCapability==="ollama_inference" && j.modelId==="qwen2.5:3b" &&
      j.maxRetry===0,"JOB_NOT_FRESH_WAITING_MODEL");
    check(Boolean(a && a.jobId===j.id && a.requestId===j.requestId &&
      a.modelId===j.modelId),"APPROVAL_JOB_BINDING_MISMATCH");
  }
  check(input.uniqueRequestIndexVerified===true && input.jobRequestCardinality===1,
    "REQUEST_UNIQUENESS_UNVERIFIED");
  check(input.otherActivePilotCount===0,"OTHER_ACTIVE_PILOT_PRESENT");
  check(input.candidateHealthy===true && input.candidateInternalNetworkVerified===true,
    "ISOLATED_CANDIDATE_NOT_READY");
  check(input.candidateDatabaseRoleVerified===true && input.candidateDbScopeVerified===true,
    "SCOPED_DEV_DB_ROLE_NOT_VERIFIED");
  check(input.auditReady===true && input.eventAndReceiptPathReady===true &&
    input.independentQaAvailable===true,"E2E_EVIDENCE_PATH_NOT_READY");
  return {
    review:"CST_DEV_WAITING_TO_QUEUED",
    status:blockers.length===0?"REVIEW_CONDITIONS_MATCH":"DENIED",
    blockers,
    // Only a future dedicated, transaction-bound DB function can consume
    // the approval and make the transition after rechecking these facts.
    queueTransitionAuthorized:false,
    dispatchPermitted:false,
    signerActivationPermitted:false,
    finalAckVerified:false,
  } as const;
}
