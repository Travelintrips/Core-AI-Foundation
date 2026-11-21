import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {cstOneJobStageSessionId as classify}
 from "../../artifacts/api-server/src/lib/cstOneJobStageSessionClaims.ts";

const read=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
const auth=read("artifacts/api-server/src/middleware/cstOneJobStageOwnerAuth.ts");
const routes=read("artifacts/api-server/src/routes/jobs.ts");
const migration=read("docs/dev/cst-onejob-stage-owner-password-state-read.CSTDEV-ONLY.sql");
const rollback=read("docs/dev/cst-onejob-stage-owner-password-state-read.ROLLBACK-CSTDEV-ONLY.sql");
const now=1795299600;
const valid={sub:1,iat:now-60,exp:now+300};

test("original exact Core session claims accepted as locator, never role authorization",()=>{
 assert.equal(classify(valid,now),1);
 assert.equal(classify({...valid,sub:2},now),2);
 for(const bad of [
  null,undefined,[],{...valid,sub:"1"},{...valid,sub:0},
  {...valid,sub:1.3},{...valid,iat:now+1},{...valid,exp:now},
  {...valid,iat:now-12*3600-1},{...valid,purpose:"magic_login"},
  {...valid,role:"owner"},{...valid,accountType:"internal"},
  {...valid,session_id:"attacker"},
 ]){
  assert.equal(classify(bad,now),null);
 }
});
test("three Owner routes use dedicated reader; existing global login remains unchanged",()=>{
 const slice=routes.slice(
  routes.indexOf('router.get("/ai/dev/onejob/owner-stage-readiness"'),
  routes.indexOf('router.post("/ai/jobs"')
 );
 assert.equal(slice.split("requireCstOneJobStageOwner").length-1,3);
 assert.doesNotMatch(slice,/requireAuth,requireInternalRole|requirePasswordChanged/);
 assert.match(slice,/verifyFreshOneJobStageConsent/);
 assert.match(slice,/origin!=="https:\/\/dev\.cstlogistic\.co\.id"/);
 assert.match(slice,/status\(201\)\.json\(staged\)/);
 const common=read("artifacts/api-server/src/middleware/internalAuth.ts");
 assert.match(common,/getInternalUserById\(payload.sub\)/);
 assert.doesNotMatch(common,/requireCstOneJobStageOwner/);
});
test("JWT requires HS256, original signed cookie and exact Core numeric sub",()=>{
 for(const token of [
  'jwt.verify(cookie,secret',
  'algorithms:["HS256"],maxAge:"12h"',
  "cstOneJobStageSessionId(",
  'SESSION_COOKIE_NAME',
  'OWNER_SESSION_REQUIRED',
  'OWNER_SESSION_INVALID',
  'CST_DEV_OWNER_READER_UNAVAILABLE',
 ])assert.ok(auth.includes(token),token);
 assert.doesNotMatch(auth,/req\.get\("x-admin-key"\)|req\.body\.(actor|owner)|createSession|issueSessionToken|issueMagicLoginToken/);
});
test("untrusted sessions cannot query the database and shared role is not used",()=>{
 const anon=auth.indexOf('if(typeof cookie!=="string"');
 const verified=auth.indexOf('jwt.verify(cookie,secret');
 const gate=auth.indexOf('env.CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED');
 const db=auth.indexOf('getCstOneJobStagingDatabase(env)');
 assert.ok(anon>0&&verified>anon&&gate>verified&&db>gate);
 for(const token of [
  "SET TRANSACTION READ ONLY",
  "SET LOCAL ROLE cst_team_model_pilot_writer",
  "session_user AS login",
  "current_database() AS database_name",
  'identity?.login!==CST_ONEJOB_STAGE_LOGIN',
  "SELECT id,role,status,account_type,must_change_password",
  "WHERE id=",
  "AND role='owner'",
  "AND status='active'",
  "AND account_type='internal'",
  "row.must_change_password!==false",
  "req.internalUser=",
  "next();",
 ])assert.ok(auth.includes(token),token);
 for(const banned of [
  "UPDATE ai_platform","INSERT INTO","DELETE FROM",
  "GRANT ALL","CREATE ROLE","SET TRANSACTION READ WRITE",
  "db.select()","getInternalUserById","@workspace/db.db",
  'req.headers["x-owner"]','as any as',
 ])assert.ok(!auth.includes(banned),banned);
});
test("minimal schema grant covers only Owner password-change flag, never full user data",()=>{
 for(const token of [
  "CST_DEV_ONEJOB_OWNER_PASSWORD_STATE_PREFLIGHT_DENIED",
  "CANONICAL_OWNER_RLS_REQUIRED",
  "GRANT SELECT (must_change_password)",
  "cst_onejob_stage_owner_select",
  "relforcerowsecurity",
  "CST_DEV_ONEJOB_OWNER_PASSWORD_STATE_POSTFLIGHT_DENIED",
 ])assert.ok(migration.includes(token),token);
 assert.doesNotMatch(migration,/GRANT ALL|GRANT UPDATE|GRANT SELECT ON ai_platform\.internal_users|ALTER ROLE .*LOGIN|CREATE ROLE/);
 assert.match(rollback,/OWNER_STAGE_SESSION_READER_ROLLBACK_DENIED/);
 assert.match(rollback,/REVOKE SELECT \(must_change_password\)/);
 assert.doesNotMatch(rollback,/DROP ROLE|DROP TABLE|DISABLE ROW LEVEL SECURITY/);
});
test("isolated stage bootstrap still requires original existing protected Core session issuer",()=>{
 const unit=read("deploy/cst-onejob-vps/owner-stage-bootstrap/cst-onejob-owner-stage-bootstrap.service.CANDIDATE");
 const entry=read("deploy/cst-onejob-vps/owner-stage-bootstrap/entrypoint-stage-only.sh");
 assert.match(unit,/LoadCredentialEncrypted=session-secret:/);
 assert.match(unit,/LoadCredentialEncrypted=database-url:/);
 assert.match(unit,/CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED=true/);
 assert.match(unit,/AI_DISPATCHER_ENABLED=false/);
 assert.match(unit,/OLLAMA_WORKER_RUNTIME_ENABLED=false/);
 assert.match(entry,/export SESSION_SECRET/);
 assert.match(entry,/CREDENTIALS_DIRECTORY/);
 assert.match(entry,/CST_TEAM_DEV_APPROVED_SOURCE_SHA/);
 assert.doesNotMatch(entry,/systemd-creds encrypt|openssl genpkey|CREATE ROLE/);
});
