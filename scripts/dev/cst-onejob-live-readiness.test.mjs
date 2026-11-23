import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {evaluateCstOneJobLiveGate} from "./cst-onejob-live-evidence-gate.mjs";
import {validateExistingDevPoolerForReadOnly,runReadOnlyGate}
  from "./cst-onejob-live-readiness.mjs";

const project="xssrfshdrtdfupgqwfdw";
const policies=[
 "cst_onejob_stage_owner_select","cst_onejob_stage_insert",
 "cst_onejob_stage_select","cst_onejob_stage_approval_insert",
 "cst_onejob_stage_approval_select","cst_onejob_stage_audit_insert"
];
const baseline={
 project,environment:"development",sharedRuntimeHealthy:true,
 approvalTablePresent:true,approvalTableForcedRls:true,oneJobIndexValid:true,
 writerNoLogin:true,writerNoBypassRls:true,roleMembershipSetOnly:true,
 policyNames:policies,stageLoginEnabled:false,
 dedicatedStageUrlConfigured:false,stageOwnerFeatureEnabled:false,
 independentQaPublicRootInstalled:false,independentQaIssuerVerified:false,
 oneUseAdmissionBrokerVerified:false,jobCardinalityIndependentlyVerified:false,
 subscriberReceiptVerified:false,independentFinalAckVerified:false,
 historicalJob482Unchanged:true,
};
function deny(partial,reason){
 const x=evaluateCstOneJobLiveGate({...baseline,...partial});
 assert.equal(x.releaseDecision,"NO_GO");
 assert.ok(x.blockers.includes(reason),JSON.stringify(x));
 assert.equal(x.dispatchPermitted,false);
 assert.equal(x.signerActivationPermitted,false);
 assert.equal(x.finalAckIssued,false);
}
test("live CST-DEV evidence gate lists real remaining NO-GO blockers",()=>{
 const report=evaluateCstOneJobLiveGate(baseline);
 assert.equal(report.releaseDecision,"NO_GO");
 assert.equal(report.configPreflight,"INCOMPLETE");
 assert.ok(report.blockers.includes("DEDICATED_STAGING_LOGIN_DISABLED"));
 assert.ok(report.blockers.includes("STAGE_SECRET_NOT_INSTALLED"));
 assert.ok(report.blockers.includes("INDEPENDENT_QA_PUBLIC_ROOT_MISSING"));
 assert.ok(report.blockers.includes("ONE_USE_BROKER_NOT_VERIFIED"));
 assert.ok(report.blockers.includes("PILOT_JOB_CARDINALITY_NOT_INDEPENDENTLY_VERIFIED"));
 assert.ok(report.blockers.includes("INDEPENDENT_FINAL_ACK_NOT_VERIFIED"));
});
test("even ALL alleged booleans cannot convert a read-only report into authority",()=>{
 const completed=Object.fromEntries(Object.keys(baseline).map(k=>
   [k,typeof baseline[k]==="boolean"?true:baseline[k]]));
 const report=evaluateCstOneJobLiveGate(completed);
 assert.equal(report.configPreflight,"CONDITIONS_REPORTED_COMPLETE");
 assert.deepEqual(report.blockers,[]);
 assert.equal(report.releaseDecision,"NO_GO");
 assert.equal(report.stageExecutionAuthorized,false);
 assert.equal(report.queueTransitionAuthorized,false);
 assert.equal(report.dispatchPermitted,false);
 assert.equal(report.finalAckIssued,false);
});
test("reject missing required catalog policy, wrong environment and role",()=>{
 deny({policyNames:policies.filter(x=>x!=="cst_onejob_stage_audit_insert")},
   "STAGING_RLS_POLICY_INCOMPLETE");
 deny({project:"nzdweipzckfszczzqtuw"},"DEV_PROJECT_ID_NOT_VERIFIED");
 deny({environment:"production"},"DEV_RUNTIME_NOT_VERIFIED");
 deny({approvalTableForcedRls:false},"OWNER_LEDGER_RLS_MISSING");
 deny({roleMembershipSetOnly:false},"STAGING_ROLE_MEMBERSHIP_UNSAFE");
 deny({historicalJob482Unchanged:false},"HISTORIC_JOB_482_NOT_VERIFIED");
});
test("existing shared DEV pooler URL validation never accepts PROD or staging principal",()=>{
 const base="postgresql://aicore_dev_runtime."+project+
   ":synthetic-not-a-real-password@aws-1-ap-southeast-2.pooler.supabase.com"+
   ":6543/postgres";
 assert.equal(validateExistingDevPoolerForReadOnly(base),true);
 for(const replacement of [
  base.replace("aicore_dev_runtime","cst_team_model_pilot_stage_login"),
  base.replace(project,"nzdweipzckfszczzqtuw"),
  base.replace(":6543",":5432"),
  base.replace(".supabase.com",".supabase.com.evil.invalid"),
  base.replace("postgresql://","http://"),
  base.replace("/postgres","/production"),
  base.replace("synthetic-not-a-real-password",""),
 ]){
   assert.equal(validateExistingDevPoolerForReadOnly(replacement),false);
 }
});
test("unconfigured probe stays NO_GO, never connects to wrong environment",async()=>{
 const result=await runReadOnlyGate({APP_ENV:"production",NODE_ENV:"production",
   SUPABASE_PROD_DATABASE_URL:"DO_NOT_CONNECT_TO_PROD",
   SUPABASE_DEV_DATABASE_URL:"DO_NOT_CONNECT_TO_DEV"});
 assert.equal(result.releaseDecision,"NO_GO");
 assert.ok(result.blockers.includes("CST_DEV_SHARED_POOLER_NOT_VERIFIED"));
});
test("readiness tool excludes job-row cardinality guesses and never mutates DB",()=>{
 const source=readFileSync(new URL("./cst-onejob-live-readiness.mjs",import.meta.url),"utf8");
 assert.match(source,/BEGIN READ ONLY/);
 assert.match(source,/ROLLBACK/);
 assert.match(source,/jobCardinalityIndependentlyVerified:false/);
 assert.doesNotMatch(source,/\bINSERT INTO\b|\bUPDATE ai_platform\b|\bALTER ROLE\b|\bDELETE FROM\b/);
 assert.doesNotMatch(source,/console\.log\(source\)|console\.log\(url\)/);
});
