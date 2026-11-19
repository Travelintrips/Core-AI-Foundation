import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectOneJobGate } from "./cst-team-onejob-readiness-gate.mjs";

const sha="a".repeat(40), imageId="sha256:"+"f".repeat(64);
const ready={
  sourceSha:sha,imageSourceSha:sha,imageId,
  candidateRunning:true,candidateHealthy:true,candidateImageId:imageId,
  candidateNetworkIsolated:true,devHostResolved:true,retiredHostQuarantined:true,
  endpointTargetsCandidate:true,nginxApiRoutesToCandidate:true,
  dbStatus:"DEV_DB_READ_ONLY_PASS",database:"postgres",
  dbRole:"cst_team_model_pilot_20261119_abcdef12",
  roleCount:1,safeRoleCount:1,
  jobId:483,jobQueued:true,jobCompany:"1",jobModel:"qwen2.5:3b",
  workerName:"cst-dev-dell-onejob-20261119-abcdef12",workerAlreadyRegistered:false,
  enrollmentConfigured:true,oneJobGuardConfigured:true,
};
const check=(changes,reason)=>{
  const verdict=projectOneJobGate({...ready,...changes});
  assert.equal(verdict.pilotAdmissionReady,false);
  assert.ok(verdict.blockers.includes(reason),`expected ${reason}, got ${verdict.blockers}`);
  assert.equal(verdict.operationalE2EVerified,false);
  assert.equal(verdict.subscriberReceiptVerified,false);
  assert.equal(verdict.independentFinalAckVerified,false);
};
test("a complete observation only authorizes consideration of a scoped pilot, never execution",()=>{
  const v=projectOneJobGate(ready);
  assert.equal(v.pilotAdmissionReady,true);
  assert.deepEqual(v.blockers,[]);
  assert.equal(v.mode,"READ_ONLY_ADVISORY_NO_DISPATCH");
  assert.equal(v.sideEffects,"NONE");
  assert.equal(v.operationalE2EVerified,false);
  assert.equal(v.subscriberReceiptVerified,false);
  assert.equal(v.independentFinalAckVerified,false);
});
test("missing or old Core runtime and wrong build provenance always fail closed",()=>{
  check({candidateRunning:false},"BLUE_GREEN_RUNTIME_NOT_HEALTHY_OR_DIFFERENT_IMAGE");
  check({candidateHealthy:false},"BLUE_GREEN_RUNTIME_NOT_HEALTHY_OR_DIFFERENT_IMAGE");
  check({candidateImageId:"sha256:"+"1".repeat(64)},"BLUE_GREEN_RUNTIME_NOT_HEALTHY_OR_DIFFERENT_IMAGE");
  check({imageSourceSha:"b".repeat(40)},"SOURCE_IMAGE_COMMIT_MISMATCH");
  check({candidateNetworkIsolated:false},"BLUE_GREEN_NETWORK_ISOLATION_NOT_PROVEN");
  check({devHostResolved:false},"UNIFIED_DEV_HOST_DNS_MISSING");
  check({retiredHostQuarantined:false},"RETIRED_DEV_HOST_NOT_QUARANTINED");
  check({endpointTargetsCandidate:false},"DEV_ENDPOINT_TO_CANDIDATE_UNVERIFIED");
  check({nginxApiRoutesToCandidate:false},"NGINX_API_STILL_ROUTES_TO_OLD_CORE");
});
test("an ancestral QA image is reusable only if runtime code and pilot RLS are unchanged",()=>{
  const oldSha="b".repeat(40);
  assert.equal(projectOneJobGate({...ready,imageSourceSha:oldSha,sourceContentEquivalent:false}).pilotAdmissionReady,false);
  const safe=projectOneJobGate({...ready,imageSourceSha:oldSha,sourceContentEquivalent:true});
  assert.equal(safe.pilotAdmissionReady,true);
  assert.equal(safe.operationalE2EVerified,false);
});
test("shared login or missing short-lived role is denied",()=>{
  check({dbRole:"aicore_dev_runtime"},"CANDIDATE_DB_LOGIN_NOT_SCOPED_PILOT_ROLE");
  check({dbStatus:"WRONG_DB_PROJECT"},"CANDIDATE_DB_LOGIN_NOT_SCOPED_PILOT_ROLE");
  check({database:"production"},"CANDIDATE_DB_LOGIN_NOT_SCOPED_PILOT_ROLE");
  check({roleCount:0,safeRoleCount:0},"ONE_JOB_ROLE_MISSING_OR_UNSAFE");
  check({roleCount:2,safeRoleCount:2},"ONE_JOB_ROLE_MISSING_OR_UNSAFE");
  check({roleCount:1,safeRoleCount:0},"ONE_JOB_ROLE_MISSING_OR_UNSAFE");
});
test("historic job, wrong company or unqueued model job cannot be admitted",()=>{
  check({jobId:482},"FRESH_COMPANY1_MODEL_JOB_NOT_PROVEN");
  check({jobId:null},"FRESH_COMPANY1_MODEL_JOB_NOT_PROVEN");
  check({jobQueued:false},"FRESH_COMPANY1_MODEL_JOB_NOT_PROVEN");
  check({jobCompany:"3"},"FRESH_COMPANY1_MODEL_JOB_NOT_PROVEN");
  check({jobModel:"qwen2.5-coder:7b"},"FRESH_COMPANY1_MODEL_JOB_NOT_PROVEN");
});
test("reused worker and unconfigured enrollment/guards cannot be admitted",()=>{
  check({workerName:"cst-dev-dell-onejob-20261119"},"FRESH_WORKER_IDENTITY_NOT_PROVEN");
  check({workerAlreadyRegistered:true},"FRESH_WORKER_IDENTITY_NOT_PROVEN");
  check({workerName:"cst-dev-dell-onejob-20261119-zzzzzzzz"},"FRESH_WORKER_IDENTITY_NOT_PROVEN");
  check({enrollmentConfigured:false},"ONE_JOB_ENROLLMENT_OR_GUARD_NOT_CONFIGURED");
  check({oneJobGuardConfigured:false},"ONE_JOB_ENROLLMENT_OR_GUARD_NOT_CONFIGURED");
});
test("diagnostic implementation cannot start jobs, manage services or change database",()=>{
  const file=readFileSync(new URL("./cst-team-onejob-readiness-gate.mjs",import.meta.url),"utf8");
  assert.match(file,/BEGIN READ ONLY/);
  assert.match(file,/ROLLBACK/);
  assert.match(file,/RUNNING|Running/);
  assert.match(file,/x-cst-source-commit/);
  assert.match(file,/NGINX_API_STILL_ROUTES_TO_OLD_CORE/);
  assert.match(file,/candidateLoopbackPort/);
  assert.match(file,/sites-enabled\/dev.cstlogistic.co.id/);
  assert.match(file,/RETIRED_VHOST/);
  assert.match(file,/dev.cstlogistic.co.id/);
  assert.match(file,/READ_ONLY_ADVISORY_NO_DISPATCH/);
  assert.doesNotMatch(file,/docker.*\b(?:run|start|stop|rm|exec\s+-it)\b/);
  assert.doesNotMatch(file,/(?:CREATE|ALTER|DROP|GRANT|REVOKE)\s+ROLE\b/i);
  assert.doesNotMatch(file,/(?:INSERT INTO|DELETE FROM|UPDATE ai_platform)\b/i);
  assert.doesNotMatch(file,/GenUI|POST .api.ai.ollama-workers|workerDispatch\(/);
});
