import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
