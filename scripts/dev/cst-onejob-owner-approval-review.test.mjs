import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {reviewCstDevOneJobOwnerApproval} from "../../artifacts/api-server/src/lib/cstOneJobOwnerApprovalReview.ts";

const sha="a".repeat(40);
const requestId="cst-ai-team-company1-dev:pilot-"+"b".repeat(20);
const workerName="cst-dev-dell-onejob-20261119-abcdef12";
const actor={id:1,role:"owner",status:"active",accountType:"internal"};
const approval={
  purpose:"CST_DEV_ONEJOB_MODEL",status:"APPROVED",approvedByUserId:1,
  companyId:"1",modelId:"qwen2.5:3b",requestId,workerName,sourceSha:sha,
  approvedAt:"2026-11-19T15:00:00.000Z",expiresAt:"2026-11-19T15:20:00.000Z",
  consumedAt:null,jobId:483,
};
const job={id:483,status:"queued",jobType:"ollama_model_invocation",requestId,modelId:"qwen2.5:3b"};
const valid={appEnv:"development",nodeEnv:"development",actor,approval,job,expectedSourceSha:sha,nowIso:"2026-11-19T15:05:00.000Z"};
const deny=(patch,code)=>{
 const r=reviewCstDevOneJobOwnerApproval({...valid,...patch});
 assert.equal(r.status,"DENIED");
 assert.ok(r.failures.includes(code),r.failures.join(","));
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.signerActivationPermitted,false);
};
test("matching evidence is review-only, never permission to execute",()=>{
 const r=reviewCstDevOneJobOwnerApproval(valid);
 assert.equal(r.status,"REVIEW_INPUTS_MATCH");
 assert.deepEqual(r.failures,[]);
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.finalAckVerified,false);
});
test("same one-use Owner approval survives multiple days of isolated QA but stays review only",()=>{
 const longer={...approval,expiresAt:"2026-11-26T15:00:00.000Z"};
 const r=reviewCstDevOneJobOwnerApproval({...valid,approval:longer,
   nowIso:"2026-11-24T15:00:00.000Z"});
 assert.equal(r.status,"REVIEW_INPUTS_MATCH");
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.finalAckVerified,false);
});
test("no session, arbitrary admin, deactivated or client-spoofed actor denied",()=>{
 deny({actor:null},"VERIFIED_OWNER_SESSION_REQUIRED");
 deny({actor:{...actor,role:"admin"}},"VERIFIED_OWNER_SESSION_REQUIRED");
 deny({actor:{...actor,status:"inactive"}},"VERIFIED_OWNER_SESSION_REQUIRED");
 deny({actor:{...actor,accountType:"external"}},"VERIFIED_OWNER_SESSION_REQUIRED");
 deny({actor:{...actor,id:99}},"APPROVER_ID_MISMATCH");
});
test("only exact development, unexpired one-use approval with pinned scope accepted",()=>{
 deny({appEnv:"production"},"DEV_ONLY");
 deny({approval:{...approval,consumedAt:"2026-11-19T15:04:00.000Z"}},"APPROVAL_ALREADY_CONSUMED");
 deny({nowIso:"2026-11-19T15:21:00.000Z"},"APPROVAL_EXPIRED_OR_UNBOUNDED");
 deny({approval:{...approval,expiresAt:"2026-11-27T15:00:00.000Z"}},"APPROVAL_EXPIRED_OR_UNBOUNDED");
 deny({approval:{...approval,sourceSha:"c".repeat(40)}},"APPROVAL_SOURCE_MISMATCH");
 deny({approval:{...approval,companyId:"3"}},"APPROVAL_COMPANY_OR_MODEL_MISMATCH");
 deny({approval:{...approval,workerName:"other"}},"REQUEST_OR_WORKER_IDENTITY_INVALID");
 deny({approval:{...approval,purpose:"SECURITY_CHANGE"}},"APPROVAL_PURPOSE_OR_STATUS_INVALID");
});
test("job identity, type, freshness and request binding cannot be substituted",()=>{
 deny({job:{...job,id:482}},"BOUND_JOB_NOT_QUEUED_MODEL");
 deny({job:{...job,id:484}},"APPROVAL_JOB_BINDING_MISMATCH");
 deny({job:{...job,status:"completed"}},"BOUND_JOB_NOT_QUEUED_MODEL");
 deny({job:{...job,jobType:"ollama_powershell_execution"}},"BOUND_JOB_NOT_QUEUED_MODEL");
 deny({job:{...job,requestId:"different"}},"APPROVAL_JOB_BINDING_MISMATCH");
 deny({approval:{...approval,jobId:482}},"APPROVAL_JOB_ID_INVALID");
});
test("multi-day DEV approval migration keeps one-use scope and no privileged role grants",()=>{
 const stage=readFileSync(new URL("../../artifacts/api-server/src/services/cstOneJobOwnerApprovalStageService.ts",import.meta.url),"utf8");
 const migration=readFileSync(new URL("../../docs/dev/cst-onejob-owner-approval-seven-day.CSTDEV-ONLY.sql",import.meta.url),"utf8");
 const rollback=readFileSync(new URL("../../docs/dev/cst-onejob-owner-approval-seven-day.ROLLBACK-CSTDEV-ONLY.sql",import.meta.url),"utf8");
 assert.match(stage,/now\(\)\+interval '7 days'/);
 for(const invariant of [
  "cst_onejob_stage_approval_insert","cst_team_model_pilot_writer",
  "expires_at<=approved_at+interval '7 days'",
  "j.status='waiting'","u.status='active'"
 ]){
  assert.ok(migration.includes(invariant),invariant);
 }
 assert.match(migration,/ACTIVE_STAGE_OR_APPROVAL_DENIED/);
 assert.match(rollback,/ROLLBACK_LONG_APPROVALS_PRESENT/);
 assert.doesNotMatch(migration,/GRANT ALL|ALTER ROLE .* LOGIN|SET ROLE .*superuser/);
});
test("helper is not an HTTP approval route, role grant or DB mutation",()=>{
 const s=readFileSync(new URL("../../artifacts/api-server/src/lib/cstOneJobOwnerApprovalReview.ts",import.meta.url),"utf8");
 assert.match(s,/PURE_REVIEW_ONLY_NOT_AN_AUTHORIZATION/);
 assert.match(s,/dispatchPermitted:false/);
 assert.match(s,/VERIFIED_OWNER_SESSION_REQUIRED/);
 assert.doesNotMatch(s,/INSERT INTO|CREATE ROLE|UPDATE ai_platform|fetch\(|router\.post|express|jwt\.sign/);
});