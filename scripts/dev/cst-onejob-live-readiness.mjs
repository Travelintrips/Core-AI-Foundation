#!/usr/bin/env node
/**
 * Read-only CST-DEV one-job readiness report. No credential issuance.
 * Uses only the EXISTING shared DEV DB connection for pg_catalog metadata;
 * shared runtime RLS cannot see pilot rows, so job-cardinality is NEVER
 * inferred as zero from its filtered visibility.
 *
 * Usage: node scripts/dev/cst-onejob-live-readiness.mjs
 * Requires APP_ENV=NODE_ENV=development and an existing DEV pooler URL.
 * Output contains no database URL, hostname, password, tokens or user IDs.
 */
import pg from "pg";
import {existsSync} from "node:fs";
import {evaluateCstOneJobLiveGate} from "./cst-onejob-live-evidence-gate.mjs";

const PROJECT="xssrfshdrtdfupgqwfdw";
const readyState=(env)=>({
 project:PROJECT,
 environment:env.APP_ENV==="development"&&env.NODE_ENV==="development"?
   "development":"UNVERIFIED",
 sharedRuntimeHealthy:false, // must be separately observed via live health
 approvalTablePresent:false,approvalTableForcedRls:false,oneJobIndexValid:false,
 writerNoLogin:false,writerNoBypassRls:false,roleMembershipSetOnly:false,
 policyNames:[],stageLoginEnabled:false,
 dedicatedStageUrlConfigured:!!env.CST_DEV_ONEJOB_STAGE_DATABASE_URL,
 stageOwnerFeatureEnabled:env.CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED==="true",
 independentQaPublicRootInstalled:existsSync(
   "/etc/cst-onejob-qa/trust/public-root.json"),
 independentQaIssuerVerified:false,
 oneUseAdmissionBrokerVerified:false,
 jobCardinalityIndependentlyVerified:false,
 subscriberReceiptVerified:false,
 independentFinalAckVerified:false,
 historicalJob482Unchanged:false,
});
export function validateExistingDevPoolerForReadOnly(url) {
  try {
    const u=new URL(url);
    return ["postgres:","postgresql:"].includes(u.protocol) &&
      u.hostname.endsWith(".pooler.supabase.com") && u.port==="6543" &&
      u.pathname==="/postgres" &&
      decodeURIComponent(u.username)==="aicore_dev_runtime."+PROJECT &&
      Boolean(u.password);
  }catch{return false}
}
export async function runReadOnlyGate(env=process.env) {
  const state=readyState(env);
  const source=env.SUPABASE_DEV_DATABASE_URL||env.SUPABASE_DATABASE_URL_DEV;
  if(state.environment!=="development"||
     !!env.SUPABASE_PROD_DATABASE_URL||
     !source||!validateExistingDevPoolerForReadOnly(source)) {
    const report=evaluateCstOneJobLiveGate(state);
    return {...report,blockers:["CST_DEV_SHARED_POOLER_NOT_VERIFIED",...report.blockers]};
  }
  const client=new pg.Client({connectionString:source,
    connectionTimeoutMillis:4_000,statement_timeout:4_000,
    application_name:"cst-onejob-readiness-catalog-readonly"});
  let opened=false;
  try{
    await client.connect();opened=true;
    await client.query("BEGIN READ ONLY");
    const ident=(await client.query("SELECT current_user AS username, current_database() AS db")).rows[0];
    if(ident.username!=="aicore_dev_runtime"||ident.db!=="postgres")
      throw Error("UNEXPECTED_DB_IDENTITY");
    const catalog=(await client.query(`
      SELECT
        (to_regclass('ai_platform.cst_onejob_owner_approvals') IS NOT NULL)
          AS approval_exists,
        COALESCE((SELECT c.relrowsecurity AND c.relforcerowsecurity
          FROM pg_catalog.pg_class c
          WHERE c.oid=to_regclass('ai_platform.cst_onejob_owner_approvals')),false)
          AS approval_forced_rls,
        COALESCE((SELECT i.indisunique AND i.indisvalid AND i.indisready
          FROM pg_catalog.pg_index i
          WHERE i.indexrelid=to_regclass(
            'ai_platform.ai_jobs_company1_pilot_request_unique')),false)
          AS request_index_valid,
        COALESCE((SELECT NOT r.rolcanlogin AND NOT r.rolbypassrls AND NOT r.rolsuper
          FROM pg_catalog.pg_roles r
          WHERE r.rolname='cst_team_model_pilot_writer'),false)
          AS writer_locked,
        COALESCE((SELECT m.set_option AND NOT m.inherit_option AND NOT m.admin_option
          FROM pg_catalog.pg_auth_members m
          JOIN pg_catalog.pg_roles writer ON writer.oid=m.roleid
          JOIN pg_catalog.pg_roles stage ON stage.oid=m.member
          WHERE writer.rolname='cst_team_model_pilot_writer'
            AND stage.rolname='cst_team_model_pilot_stage_login'),false)
          AS stage_membership_limited,
        COALESCE((SELECT r.rolcanlogin FROM pg_catalog.pg_roles r
          WHERE r.rolname='cst_team_model_pilot_stage_login'),false)
          AS stage_login_enabled`)).rows[0];
    const policyResult=await client.query(`
      SELECT policyname FROM pg_catalog.pg_policies
      WHERE schemaname='ai_platform' AND policyname LIKE 'cst_onejob_stage_%'`);
    Object.assign(state,{
      approvalTablePresent:catalog.approval_exists===true,
      approvalTableForcedRls:catalog.approval_forced_rls===true,
      oneJobIndexValid:catalog.request_index_valid===true,
      writerNoLogin:catalog.writer_locked===true,
      writerNoBypassRls:catalog.writer_locked===true,
      roleMembershipSetOnly:catalog.stage_membership_limited===true,
      stageLoginEnabled:catalog.stage_login_enabled===true,
      policyNames:policyResult.rows.map(x=>x.policyname),
    });
    await client.query("ROLLBACK");
  }catch{
    try{if(opened)await client.query("ROLLBACK")}catch{}
    const report=evaluateCstOneJobLiveGate(state);
    return {...report,blockers:["DEV_READ_ONLY_CATALOG_PROBE_FAILED",...report.blockers]};
  }finally{
    if(opened)await client.end().catch(()=>{});
  }
  return evaluateCstOneJobLiveGate(state);
}
if(import.meta.url===`file://${process.argv[1]}`) {
  const report=await runReadOnlyGate();
  console.log(JSON.stringify(report));
  // This deliberately non-authorizing audit does not return an exit success
  // code that could be mistaken for operational release permission.
  if(report.releaseDecision!=="NO_GO")process.exitCode=3;
}
