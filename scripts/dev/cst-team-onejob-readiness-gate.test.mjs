import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectOneJobGate } from "./cst-team-onejob-readiness-gate.mjs";

const sha="a".repeat(40), imageId="sha256:"+"f".repeat(64);
const ready={
  sourceSha:sha,imageSourceSha:sha,imageBuildMarkerSha:sha,imageId,
  candidateRunning:true,candidateHealthy:true,candidateImageId:imageId,
  candidateNetworkIsolated:true,candidateHostGatewayBlocked:true,
  candidateIndependentNetworkAclVerified:true,candidateDedicatedDevDbTransportVerified:true,
  devHostResolved:true,retiredHostQuarantined:true,
  candidateDirectHealthy:true,nginxApiRetainsExistingCore:true,
  dbStatus:"DEV_DB_READ_ONLY_PASS",database:"postgres",
  dbRole:"cst_team_model_pilot_20261119_abcdef12",
  roleCount:1,safeRoleCount:1,
  jobId:483,matchingRequestCount:1,uniqueIndexPresent:true,jobQueued:true,jobCompany:"1",jobModel:"qwen2.5:3b",
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
  check({imageBuildMarkerSha:"b".repeat(40)},"IMAGE_BUILD_SHA_MARKER_MISMATCH");
  check({imageBuildMarkerSha:null},"IMAGE_BUILD_SHA_MARKER_MISMATCH");
  check({candidateNetworkIsolated:false},"BLUE_GREEN_NETWORK_ISOLATION_NOT_PROVEN");
  check({candidateHostGatewayBlocked:false},"HOST_GATEWAY_ACCESS_NOT_BLOCKED_OR_UNVERIFIED");
  check({candidateHostGatewayBlocked:null},"HOST_GATEWAY_ACCESS_NOT_BLOCKED_OR_UNVERIFIED");
  check({candidateIndependentNetworkAclVerified:false},"CANDIDATE_EGRESS_ACL_NOT_INDEPENDENTLY_VERIFIED");
  check({candidateIndependentNetworkAclVerified:null},"CANDIDATE_EGRESS_ACL_NOT_INDEPENDENTLY_VERIFIED");
  check({candidateIndependentNetworkAclVerified:"true"},"CANDIDATE_EGRESS_ACL_NOT_INDEPENDENTLY_VERIFIED");
  check({candidateDedicatedDevDbTransportVerified:false},"DEDICATED_CST_DEV_DB_TRANSPORT_NOT_VERIFIED");
  check({candidateDedicatedDevDbTransportVerified:null},"DEDICATED_CST_DEV_DB_TRANSPORT_NOT_VERIFIED");
  check({candidateDedicatedDevDbTransportVerified:"true"},"DEDICATED_CST_DEV_DB_TRANSPORT_NOT_VERIFIED");
  check({devHostResolved:false},"UNIFIED_DEV_HOST_DNS_MISSING");
  check({retiredHostQuarantined:false},"RETIRED_DEV_HOST_NOT_QUARANTINED");
  check({candidateDirectHealthy:false},"CANDIDATE_LOOPBACK_HEALTH_UNVERIFIED");
  check({nginxApiRetainsExistingCore:false},"SHARED_DEV_API_ROUTE_CHANGED");
});
test("gateway denial and scoped SQL cannot imply independent ACL or DB route proof",()=>{
  const evidence={...ready, candidateIndependentNetworkAclVerified:undefined,
    candidateDedicatedDevDbTransportVerified:undefined};
  const verdict=projectOneJobGate(evidence);
  assert.equal(verdict.pilotAdmissionReady,false);
  assert.ok(verdict.blockers.includes("CANDIDATE_EGRESS_ACL_NOT_INDEPENDENTLY_VERIFIED"));
  assert.ok(verdict.blockers.includes("DEDICATED_CST_DEV_DB_TRANSPORT_NOT_VERIFIED"));
  assert.equal(verdict.sideEffects,"NONE");
  assert.equal(verdict.independentFinalAckVerified,false);
});
test("an ancestral QA image is reusable only if runtime code and pilot RLS are unchanged",()=>{
  const oldSha="b".repeat(40);
  assert.equal(projectOneJobGate({...ready,imageSourceSha:oldSha,sourceContentEquivalent:false}).pilotAdmissionReady,false);
  const safe=projectOneJobGate({...ready,imageSourceSha:oldSha,imageBuildMarkerSha:oldSha,sourceContentEquivalent:true});
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
  check({matchingRequestCount:2},"PILOT_REQUEST_ID_NOT_UNIQUE");
  check({matchingRequestCount:0},"PILOT_REQUEST_ID_NOT_UNIQUE");
  check({uniqueIndexPresent:false},"PILOT_DB_UNIQUE_REQUEST_CONSTRAINT_MISSING");
  check({uniqueIndexPresent:null},"PILOT_DB_UNIQUE_REQUEST_CONSTRAINT_MISSING");
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
  assert.match(file,/x-cst-commit-sha/);
  assert.match(file,/CANDIDATE_LOOPBACK_HEALTH_UNVERIFIED/);
  assert.match(file,/SHARED_DEV_API_ROUTE_CHANGED/);
  assert.match(file,/candidateLoopbackPort/);
  assert.match(file,/IMAGE_BUILD_SHA_MARKER_MISMATCH/);
  assert.match(file,/\.cst-build-sha/);
  assert.match(file,/cst-core-onejob-dev-net/);
  assert.match(file,/probeCstDevHostGateway/);
  assert.match(file,/HOST_GATEWAY_ACCESS_NOT_BLOCKED_OR_UNVERIFIED/);
  assert.match(file,/CANDIDATE_EGRESS_ACL_NOT_INDEPENDENTLY_VERIFIED/);
  assert.match(file,/DEDICATED_CST_DEV_DB_TRANSPORT_NOT_VERIFIED/);
  // Preflight must not accept a user-supplied flag as operational proof.
  assert.match(file,/candidateIndependentNetworkAclVerified:false/);
  assert.match(file,/candidateDedicatedDevDbTransportVerified:false/);
  assert.doesNotMatch(file,/candidateIndependentNetworkAclVerified:\s*process\.env/);
  assert.doesNotMatch(file,/candidateDedicatedDevDbTransportVerified:\s*process\.env/);
  assert.match(file,/members\.length===1/);
  assert.match(file,/isInternal==="true"/);
  assert.match(file,/matchingRequestCount===1/);
  assert.match(file,/uniqueIndexPresent===true/);
  assert.match(file,/ai_jobs_company1_pilot_request_unique/);
  assert.match(file,/members\[0\]\?\.Name===CANDIDATE/);
  assert.match(file,/sites-enabled\/dev.cstlogistic.co.id/);
  assert.match(file,/RETIRED_VHOST/);
  assert.match(file,/dev.cstlogistic.co.id/);
  assert.match(file,/READ_ONLY_ADVISORY_NO_DISPATCH/);
  assert.doesNotMatch(file,/docker.*\b(?:run|start|stop|rm|exec\s+-it)\b/);
  assert.doesNotMatch(file,/(?:CREATE|ALTER|DROP|GRANT|REVOKE)\s+ROLE\b/i);
  assert.doesNotMatch(file,/(?:INSERT INTO|DELETE FROM|UPDATE ai_platform)\b/i);
  assert.doesNotMatch(file,/GenUI|POST .api.ai.ollama-workers|workerDispatch\(/);
});
