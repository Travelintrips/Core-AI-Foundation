import { spawn } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import process from "node:process";

const API_BASE = (process.env.AI_CORE_BASE_URL || "https://aicore.cstlogistic.co.id/api").replace(/\/$/, "");
const TOKEN = (process.env.AI_CORE_SCOPED_AGENT_TOKEN || "").trim();
const CLIENT_ID = "gcp-openclaw-main";
const POLL_MS = Math.max(2000, Math.min(60000, Number(process.env.AI_CORE_AGENT_WORK_POLL_MS || 5000)));
const EXEC_TIMEOUT_SECONDS = Math.max(30, Math.min(900, Number(process.env.OPENCLAW_WORK_TIMEOUT_SECONDS || 180)));
const MAX_RESULT_CHARS = 20000;
const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || "/home/node/.openclaw/openclaw.json";
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function runOpenClawAgent(work) {
  const sessionId = "ai-core-work-" + String(work.commandId).replace(/[^a-zA-Z0-9_-]/g, "");
  const args = [
    "dist/index.js",
    "agent",
    "--agent",
    "main",
    "--session-id",
    sessionId,
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

async function workLoop() {
  while (!stopping) {
    try {
      const work = await claimWork();
      if (!work) {
        await sleep(POLL_MS);
        continue;
      }

      log("claimed bounded work " + String(work.commandId));
      const result = await runOpenClawAgent(work);
      await reportResult(work, result);
      log(
        "reported " +
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
await workLoop();

if (gateway && gateway.exitCode === null) {
  await new Promise((resolve) => gateway.once("exit", resolve));
}
