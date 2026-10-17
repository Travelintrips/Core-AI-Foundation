/**
 * One event-driven DEV-only worker per configured Dell OpenClaw agent.
 * Secrets come from a protected per-worker env file and are never logged.
 * Initially accepts deterministic registration/self-test work only.
 * Operational capabilities can be expanded after role-specific E2E validation.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { workEvents } from "./work-event-stream.mjs";

const ROLES = new Set(["browser", "recovery", "verifier"]);
const role = String(process.argv[2] ?? "").trim();
if (!ROLES.has(role)) throw Error("Expected Dell role: browser, recovery, or verifier");
const clientId = `openclaw-pc-worker-dell-${role}`;
const agentId = `dell-${role}`;
const envFile = path.join(os.homedir(), "aicore-worker-bootstrap", `ai-worker-dell-${role}.env`);

function readSettings(filename) {
  const lines = fs.readFileSync(filename, "utf8").split(/\r?\n/);
  return Object.fromEntries(lines.filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => {
      const equal = line.indexOf("=");
      return [line.slice(0, equal), line.slice(equal + 1).trim().replace(/^["']|["']$/g, "")];
    }));
}
const config = readSettings(envFile);
if (config.AI_CORE_OPENCLAW_CLIENT_ID !== clientId || !config.AI_CORE_SCOPED_AGENT_TOKEN) {
  throw Error("Missing or mismatched per-worker DEV credentials");
}
const baseUrl = new URL(config.AI_CORE_BASE_URL ?? "");
if (baseUrl.protocol !== "https:" || baseUrl.hostname !== "dev.cstlogistic.co.id"
    || !baseUrl.pathname.startsWith("/api") || baseUrl.search || baseUrl.hash) {
  throw Error("Refusing non-DEV or insecure AI Core target");
}
const base = baseUrl.href.replace(/\/$/, "");
const token = config.AI_CORE_SCOPED_AGENT_TOKEN;
const node = path.join(process.env.LOCALAPPDATA ?? "", "OpenClaw", "deps", "portable-node", "node.exe");
const cli = path.join(process.env.LOCALAPPDATA ?? "", "OpenClaw", "deps", "portable-node",
  "node_modules", "openclaw", "dist", "index.js");
if (!fs.existsSync(node) || !fs.existsSync(cli)) throw Error("OpenClaw runtime missing");

async function call(pathname, body) {
  const response = await fetch(base + pathname, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 204) return null;
  if (!response.ok) throw Error("AI Core HTTP " + response.status);
  return response.json();
}

function execute(work) {
  if (work.commandType !== "EXTERNAL_AGENT_WORK" ||
      (work.assignedClientId && work.assignedClientId !== clientId) ||
      (work.metadata?.assignedClientId && work.metadata.assignedClientId !== clientId)) {
    return { ok: false, message: "Work identity or command type denied",
      details: { worker: clientId, reason: "identity_or_type_mismatch" } };
  }
  const instruction = String(work.instruction ?? "").trim();
  if (instruction === "ping") {
    return { ok: true, message: "pong " + clientId,
      details: { worker: clientId, check: "deterministic_ping", verified: true } };
  }
  if (instruction !== `AI_CORE_DELL_SELFTEST_${role.toUpperCase()}`) {
    return { ok: false, message: "Role work not yet approved for this DEV pilot",
      details: { worker: clientId, reason: "only_registration_tests_enabled", verified: false } };
  }
  const expected = `DELL_${role.toUpperCase()}_READ_PASS`;
  const prompt = `On this Dell DEV agent, call the read tool to read AGENTS.md in your workspace. `
    + `Verify that it identifies the agent as ${agentId}. If read succeeds, reply exactly ${expected}. `
    + "Otherwise reply READ_FAILED. Do not change files or access other systems.";
  const args = [cli, "agent", "--agent", agentId, "--session-key",
    `agent:${agentId}:ai-core-dev-${work.commandId}`, "--message", prompt,
    "--timeout", "45", "--json"];
  const run = spawnSync(node, args, {
    windowsHide: true, encoding: "utf8", timeout: 70_000, maxBuffer: 512 * 1024,
  });
  let parsed;
  try { parsed = JSON.parse(String(run.stdout ?? "").trim()); } catch { parsed = null; }
  const receipt = parsed?.result?.meta?.agentMeta?.terminalReceipt;
  const tools = Array.isArray(receipt?.successfulToolNames) ? receipt.successfulToolNames : [];
  const reply = String(parsed?.result?.payloads?.[0]?.text ?? "").trim();
  const verified = run.status === 0 && parsed?.status === "ok" &&
    tools.includes("read") && reply === expected && !parsed?.result?.meta?.aborted;
  return {
    ok: verified,
    message: verified ? expected : "Dell agent self-test failed or evidence missing",
    details: {
      worker: clientId, agentId, verified, toolUsed: tools.includes("read"),
      cliExitCode: run.status, runId: parsed?.runId ?? null,
      resultCheck: "model_reply_and_tool_receipt",
      conversationAckVerified: false,
    },
  };
}

let heartbeatBusy = false;
async function heartbeat() {
  if (heartbeatBusy) return;
  heartbeatBusy = true;
  try {
    await call("/ai/agent-runtime/presence/" + encodeURIComponent(clientId) + "/heartbeat", {
      health: "healthy", version: "dell-role-event-consumer-v1",
      details: { device: "DELL", role, environment: "DEV", transport: "sse", mode: "registration-pilot" },
    });
  } catch (error) {
    console.error("heartbeat failed: " + error.name);
  } finally { heartbeatBusy = false; }
}

function verifiedCallback(receipt, commandId, status) {
  return receipt && receipt.commandId === commandId && receipt.status === status &&
    typeof receipt.response?.id === "string" &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(receipt.response.id);
}

const timer = setInterval(() => { void heartbeat(); }, 25_000);
timer.unref();
await heartbeat();
let failures = 0;
while (true) {
  try {
    // SSE hints are not authorization: claim and result APIs remain authoritative.
    for await (const _wake of workEvents(base, token, clientId)) {
      failures = 0;
      while (true) {
        const work = await call("/ai/agent-runtime/work/claim", { clientId, leaseSeconds: 300 });
        if (!work) break;
        if (!work.commandId || !work.claimToken) throw Error("Invalid work claim");
        let result;
        try { result = execute(work); }
        catch (error) {
          result = { ok: false, message: "Worker execution failed",
            details: { worker: clientId, errorType: error.name, verified: false } };
        }
        const status = result.ok ? "COMPLETED" : "FAILED";
        let acknowledged = false;
        for (let attempt = 1; attempt <= 8; attempt++) {
          try {
            const receipt = await call("/ai/agent-runtime/work/" +
              encodeURIComponent(work.commandId) + "/result", {
              clientId, claimToken: work.claimToken, status,
              message: result.message, details: result.details,
            });
            acknowledged = verifiedCallback(receipt, work.commandId, status);
            if (acknowledged) break;
          } catch (error) {
            console.error("result delivery error: " + error.name);
          }
          if (attempt < 8) await new Promise((resolve) =>
            setTimeout(resolve, Math.min(attempt * 2500, 15000)));
        }
        if (!acknowledged) throw Error("Missing persisted result receipt");
        console.log("callback persisted " + work.commandId + " status=" + status);
      }
    }
  } catch (error) {
    failures = Math.min(6, failures + 1);
    console.error("stream reconnect: " + error.name);
    await new Promise((resolve) => setTimeout(resolve, Math.min(60_000, 1000 * 2 ** failures)));
  }
}
