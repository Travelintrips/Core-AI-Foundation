import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {reviewOneJobWaitingAdmission} from "../../artifacts/api-server/src/lib/cstOneJobWaitingAdmissionReview.ts";
const sha="a".repeat(40),requestId="cst-ai-team-company1-dev:pilot-"+"b".repeat(20);
const worker="cst-dev-dell-onejob-20261119-abcdef12";
const approval={status:"APPROVED",companyId:"1",modelId:"qwen2.5:3b",
 requestId,workerName:worker,sourceSha:sha,jobId:483,approvedByUserId:1,
 approvedAt:"2026-11-19T15:00:00.000Z",expiresAt:"2026-11-19T15:20:00.000Z",consumedAt:null};
const job={id:483,status:"waiting",jobType:"ollama_model_invocation",
 requiredCapability:"ollama_inference",requestId,modelId:"qwen2.5:3b",maxRetry:0};
const ready={environment:"development",nodeEnvironment:"development",approval,job,
 expectedWorkerName:worker,candidateBuildSha:sha,uniqueRequestIndexVerified:true,
 candidateHealthy:true,candidateInternalNetworkVerified:true,candidateDatabaseRoleVerified:true,
 candidateDbScopeVerified:true,jobRequestCardinality:1,auditReady:true,
 eventAndReceiptPathReady:true,independentQaAvailable:true,otherActivePilotCount:0,
 nowIso:"2026-11-19T15:05:00.000Z"};
function deny(patch,why){
 const r=reviewOneJobWaitingAdmission({...ready,...patch});
 assert.equal(r.status,"DENIED");
 assert.ok(r.blockers.includes(why),r.blockers.join(","));
 assert.equal(r.queueTransitionAuthorized,false);
 assert.equal(r.dispatchPermitted,false);
}
test("complete hypothetical evidence never grants a transition",()=>{
 const r=reviewOneJobWaitingAdmission(ready);
 assert.equal(r.status,"REVIEW_CONDITIONS_MATCH");
 assert.deepEqual(r.blockers,[]);
 assert.equal(r.queueTransitionAuthorized,false);
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.finalAckVerified,false);
});
test("bound WAITING approval may remain pending for five days without a second human click",()=>{
 const extended={...approval,expiresAt:"2026-11-26T15:00:00.000Z"};
 const result=reviewOneJobWaitingAdmission({...ready,approval:extended,
    nowIso:"2026-11-24T15:00:00.000Z"});
 assert.equal(result.status,"REVIEW_CONDITIONS_MATCH");
 assert.equal(result.queueTransitionAuthorized,false);
 assert.equal(result.finalAckVerified,false);
});
test("approval must remain one-use, current and bound to a waiting job",()=>{
 deny({approval:{...approval,consumedAt:"2026-11-19T15:04:00.000Z"}},"OWNER_APPROVAL_ALREADY_USED");
 deny({approval:{...approval,sourceSha:"c".repeat(40)}},"APPROVAL_SOURCE_SHA_MISMATCH");
 deny({nowIso:"2026-11-19T15:21:00.000Z"},"APPROVAL_EXPIRED");
 deny({job:{...job,status:"queued"}},"JOB_NOT_FRESH_WAITING_MODEL");
 deny({job:{...job,id:482}},"JOB_NOT_FRESH_WAITING_MODEL");
 deny({job:{...job,id:484}},"APPROVAL_JOB_BINDING_MISMATCH");
 deny({job:{...job,jobType:"ollama_powershell_execution"}},"JOB_NOT_FRESH_WAITING_MODEL");
 deny({job:{...job,maxRetry:3}},"JOB_NOT_FRESH_WAITING_MODEL");
 deny({expectedWorkerName:"wrong"},"WORKER_MISMATCH");
});
test("global uniqueness, DEV identity, isolated runtime and receipt path required",()=>{
 deny({environment:"production"},"DEV_ONLY");
 deny({uniqueRequestIndexVerified:false},"REQUEST_UNIQUENESS_UNVERIFIED");
 deny({jobRequestCardinality:2},"REQUEST_UNIQUENESS_UNVERIFIED");
 deny({otherActivePilotCount:1},"OTHER_ACTIVE_PILOT_PRESENT");
 deny({candidateHealthy:false},"ISOLATED_CANDIDATE_NOT_READY");
 deny({candidateInternalNetworkVerified:false},"ISOLATED_CANDIDATE_NOT_READY");
 deny({candidateDatabaseRoleVerified:false},"SCOPED_DEV_DB_ROLE_NOT_VERIFIED");
 deny({candidateDbScopeVerified:false},"SCOPED_DEV_DB_ROLE_NOT_VERIFIED");
 deny({auditReady:false},"E2E_EVIDENCE_PATH_NOT_READY");
 deny({eventAndReceiptPathReady:false},"E2E_EVIDENCE_PATH_NOT_READY");
 deny({independentQaAvailable:false},"E2E_EVIDENCE_PATH_NOT_READY");
});
test("read-only source has no DB writes, HTTP routes or signer issuance",()=>{
 const s=readFileSync(new URL("../../artifacts/api-server/src/lib/cstOneJobWaitingAdmissionReview.ts",import.meta.url),"utf8");
 assert.match(s,/queueTransitionAuthorized:false/);
 assert.match(s,/finalAckVerified:false/);
 assert.doesNotMatch(s,/INSERT INTO|UPDATE ai_platform|CREATE ROLE|fetch\(|router\.post|jwt\.sign|DISPATCH_ALLOWED/);
});