import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { CST_MODEL_ADMISSION_REQUIREMENTS, projectCstModelAdmissionReadiness } from "../artifacts/api-server/src/lib/cstTeamModelAdmission.ts";
import {
  CST_TEAM_MONITOR_CLIENTS,
  isCstTeamDevMode,
  projectCstTeamReadiness,
} from "../artifacts/api-server/src/lib/cstTeamReadinessProjection.ts";

const auth = readFileSync(new URL("../artifacts/api-server/src/middleware/adminAuth.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../artifacts/api-server/src/routes/coding-control-bridge.ts", import.meta.url), "utf8");

test("DEV only: no added user login, token or privileged registry scope", () => {
  assert.equal(isCstTeamDevMode({ APP_ENV: "development", NODE_ENV: "development" }), true);
  assert.equal(isCstTeamDevMode({ APP_ENV: "production", NODE_ENV: "development" }), false);
  assert.equal(isCstTeamDevMode({ APP_ENV: "development", NODE_ENV: "production" }), false);
  assert.equal(isCstTeamDevMode({}), false);
  assert.match(auth, /method: "GET", pattern: \/\^\\\/ai\\\/coding\\\/bridge\\\/cst-team-readiness\$\//);
  assert.match(auth, /req\.path === "\/ai\/coding\/bridge\/cst-team-readiness"/);
  assert.match(route, /if \(!isCstTeamDevMode\(\)\)/);
  assert.match(route, /Cache-Control", "no-store"/);
});

test("only three existing bounded workers, no special-purpose wake/other-tenant workers", () => {
  const now = new Date("2026-11-18T10:00:00Z");
  const agents = [
    { clientId: "openclaw-vps-main", eligible: true, presenceState: "ACTIVE", reportedHealth: "healthy", lastSeenAt: now },
    { clientId: "openclaw-pc-worker-dev", eligible: true, presenceState: "UNAVAILABLE", reportedHealth: "healthy" },
    { clientId: "openclaw-travelintrips-tools-dev", eligible: false, presenceState: "ACTIVE", reportedHealth: "degraded" },
    { clientId: "openclaw-dell-chatgpt-wake-dev", eligible: true, presenceState: "ACTIVE", reportedHealth: "healthy" },
  ];
  const p = projectCstTeamReadiness(agents, now);
  assert.deepEqual(p.workers.map(w => w.clientId), [...CST_TEAM_MONITOR_CLIENTS]);
  assert.deepEqual(p.workers.map(w => w.eligible), [true,false,false]);
  assert.equal(p.workers[0].lastSeenAt, now);
  assert.equal(p.workers.some(w=>w.clientId.includes("chatgpt")), false);
  assert.equal(p.mode, "PRESENCE_ONLY_NOT_EXECUTION_PROOF");
  assert.equal(JSON.stringify(p).includes("capabilities"), false);
  assert.equal(JSON.stringify(p).includes("permissions"), false);
});

test("missing workers always show unavailable, never falsely report task completion", () => {
  const p = projectCstTeamReadiness([]);
  assert.equal(p.workers.length, 3);
  assert.ok(p.workers.every(w => !w.eligible && w.presenceState === "UNAVAILABLE"));
  assert.equal("completed" in p, false);
  assert.equal("finalAckVerified" in p, false);
});

test("new endpoint never exposes write permission, tokens or command dispatch", () => {
  const snippet = route.slice(
    route.indexOf('router.get("/ai/coding/bridge/cst-team-readiness"'),
    route.indexOf('router.get("/ai/coding/bridge/ai-task-timeline"'),
  );
  assert.match(snippet, /projectCstTeamReadiness\(readinessRows\)/);
  assert.doesNotMatch(snippet, /submitCodingBridgeCommand|dispatchExternalAgentWork|claimCodingBridgeCommand|process\.env\.[A-Z_]*TOKEN|req\.body|req\.query/);
});

test("DEV readiness GET does not attempt schema creation or privileged DDL", () => {
  const registry = readFileSync(new URL("../artifacts/api-server/src/services/externalAgentRegistryService.ts", import.meta.url), "utf8");
  const snippet = route.slice(
    route.indexOf('router.get("/ai/coding/bridge/cst-team-readiness"'),
    route.indexOf('router.get("/ai/coding/bridge/ai-task-timeline"'),
  );
  assert.match(snippet, /getExternalAgentRegistrySnapshot\(\{ skipSchemaEnsure: true \}\)/);
  assert.doesNotMatch(snippet, /ensureCodingControlBridgeTables|CREATE TABLE|ALTER TABLE/);
  assert.match(registry, /if \(!options\.skipSchemaEnsure\) await ensureCodingControlBridgeTables\(\)/);
});

test("registered dispatch policy remains unchanged; tools heartbeat is observed without eligibility", () => {
  const registry = readFileSync(new URL("../artifacts/api-server/src/services/externalAgentRegistryService.ts", import.meta.url), "utf8");
  const presenceOnly = registry.slice(registry.indexOf("export async function getCstTeamPresenceOnlyWorkerReadback"));
  assert.match(presenceOnly, /const clientId = "openclaw-travelintrips-tools-dev" as const/);
  assert.match(presenceOnly, /eligible: false as const/);
  assert.match(presenceOnly, /\.select\(/);
  assert.doesNotMatch(presenceOnly, /CREATE TABLE|ALTER TABLE|GRANT |INSERT INTO|DELETE FROM|db\.update\(|db\.insert\(/);
  assert.match(route, /getCstTeamPresenceOnlyWorkerReadback\(\)/);
  assert.match(route, /getExternalAgentRegistrySnapshot\(\{ skipSchemaEnsure: true \}\)/);
  const now = new Date("2026-11-18T14:00:00Z");
  const result = projectCstTeamReadiness([
    { clientId: "openclaw-travelintrips-tools-dev", eligible: false,
      presenceState: "ACTIVE", reportedHealth: "healthy",
      lastSeenAt: now, leaseExpiresAt: new Date(now.getTime() + 90_000) },
  ], now);
  const worker = result.workers.find(w => w.clientId === "openclaw-travelintrips-tools-dev");
  assert.equal(worker.presenceState, "ACTIVE");
  assert.equal(worker.reportedHealth, "healthy");
  assert.equal(worker.eligible, false);
  assert.equal("dispatchAllowed" in worker, false);
});

const outboundWorker = new URL("../artifacts/api-server/src/scripts/remoteOllamaWorker.ts", import.meta.url);
function runDevOnlyOutboundWorker(overrides = {}) {
  const env = { ...process.env,
    APP_ENV: "development", NODE_ENV: "development",
    CST_TEAM_OUTBOUND_DEV_ONLY: "true",
    CST_TEAM_SYNTHETIC_LOOPBACK_TEST: "false",
    AICORE_REMOTE_URL: "",
    OLLAMA_REMOTE_ENROLLMENT_SECRET: "SYNTHETIC-DEV-ONLY-NO-REAL-CREDENTIAL",
    OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1",
    OLLAMA_WORKER_MAX_CONCURRENCY: "1",
    CST_TEAM_DEV_SINGLE_JOB_ID: "421",
    GCP_GPU_AUTO_STOP_ENABLED: "false",
    ...overrides,
  };
  return spawnSync(process.execPath, ["--experimental-strip-types", outboundWorker.pathname], {
    env, encoding: "utf8", timeout: 5000,
  });
}
test("DEV outbound Ollama must specify its Core DEV host; never use the legacy PROD fallback", () => {
  const missing = runDevOnlyOutboundWorker();
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /CST_TEAM_EXPLICIT_DEV_CORE_URL_REQUIRED/);
  const prodDefault = runDevOnlyOutboundWorker({AICORE_REMOTE_URL:"https://aicore.cstlogistic.co.id"});
  assert.notEqual(prodDefault.status, 0);
  assert.match(prodDefault.stderr, /CST_TEAM_DEV_CORE_HOST_NOT_ALLOWED/);
  const arbitraryHost = runDevOnlyOutboundWorker({AICORE_REMOTE_URL:"http://192.168.0.1:3000"});
  assert.notEqual(arbitraryHost.status, 0);
  assert.match(arbitraryHost.stderr, /CST_TEAM_DEV_CORE_HOST_NOT_ALLOWED/);
  const localWithoutSynthetic = runDevOnlyOutboundWorker({AICORE_REMOTE_URL:"http://127.0.0.1:18444"});
  assert.notEqual(localWithoutSynthetic.status, 0);
  assert.match(localWithoutSynthetic.stderr, /CST_TEAM_DEV_CORE_HOST_NOT_ALLOWED/);
});
test("DEV outbound Ollama refuses wrong runtime, nonlocal model URL, concurrency, or GCP stop", () => {
  const baseline = {AICORE_REMOTE_URL:"https://dev.cstlogistic.co.id"};
  for (const [change, expected] of [
    [{NODE_ENV:"production"}, /CST_TEAM_DEV_RUNTIME_REQUIRED/],
    [{OLLAMA_BASE_URL:"http://10.0.0.8:11434/v1"}, /CST_TEAM_LOCAL_OLLAMA_ONLY/],
    [{OLLAMA_WORKER_MAX_CONCURRENCY:"2"}, /CST_TEAM_DEV_SINGLE_WORKER_SLOT_REQUIRED/],
    [{GCP_GPU_AUTO_STOP_ENABLED:"true"}, /CST_TEAM_DEV_GCP_SELF_STOP_FORBIDDEN/],
    [{AICORE_REMOTE_URL:"https://dev.cstlogistic.co.id/api"}, /CST_TEAM_DEV_CORE_HOST_NOT_ALLOWED/],
  ]) {
    const result=runDevOnlyOutboundWorker({...baseline,...change});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,expected);
  }
});
test("isolated local API exception requires explicit synthetic flag, never production permission", () => {
  const source=readFileSync(outboundWorker,"utf8");
  assert.match(source,/CST_TEAM_SYNTHETIC_LOOPBACK_TEST/);
  assert.match(source,/target\.hostname === "127\.0\.0\.1"/);
  assert.match(source,/target\.port === "18444"/);
  assert.match(source,/!allowedDev && !syntheticLoopback/);
  assert.doesNotMatch(source,/https:\/\/aicore\.cstlogistic\.co\.id"\]\.includes/);
});

test("DEV model worker requires one exact job ID, not a shared queue or PowerShell self-test", () => {
  for (const invalid of ["", "0", "-1", "3.5", "2147483648", "not-a-job"]) {
    const result=runDevOnlyOutboundWorker({
      AICORE_REMOTE_URL:"https://dev.cstlogistic.co.id",
      CST_TEAM_DEV_SINGLE_JOB_ID:invalid,
    });
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/CST_TEAM_DEV_SINGLE_JOB_ID_REQUIRED/);
  }
  const worker=readFileSync(outboundWorker,"utf8");
  assert.match(worker,/devOneShotJobId !== null/);
  assert.match(worker,/JSON\.stringify\(\{ devExpectedJobId: devOneShotJobId \}\)/);
  assert.match(worker,/CST_TEAM_DEV_JOB_OR_TYPE_MISMATCH/);
  assert.match(worker,/CST_TEAM_DEV_SINGLE_JOB_COMPLETED/);
  assert.match(worker,/CST_TEAM_DEV_POWERSHELL_SELF_TEST_NOT_ALLOWED/);
  assert.match(worker,/CST_TEAM_DEV_REGISTRATION_FAILED/);
});

test("Core model claim filters exact job ID and rejects scoped requests without DEV authorization", () => {
  const remoteRoute=readFileSync(new URL("../artifacts/api-server/src/routes/remote-ollama-worker.ts",import.meta.url),"utf8");
  const remoteService=readFileSync(new URL("../artifacts/api-server/src/services/remoteOllamaWorkerService.ts",import.meta.url),"utf8");
  assert.match(remoteRoute,/CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED/);
  assert.match(remoteRoute,/DEV_SCOPED_MODEL_CLAIM_DISABLED/);
  assert.match(remoteRoute,/devExpectedJobId/);
  assert.match(remoteRoute,/parsedJobId\?\.success/);
  assert.match(remoteService,/REMOTE_OLLAMA_DEV_JOB_SCOPE_INVALID/);
  assert.match(remoteService,/AND id = \$\{scopedJobId\}\s+AND job_type = \$\{REMOTE_OLLAMA_JOB_TYPE\}/);
  assert.match(remoteService,/payload_json->>'requestId' LIKE 'cst-ai-team-company1-dev:%'/);
  assert.match(remoteRoute,/DEV_SCOPED_MODEL_JOB_REQUIRED/);
  assert.match(remoteRoute,/DEV_SCOPED_MODEL_JOB_OR_WORKER_NOT_APPROVED/);
  assert.match(remoteRoute,/CST_TEAM_DEV_APPROVED_JOB_ID/);
  assert.match(remoteRoute,/CST_TEAM_DEV_APPROVED_WORKER_NAME/);
  assert.match(remoteService,/worker\.modelId && scopedJobId === undefined/);
});

test("model worker preflight must never authorize execution or weaken RLS", () => {
  const allMissing=projectCstModelAdmissionReadiness({});
  assert.equal(allMissing.status,"blocked");
  assert.equal(allMissing.eligibleToDispatch,false);
  assert.equal(allMissing.verifiedOperationalWorker,false);
  assert.equal(allMissing.blockers.length,CST_MODEL_ADMISSION_REQUIREMENTS.length);
  const allPresent=Object.fromEntries(CST_MODEL_ADMISSION_REQUIREMENTS.map(key=>[key,true]));
  const review=projectCstModelAdmissionReadiness(allPresent);
  assert.equal(review.status,"review_required");
  assert.equal(review.eligibleToDispatch,false);
  assert.equal(review.verifiedOperationalWorker,false);
  const partial=projectCstModelAdmissionReadiness({...allPresent,JOBS_UPDATE_GRANT:false,
    JOBS_MODEL_INSERT_RLS:false,WORKERS_REMOTE_UPDATE_RLS:false});
  assert.deepEqual(partial.blockers,["JOBS_UPDATE_GRANT","JOBS_MODEL_INSERT_RLS","WORKERS_REMOTE_UPDATE_RLS"]);
});
test("DEV remote worker RLS preflight only reads PostgreSQL catalogs, never writes", () => {
  const source=readFileSync(new URL("../artifacts/api-server/src/scripts/cstTeamModelAdmissionAudit.ts",import.meta.url),"utf8");
  assert.match(source,/CST_DEV_READ_ONLY_RLS_PREFLIGHT_NOT_AUTHORIZATION/);
  assert.match(source,/SUPABASE_DATABASE_URL_DEV/);
  assert.match(source,/xssrfshdrtdfupgqwfdw/);
  assert.match(source,/pg_policies/);
  assert.match(source,/has_table_privilege/);
  assert.match(source,/current_user/);
  assert.match(source,/JOBS_MODEL_INSERT_RLS/);
  assert.match(source,/WORKERS_REMOTE_UPDATE_RLS/);
  assert.doesNotMatch(source,/await\s+(?:db|pool)\.insert\(|await\s+(?:db|pool)\.update\(|CREATE\s+POLICY|ALTER\s+ROLE|GRANT\s+UPDATE\s+ON/i);
});
