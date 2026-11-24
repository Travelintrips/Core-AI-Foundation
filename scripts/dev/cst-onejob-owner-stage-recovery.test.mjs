import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {reviewCstOneJobStageRecovery as review}
 from "../../artifacts/api-server/src/lib/cstOneJobStageRecoveryReview.ts";
const read=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
const source="e".repeat(40);
const request="cst-ai-team-company1-dev:pilot-"+"a".repeat(20);
const baseline=()=>({
  approval:{
    job_id:483,company_id:"1",model_id:"qwen2.5:3b",
    status:"APPROVED",source_sha:source,request_id:request,
    expires_at:"2026-11-21T14:00:00.000Z"
  },
  job:{
    id:483,job_code:"OLLAMA-A1B2C3D4",status:"waiting",
    job_type:"ollama_model_invocation",model_id:"qwen2.5:3b",
    request_id:request
  },
  expectedSourceSha:source,nowMs:Date.parse("2026-11-21T13:55:00.000Z")
});
const safe=(v)=>{
  assert.equal(v.automaticRetryAllowed,false);
  assert.equal(v.dispatchPermitted,false);
  assert.equal(v.releaseDecision,"NO_GO");
};
test("real paired owner WAITING readback confirms one job but never authorizes a retry",()=>{
 const x=review(baseline());
 assert.equal(x.state,"WAITING_VERIFIED");
 assert.equal(x.jobId,483);
 assert.equal(x.jobCode,"OLLAMA-A1B2C3D4");
 assert.equal(x.approvalReadbackVerified,true);
 assert.equal(x.jobReadbackVerified,true);
 safe(x);
});
test("missing row under restricted RLS is ambiguous, never proof that POST failed",()=>{
 for(const a of [null,undefined]){
  const x=review({...baseline(),approval:a});
  assert.equal(x.state,"NOT_VISIBLE");
  assert.equal(x.jobId,null);
  safe(x);
 }
});
test("expired or historical source does not become new permission",()=>{
 const expired=review({...baseline(),nowMs:Date.parse("2026-11-21T14:00:00.000Z")});
 assert.equal(expired.state,"EXPIRED");safe(expired);
 const wrong=review({...baseline(),expectedSourceSha:"f".repeat(40)});
 assert.equal(wrong.state,"SOURCE_MISMATCH");safe(wrong);
});
test("wrong job, worker source or forged row is rejected as one active WAITING proof",()=>{
 for(const patch of [
  {id:484},{status:"queued"},{job_type:"coding_repository_analyzer"},
  {request_id:"cst-ai-team-company1-dev:pilot-"+"b".repeat(20)},
  {job_code:"FORGED"},{model_id:"qwen2.5:72b"}
 ]){
  const i=baseline(),x=review({...i,job:{...i.job,...patch}});
  assert.equal(x.state,"JOB_NOT_VISIBLE");safe(x);
 }
 for(const patch of [
  {job_id:482},{company_id:"3"},{status:"CONSUMED"},
  {model_id:"qwen2.5:72b"},{request_id:"fake"},
  {source_sha:"not-a-sha"},{expires_at:"invalid"}
 ]){
  const i=baseline(),x=review({...i,approval:{...i.approval,...patch}});
  assert.equal(x.state,"UNVERIFIED_ROW");safe(x);
 }
});
test("database reader uses only already-granted columns, scoped role and READ ONLY",()=>{
 const db=read("artifacts/api-server/src/services/cstOneJobStageRecoveryService.ts");
 for(const token of [
  "SET TRANSACTION READ ONLY",
  "SET LOCAL ROLE cst_team_model_pilot_writer",
  "session_user AS login",
  "actor?.login!==CST_ONEJOB_STAGE_LOGIN",
  "approved_by_user_id=",
  "status='APPROVED' AND consumed_at IS NULL",
  "ORDER BY expires_at DESC LIMIT 2",
  "payload_json->>'requestId'",
  "getCstOneJobStagingDatabase(input.env)"
 ])assert.ok(db.includes(token),token);
 for(const banned of [
  "ORDER BY approved_at","INSERT INTO","UPDATE ai_platform",
  "DELETE FROM","SET TRANSACTION READ WRITE","CREATE ROLE",
  "GRANT ALL","return db.transaction"
 ])assert.ok(!db.includes(banned),banned);
});
test("recovery API enforces real internal Owner, no second POST, sanitizes DB errors",()=>{
 const route=read("artifacts/api-server/src/routes/jobs.ts");
 const start=route.indexOf('router.get("/ai/dev/onejob/owner-stage-status"');
 const end=route.indexOf('router.post("/ai/dev/onejob/owner-approve-and-stage"',start);
 assert.ok(start>0&&end>start);
 const code=route.slice(start,end);
 for(const token of [
  'requireCstOneJobStageOwner',
  "ownerUserId:actor.id","Cache-Control","no-store","status(503)",
  "automaticRetryAllowed:false"
 ])assert.ok(code.includes(token),token);
 for(const banned of ["req.body.actor","req.body.owner","newPassword",
                      "x-admin-key","requireAdminApiKey"])
  assert.ok(!code.includes(banned),banned);
 assert.equal(route.split('router.get("/ai/dev/onejob/owner-stage-status"').length-1,1);
 assert.equal(route.split('router.post("/ai/dev/onejob/owner-approve-and-stage"').length-1,1);
});
test("UI checks status via GET after ambiguous POST and never sends another POST",()=>{
 const ui=read("artifacts/ai-platform/src/pages/cst-dev-onejob.tsx");
 for(const token of [
  "read-onejob-approval-status","onejob-recovered-waiting",
  "const recovery=await checkPreviousApproval()",
  'apiFetch<Recovery>("/api/ai/dev/onejob/owner-stage-status")',
  "setSubmitted(true)","automaticRetryAllowed:false",
  "disabled={!ready||submitted||loading||statusLoading}"
 ])assert.ok(ui.includes(token),token);
 assert.equal(ui.split('method:"POST"').length-1,1);
});
test("root approval, QA and dispatcher remain independent mandatory gates",()=>{
 const core=read("artifacts/api-server/src/services/cstOneJobOwnerApprovalStageService.ts");
 const broker=read("scripts/dev/cst-onejob-trusted-admission-bridge.mjs");
 for(const token of ["status:\"waiting\" as const","independentQaAdmissionVerified:false"])
  assert.ok(core.includes(token),token);
 for(const token of ["SIGNED_QA_EVIDENCE_DENIED","admit_verified_onejob_capability"])
  assert.ok(broker.includes(token),token);
});

test("a WAITING job reads the same Owner fingerprint audit without creating signed root trust",()=>{
 const reader=read("artifacts/api-server/src/services/cstOneJobStageRecoveryService.ts");
 const page=read("artifacts/ai-platform/src/pages/cst-dev-onejob.tsx");
 const audit=read("artifacts/api-server/src/lib/cstOneJobOperationsRootSelectionReview.ts");
 for(const part of [
  "SELECT module,action,resource_type,resource_id,status,details",
  "FROM ai_platform.ai_audit_logs",
  "action='owner_approved_waiting_job'",
  "details->>'approvalId'",
  "ONEJOB_RECOVERY_DUPLICATE_ROOT_AUDIT",
  "reviewCstOneJobSingleSuperAdminRootSelection",
  "rootCandidateAuditMatched:proof.sameSuperAdminSingleJobFieldsMatch",
  "operationsRootTrusted:false,signedReleaseAuthorized:false",
  "SET TRANSACTION READ ONLY",
  "SET LOCAL ROLE cst_team_model_pilot_writer",
 ])assert.ok(reader.includes(part),part);
 assert.match(audit,/authenticatedDbReadbackVerified:false/);
 assert.match(page,/recovered.rootCandidateAuditMatched/);
 assert.match(page,/Kunci Operations masih belum dipercaya/);
 assert.doesNotMatch(reader,/GRANT ALL|CREATE ROLE|INSERT INTO|SET TRANSACTION READ WRITE/);
});
test("source-pinned narrow audit SELECT migration cannot grant writer UPDATE or another root",()=>{
 const mig=read("docs/dev/cst-onejob-stage-ops-root-audit-read.CSTDEV-ONLY.sql");
 const rollback=read("docs/dev/cst-onejob-stage-ops-root-audit-read.ROLLBACK-CSTDEV-ONLY.sql");
 assert.match(mig,/CREATE POLICY cst_onejob_stage_owner_audit_read/);
 assert.match(mig,/FOR SELECT TO cst_team_model_pilot_writer/);
 assert.match(mig,/GRANT SELECT \(purpose\)/);
 assert.match(mig,/GRANT SELECT \(module,action,resource_type,resource_id,status,details\)/);
 assert.match(mig,/65aa7599c60cc0acc71d72f9f3bd5bd810873aad725fa64856e36639c995f71b/);
 assert.match(mig,/sameSuperAdminRootSelection/);
 assert.match(mig,/operationsRootTrusted/);
 assert.match(mig,/independentQaAdmissionVerified/);
 assert.match(mig,/OWNER_APPROVAL_OR_STAGE_SESSION_ALREADY_PRESENT/);
 assert.doesNotMatch(mig,/GRANT SELECT ON ai_platform.ai_audit_logs|GRANT ALL|GRANT UPDATE|ALTER ROLE|CREATE ROLE/);
 assert.match(rollback,/ROOT_AUDIT_READER_ROLLBACK_ACTIVE_APPROVAL_DENIED/);
 assert.match(rollback,/REVOKE SELECT \(purpose\)/);
});
