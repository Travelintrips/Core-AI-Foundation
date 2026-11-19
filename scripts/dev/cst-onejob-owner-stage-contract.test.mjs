import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";

const route=readFileSync(new URL("../../artifacts/api-server/src/routes/jobs.ts",import.meta.url),"utf8");
const service=readFileSync(new URL("../../artifacts/api-server/src/services/cstOneJobOwnerApprovalStageService.ts",import.meta.url),"utf8");
const ddl=readFileSync(new URL("../../docs/dev/cst-onejob-owner-approval.PROPOSED.sql",import.meta.url),"utf8");

test("dedicated Owner route authenticates from current internal session, not actor body",()=>{
 const pos=route.indexOf('router.post("/ai/dev/onejob/owner-approve-and-stage"');
 assert.ok(pos>0);
 const target=route.slice(pos,route.indexOf("// ── Enqueue Job",pos));
 assert.match(target,/requireAuth/);
 assert.match(target,/requireInternalRole\("owner"\)/);
 assert.match(target,/origin!=="https:\/\/dev\.cstlogistic\.co\.id"/);
 assert.match(target,/host!=="dev\.cstlogistic\.co\.id"/);
 assert.match(target,/ONEJOB_APPROVAL_BODY_MUST_BE_EMPTY/);
 assert.match(target,/ownerUserId:actor\.id/);
 assert.doesNotMatch(target,/x-admin-key|req\.body\.actor|admin-api|requireAdminApiKey/);
 assert.match(target,/dispatchPermitted:false/);
});
test("stage refuses unpinned runtime and all dispatching by default",()=>{
 assert.match(service,/CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED==="true"/);
 assert.match(service,/AI_DISPATCHER_ENABLED==="false"/);
 assert.match(service,/OLLAMA_WORKER_RUNTIME_ENABLED==="false"/);
 assert.match(service,/!env\.SUPABASE_PROD_DATABASE_URL/);
 assert.match(service,/CST_TEAM_DEV_APPROVED_SOURCE_SHA/);
 assert.match(service,/CST_TEAM_DEV_APPROVED_WORKER_NAME/);
 assert.match(service,/DEV_SOURCE_SHA_NOT_PINNED/);
});
test("waiting job, approval FK and audit are atomic in same transaction",()=>{
 const tx=service.indexOf("return db.transaction(async tx=>");
 const job=service.indexOf("INSERT INTO ai_platform.ai_jobs",tx);
 const appr=service.indexOf("INSERT INTO ai_platform.cst_onejob_owner_approvals",job);
 const audit=service.indexOf("INSERT INTO ai_platform.ai_audit_logs",appr);
 assert.ok(tx>0 && job>tx && appr>job && audit>appr);
 assert.doesNotMatch(service,/FOR SHARE/);
 assert.match(service,/role='owner' AND status='active' AND account_type='internal'/);
 assert.match(service,/ONEJOB_UNIQUE_INDEX_NOT_READY/);
 assert.match(service,/,'waiting',0,'immediate'/);
 assert.match(service,/status:"waiting" as const/);
 assert.match(service,/admissionReady:false,dispatchPermitted:false,finalAckVerified:false/);
 assert.doesNotMatch(service,/status:"queued" as const|CREATE ROLE|DROP ROLE|DISPATCH_ALLOWED|SUPABASE_PROD_DATABASE_URL\s*=/);
});
test("proposal is not migration-applied; forced-RLS approval row binds exactly one job",()=>{
 assert.match(ddl,/PROPOSED ONLY/);
 assert.match(ddl,/job_id integer NOT NULL UNIQUE REFERENCES ai_platform\.ai_jobs\(id\)/);
 assert.match(ddl,/request_id text NOT NULL UNIQUE/);
 assert.match(ddl,/approved_by_user_id integer NOT NULL REFERENCES ai_platform\.internal_users\(id\)/);
 assert.match(ddl,/FORCE ROW LEVEL SECURITY/);
 assert.match(ddl,/Intentionally no GRANT or policy/);
 assert.doesNotMatch(ddl,/GRANT\s+(?:ALL|INSERT|UPDATE)|DISABLE ROW LEVEL SECURITY/i);
});

test("owner stage rejects shared runtime DB role before any job writes",()=>{
 const tx=service.indexOf("return db.transaction(async tx=>");
 const gate=service.indexOf("ONEJOB_DEDICATED_WRITER_RLS_NOT_PROVISIONED",tx);
 const owner=service.indexOf("OWNER_NOT_ACTIVE_IN_TRANSACTION",gate);
 const insert=service.indexOf("INSERT INTO ai_platform.ai_jobs",owner);
 assert.ok(tx>=0 && gate>tx && owner>gate && insert>owner);
 assert.match(service,/current_user AS role_name/);
 assert.match(service,/scope\?\.role_name!=='cst_team_model_pilot_writer'/);
 for(const policy of ["cst_onejob_stage_insert","cst_onejob_stage_select",
   "cst_onejob_stage_approval_insert"]){
   assert.ok(service.includes(policy));
 }
 assert.doesNotMatch(service,/SET ROLE cst_team_model_pilot_writer|GRANT ALL/);
});
