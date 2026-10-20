import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const workerId = "openclaw-dell-chatgpt-wake-dev";
const keyId = "openclaw-dell-chatgpt-wake-dev-ed25519-v1";
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const OWNER = /^ai-engine-oauth:[a-f0-9]{64}$/;
const PROFILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ALIAS = /^GPT[0-9]{2,4}$/;

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function matches(pattern, value) {
  // JavaScript's $ anchor can precede a final newline; bindings must be exact.
  return typeof value === "string" && value === value.trim() && pattern.test(value);
}

export function bindingFingerprint(binding) {
  return createHash("sha256").update([
    "dev-chatgpt-wake-binding/v1", binding.accountAlias, binding.ownerChannel,
    binding.targetConversationId, binding.workerId, binding.browserProfile,
  ].join("|")).digest("hex");
}

function validBinding(value) {
  return record(value) && value.version === 1 &&
    matches(ALIAS, value.accountAlias) && matches(OWNER, value.ownerChannel) &&
    matches(UUID, value.targetConversationId) && value.workerId === workerId && matches(PROFILE, value.browserProfile) &&
    (value.bindingFingerprint === undefined || value.bindingFingerprint === bindingFingerprint(value));
}

/** Validate the whole registry before selecting a tuple, including disabled entries. */
export function localBindings(config) {
  if (!record(config) || config.enabled !== true ||
      (config.bindings !== undefined && !Array.isArray(config.bindings))) {
    throw new Error("DEV wake pairing disabled or malformed");
  }
  const entries = [];
  const singularLegacy = Object.hasOwn(config, "legacyBinding");
  const pluralLegacy = Object.hasOwn(config, "legacyBindings");
  if (singularLegacy && pluralLegacy) throw new Error("Ambiguous GPT01 legacy registry");
  const legacyEntries = singularLegacy ? [config.legacyBinding] : (pluralLegacy ? config.legacyBindings : []);
  if (!Array.isArray(legacyEntries) || (pluralLegacy && legacyEntries.length === 0)) {
    throw new Error("Explicit GPT01 legacy pairing required");
  }
  for (const legacy of legacyEntries) {
    if (!validBinding(legacy) || typeof legacy.enabled !== "boolean" ||
        legacy.accountAlias !== "GPT01" || legacy.browserProfile !== "openclaw" ||
        !Array.isArray(config.allowedConversationIds) ||
        config.allowedConversationIds.length !== 1 ||
        config.allowedConversationIds[0] !== legacy.targetConversationId) {
      throw new Error("Explicit GPT01 legacy pairing required");
    }
    entries.push({ ...legacy, legacy: true });
  }
  for (const value of config.bindings || []) {
    if (!validBinding(value) || typeof value.enabled !== "boolean" || value.accountAlias === "GPT01") {
      throw new Error("Invalid additional DEV wake binding");
    }
    entries.push({ ...value, legacy: false });
  }
  // Several already-authorized owners may share the single legacy GPT01
  // destination. Only that group can repeat alias/target/profile; owners never
  // repeat, and an additional binding cannot collide with any legacy owner.
  const destinations = [...entries.filter(entry => entry.legacy).slice(0, 1), ...entries.filter(entry => !entry.legacy)];
  for (const field of ["accountAlias", "ownerChannel", "targetConversationId", "browserProfile"]) {
    const values = (field === "ownerChannel" ? entries : destinations)
      .map(entry => field === "browserProfile" ? entry[field].toLowerCase() : entry[field]);
    if (new Set(values).size !== values.length) throw new Error("Conflicting DEV wake bindings");
  }
  return entries;
}

export function assistantChallenge(metadata, fingerprint) {
  const watch = metadata.watchCommandId;
  const job = metadata.jobId;
  const revision = metadata.checkpointRevision;
  const hasWatch = watch !== undefined || job !== undefined || revision !== undefined;
  if (!matches(OWNER, metadata.conversationId) || !matches(UUID, metadata.targetConversationId) ||
      !matches(DIGEST, metadata.eventId) || (hasWatch &&
        (typeof watch !== "string" || !matches(UUID, watch.toLowerCase()) || typeof job !== "string" || !matches(UUID, job.toLowerCase()) ||
         !Number.isSafeInteger(revision) || revision < 1))) {
    throw new Error("Invalid DEV wake challenge context");
  }
  const fields = [
    "dev-chatgpt-assistant-attestation/v" + (fingerprint ? "2" : "1"),
    metadata.conversationId, metadata.targetConversationId, metadata.eventId,
    watch?.toLowerCase() ?? "", job?.toLowerCase() ?? "", revision === undefined ? "" : String(revision),
  ];
  if (fingerprint) fields.push(fingerprint);
  return createHash("sha256").update(fields.join("|")).digest("hex");
}

/** Called before starting Python or touching Chrome. No implicit legacy fallback. */
export function resolveWorkBinding(work, config) {
  const instruction = String(work.instruction || "").trim();
  const match = /^DEV_CHATGPT_WAKE_V([12]) conversation=([0-9a-f-]{36}) event=([a-f0-9]{64}) challenge=([a-f0-9]{64})(?: task=([A-Za-z0-9_-]{1,4096}))?$/i.exec(instruction);
  if (work.commandType !== "EXTERNAL_AGENT_WORK" || !match || !UUID.test(match[2].toLowerCase()) ||
      (match[1] === "1") !== (match[5] === undefined)) {
    throw new Error("Dedicated DELL worker rejects non-wake job");
  }
  const conversationId = match[2].toLowerCase();
  const eventId = match[3].toLowerCase();
  const challenge = match[4].toLowerCase();
  const metadata = work.metadata;
  if (!record(metadata) || metadata.assignedClientId !== workerId ||
      metadata.targetConversationId !== conversationId || metadata.eventId !== eventId ||
      metadata.assistantAttestationChallenge !== challenge || metadata.capability !== "chatgpt:wake" ||
      metadata.explicitWorkerTarget !== true || metadata.devOnly !== true ||
      metadata.source !== "authorized-dev-browser-wake" || !matches(OWNER, metadata.conversationId)) {
    throw new Error("Wake binding mismatch");
  }
  const entries = localBindings(config);
  const bound = Object.hasOwn(metadata, "wakeBinding");
  let selected;
  let wakeBinding;
  if (bound) {
    wakeBinding = metadata.wakeBinding;
    if (!validBinding(wakeBinding) || !matches(DIGEST, wakeBinding.bindingFingerprint) ||
        wakeBinding.accountAlias === "GPT01" || wakeBinding.ownerChannel !== metadata.conversationId ||
        wakeBinding.targetConversationId !== conversationId) {
      throw new Error("Invalid command wake binding");
    }
    selected = entries.find(entry => !entry.legacy && entry.enabled &&
      ["accountAlias", "ownerChannel", "targetConversationId", "workerId", "browserProfile"]
        .every(field => entry[field] === wakeBinding[field]));
  } else {
    selected = entries.find(entry => entry.legacy && entry.enabled &&
      entry.ownerChannel === metadata.conversationId && entry.targetConversationId === conversationId);
  }
  if (!selected) throw new Error("Exact local DEV wake binding not enabled");
  if (assistantChallenge(metadata, wakeBinding?.bindingFingerprint) !== challenge) {
    throw new Error("Wake challenge does not match binding");
  }
  return { instruction, conversationId, eventId, challenge, metadata,
    browserProfile: selected.browserProfile, wakeBinding,
    attestationVersion: bound ? 2 : 1 };
}

function loadRuntime() {
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
  return { root, helper, settings, base, python };
}

async function request(runtime, route, payload) {
  const { base, settings } = runtime;
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
export function execute(work, runtime) {
  const { root, helper, python } = runtime;
  const readPairings = runtime.readPairings || (() => JSON.parse(fs.readFileSync(path.join(root, "dell-chatgpt-wake-allowlist.json"), "utf8")));
  let context;
  try { context = resolveWorkBinding(work, readPairings()); }
  catch (error) {
    return { ok: false, message: String(error.message).slice(0, 160), details: { reason: "binding_mismatch" } };
  }
  const { instruction, conversationId, eventId, challenge, metadata, browserProfile, wakeBinding, attestationVersion } = context;
  const env = {
    ...process.env,
    AI_CORE_DEV_WAKE_WORKER_ID: workerId,
    AI_CORE_DEV_WAKE_KEY_ID: keyId,
    AI_CORE_DEV_WAKE_ALLOWLIST_FILE: "dell-chatgpt-wake-allowlist.json",
    AI_CORE_DEV_WAKE_PRIVATE_KEY_FILE: "dell-chatgpt-wake-attestation-ed25519.pem",
    AI_CORE_OPENCLAW_CMD: path.join(process.env.LOCALAPPDATA || path.dirname(root), "OpenClaw", "deps", "portable-node", "openclaw.cmd"),
    AI_CORE_DEV_WAKE_BROWSER_PROFILE: browserProfile,
  };
  const run = (runtime.spawn || spawnSync)(python, [helper], {
    input: JSON.stringify({ instruction, workerId, metadata }),
    encoding: "utf8",
    windowsHide: true,
    // Native bound observation includes one passive capture; preserve GPT01's
    // existing cap. The nominal 60s margin within a 300s claim is reduced by
    // claim-response and preparation overhead; callback acceptance is separate.
    timeout: wakeBinding ? 240_000 : 180_000,
    maxBuffer: 2 * 1024 * 1024,
    env,
  });
  let receipt = null;
  try { receipt = JSON.parse(String(run.stdout || "").trim()); } catch {}
  const verified = run.status === 0 && receipt?.ok === true &&
    receipt?.verifiedAssistantReply === true &&
    receipt?.browserConfirmed === true &&
    receipt?.browserPairingVerified === true &&
    receipt?.chatgptSubmitted === true &&
    receipt?.conversationId === conversationId &&
    receipt?.eventId === eventId &&
    receipt?.challenge === challenge &&
    receipt?.browserProfile === browserProfile &&
    receipt?.attestation?.version === attestationVersion &&
    receipt?.attestation?.algorithm === "Ed25519" &&
    matches(UUID, receipt?.attestation?.assistantMessageId) && matches(DIGEST, receipt?.attestation?.assistantResponseHash) &&
    matches(/^[A-Za-z0-9+/]{86}==$/, receipt?.attestation?.signature) &&
    receipt?.attestation?.workerId === workerId && receipt?.attestation?.keyId === keyId &&
    receipt?.attestation?.conversationId === conversationId &&
    receipt?.attestation?.eventId === eventId && receipt?.attestation?.challenge === challenge &&
    (wakeBinding ? (
      receipt?.bindingFingerprint === wakeBinding.bindingFingerprint &&
      receipt?.attestation?.bindingFingerprint === wakeBinding.bindingFingerprint &&
      receipt?.attestation?.browserProfile === browserProfile &&
      typeof receipt?.assistantResponseText === "string" && receipt.assistantResponseText.length > 0 &&
      receipt.assistantResponseText.length <= 4000 &&
      receipt.assistantResponseText === receipt?.attestation?.assistantResponseText &&
      createHash("sha256").update(receipt.assistantResponseText, "utf8").digest("hex") === receipt.attestation.assistantResponseHash
    ) : (receipt?.bindingFingerprint === undefined && receipt?.attestation?.bindingFingerprint === undefined &&
      receipt?.attestation?.browserProfile === undefined));
  const assistantResponseText = verified && typeof receipt?.assistantResponseText === "string"
    ? (wakeBinding ? receipt.assistantResponseText : receipt.assistantResponseText.trim().slice(0, 4000))
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
      browserProfile,
      ...(wakeBinding ? { wakeBinding, bindingFingerprint: wakeBinding.bindingFingerprint } : {}),
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
      browserProfile,
      attestation: null,
      exitCode: run.status ?? 1,
      reason: receipt?.message || "Browser verification failed",
    },
  };
}

export async function runWorker() {
  const runtime = loadRuntime();
  while (true) {
    try {
      await request(runtime, "/ai/agent-runtime/presence/" + encodeURIComponent(workerId) + "/heartbeat",
        { health: "healthy", version: "dell-wake-executor-3" });
      const work = await request(runtime, "/ai/agent-runtime/work/claim", { clientId: workerId, leaseSeconds: 300 });
      if (work?.commandId && work?.claimToken) {
        let answer;
        try { answer = execute(work, runtime); }
        catch (error) { answer = { ok: false, message: "Worker execution failed", details: { errorType: error?.name || "Error" } }; }
        let delivered = false;
        for (let attempt = 1; attempt <= 8; attempt++) {
          try {
            await request(runtime, "/ai/agent-runtime/work/" + encodeURIComponent(work.commandId) + "/result", {
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runWorker();

