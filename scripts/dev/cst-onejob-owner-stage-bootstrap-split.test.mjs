import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
const load=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
const unit=load("deploy/cst-onejob-vps/owner-stage-bootstrap/cst-onejob-owner-stage-bootstrap.service.CANDIDATE");
const entry=load("deploy/cst-onejob-vps/owner-stage-bootstrap/entrypoint-stage-only.sh");
const nginx=load("deploy/cst-onejob-vps/owner-stage-bootstrap/cst-onejob-owner-stage-routing.nginx.CANDIDATE");
test("WAITING-only bootstrap unit requires no future job release to start staging",()=>{
 assert.match(unit,/ConditionPathExists=\/etc\/cst-onejob-dev\/bootstrap-verified\/owner-stage-runtime-ready\.json/);
 assert.doesNotMatch(unit,/ConditionPathExists=.*operator-trust|ConditionPathExists=.*approved-change|ConditionPathExists=.*approved-public\/owner-stage\.json/);
 assert.doesNotMatch(unit,/RefuseManualStart=yes|\[Install\]/);
 assert.match(unit,/LoadCredentialEncrypted=database-url:/);
 assert.match(unit,/LoadCredentialEncrypted=session-secret:/);
 assert.match(unit,/--user 28502:28501/);
 assert.match(unit,/RuntimeDirectory=cst-onejob-stage-credentials/);
 assert.match(unit,/RuntimeDirectoryMode=0700/);
 assert.match(unit,/ExecStartPre=\/usr\/bin\/python3 .*stage-credential-handoff\.py prepare/);
 assert.match(unit,/ExecStopPost=\/usr\/bin\/python3 .*stage-credential-handoff\.py cleanup/);
 assert.match(unit,/src=\/run\/cst-onejob-stage-credentials,dst=\/run\/credentials\/cst-onejob-owner-stage\.service,readonly/);
 assert.doesNotMatch(unit,/src=%d,dst=\/run\/credentials\/cst-onejob-owner-stage\.service/);
 assert.match(unit,/--network cst-onejob-owner-stage-internal/);
 assert.match(unit,/ExecCondition=\/usr\/bin\/test -S \/run\/cst-onejob-stage-db\/pg-pooler\.sock/);
 assert.match(unit,/owner-stage-socket-acl-reviewed/);
 assert.match(unit,/CST_DEV_ONEJOB_STAGE_SOCKET_TRANSPORT_ENABLED=true/);
 assert.doesNotMatch(unit,/--network (none|host)|--privileged/);
 assert.match(unit,/--publish 127\.0\.0\.1:18583:3000/);
 assert.match(unit,/--read-only/);
 assert.match(unit,/--cap-drop ALL/);
 assert.match(unit,/--security-opt no-new-privileges:true/);
 assert.match(unit,/cst-onejob-stage-dev:d3cd194b/);
 assert.match(unit,/CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED=true/);
 for(const name of ["AI_DISPATCHER_ENABLED","AI_SCHEDULER_ENABLED",
  "OLLAMA_WORKER_RUNTIME_ENABLED","CST_DEV_ONEJOB_BROKER_ENABLED"])
  assert.match(unit,new RegExp(name+"=false"));
});
test("staging entrypoint rejects untrusted credential paths, session issuer drift and source drift",()=>{
 const mandatory=[
  "CREDENTIALS_DIRECTORY","APP_ENV","NODE_ENV","AI_DISPATCHER_ENABLED",
  "AI_SCHEDULER_ENABLED","OLLAMA_WORKER_RUNTIME_ENABLED",
  "CST_DEV_ONEJOB_BROKER_ENABLED","CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED",
  "database-url","session-secret","source_sha",
  "CST_TEAM_DEV_APPROVED_SOURCE_SHA","CST_DEV_ONEJOB_OPERATIONS_CANDIDATE_FINGERPRINT",
  "65aa7599c60cc0acc71d72f9f3bd5bd810873aad725fa64856e36639c995f71b",
  "exec node scripts/hostinger-start.cjs",
 ];
 for(const token of mandatory)assert.ok(entry.includes(token),token);
 assert.doesNotMatch(entry,/systemd-creds encrypt|openssl genpkey|ALTER ROLE|CREATE ROLE/);
 assert.equal(entry.includes('echo "$SESSION_SECRET"'),false);
 const path=new URL("../../deploy/cst-onejob-vps/owner-stage-bootstrap/entrypoint-stage-only.sh",import.meta.url);
 const fail=(env,marker)=>{
  const r=spawnSync("sh",[path.pathname],{
   env:{PATH:process.env.PATH??"/usr/bin:/bin",...env},
   encoding:"utf8",timeout:1800});
  assert.equal(r.status,77);
  assert.match(r.stdout+String(r.stderr),new RegExp(marker));
 };
 fail({CREDENTIALS_DIRECTORY:"/tmp/attacker"},"CREDENTIAL_DIRECTORY_DENIED");
 fail({CREDENTIALS_DIRECTORY:"/run/credentials/cst-onejob-owner-stage.service",
  APP_ENV:"production",NODE_ENV:"development"},"NOT_DEV");
 fail({CREDENTIALS_DIRECTORY:"/run/credentials/cst-onejob-owner-stage.service",
  APP_ENV:"development",NODE_ENV:"development",
  AI_DISPATCHER_ENABLED:"true",AI_SCHEDULER_ENABLED:"false",
  OLLAMA_WORKER_RUNTIME_ENABLED:"false",CST_DEV_ONEJOB_BROKER_ENABLED:"false",
  CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED:"true"},"UNAPPROVED_FEATURE_OR_DISPATCH_DENIED");
 fail({CREDENTIALS_DIRECTORY:"/run/credentials/cst-onejob-owner-stage.service",
  APP_ENV:"development",NODE_ENV:"development",
  AI_DISPATCHER_ENABLED:"false",AI_SCHEDULER_ENABLED:"false",
  OLLAMA_WORKER_RUNTIME_ENABLED:"false",CST_DEV_ONEJOB_BROKER_ENABLED:"false",
  CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED:"true"},"REQUIRED_CREDENTIALS_OR_CA_MISSING");
});
test("future Nginx routing is Owner-guarded, same-origin, bounded, and NOT installed",()=>{
 for(const path of ["owner-stage-readiness","owner-stage-status","owner-approve-and-stage"])
  assert.match(nginx,new RegExp("location = /api/ai/dev/onejob/"+path));
 assert.equal((nginx.match(/auth_request \/api\/internal\/auth\/me;/g)||[]).length,3);
 assert.equal((nginx.match(/proxy_set_header Host dev\.cstlogistic\.co\.id;/g)||[]).length,3);
 assert.match(nginx,/limit_except POST \{ deny all; \}/);
 assert.match(nginx,/limit_except GET \{ deny all; \}/);
 assert.match(nginx,/client_max_body_size 1k/);
 assert.match(nginx,/proxy_pass http:\/\/127\.0\.0\.1:18583\//);
 assert.match(nginx,/location \^~ \/api\/ai\/dev\/onejob\/owner-approve-and-stage\//);
 const existing=load("artifacts/api-server/src/routes/jobs.ts");
 assert.match(existing,/requireCstOneJobStageOwner/);
 const scoped=load("artifacts/api-server/src/middleware/cstOneJobStageOwnerAuth.ts");
 assert.match(scoped,/algorithms:\["HS256"\]/);
 assert.match(scoped,/must_change_password!==false/);
 assert.match(existing,/verifyFreshOneJobStageConsent/);
 assert.match(existing,/origin!=="https:\/\/dev\.cstlogistic\.co\.id"/);
});
test("stage-only design cannot assert cryptographic release, admission, or Final ACK",()=>{
 const service=load("artifacts/api-server/src/services/cstOneJobOwnerApprovalStageService.ts");
 assert.match(service,/status:"waiting" as const/);
 assert.match(service,/operationsRootTrusted:false,independentQaAdmissionVerified:false/);
 assert.match(service,/dispatchPermitted:false,finalAckVerified:false/);
 assert.match(service,/CST_DEV_ONEJOB_OPERATIONS_CANDIDATE_FINGERPRINT/);
 const release=load("scripts/dev/cst-onejob-operations-broker-release.mjs");
 assert.match(release,/APPROVED_OPS_ROOT_FINGERPRINT=null/);
 const selected=load("deploy/cst-onejob-vps/cst_onejob_stage_release_v2.py");
 assert.match(selected,/APPROVED_OPERATIONS_ROOT_FINGERPRINT=None/);
});
