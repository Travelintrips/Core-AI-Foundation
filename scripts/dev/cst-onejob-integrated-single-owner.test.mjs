import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
const ROOT=new URL("../../",import.meta.url);
const read=(path)=>readFileSync(new URL(path,ROOT),"utf8");

test("only canonical one-tap Owner staging API is registered",()=>{
 const jobs=read("artifacts/api-server/src/routes/jobs.ts");
 const routes=read("artifacts/api-server/src/routes/index.ts");
 const owner=jobs.split('router.post("/ai/dev/onejob/owner-approve-and-stage"');
 assert.equal(owner.length,2,"one canonical staging endpoint only");
 assert.match(owner[1],/requireAuth/);
 assert.match(owner[1],/requireInternalRole\("owner"\)/);
 assert.match(owner[1],/requirePasswordChanged/);
 assert.match(owner[1],/verifyFreshOneJobStageConsent/);
 assert.match(owner[1],/FRESH_EXPLICIT_OWNER_STAGE_CONSENT_REQUIRED/);
 assert.doesNotMatch(routes,/cstTeamOneJobOwnerConsentRouter/);
 assert.equal(existsSync(new URL("artifacts/api-server/src/routes/cst-team-onejob-owner-consent.ts",ROOT)),false);
});

test("WAITING job and exactly one approval are staged atomically with no dispatch",()=>{
 const service=read("artifacts/api-server/src/services/cstOneJobOwnerApprovalStageService.ts");
 const txn=service.indexOf("return stageDb.transaction(async tx=>");
 const job=service.indexOf("INSERT INTO ai_platform.ai_jobs",txn);
 const appr=service.indexOf("INSERT INTO ai_platform.cst_onejob_owner_approvals",job);
 const audit=service.indexOf("INSERT INTO ai_platform.ai_audit_logs",appr);
 assert.ok(txn>=0 && job>txn && appr>job && audit>appr);
 assert.match(service,/ONEJOB_SINGLE_ACTIVE_INDEX_NOT_READY/);
 assert.match(service,/cst_onejob_one_active_approval/);
 assert.match(service,/cst_team_model_pilot_writer/);
 assert.match(service,/status:"waiting" as const/);
 assert.match(service,/dispatchPermitted:false/);
 assert.doesNotMatch(service,/CREATE ROLE|GRANT ALL/);
});

test("no parallel pre-stage authority is present in integrated source",()=>{
 assert.equal(existsSync(new URL("scripts/dev/cst-team-onejob-prestage-once.mjs",ROOT)),false);
 assert.equal(existsSync(new URL("scripts/dev/cst-team-onejob-prestage-role-template.sql",ROOT)),false);
 const consent=read("artifacts/api-server/src/lib/cstOneJobFreshStageConsent.ts");
 assert.match(consent,/APPROVE_ONE_NEW_CST_DEV_MODEL_JOB/);
});

test("operational broker and signed consumer cannot silently issue E2E PASS",()=>{
 const broker=read("scripts/dev/cst_team_onejob_operational_broker.py");
 const subscriber=read("scripts/dev/cst-team-onejob-subscriber-receipt.mjs");
 const acceptance=read("scripts/dev/cst-onejob-onepass-acceptance.mjs");
 assert.match(broker,/SO_PEERCRED|verify_unix_peer/);
 assert.match(subscriber,/signature|sign|receipt/i);
 assert.match(acceptance,/releaseDecision:"NO_GO"/);
 assert.match(acceptance,/dispatchPermitted:false/);
 assert.match(acceptance,/finalAckIssued:false/);
});
