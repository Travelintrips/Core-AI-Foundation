import { spawn, spawnSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { DatabaseSync } from "node:sqlite";
import process from "node:process";

// Stable container DNS survives AI Core replacement without requiring a network alias.
const API_BASE = (process.env.AI_CORE_INTERNAL_BASE_URL || "http://core-ai-dev:3000/api").replace(/\/$/, "");
const TOKEN = (process.env.AI_CORE_SCOPED_AGENT_TOKEN || "").trim();
const CLIENT_ID = (process.env.AI_CORE_OPENCLAW_CLIENT_ID || "gcp-openclaw-main").trim();
const POLL_MS = Math.max(2000, Math.min(60000, Number(process.env.AI_CORE_AGENT_WORK_POLL_MS || 5000)));
const EXEC_TIMEOUT_SECONDS = Math.max(30, Math.min(900, Number(process.env.OPENCLAW_WORK_TIMEOUT_SECONDS || 180)));
const MAX_RESULT_CHARS = 20000;
const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || "/home/node/.openclaw/openclaw.json";
const OPENCLAW_STATE_MANAGER_ID = (process.env.OPENCLAW_STATE_MANAGER_ID || "ai-core-workers-openclaw").trim();
const OPENCLAW_STATE_DIR = process.env.OPENCLAW_STATE_DIR || "/home/node/.openclaw";
const OPENCLAW_STATE_DB_PATH = OPENCLAW_STATE_DIR + "/state/openclaw.sqlite";
const GATEWAY_LEASE_STALE_MS = 60_000;
const CONTROL_UI_ALLOWED_ORIGINS = (process.env.OPENCLAW_CONTROL_UI_ALLOWED_ORIGINS || "http://127.0.0.1:28789,http://localhost:28789,http://127.0.0.1:18789,http://localhost:18789")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

let stopping = false;
let gateway = null;
let activeAgent = null;

function ensureGatewayControlUiOrigins() {
  let config = {};
  try {
    config = JSON.parse(readFileSync(OPENCLAW_CONFIG_PATH, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  config.gateway ||= {};
  config.gateway.controlUi ||= {};
  const existing = Array.isArray(config.gateway.controlUi.allowedOrigins)
    ? config.gateway.controlUi.allowedOrigins.filter((value) => typeof value === "string")
    : [];
  const allowedOrigins = [...new Set([...existing, ...CONTROL_UI_ALLOWED_ORIGINS])];
  config.gateway.controlUi.allowedOrigins = allowedOrigins;

  const tmpPath = OPENCLAW_CONFIG_PATH + ".tmp-control-ui";
  writeFileSync(tmpPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmpPath, OPENCLAW_CONFIG_PATH);
  log("gateway control UI origins ready: " + allowedOrigins.join(","));
}

function log(message) {
  process.stdout.write("[openclaw-supervisor] " + message + "\n");
}

function runOpenClawCli(args) {
  const result = spawnSync("node", ["dist/index.js", ...args], {
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().slice(-2000);
    throw new Error("OpenClaw CLI failed: " + detail);
  }
  return String(result.stdout || "").trim();
}

function ensureExternalStateOwnership() {
  if (process.env.OPENCLAW_SUPERVISOR_MODE !== "external") {
    throw new Error(
      "OPENCLAW_SUPERVISOR_MODE=external is required for Docker-supervised shared-state ownership",
    );
  }

  const status = JSON.parse(
    runOpenClawCli(["database", "ownership", "status", "--json"]),
  );

  if (status.status === "unowned") {
    const claimed = JSON.parse(
      runOpenClawCli([
        "database",
        "ownership",
        "claim",
        "--manager",
        OPENCLAW_STATE_MANAGER_ID,
        "--json",
      ]),
    );
    log(
      "claimed shared-state ownership manager=" +
        String(claimed?.ownership?.managerId || OPENCLAW_STATE_MANAGER_ID),
    );
    return;
  }

  if (status.status !== "external") {
    throw new Error(
      "Unexpected OpenClaw shared-state ownership mode: " + String(status.status),
    );
  }

  const managerId = String(status?.ownership?.managerId || "").trim();
  if (managerId && managerId !== OPENCLAW_STATE_MANAGER_ID) {
    throw new Error(
      "OpenClaw shared-state is owned by a different external manager: " + managerId,
    );
  }

  log(
    "shared-state ownership ready manager=" +
      (managerId || OPENCLAW_STATE_MANAGER_ID),
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readGatewayLease(db) {
  return db.prepare(
    "select owner, expires_at, heartbeat_at, payload_json, updated_at " +
      "from state_leases where scope = 'gateway-owner' and lease_key = 'global'",
  ).get();
}

function parseGatewayLeaseOwner(row) {
  try {
    const payload = JSON.parse(String(row?.payload_json || "{}"));
    return {
      host: String(payload?.owner?.host || ""),
      pid: Number(payload?.owner?.pid || 0),
    };
  } catch {
    return { host: "", pid: 0 };
  }
}

function localPidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function deleteGatewayLeaseIfUnchanged(db, expected) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const latest = readGatewayLease(db);
    if (
      !latest ||
      String(latest.owner) !== String(expected.owner) ||
      Number(latest.heartbeat_at) !== Number(expected.heartbeat_at) ||
      Number(latest.updated_at) !== Number(expected.updated_at)
    ) {
      db.exec("ROLLBACK");
      return false;
    }

    const deleted = db.prepare(
      "delete from state_leases " +
        "where scope = 'gateway-owner' and lease_key = 'global' " +
        "and owner = ? and heartbeat_at = ? and updated_at = ?",
    ).run(
      String(expected.owner),
      Number(expected.heartbeat_at),
      Number(expected.updated_at),
    );
    db.exec("COMMIT");
    return Number(deleted.changes || 0) === 1;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Best effort rollback if BEGIN succeeded.
    }
    throw error;
  }
}

async function reconcileStaleGatewayLease() {
  const currentHost = hostname();

  while (true) {
    const db = new DatabaseSync(OPENCLAW_STATE_DB_PATH);
    try {
      const row = readGatewayLease(db);
      if (!row) return;

      const owner = parseGatewayLeaseOwner(row);
      if (owner.host === currentHost && localPidIsAlive(owner.pid)) {
        throw new Error(
          "Gateway lease is still owned by a live local process pid=" + owner.pid,
        );
      }

      const heartbeatAgeMs = Math.max(0, Date.now() - Number(row.heartbeat_at || 0));
      if (owner.host !== currentHost && heartbeatAgeMs < GATEWAY_LEASE_STALE_MS) {
        const waitMs = Math.min(
          5_000,
          Math.max(1_000, GATEWAY_LEASE_STALE_MS - heartbeatAgeMs),
        );
        log(
          "waiting for previous gateway lease heartbeat to become stale" +
            " ownerHost=" + owner.host +
            " ageMs=" + heartbeatAgeMs,
        );
        await sleep(waitMs);
        continue;
      }

      if (deleteGatewayLeaseIfUnchanged(db, row)) {
        log(
          "cleared stale gateway lease ownerHost=" +
            (owner.host || "unknown") +
            " ownerPid=" +
            String(owner.pid || "unknown"),
        );
      }
      return;
    } finally {
      db.close();
    }
  }
}

async function aiCoreRequest(path, options = {}) {
  const headers = {
    authorization: "Bearer " + TOKEN,
    accept: "application/json",
    ...(options.body ? { "content-type": "application/json" } : {}),
  };
  const response = await fetch(API_BASE + path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
    signal: AbortSignal.timeout(30000),
  });
  return response;
}

function parseAgentResult(raw) {
  const text = raw.trim();
  if (!text) return "OpenClaw completed the bounded task without textual output.";

  try {
    const parsed = JSON.parse(text);
    const candidates = [
      parsed?.result?.message,
      parsed?.result?.text,
      parsed?.message,
      parsed?.text,
      parsed?.output,
      parsed?.response,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim().slice(0, MAX_RESULT_CHARS);
      }
    }
  } catch {
    // Preserve bounded CLI output when a release uses a different JSON envelope.
  }

  return text.slice(-MAX_RESULT_CHARS);
}

function tailText(value, maxChars) {
  const text = String(value || "").trim();
  return text.length <= maxChars ? text : text.slice(-maxChars);
}

async function runDirectMonitoring(work) {
  const operation = String(work?.metadata?.directOperation || "").trim();
  const destinations = {
    "ai-core-health": "http://ai-core-backend:3000/api/health",
    "github-repository": "https://api.github.com/repos/Travelintrips/Core-AI-Foundation/actions/runs?per_page=1",
    "hostinger-deployment": "https://aicore.cstlogistic.co.id/api/health",
  };
  if (!Object.hasOwn(destinations, operation)) {
    return { ok: false, message: "Unsupported direct monitoring operation", details: { runtime: "direct-api", operation } };
  }
  try {
    const response = await fetch(destinations[operation], {
      method: "GET",
      headers: { accept: "application/json", "user-agent": "ai-core-openclaw-monitor/1" },
      signal: AbortSignal.timeout(12000),
    });
    if (operation === "github-repository" && response.ok) {
      const payload = await response.json();
      const run = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs[0] : null;
      const failed = run?.status === "completed" && !["success", "skipped", "neutral"].includes(run?.conclusion);
      return { ok: !failed, message: `GitHub Actions latest: ${run?.status || "none"}/${run?.conclusion || "none"}`,
        details: { runtime: "direct-api", operation, httpStatus: response.status, llmUsed: false,
          workflowRunId: run?.id || null, status: run?.status || null, conclusion: run?.conclusion || null } };
    }
    return {
      ok: response.ok,
      message: `${operation}: HTTP ${response.status}`,
      details: { runtime: "direct-api", operation, httpStatus: response.status, llmUsed: false },
    };
  } catch (error) {
    return { ok: false, message: `${operation}: ${String(error?.message || error).slice(0,200)}`,
      details: { runtime: "direct-api", operation, llmUsed: false } };
  }
}

async function runOpenClawAgent(work) {
  const sessionId = "ai-core-work-" + String(work.commandId).replace(/[^a-zA-Z0-9_-]/g, "");
  const executionProfile = String(work?.metadata?.openClawExecutionProfile || "agent-tools");
  const args = [
    "dist/index.js",
    "agent",
    "--agent",
    "main",
    "--session-id",
    sessionId,
    ...(executionProfile === "chat-no-tools"
      ? ["--model", "ai-core/ai-core-agent-chat"]
      : []),
    "--message",
    String(work.instruction),
    "--thinking",
    "off",
    "--timeout",
    String(EXEC_TIMEOUT_SECONDS),
    "--json",
  ];

  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const startedAt = Date.now();

    activeAgent = spawn("node", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    const timer = setTimeout(() => {
      if (!settled && activeAgent) {
        timedOut = true;
        activeAgent.kill("SIGTERM");
        setTimeout(() => activeAgent?.kill("SIGKILL"), 5000).unref();
      }
    }, (EXEC_TIMEOUT_SECONDS + 10) * 1000);
    timer.unref();

    activeAgent.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_RESULT_CHARS * 3) {
        stdout = stdout.slice(-MAX_RESULT_CHARS * 2);
      }
    });
    activeAgent.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    activeAgent.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeAgent = null;
      const stderrTail = tailText(stderr, 8000);
      const stdoutTail = tailText(stdout, 8000);
      resolve({
        ok: false,
        message: ("OpenClaw process could not start: " + (error instanceof Error ? error.message : String(error))).slice(0, 4000),
        details: {
          exitCode: null,
          signal: null,
          runtime: "openclaw-cli",
          timedOut: false,
          durationMs: Date.now() - startedAt,
          failureStage: "spawn",
          errorType: error instanceof Error ? error.name : "Error",
          errorMessage: error instanceof Error ? error.message.slice(0, 4000) : String(error).slice(0, 4000),
          stdoutTail,
          stderrTail,
        },
      });
    });

    activeAgent.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeAgent = null;
      const durationMs = Date.now() - startedAt;
      const stdoutTail = tailText(stdout, 8000);
      const stderrTail = tailText(stderr, 8000);
      if (code === 0) {
        resolve({
          ok: true,
          message: parseAgentResult(stdout),
          details: {
            exitCode: 0,
            signal: signal || null,
            runtime: "openclaw-cli",
            timedOut: false,
            durationMs,
            stdoutTail,
            stderrTail,
            executionProfile,
          },
        });
        return;
      }
      const failureReason = timedOut
        ? "OpenClaw bounded execution timed out"
        : "OpenClaw bounded execution failed";
      const safeFailure =
        failureReason +
        (typeof code === "number" ? " (exit " + code + ")" : "") +
        (signal ? " signal=" + signal : "") +
        (stderrTail ? ": " + stderrTail.slice(-1500) : stdoutTail ? ": " + stdoutTail.slice(-1500) : ".");
      resolve({
        ok: false,
        message: safeFailure.slice(0, 4000),
        details: {
          exitCode: code,
          signal: signal || null,
          runtime: "openclaw-cli",
          timedOut,
          durationMs,
          failureStage: timedOut ? "agent-timeout" : "agent-process",
          stdoutTail,
          stderrTail,
        },
      });
    });
  });
}

async function claimWork() {
  const response = await aiCoreRequest("/ai/agent-runtime/work/claim", {
    method: "POST",
    body: JSON.stringify({
      clientId: CLIENT_ID,
      leaseSeconds: Math.min(300, Math.max(60, EXEC_TIMEOUT_SECONDS + 30)),
    }),
  });
  if (response.status === 204) return null;
  if (!response.ok) {
    throw new Error("AI Core work claim HTTP " + response.status);
  }
  return await response.json();
}

async function reportResult(work, result) {
  const response = await aiCoreRequest(
    "/ai/agent-runtime/work/" + encodeURIComponent(work.commandId) + "/result",
    {
      method: "POST",
      body: JSON.stringify({
        clientId: CLIENT_ID,
        claimToken: work.claimToken,
        status: result.ok ? "COMPLETED" : "FAILED",
        message: result.message,
        details: result.details,
      }),
    },
  );
  if (!response.ok) {
    throw new Error("AI Core work result HTTP " + response.status);
  }
}

// Keep completed executions on disk until AI Core confirms receipt. Never re-run a
// claimed operation merely because result delivery failed.
const resultOutbox = new DatabaseSync(OPENCLAW_STATE_DIR + "/result-outbox.sqlite");
resultOutbox.exec("CREATE TABLE IF NOT EXISTS pending_results (command_id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
function queueResult(work, result) {
  resultOutbox.prepare("INSERT OR REPLACE INTO pending_results(command_id, payload) VALUES (?, ?)").run(String(work.commandId), JSON.stringify({ work, result }));
}
async function flushResults() {
  const rows = resultOutbox.prepare("SELECT command_id, payload FROM pending_results ORDER BY created_at LIMIT 20").all();
  for (const row of rows) {
    const { work, result } = JSON.parse(row.payload);
    try {
      await reportResult(work, result);
      resultOutbox.prepare("DELETE FROM pending_results WHERE command_id = ?").run(row.command_id);
      log("result delivery acknowledged for " + row.command_id);
    } catch (error) {
      log("result delivery pending for " + row.command_id + ": " + String(error.message || error).slice(0, 180));
      return false;
    }
  }
  return true;
}

// The worker must maintain its own bounded presence lease. A healthy container
// without a current heartbeat must never be considered dispatch-eligible.
let presenceHeartbeatInFlight = false;
async function heartbeatPresence() {
  if (stopping || presenceHeartbeatInFlight) return;
  presenceHeartbeatInFlight = true;
  try {
    const response = await aiCoreRequest(
      "/ai/agent-runtime/presence/" + encodeURIComponent(CLIENT_ID) + "/heartbeat",
      {
        method: "POST",
        body: JSON.stringify({
          health: "healthy",
          version: "openclaw-supervisor",
          details: { runtime: "vps-openclaw", workMode: "bounded" },
        }),
      },
    );
    if (!response.ok) {
      log("presence heartbeat HTTP " + response.status);
    }
  } catch (error) {
    log("presence heartbeat failed: " + String(error?.cause?.code || error?.message || error).slice(0, 180));
  } finally {
    presenceHeartbeatInFlight = false;
  }
}

async function workLoop() {
  while (!stopping) {
    try {
      if (!(await flushResults())) {
        await sleep(POLL_MS);
        continue;
      }
      const work = await claimWork();
      if (!work) {
        await sleep(POLL_MS);
        continue;
      }

      log("claimed bounded work " + String(work.commandId));
      const result = work?.metadata?.openClawExecutionProfile === "monitor-direct"
        ? await runDirectMonitoring(work)
        : await runOpenClawAgent(work);
      queueResult(work, result);
      const delivered = await flushResults();
      log(
        (delivered ? "reported " : "queued result ") +
          (result.ok ? "COMPLETED" : "FAILED") +
          " for " +
          String(work.commandId),
      );
    } catch (error) {
      log(
        "work loop error: " +
          (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      );
      await sleep(POLL_MS);
    }
  }
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  log("received " + signal + "; stopping");
  activeAgent?.kill("SIGTERM");
  gateway?.kill("SIGTERM");
  setTimeout(() => {
    activeAgent?.kill("SIGKILL");
    gateway?.kill("SIGKILL");
  }, 5000).unref();
}

if (!TOKEN) {
  throw new Error("AI_CORE_SCOPED_AGENT_TOKEN is required");
}

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

ensureGatewayControlUiOrigins();
ensureExternalStateOwnership();
await reconcileStaleGatewayLease();

gateway = spawn(
  "node",
  [
    "dist/index.js",
    "gateway",
    "--bind",
    "lan",
    "--port",
    "18789",
    "--allow-unconfigured",
  ],
  {
    stdio: "inherit",
    env: process.env,
  },
);

gateway.on("exit", (code, signal) => {
  if (!stopping) {
    log(
      "gateway exited unexpectedly" +
        (typeof code === "number" ? " code=" + code : "") +
        (signal ? " signal=" + signal : ""),
    );
    process.exitCode = typeof code === "number" && code !== 0 ? code : 1;
    stop("gateway-exit");
  }
});

await sleep(5000);
await heartbeatPresence();
const presenceTimer = setInterval(() => { void heartbeatPresence(); }, 30_000);
presenceTimer.unref();
await workLoop();
clearInterval(presenceTimer);

if (gateway && gateway.exitCode === null) {
  await new Promise((resolve) => gateway.once("exit", resolve));
}
