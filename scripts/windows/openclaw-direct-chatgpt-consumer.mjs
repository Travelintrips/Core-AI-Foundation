import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function arg(name) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? String(process.argv[i + 1] || "").trim() : "";
}

const workerId = arg("worker");
const envFile = arg("env");
const browserProfile = arg("profile");
const cdpPort = Number(arg("cdp-port"));
const expectedConversationId = arg("conversation-id");
const helper = arg("helper");

if (!["openclaw-pc-worker-dev", "openclaw-pc-worker-2"].includes(workerId)) throw new Error("Unsupported DEV worker");
if (!envFile || !fs.existsSync(envFile)) throw new Error("Worker env file missing");
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(browserProfile)) throw new Error("Invalid browser profile");
if (!Number.isInteger(cdpPort) || cdpPort < 1024 || cdpPort > 65535) throw new Error("Invalid CDP port");
if (!/^[A-Za-z0-9-]{30,64}$/.test(expectedConversationId)) throw new Error("Invalid expected conversation ID");
if (!helper || !fs.existsSync(helper)) throw new Error("ChatGPT E2E helper missing");

const settings = Object.fromEntries(
  fs.readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const n = line.indexOf("=");
      return [line.slice(0, n), line.slice(n + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

if (settings.AI_CORE_OPENCLAW_CLIENT_ID !== workerId) throw new Error("Worker identity mismatch");
if (settings.AI_CORE_BASE_URL !== "https://dev.cstlogistic.co.id/api") throw new Error("DEV-only base URL required");
if (!settings.AI_CORE_SCOPED_AGENT_TOKEN) throw new Error("Scoped DEV token missing");

const base = settings.AI_CORE_BASE_URL.replace(/\/$/, "");
const node = process.execPath;

async function request(route, payload) {
  const response = await fetch(base + route, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + settings.AI_CORE_SCOPED_AGENT_TOKEN,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error("AI Core HTTP " + response.status);
  return response.json();
}

function execute(work) {
  if (String(work.instruction || "").trim() !== "AI_CORE_CHATGPT_BROWSER_E2E") {
    return { ok: false, message: "Unsupported direct worker instruction", details: { reason: "unsupported_instruction", exitCode: 1 } };
  }
  if (work.metadata?.assignedClientId !== workerId) {
    return { ok: false, message: "Worker binding mismatch", details: { reason: "worker_mismatch", exitCode: 1 } };
  }
  if (work.metadata?.browserProfile !== browserProfile) {
    return { ok: false, message: "Browser profile binding mismatch", details: { reason: "profile_mismatch", exitCode: 1 } };
  }

  const run = spawnSync(node, [helper], {
    windowsHide: true,
    encoding: "utf8",
    timeout: 360000,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      AI_CORE_CHATGPT_BROWSER_PROFILE: browserProfile,
      AI_CORE_CHATGPT_CDP_PORT: String(cdpPort),
      AI_CORE_CHATGPT_EXPECTED_CONVERSATION_ID: expectedConversationId,
    },
  });

  let receipt = null;
  try { receipt = JSON.parse(String(run.stdout || "").trim()); } catch {}
  const verified =
    run.status === 0 &&
    receipt?.chatgptSubmitted === true &&
    receipt?.verifiedAssistantReply === true &&
    receipt?.conversationId === expectedConversationId &&
    /^[a-f0-9]{64}$/.test(String(receipt?.evidenceFingerprint || "")) &&
    typeof receipt?.verifiedAt === "string" &&
    !Number.isNaN(Date.parse(receipt.verifiedAt));

  return {
    ok: verified,
    message: verified
      ? "Verified direct OpenClaw ChatGPT E2E for " + work.commandId
      : String(run.stdout || run.stderr || run.error?.message || "Browser E2E failed without verified receipt").slice(-3000),
    details: {
      runtime: "openclaw-direct-chatgpt-browser",
      eventId: String(work.commandId || ""),
      browserProfile,
      conversationId: verified ? receipt.conversationId : null,
      chatgptSubmitted: verified,
      verifiedAssistantReply: verified,
      evidenceFingerprint: verified ? receipt.evidenceFingerprint : null,
      verifiedAt: verified ? receipt.verifiedAt : null,
      exitCode: run.status ?? 1,
    },
  };
}

let idleDelayMs = 5000;
let lastHeartbeatAt = 0;

while (true) {
  let claimed = false;
  try {
    const now = Date.now();
    if (now - lastHeartbeatAt >= 60000) {
      await request("/ai/agent-runtime/presence/" + encodeURIComponent(workerId) + "/heartbeat", {
        health: "healthy",
        version: "direct-multi-account-v1",
        details: { browserProfile, cdpPort, expectedConversationId },
      });
      lastHeartbeatAt = now;
    }

    const work = await request("/ai/agent-runtime/work/claim", { clientId: workerId, leaseSeconds: 300 });
    if (work?.commandId && work?.claimToken) {
      claimed = true;
      let answer;
      try { answer = execute(work); }
      catch (error) { answer = { ok: false, message: "Worker execution failed", details: { errorType: error?.name || "Error", exitCode: 1 } }; }

      await request("/ai/agent-runtime/work/" + encodeURIComponent(work.commandId) + "/result", {
        clientId: workerId,
        claimToken: work.claimToken,
        status: answer.ok ? "COMPLETED" : "FAILED",
        message: answer.message,
        details: answer.details,
      });
      console.log("reported command " + work.commandId);
    }
  } catch (error) {
    console.log("worker cycle error " + (error?.name || "Error") + " " + String(error?.message || error).slice(0, 120));
  }
  idleDelayMs = claimed ? 5000 : Math.min(Math.round(idleDelayMs * 1.6), 30000);
  await new Promise((resolve) => setTimeout(resolve, idleDelayMs));
}
