/**
 * Pure matching of an independently obtained CST-DEV DB readback to ONE
 * Super Admin's audit-bound Operations public candidate selection.
 *
 * This does not read PostgreSQL, authenticate a session, trust a root,
 * sign a permit, write a row, or issue release permission. Actual Ops
 * release requires a separate *authenticated* database readback and the
 * existing cryptographic verification/replay gates.
 */
import {CST_ONEJOB_PUBLIC_OPERATIONS_CANDIDATE_SHA256 as CANDIDATE}
 from "./cstOneJobOperationsRootCandidate.js";

const ID=/^[0-9]+$/;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA40=/^[a-f0-9]{40}$/;
const REQUEST=/^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$/;
const WORKER=/^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$/;
type Row=Record<string,unknown>;
const obj=(v:unknown):v is Row=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const check=(v:unknown,keys:readonly string[]):v is Row=>obj(v)&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const safe=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;

const detailsKeys=[
 "ownerUserId","approvalId","requestId","workerName","sourceSha",
 "operationsRootCandidateSha256","sameSuperAdminRootSelection",
 "operationsRootTrusted","independentQaAdmissionVerified","dispatchPermitted"
] as const;

export function reviewCstOneJobSingleSuperAdminRootSelection(input:{
 owner?:unknown;approval?:unknown;job?:unknown;audit?:unknown;
 sourceSha:unknown;nowIso:unknown;
}){
 const reasons:string[]=[];
 const need=(ok:boolean,why:string)=>{if(!ok)reasons.push(why)};
 const owner=obj(input.owner)?input.owner:null;
 const approval=obj(input.approval)?input.approval:null;
 const job=obj(input.job)?input.job:null;
 const audit=obj(input.audit)?input.audit:null;
 const d=audit&&obj(audit.details)?audit.details:null;
 const now=typeof input.nowIso==="string"?Date.parse(input.nowIso):NaN;
 const expires=typeof approval?.expiresAt==="string"?Date.parse(approval.expiresAt):NaN;

 need(Boolean(owner&&safe(owner.id)&&owner.role==="owner"&&
      owner.status==="active"&&owner.accountType==="internal"),
      "ACTIVE_SUPER_ADMIN_FROM_CURRENT_DB_REQUIRED");
 need(Boolean(SHA40.test(String(input.sourceSha))&&
      approval&&approval.sourceSha===input.sourceSha),
      "CURRENT_SOURCE_SHA_MISMATCH");
 need(Boolean(approval&&UUID.test(String(approval.id))&&
     approval.companyId==="1"&&approval.modelId==="qwen2.5:3b"&&
     approval.status==="APPROVED"&&approval.purpose==="CST_DEV_ONEJOB_MODEL"&&
     approval.consumedAt===null&&
     safe(approval.approvedByUserId)&&owner&&approval.approvedByUserId===owner.id&&
     safe(approval.jobId)&&Number(approval.jobId)>482&&
     REQUEST.test(String(approval.requestId))&&
     WORKER.test(String(approval.workerName))&&
     Number.isFinite(now)&&Number.isFinite(expires)&&now<expires),
      "OWNER_APPROVAL_NOT_VALID_FOR_ONE_WAITING_JOB");
 need(Boolean(job&&safe(job.id)&&Number(job.id)>482&&
    approval&&job.id===approval.jobId&&job.status==="waiting"&&
    job.jobType==="ollama_model_invocation"&&
    job.modelId==="qwen2.5:3b"&&job.requestId===approval.requestId),
    "JOB_NOT_MATCHED_OR_NO_LONGER_WAITING");
 need(Boolean(audit&&audit.module==="cst-onejob"&&
    audit.action==="owner_approved_waiting_job"&&
    audit.resourceType==="ai_job"&&audit.status==="success"&&
    approval&&audit.resourceId===String(approval.jobId)&&
    check(d,detailsKeys)),
    "AUDIT_SOURCE_OR_SHAPE_NOT_VERIFIED");
 need(Boolean(d&&approval&&owner&&d.ownerUserId===owner.id&&
    d.approvalId===approval.id&&d.requestId===approval.requestId&&
    d.workerName===approval.workerName&&d.sourceSha===input.sourceSha&&
    d.operationsRootCandidateSha256===CANDIDATE&&
    d.sameSuperAdminRootSelection===true&&
    d.operationsRootTrusted===false&&
    d.independentQaAdmissionVerified===false&&
    d.dispatchPermitted===false),
    "CANDIDATE_ROOT_NOT_BOUND_TO_SAME_SUPER_ADMIN_AUDIT");
 return {
  status:reasons.length?"DENIED":"READBACK_FIELDS_MATCH_ONLY",
  reasons,
  publicCandidateSha256:CANDIDATE,
  sameSuperAdminSingleJobFieldsMatch:reasons.length===0,
  // Caller objects are not a certified DB session: no fake live release!
  authenticatedDbReadbackVerified:false,
  independentOperationsCustodyProven:false,
  operationsRootTrusted:false,
  preAdmissionQaVerified:false,
  signedReleaseAuthorized:false,
  dispatchPermitted:false,operationalE2EVerified:false,
  releaseDecision:"NO_GO",
 } as const;
}
