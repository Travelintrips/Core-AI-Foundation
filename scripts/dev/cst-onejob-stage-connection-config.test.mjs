import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  reviewCstOneJobStageDatabaseConfig,
  CST_ONEJOB_STAGE_URL_KEY
} from "../../artifacts/api-server/src/lib/cstOneJobStageDbConfig.ts";

const ref="xssrfshdrtdfupgqwfdw";
const devUrl="https://"+ref+".supabase.co";
const url="postgresql://cst_team_model_pilot_stage_login."+ref+
 ":synthetic-test-password-never-deploy@aws-1-ap-southeast-2.pooler.supabase.com"+
 ":6543/postgres?sslmode=verify-full";
const good={APP_ENV:"development",NODE_ENV:"development",
  SUPABASE_URL_DEV:devUrl,[CST_ONEJOB_STAGE_URL_KEY]:url};
const inspect=(patch)=>reviewCstOneJobStageDatabaseConfig({...good,...patch});
const denied=(patch,code)=>{
  const report=inspect(patch);
  assert.equal(report.readyForDedicatedConnection,false,JSON.stringify(report));
  assert.ok(report.blockers.includes(code),JSON.stringify(report));
  assert.doesNotMatch(JSON.stringify(report),/synthetic-test-password|postgresql:/);
};
test("synthetic dedicated project-login pooler with verify-full passes config only",()=>{
 const report=inspect({});
 assert.equal(report.readyForDedicatedConnection,true,JSON.stringify(report));
 assert.deepEqual(report.blockers,[]);
 assert.doesNotMatch(JSON.stringify(report),/password|pooler\./i);
});
test("refuse missing credential, production mode and PROD database environment",()=>{
 denied({[CST_ONEJOB_STAGE_URL_KEY]:""},"DEDICATED_STAGING_DATABASE_URL_MISSING");
 denied({APP_ENV:"production"},"CST_DEV_ONLY");
 denied({NODE_ENV:"production"},"CST_DEV_ONLY");
 denied({SUPABASE_PROD_DATABASE_URL:"set"},"PROD_DATABASE_ENV_FORBIDDEN");
 denied({SUPABASE_URL_DEV:"https://nzdweipzckfszczzqtuw.supabase.co"},
        "DEV_SUPABASE_REF_MISMATCH");
 denied({SUPABASE_URL_DEV:""},"DEV_SUPABASE_REF_MISSING");
});
test("reject role impersonation, project mixing and unsafe database destinations",()=>{
 const replace=(match,replacement)=>({[CST_ONEJOB_STAGE_URL_KEY]:url.replace(match,replacement)});
 denied(replace("cst_team_model_pilot_stage_login."+ref,
   "aicore_dev_runtime."+ref),"STAGING_LOGIN_OR_PROJECT_MISMATCH");
 denied(replace("cst_team_model_pilot_stage_login."+ref,
   "cst_team_model_pilot_stage_login.nzdweipzckfszczzqtuw"),
   "STAGING_LOGIN_OR_PROJECT_MISMATCH");
 denied(replace("aws-1-ap-southeast-2.pooler.supabase.com",
   "aws-1-ap-southeast-2.pooler.supabase.com.evil.invalid"),
   "STAGING_DATABASE_NOT_SUPABASE_POOLER");
 denied(replace("aws-1-ap-southeast-2.pooler.supabase.com",
   "db."+ref+".supabase.co"),"STAGING_DATABASE_NOT_SUPABASE_POOLER");
 denied(replace("aws-1-ap-southeast-2.pooler.supabase.com",
   "aws-0-ap-southeast-1.pooler.supabase.com"),"STAGING_DATABASE_NOT_SUPABASE_POOLER");
 denied(replace(":6543/postgres",":5432/postgres"),
   "STAGING_TRANSACTION_POOLER_REQUIRED");
 denied(replace("/postgres?","/production?"),"STAGING_DATABASE_NAME_INVALID");
 denied(replace("postgresql://","http://"),"STAGING_DATABASE_PROTOCOL_INVALID");
});
test("reject disabled TLS, startup option injection, altered pin and weak secret",()=>{
 const replace=(match,replacement)=>({[CST_ONEJOB_STAGE_URL_KEY]:url.replace(match,replacement)});
 denied(replace("sslmode=verify-full","sslmode=disable"),
        "STAGING_TLS_VERIFY_FULL_REQUIRED");
 denied(replace("?sslmode=verify-full",""),
        "STAGING_TLS_VERIFY_FULL_REQUIRED");
 denied(replace("sslmode=verify-full","sslmode=verify-full&options=-csearch_path%3Dpublic"),
        "STAGING_TLS_VERIFY_FULL_REQUIRED");
 denied(replace("synthetic-test-password-never-deploy","short"),
        "STAGING_DEDICATED_PASSWORD_MISSING");
 denied(replace("sslmode=verify-full","sslmode=verify-full#change"),
        "STAGING_URL_FRAGMENT_FORBIDDEN");
});
test("stage only uses dedicated lazy connection and SET LOCAL inside transaction",()=>{
 const source=readFileSync(new URL(
   "../../artifacts/api-server/src/services/cstOneJobOwnerApprovalStageService.ts",
   import.meta.url),"utf8");
 const pool=readFileSync(new URL(
   "../../artifacts/api-server/src/lib/cstOneJobStagingDatabase.ts",
   import.meta.url),"utf8");
 assert.match(source,/getCstOneJobStagingDatabase\(input.env\)/);
 assert.match(source,/stageDb.transaction\(async tx=>/);
 assert.match(source,/SET LOCAL ROLE cst_team_model_pilot_writer/);
 const readWrite=source.indexOf("SET TRANSACTION READ WRITE");
 const writerRole=source.indexOf("SET LOCAL ROLE cst_team_model_pilot_writer");
 assert.ok(readWrite>0&&writerRole>readWrite,
   "read-write transaction must be declared before writer role/queries");
 assert.match(source,/session_user AS login_role_name/);
 assert.match(source,/scope\?\.login_role_name!==CST_ONEJOB_STAGE_LOGIN/);
 assert.doesNotMatch(source,/return db.transaction\(/);
 assert.doesNotMatch(source,/SET SESSION ROLE/);
 assert.match(pool,/max:1/);
 assert.match(pool,/connectionTimeoutMillis:3_500/);
 assert.doesNotMatch(pool,/verify:\s*\(/);
 assert.match(pool,/reviewCstOneJobStageDatabaseConfig\(env\)/);
 assert.match(pool,/ONEJOB_STAGING_DATABASE_CREDENTIAL_CHANGED_RESTART_REQUIRED/);
 assert.doesNotMatch(pool,/resolveDatabaseUrl\(|SUPABASE_DEV_DATABASE_URL|SUPABASE_PROD_DATABASE_URL|from "@workspace\/db";\s*const \{\s*db\s*\}/);
});
