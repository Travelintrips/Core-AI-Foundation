import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
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
