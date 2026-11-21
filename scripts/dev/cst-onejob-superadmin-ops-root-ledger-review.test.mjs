import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {CST_ONEJOB_PUBLIC_OPERATIONS_CANDIDATE_SHA256 as rootFingerprint}
 from "../../artifacts/api-server/src/lib/cstOneJobOperationsRootCandidate.js";
import {reviewCstOneJobSingleSuperAdminRootSelection as review}
 from "../../artifacts/api-server/src/lib/cstOneJobOperationsRootSelectionReview.ts";

const source="e".repeat(40);
const base=()=>({
 owner:{id:19,role:"owner",status:"active",accountType:"internal"},
 approval:{
  id:"123e4567-e89b-12d3-a456-426614174000",approvedByUserId:19,
  jobId:483,companyId:"1",modelId:"qwen2.5:3b",status:"APPROVED",
  purpose:"CST_DEV_ONEJOB_MODEL",consumedAt:null,
  sourceSha:source,workerName:"cst-dev-dell-onejob-20261121-abcdef12",
  requestId:"cst-ai-team-company1-dev:pilot-"+"a".repeat(20),
  expiresAt:"2026-11-21T12:05:00.000Z",
 },
 job:{id:483,status:"waiting",jobType:"ollama_model_invocation",
      modelId:"qwen2.5:3b",requestId:"cst-ai-team-company1-dev:pilot-"+"a".repeat(20)},
 audit:{
  module:"cst-onejob",action:"owner_approved_waiting_job",
  resourceType:"ai_job",resourceId:"483",status:"success",
  details:{
   ownerUserId:19,approvalId:"123e4567-e89b-12d3-a456-426614174000",
   requestId:"cst-ai-team-company1-dev:pilot-"+"a".repeat(20),
   workerName:"cst-dev-dell-onejob-20261121-abcdef12",
   sourceSha:source,operationsRootCandidateSha256:rootFingerprint,
   sameSuperAdminRootSelection:true,operationsRootTrusted:false,
   independentQaAdmissionVerified:false,dispatchPermitted:false
  }
 },
 sourceSha:source,nowIso:"2026-11-21T12:00:00.000Z"
});
const reject=(change,code)=>{
 const a=base();change(a);
 const v=review(a);
 assert.equal(v.status,"DENIED",JSON.stringify(v));
 assert.ok(v.reasons.includes(code),JSON.stringify(v.reasons));
 assert.equal(v.operationsRootTrusted,false);
 assert.equal(v.signedReleaseAuthorized,false);
 assert.equal(v.dispatchPermitted,false);
 assert.equal(v.operationalE2EVerified,false);
};
test("one Owner Super Admin matches one waiting job + exact public candidate but does not issue release",()=>{
 const x=review(base());
 assert.equal(x.status,"READBACK_FIELDS_MATCH_ONLY");
 assert.equal(x.publicCandidateSha256,rootFingerprint);
 assert.equal(x.sameSuperAdminSingleJobFieldsMatch,true);
 assert.equal(x.authenticatedDbReadbackVerified,false);
 assert.equal(x.operationsRootTrusted,false);
 assert.equal(x.signedReleaseAuthorized,false);
 assert.equal(x.releaseDecision,"NO_GO");
});
test("wrong actor, stale/replayed approval, other company/job and source are denied",()=>{
 for(const [op,code] of [
  [x=>x.owner.role="admin","ACTIVE_SUPER_ADMIN_FROM_CURRENT_DB_REQUIRED"],
  [x=>x.owner.status="suspended","ACTIVE_SUPER_ADMIN_FROM_CURRENT_DB_REQUIRED"],
  [x=>x.approval.approvedByUserId=20,"OWNER_APPROVAL_NOT_VALID_FOR_ONE_WAITING_JOB"],
  [x=>x.approval.consumedAt="2026-11-21T12:00:00.000Z","OWNER_APPROVAL_NOT_VALID_FOR_ONE_WAITING_JOB"],
  [x=>x.approval.companyId="3","OWNER_APPROVAL_NOT_VALID_FOR_ONE_WAITING_JOB"],
  [x=>x.approval.jobId=482,"OWNER_APPROVAL_NOT_VALID_FOR_ONE_WAITING_JOB"],
  [x=>x.job.status="queued","JOB_NOT_MATCHED_OR_NO_LONGER_WAITING"],
  [x=>x.job.id=484,"JOB_NOT_MATCHED_OR_NO_LONGER_WAITING"],
  [x=>x.sourceSha="d".repeat(40),"CURRENT_SOURCE_SHA_MISMATCH"],
  [x=>x.nowIso="2026-11-21T12:10:00.000Z","OWNER_APPROVAL_NOT_VALID_FOR_ONE_WAITING_JOB"]
 ])reject(op,code);
});
test("forged/missing/misaligned root fingerprint and audit lineage are denied",()=>{
 for(const mutate of [
  x=>x.audit.details.operationsRootCandidateSha256="d".repeat(64),
  x=>x.audit.details.operationsRootTrusted=true,
  x=>x.audit.details.independentQaAdmissionVerified=true,
  x=>x.audit.details.sameSuperAdminRootSelection=false,
  x=>x.audit.details.dispatchPermitted=true,
  x=>x.audit.details.ownerUserId=20,
  x=>x.audit.details.approvalId="00000000-0000-0000-0000-000000000000",
  x=>x.audit.details.extra="forged",
  x=>x.audit.resourceId="484",
  x=>x.audit.action="owner_approved_all_jobs",
 ])reject(mutate,mutate.toString().includes("resourceId")||
   mutate.toString().includes("action")||
   mutate.toString().includes("extra")?
   "AUDIT_SOURCE_OR_SHAPE_NOT_VERIFIED":
   "CANDIDATE_ROOT_NOT_BOUND_TO_SAME_SUPER_ADMIN_AUDIT");
});
test("root selection verifier is pure; no grants, authentication forgery, signatures or dispatch",()=>{
 const code=readFileSync(new URL(
  "../../artifacts/api-server/src/lib/cstOneJobOperationsRootSelectionReview.ts",
  import.meta.url),"utf8");
 assert.doesNotMatch(code,/from "pg"|fetch\(|CREATE ROLE|INSERT INTO|GRANT ALL|privateKey|setTimeout|sign\(/);
 assert.match(code,/authenticatedDbReadbackVerified:false/);
 assert.match(code,/operationsRootTrusted:false/);
});

test("WAITING cannot be claimed by existing worker before signed admission",()=>{
 const worker=readFileSync(new URL(
   "../../artifacts/api-server/src/services/jobWorkerService.ts",import.meta.url),"utf8");
 const start=worker.indexOf("// Find the highest-priority available job and lock it.");
 const end=worker.indexOf("FOR UPDATE SKIP LOCKED",start);
 assert.ok(start>0&&end>start);
 const select=worker.slice(start,end);
 assert.match(select,/status = 'queued'/);
 assert.match(select,/status = 'retrying'/);
 assert.doesNotMatch(select,/status = 'waiting'/);
 const stage=readFileSync(new URL(
   "../../artifacts/api-server/src/services/cstOneJobOwnerApprovalStageService.ts",import.meta.url),"utf8");
 assert.match(stage,/status:"waiting" as const/);
 assert.doesNotMatch(stage,/status:"queued" as const/);
 const broker=readFileSync(new URL(
   "../../scripts/dev/cst-onejob-trusted-admission-bridge.mjs",import.meta.url),"utf8");
 assert.match(broker,/SIGNED_QA_EVIDENCE_DENIED/);
 assert.match(broker,/admit_verified_onejob_capability/);
});
