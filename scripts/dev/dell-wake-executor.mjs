import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workerId = "openclaw-dell-chatgpt-wake-dev";
const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "AI-Core");
const envFile = path.join(root, "dell-chatgpt-wake-dev.env");
const helper = path.join(root, "dev-chatgpt-wake-once.py");
const settings = Object.fromEntries(fs.readFileSync(envFile, "utf8").split(/\r?\n/)
  .filter(line => line.trim() && !line.trim().startsWith("#"))
  .map(line => { const n = line.indexOf("="); return [line.slice(0, n), line.slice(n + 1).trim().replace(/^[\"']|[\"']$/g, "")]; }));
if (settings.AI_CORE_OPENCLAW_CLIENT_ID !== workerId ||
    settings.AI_CORE_BASE_URL?.replace(/\/$/, "") !== "https://dev.cstlogistic.co.id/api" ||
    !settings.AI_CORE_SCOPED_AGENT_TOKEN) throw new Error("Worker config incomplete");
if (!fs.existsSync(helper)) throw new Error("Wake helper missing");

const base = settings.AI_CORE_BASE_URL.replace(/\/$/, "");
const python = settings.AI_CORE_PYTHON?.trim() || (() => {
  const programs = path.join(process.env.LOCALAPPDATA || "", "Programs", "Python");
  if (fs.existsSync(programs)) {
    const candidates = fs.readdirSync(programs, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /^Python\d+$/i.test(entry.name))
      .map(entry => path.join(programs, entry.name, "python.exe"))
      .filter(candidate => fs.existsSync(candidate))
      .sort().reverse();
    if (candidates[0]) return candidates[0];
  }
  return "python";
})();
async function request(route, payload) {
  const response = await fetch(base + route, {
    method: "POST",
    headers: { Authorization: "Bearer " + settings.AI_CORE_SCOPED_AGENT_TOKEN, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error("AI Core HTTP " + response.status);
  return response.json();
}
function execute(work) {
  const instruction = String(work.instruction || "").trim();
  const match = /^DEV_CHATGPT_WAKE_V(?:1|2) conversation=([0-9a-f-]{36}) event=([a-f0-9]{64}) challenge=([a-f0-9]{64})(?: task=([A-Za-z0-9_-]{1,4096}))?$/i.exec(instruction);
  if (work.commandType !== "EXTERNAL_AGENT_WORK" || !match) {
    return { ok: false, message: "Dedicated DELL worker rejects non-wake job", details: { reason: "scope_denied" } };
  }
  const conversationId = match[1].toLowerCase();
  const eventId = match[2].toLowerCase();
  const challenge = match[3].toLowerCase();
  const metadata = work.metadata || {};
  if (metadata.assignedClientId !== workerId ||
      metadata.targetConversationId !== conversationId ||
      metadata.eventId !== eventId ||
      metadata.assistantAttestationChallenge !== challenge ||
      metadata.capability !== "chatgpt:wake") {
    return { ok: false, message: "Wake binding mismatch", details: { reason: "binding_mismatch" } };
  }
  const env = {
    ...process.env,
    AI_CORE_DEV_WAKE_WORKER_ID: workerId,
    AI_CORE_DEV_WAKE_KEY_ID: "openclaw-dell-chatgpt-wake-dev-ed25519-v1",
    AI_CORE_DEV_WAKE_ALLOWLIST_FILE: "dell-chatgpt-wake-allowlist.json",
    AI_CORE_DEV_WAKE_PRIVATE_KEY_FILE: "dell-chatgpt-wake-attestation-ed25519.pem",
    AI_CORE_OPENCLAW_CMD: path.join(process.env.LOCALAPPDATA, "OpenClaw", "deps", "portable-node", "openclaw.cmd"),
    AI_CORE_DEV_WAKE_BROWSER_PROFILE: "openclaw",
  };
  const run = spawnSync(python, [helper], {
    input: JSON.stringify({ instruction, workerId }),
    encoding: "utf8",
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 2 * 1024 * 1024,
    env,
  });
  let receipt = null;
  try { receipt = JSON.parse(String(run.stdout || "").trim()); } catch {}
  const verified = run.status === 0 && receipt?.ok === true &&
    receipt?.verifiedAssistantReply === true &&
    receipt?.browserPairingVerified === true &&
    receipt?.chatgptSubmitted === true &&
    receipt?.conversationId === conversationId &&
    receipt?.eventId === eventId &&
    receipt?.challenge === challenge &&
    receipt?.attestation?.workerId === workerId &&
    receipt?.attestation?.keyId === "openclaw-dell-chatgpt-wake-dev-ed25519-v1";
  const assistantResponseText = verified && typeof receipt?.assistantResponseText === "string"
    ? receipt.assistantResponseText.trim().slice(0, 4000)
    : "";
  return {
    ok: verified,
    message: verified
      ? (assistantResponseText || "ChatGPT assistant reply attested by DELL")
      : String(receipt?.message || run.stderr || run.error?.message || "Browser verification failed").slice(-400),
    details: verified ? {
      mode: "chatgpt-browser-wake-dev",
      runtime: "openclaw-pc",
      workerId,
      verified: true,
      modelInvoked: true,
      chatgptSubmitted: true,
      browserConfirmed: true,
      browserPairingVerified: true,
      verifiedAssistantReply: true,
      conversationId,
      eventId,
      challenge,
      evidenceFingerprint: receipt.evidenceFingerprint,
      attestation: receipt.attestation,
      assistantResponseText: assistantResponseText || null,
      exitCode: 0,
      verifiedAt: receipt.attestation?.observedAt,
    } : {
      mode: "chatgpt-browser-wake-dev",
      runtime: "openclaw-pc",
      workerId,
      verified: false,
      modelInvoked: false,
      chatgptSubmitted: false,
      browserConfirmed: false,
      browserPairingVerified: false,
      verifiedAssistantReply: false,
      conversationId,
      eventId,
      challenge,
      attestation: null,
      exitCode: run.status ?? 1,
      reason: receipt?.message || "Browser verification failed",
    },
  };
}

while (true) {
  try {
    await request("/ai/agent-runtime/presence/" + encodeURIComponent(workerId) + "/heartbeat",
      { health: "healthy", version: "dell-wake-executor-2" });
    const work = await request("/ai/agent-runtime/work/claim", { clientId: workerId, leaseSeconds: 300 });
    if (work?.commandId && work?.claimToken) {
      let answer;
      try { answer = execute(work); }
      catch (error) { answer = { ok: false, message: "Worker execution failed", details: { errorType: error?.name || "Error" } }; }
      let delivered = false;
      for (let attempt = 1; attempt <= 8; attempt++) {
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
          console.log("result delivery attempt " + attempt + " failed: " + (error?.name || "Error"));
          if (attempt < 8) await new Promise(resolve => setTimeout(resolve, Math.min(attempt * 2500, 15_000)));
        }
      }
      if (!delivered) console.log("UNDELIVERED " + work.commandId);
      else console.log("reported command " + work.commandId);
    }
  } catch (error) {
    console.log("worker cycle error " + (error?.name || "Error") + " " + String(error?.message || "").slice(0, 100));
  }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
