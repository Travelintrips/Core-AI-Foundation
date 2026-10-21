import fs from "node:fs";
import os from "node:os";
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
const e2eHelper = arg("helper");
const targetedHelper = path.join(path.dirname(e2eHelper), "chatgpt-targeted-continue-profiled.mjs");

if (!["openclaw-pc-worker-dev", "openclaw-pc-worker-2"].includes(workerId)) throw new Error("Unsupported DEV worker");
if (!envFile || !fs.existsSync(envFile)) throw new Error("Worker env file missing");
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(browserProfile)) throw new Error("Invalid browser profile");
if (!Number.isInteger(cdpPort) || cdpPort < 1024 || cdpPort > 65535) throw new Error("Invalid CDP port");
if (!/^[A-Za-z0-9-]{30,64}$/.test(expectedConversationId)) throw new Error("Invalid expected conversation ID");
if (!e2eHelper || !fs.existsSync(e2eHelper)) throw new Error("ChatGPT E2E helper missing");
if (!fs.existsSync(targetedHelper)) throw new Error("Profile-bound ChatGPT continuation helper missing");

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
const helperEnv = {
  ...process.env,
  AI_CORE_CHATGPT_BROWSER_PROFILE: browserProfile,
  AI_CORE_CHATGPT_CDP_PORT: String(cdpPort),
  AI_CORE_CHATGPT_EXPECTED_CONVERSATION_ID: expectedConversationId,
};

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

function fail(message, reason) {
  return {
    ok: false,
    message,
    details: {
      runtime: "openclaw-direct-chatgpt-browser",
      browserProfile,
      conversationId: null,
      chatgptSubmitted: false,
      verifiedAssistantReply: false,
      evidenceFingerprint: null,
      verifiedAt: null,
      exitCode: 1,
      reason,
    },
  };
}

function validateWorkBinding(work) {
  if (work.metadata?.assignedClientId !== workerId) return "worker_mismatch";
  if (work.metadata?.browserProfile && work.metadata.browserProfile !== browserProfile) return "profile_mismatch";
  if (work.metadata?.conversationId && work.metadata.conversationId !== expectedConversationId) return "conversation_mismatch";
  return null;
}

function executeE2e(work) {
  const bindingError = validateWorkBinding(work);
  if (bindingError) return fail("Direct ChatGPT binding mismatch", bindingError);

  const run = spawnSync(node, [e2eHelper], {
    windowsHide: true,
    encoding: "utf8",
    timeout: 360000,
    maxBuffer: 1024 * 1024,
    env: helperEnv,
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

function executeContinuation(work, instruction) {
  const bindingError = validateWorkBinding(work);
  if (bindingError) return fail("Direct ChatGPT binding mismatch", bindingError);

  const encoded = instruction.slice("CHATGPT_CONTINUE_JSON:".length);
  if (!/^[A-Za-z0-9_-]{30,10000}$/.test(encoded)) return fail("Invalid encoded ChatGPT job", "invalid_payload");

  let job;
  try {
    job = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return fail("Invalid ChatGPT job JSON", "invalid_json");
  }

  const expectedUrl = "https://chatgpt.com/c/" + expectedConversationId;
  if (
    job?.mode !== "chatgpt_continue" ||
    job?.conversationUrl !== expectedUrl ||
    !/^[A-Za-z0-9_-]{8,90}$/.test(String(job?.jobId || "")) ||
    typeof job?.message !== "string" ||
    job.message.length < 8 ||
    job.message.length > 3000
  ) {
    return fail("Conversation-bound ChatGPT job is invalid or mismatched", "conversation_mismatch");
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "direct-chatgpt-job-"));
  try {
    const jobFile = path.join(dir, "job.json");
    fs.writeFileSync(jobFile, JSON.stringify(job), { encoding: "utf8", mode: 0o600 });

    const run = spawnSync(node, [targetedHelper, jobFile], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 360000,
      maxBuffer: 1024 * 1024,
      env: helperEnv,
    });

    let receipt = null;
    try { receipt = JSON.parse(String(run.stdout || "").trim()); } catch {}
    const verified =
      run.status === 0 &&
      receipt?.jobId === job.jobId &&
      receipt?.conversationUrl === expectedUrl &&
      receipt?.verifiedAssistantReply === true &&
      /^[a-f0-9]{64}$/.test(String(receipt?.fingerprint || "")) &&
      typeof receipt?.verifiedAt === "string" &&
      !Number.isNaN(Date.parse(receipt.verifiedAt));

    return {
      ok: verified,
      message: verified
        ? "ChatGPT message and assistant reply verified for " + job.jobId
        : String(run.stdout || run.stderr || run.error?.message || "ChatGPT continuation failed without verified receipt").slice(-3000),
      details: {
        runtime: "openclaw-direct-chatgpt-browser",
        eventId: String(work.commandId || ""),
        jobId: job.jobId,
        browserProfile,
        conversationId: verified ? expectedConversationId : null,
        chatgptSubmitted: verified,
        verifiedAssistantReply: verified,
        evidenceFingerprint: verified ? receipt.fingerprint : null,
        verifiedAt: verified ? receipt.verifiedAt : null,
        assistantText: verified ? String(receipt.assistantText || "").slice(0, 4000) : null,
        exitCode: run.status ?? 1,
      },
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function execute(work) {
  const instruction = String(work.instruction || "").trim();
  if (instruction === "AI_CORE_CHATGPT_BROWSER_E2E") return executeE2e(work);
  if (instruction.startsWith("CHATGPT_CONTINUE_JSON:")) return executeContinuation(work, instruction);
  return fail("Unsupported direct worker instruction", "unsupported_instruction");
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
        version: "direct-multi-account-v2",
        details: { browserProfile, cdpPort, expectedConversationId },
      });
      lastHeartbeatAt = now;
    }

    const work = await request("/ai/agent-runtime/work/claim", { clientId: workerId, leaseSeconds: 300 });
    if (work?.commandId && work?.claimToken) {
      claimed = true;
      let answer;
      try {
        answer = execute(work);
      } catch (error) {
        answer = fail("Worker execution failed", error?.name || "Error");
      }

      let delivered = false;
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        try {
          await request("/ai/agent-runtime/work/" + encodeURIComponent(work.commandId) + "/result", {
            clientId: workerId,
            claimToken: work.claimToken,
            status: answer.ok ? "COMPLETED" : "FAILED",
            message: answer.message,
            details: answer.details,
          });
          delivered = true;
          break;
        } catch (error) {
          console.log("result delivery attempt " + attempt + " failed: " + String(error?.message || error).slice(0, 120));
          if (attempt < 8) {
            await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 2500, 15000)));
          }
        }
      }
      if (!delivered) {
        console.log("UNDELIVERED " + work.commandId + " -- claim recovery required");
      } else {
        console.log("reported command " + work.commandId);
      }
    }
  } catch (error) {
    console.log("worker cycle error " + (error?.name || "Error") + " " + String(error?.message || error).slice(0, 120));
  }

  idleDelayMs = claimed ? 5000 : Math.min(Math.round(idleDelayMs * 1.6), 30000);
  await new Promise((resolve) => setTimeout(resolve, idleDelayMs));
}
