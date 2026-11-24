/**
 * Review-only predicate for a future atomic, one-use DEV model pilot approval.
 *
 * Trust boundary: actor MUST come from optionalSessionAuth's verified cookie
 * and current internal_users DB readback, NOT from request body, a client
 * actor string, admin API key, or machine-to-machine bridge identity.
 *
 * approval MUST come from an authoritative, locked, unexpired approval row.
 * job MUST come from the bound transaction, not from untrusted input.
 * Passing this predicate is NOT authorization, a dispatch permit, or Final ACK.
 */
const REQUEST = /^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$/;
const WORKER = /^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$/;
const SHA = /^[a-f0-9]{40}$/;

export type PilotOwnerActor = {
  id: number;
  role: string;
  status: string;
  accountType: string;
} | null;
export type PilotApprovalEvidence = {
  purpose: string;
  status: string;
  approvedByUserId: number;
  companyId: string;
  modelId: string;
  requestId: string;
  workerName: string;
  sourceSha: string;
  approvedAt: string;
  expiresAt: string;
  consumedAt: string | null;
  jobId: number | null;
};
export type PilotJobEvidence = {
  id: number;
  status: string;
  jobType: string;
  requestId: string;
  modelId: string;
};
export type PilotApprovalReviewInput = {
  appEnv: string;
  nodeEnv: string;
  actor: PilotOwnerActor;
  approval: PilotApprovalEvidence | null;
  job: PilotJobEvidence | null;
  expectedSourceSha: string;
  nowIso: string;
};
export function reviewCstDevOneJobOwnerApproval(input: PilotApprovalReviewInput) {
  const failures: string[] = [];
  const requireCondition=(ok:boolean,code:string)=>{if(!ok)failures.push(code)};
  const {actor,approval,job}=input;
  requireCondition(input.appEnv==="development" && input.nodeEnv==="development","DEV_ONLY");
  requireCondition(Boolean(actor && Number.isSafeInteger(actor.id) && actor.id>0 &&
    actor.role==="owner" && actor.status==="active" && actor.accountType==="internal"),
    "VERIFIED_OWNER_SESSION_REQUIRED");
  requireCondition(SHA.test(input.expectedSourceSha),"SOURCE_SHA_INVALID");
  requireCondition(Boolean(approval),"PERSISTED_APPROVAL_MISSING");
  requireCondition(Boolean(job),"BOUND_JOB_MISSING");
  if (approval) {
    const now=Date.parse(input.nowIso),start=Date.parse(approval.approvedAt),end=Date.parse(approval.expiresAt);
    requireCondition(approval.purpose==="CST_DEV_ONEJOB_MODEL" && approval.status==="APPROVED",
      "APPROVAL_PURPOSE_OR_STATUS_INVALID");
    requireCondition(Boolean(actor && approval.approvedByUserId===actor.id),"APPROVER_ID_MISMATCH");
    requireCondition(approval.companyId==="1" && approval.modelId==="qwen2.5:3b",
      "APPROVAL_COMPANY_OR_MODEL_MISMATCH");
    requireCondition(REQUEST.test(approval.requestId) && WORKER.test(approval.workerName),
      "REQUEST_OR_WORKER_IDENTITY_INVALID");
    requireCondition(approval.sourceSha===input.expectedSourceSha,"APPROVAL_SOURCE_MISMATCH");
    requireCondition(Number.isFinite(now) && Number.isFinite(start) && Number.isFinite(end) &&
      start<=now && now<end && end-start>0 && end-start<=7*24*60*60*1000,
      "APPROVAL_EXPIRED_OR_UNBOUNDED");
    requireCondition(approval.consumedAt===null,"APPROVAL_ALREADY_CONSUMED");
    requireCondition(Number.isSafeInteger(approval.jobId) && Number(approval.jobId)>0 &&
      approval.jobId!==482,"APPROVAL_JOB_ID_INVALID");
  }
  if(job){
    requireCondition(Number.isSafeInteger(job.id) && job.id>0 && job.id!==482 &&
      job.status==="queued" && job.jobType==="ollama_model_invocation" &&
      job.modelId==="qwen2.5:3b","BOUND_JOB_NOT_QUEUED_MODEL");
    requireCondition(Boolean(approval && job.id===approval.jobId &&
      job.requestId===approval.requestId && job.modelId===approval.modelId),
      "APPROVAL_JOB_BINDING_MISMATCH");
  }
  return {
    status:failures.length===0?"REVIEW_INPUTS_MATCH":"DENIED",
    failures,
    mode:"PURE_REVIEW_ONLY_NOT_AN_AUTHORIZATION",
    dispatchPermitted:false,
    signerActivationPermitted:false,
    finalAckVerified:false,
  } as const;
}