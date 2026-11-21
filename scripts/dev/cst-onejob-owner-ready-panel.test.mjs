import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const load=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
const jobs=load("artifacts/api-server/src/routes/jobs.ts");
const stage=load("artifacts/api-server/src/services/cstOneJobOwnerApprovalStageService.ts");
const ui=load("artifacts/ai-platform/src/pages/cst-dev-onejob.tsx");
const layout=load("artifacts/ai-platform/src/components/layout.tsx");
const app=load("artifacts/ai-platform/src/App.tsx");
test("one Super Admin WAITING click checks dedicated DB scope but defers job-specific QA until admission",()=>{
 const pos=jobs.indexOf('router.get("/ai/dev/onejob/owner-stage-readiness"');
 const post=jobs.indexOf('router.post("/ai/dev/onejob/owner-approve-and-stage"');
 assert.ok(pos>0&&post>pos);
 const read=jobs.slice(pos,post);
 for(const pattern of [
  /requireAuth/,/requireInternalRole\("owner"\)/,/requirePasswordChanged/,
  /readIndependentlySignedPreapproval/,/getCstOneJobStagingDatabase/,
  /SET TRANSACTION READ ONLY/,/scoped_membership/,
  /readyForOneOwnerClick:blockers\.length===0/,
  /dispatchPermitted:false/
 ])assert.match(read,pattern);
 assert.match(read,/qaTechnicalPreflightAdvisory:qa.verified/);
 assert.match(read,/signedQaAdmissionStillRequired:true/);
 assert.match(read,/const blockers=\[\.\.\.envGate.blockers,\.\.\.stageConfig.blockers\]/);
 assert.doesNotMatch(stage,/INDEPENDENT_QA_PREAPPROVAL_REQUIRED/);
 assert.doesNotMatch(stage,/readIndependentlySignedPreapproval/);
 assert.match(stage,/status:"waiting" as const/);
});
test("UI never auto-approves, never asks for a new login, and is hidden outside Owner DEV",()=>{
 assert.match(ui,/user\.role==="owner"/);
 assert.match(ui,/dev\.cstlogistic\.co\.id/);
 assert.match(ui,/disabled=\{!ready\|\|submitted\|\|loading\}/);
 assert.match(ui,/APPROVE_ONE_NEW_CST_DEV_MODEL_JOB/);
 assert.match(ui,/operationsRootFingerprint:readiness.data\?\.operationsRootCandidateSha256/);
 assert.match(ui,/onejob-ops-candidate-fingerprint/);
 assert.match(ui,/setSubmitted\(true\)/);
 assert.doesNotMatch(ui,/request-magic-link|type="password"|setInterval|autoRetry/i);
 assert.match(layout,/nav-dev-onejob/);
 assert.match(layout,/user\?\.role==="owner"/);
 assert.match(app,/path="\/dev-onejob" component=\{CstDevOneJobPage\}/);
});
test("Owner action stages WAITING only; no grant, dispatch, or final ACK",()=>{
 assert.match(stage,/status:"waiting" as const/);
 assert.match(stage,/dispatchPermitted:false,finalAckVerified:false/);
 assert.doesNotMatch(stage,/GRANT ALL|CREATE ROLE|status:"queued" as const/);
});
