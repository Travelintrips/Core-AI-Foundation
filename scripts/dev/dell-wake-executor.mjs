import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const workerId = "openclaw-dell-chatgpt-wake-dev";
const keyId = "openclaw-dell-chatgpt-wake-dev-ed25519-v1";
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const OWNER = /^ai-engine-oauth:[a-f0-9]{64}$/;
const PROFILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ALIAS = /^GPT[0-9]{2,4}$/;

// Matched to the native transport's 1950s phase envelope plus 30s for
// initialization, signing and receipt teardown. Renewals never extend this.
export const BOUND_HELPER_MAX_RUN_MS = 1_980_000;
export const BOUND_LEASE_SECONDS = 300;
export const BOUND_LEASE_MARGIN_MS = 25_000;
export const BOUND_RENEW_INTERVAL_MS = 60_000;
const BOUND_RENEW_RETRY_MS = 5_000;
const BOUND_CHILD_EXIT_GRACE_MS = 5_000;
const BOUND_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

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

async function request(runtime, route, payload, options = {}) {
  const { base, settings } = runtime;
  const response = await fetch(base + route, {
    method: "POST",
    headers: { Authorization: "Bearer " + settings.AI_CORE_SCOPED_AGENT_TOKEN, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  });
  if (response.status === 204) return null;
  if (!response.ok) {
    const error = new Error("AI Core HTTP " + response.status);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
function helperEnvironment(root, browserProfile) {
  return {
    ...process.env,
    AI_CORE_DEV_WAKE_WORKER_ID: workerId,
    AI_CORE_DEV_WAKE_KEY_ID: keyId,
    AI_CORE_DEV_WAKE_ALLOWLIST_FILE: "dell-chatgpt-wake-allowlist.json",
    AI_CORE_DEV_WAKE_PRIVATE_KEY_FILE: "dell-chatgpt-wake-attestation-ed25519.pem",
    AI_CORE_OPENCLAW_CMD: path.join(process.env.LOCALAPPDATA || path.dirname(root), "OpenClaw", "deps", "portable-node", "openclaw.cmd"),
    AI_CORE_DEV_WAKE_BROWSER_PROFILE: browserProfile,
  };
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
  const env = helperEnvironment(root, browserProfile);
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
  return executionAnswer(context, run);
}

function executionAnswer(context, run) {
  const { conversationId, eventId, challenge, browserProfile, wakeBinding, attestationVersion } = context;
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

/** A local lease may expire irreversibly even if a late server renewal succeeds. */
export class BoundClaimLease {
  constructor(work, runtime) {
    if (!matches(UUID, work.commandId) || !matches(UUID, work.claimToken)) throw new Error("Bound claim identity invalid");
    this.work = work;
    this.runtime = runtime;
    this.http = runtime.request || request;
    this.now = runtime.monotonic || (() => performance.now());
    this.wall = runtime.wallClock || (() => Date.now());
    this.setTimer = runtime.setTimer || setTimeout;
    this.clearTimer = runtime.clearTimer || clearTimeout;
    this.abort = new AbortController();
    this.active = true;
    this.sequence = 0;
    this.expiresAt = 0;
    this.failure = null;
    this.onGrant = null;
    this.onInvalidation = null;
    this.presenceEnabled = false;
    this.presencePending = false;
    this.inactive = new Promise(resolve => { this.resolveInactive = resolve; });
  }

  async start() {
    await this.renew(true);
    if (!this.usable()) throw new Error(this.failure || "Initial bound lease unavailable");
    return this;
  }

  usable() {
    if (this.active && this.expiresAt > 0 && this.now() >= this.expiresAt) this.invalidate("lease_expired");
    return this.active && this.expiresAt > this.now();
  }

  grant() {
    if (!this.usable()) throw new Error("Bound lease unavailable");
    // The helper validates this same-host timestamp's age and subtracts it
    // before starting its own monotonic deadline. Queued grants buy no time.
    return { sequence: this.sequence, issuedAtUtcMs: this.wall(), validForMs: Math.floor(this.expiresAt - this.now()) };
  }

  scheduleRenew(delay) {
    this.clearTimer(this.renewTimer);
    if (this.active) this.renewTimer = this.setTimer(() => { void this.renew(false); }, delay);
  }

  scheduleExpiry() {
    this.clearTimer(this.expiryTimer);
    if (this.active) this.expiryTimer = this.setTimer(() => {
      if (this.usable()) this.scheduleExpiry();
    }, Math.max(0, this.expiresAt - this.now()));
  }

  async renew(initial = false) {
    if (!this.active || this.renewing || (!initial && !this.usable())) return;
    this.renewing = true;
    const startedAt = this.now();
    try {
      const response = await this.http(this.runtime,
        "/ai/agent-runtime/work/" + encodeURIComponent(this.work.commandId) + "/renew",
        { clientId: workerId, claimToken: this.work.claimToken, leaseSeconds: BOUND_LEASE_SECONDS },
        { signal: this.abort.signal });
      // The server's renewal UPDATE does not reject an expired lease itself.
      // Never revive a locally expired or explicitly cancelled execution.
      if (!this.active || (!initial && !this.usable())) return;
      if (!record(response) || response.renewed !== true || Object.keys(response).length !== 1) {
        this.invalidate("lease_renewal_unconfirmed");
        return;
      }
      const expiresAt = startedAt + BOUND_LEASE_SECONDS * 1000 - BOUND_LEASE_MARGIN_MS;
      if (this.now() >= expiresAt) {
        this.invalidate("lease_renewal_too_late");
        return;
      }
      this.expiresAt = expiresAt;
      if (!initial) {
        this.sequence += 1;
        try { this.onGrant?.({ type: "lease", commandId: this.work.commandId, ...this.grant() }); }
        catch { this.invalidate("lease_control_unavailable"); return; }
      }
      this.scheduleExpiry();
      this.scheduleRenew(BOUND_RENEW_INTERVAL_MS);
      // After the helper has exited, its result can still be in flight.
      // Presence remains active, while no further child grant is written.
      if (!initial && !this.onGrant) void this.pulsePresence();
    } catch (error) {
      if (!this.active || (!initial && !this.usable())) return;
      if ([401, 403, 409].includes(error?.status)) this.invalidate("claim_revoked");
      else if (initial) this.invalidate("initial_lease_unavailable");
      else this.scheduleRenew(Math.min(BOUND_RENEW_RETRY_MS, Math.max(0, this.expiresAt - this.now())));
    } finally { this.renewing = false; }
  }

  invalidate(reason) {
    if (!this.active) return;
    this.failure = reason;
    this.stop();
    this.onInvalidation?.(reason);
  }

  async pulsePresence() {
    if (!this.presenceEnabled || !this.usable() || this.presencePending) return;
    this.presencePending = true;
    try {
      await this.http(this.runtime, "/ai/agent-runtime/presence/" + encodeURIComponent(workerId) + "/heartbeat",
        { health: "healthy", version: "dell-wake-executor-3", details: { activeJobs: 1, availableSlots: 0 } },
        { signal: this.abort.signal });
    } catch {
      // Presence's 90s lease is separate. Its success or failure never renews
      // command ownership, delays a grant, or bypasses the expiry watchdog.
    } finally { this.presencePending = false; }
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.clearTimer(this.renewTimer);
    this.clearTimer(this.expiryTimer);
    this.abort.abort();
    this.resolveInactive();
  }

  async wait(delay) {
    if (!this.usable()) return false;
    let timer;
    const elapsed = new Promise(resolve => { timer = this.setTimer(() => resolve(true), delay); });
    const result = await Promise.race([elapsed, this.inactive.then(() => false)]);
    this.clearTimer(timer);
    return result && this.usable();
  }
}

function runBoundChild(context, work, runtime, lease) {
  return new Promise(resolve => {
    const { root, helper, python } = runtime;
    const env = helperEnvironment(root, context.browserProfile);
    delete env.AI_CORE_SCOPED_AGENT_TOKEN;
    const metadata = { ...context.metadata };
    delete metadata.claimToken;
    let child;
    let done = false;
    let childExited = false;
    let cancelled = null;
    let hardTimer;
    let exitTimer;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let chunks = [];
    const startedAt = lease.now();
    const settle = result => {
      if (done) return;
      done = true;
      lease.clearTimer(hardTimer);
      lease.clearTimer(exitTimer);
      lease.onGrant = null;
      lease.onInvalidation = null;
      child?.stdin?.destroy();
      chunks = [];
      resolve(result);
    };
    const cancel = reason => {
      if (done || cancelled) return;
      cancelled = reason;
      chunks = [];
      // stdout/stderr can still drain after exit. Latch a failed output guard
      // even then; never accept a retained JSON prefix after discarding bytes.
      if (childExited) return;
      try {
        child?.stdin?.write(JSON.stringify({ type: "revoke", commandId: work.commandId,
          sequence: lease.sequence + 1 }) + "\n");
      } catch {}
      // Node retains the exact spawned process handle. The bound Python
      // process owns a noninheritable KILL_ON_JOB_CLOSE job before any child
      // launch; its death closes that handle and kills only its descendants.
      // No taskkill, PID tree enumeration, Chrome handle or shared process.
      try { child?.kill(); } catch {}
      child?.stdin?.destroy();
      if (!done) exitTimer = lease.setTimer(() => settle({ status: null, stdout: "", stderr: "",
        error: new Error("Owned helper termination unconfirmed"), cancelReason: reason,
        terminationConfirmed: false }), BOUND_CHILD_EXIT_GRACE_MS);
    };
    try {
      child = (runtime.spawnBound || spawn)(python, [helper, "--bound-lease-v1"], {
        windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"], env,
      });
      lease.onInvalidation = cancel;
      lease.onGrant = frame => {
        if (done || childExited || cancelled) return;
        child.stdin.write(JSON.stringify(frame) + "\n", error => {
          if (error) cancel("lease_control_unavailable");
          else void lease.pulsePresence();
        });
      };
      child.on("error", () => cancel("helper_process_unavailable"));
      child.on("exit", () => {
        childExited = true;
        lease.clearTimer(exitTimer);
        exitTimer = lease.setTimer(() => settle({ status: null, stdout: "", stderr: "",
          error: new Error("Owned helper streams did not close"), terminationConfirmed: false }), BOUND_CHILD_EXIT_GRACE_MS);
      });
      child.on("close", code => {
        let output = "";
        if (!cancelled) {
          try { output = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
          catch { cancelled = "helper_output_encoding_invalid"; }
        }
        settle({ status: code, stdout: output, stderr: "", terminationConfirmed: true,
          ...(cancelled ? { error: new Error(cancelled), cancelReason: cancelled } : {}) });
      });
      child.stdin.on("error", () => cancel("lease_control_unavailable"));
      child.stdout.on("error", () => cancel("helper_output_unavailable"));
      child.stderr.on("error", () => cancel("helper_output_unavailable"));
      child.stdout.on("data", value => {
        if (done || cancelled) return;
        const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
        stdoutBytes += bytes.length;
        if (stdoutBytes > BOUND_MAX_OUTPUT_BYTES) cancel("helper_output_limit");
        else chunks.push(bytes);
      });
      child.stderr.on("data", value => {
        stderrBytes += Buffer.byteLength(value);
        if (stderrBytes > BOUND_MAX_OUTPUT_BYTES) cancel("helper_output_limit");
      });
      hardTimer = lease.setTimer(() => cancel("helper_deadline_exceeded"),
        Math.max(0, BOUND_HELPER_MAX_RUN_MS - (lease.now() - startedAt)));
      const envelope = { protocol: "ai-core-native-lease/v1", commandId: work.commandId,
        instruction: context.instruction, workerId, metadata, maxRunMs: BOUND_HELPER_MAX_RUN_MS, lease: lease.grant() };
      child.stdin.write(JSON.stringify(envelope) + "\n", error => {
        if (error) cancel("lease_control_unavailable");
        else {
          lease.presenceEnabled = true;
          void lease.pulsePresence();
        }
      });
    } catch {
      if (child) cancel("helper_process_unavailable");
      else settle({ status: null, stdout: "", stderr: "", error: new Error("Bound helper could not start"), terminationConfirmed: true });
    }
  });
}

function confirmsBoundResult(value, work, answer) {
  const status = answer.ok ? "COMPLETED" : "FAILED";
  const response = value?.response;
  if (!record(value) || value.commandId !== work.commandId || value.status !== status ||
      !record(response) || !matches(UUID, response.id) || response.commandId !== work.commandId ||
      response.kind !== status || response.message !== answer.message.trim() ||
      !record(response.checkpointJson) || response.checkpointJson.status !== status ||
      response.checkpointJson.clientId !== workerId || !record(response.metadataJson)) return false;
  const codes = new Set(["JOB_COMPLETED", "RESULT_VERIFIED", "DELIVERY_SUBMITTED", "DELIVERY_CONFIRMED",
    "CALLBACK_RECEIVED", "E2E_VERIFIED", "FAILED", "UNKNOWN_UNVERIFIED"]);
  if (!["statusCode", "deliveryCode", "e2eCode"].every(key => codes.has(value[key]) &&
      response.checkpointJson[key] === value[key] && response.metadataJson[key] === value[key])) return false;
  // JSON transport drops undefined members; compare every actually submitted
  // detail, including exact bound text/signature, against the committed row.
  const submitted = JSON.parse(JSON.stringify(answer.details));
  return Object.entries(submitted).every(([key, expected]) => isDeepStrictEqual(response.metadataJson[key], expected));
}

async function deliverBoundAnswer(work, runtime, lease, answer) {
  const http = runtime.request || request;
  for (let attempt = 1; attempt <= 8 && lease.usable(); attempt++) {
    try {
      const committed = await http(runtime, "/ai/agent-runtime/work/" + encodeURIComponent(work.commandId) + "/result", {
        clientId: workerId, claimToken: work.claimToken, status: answer.ok ? "COMPLETED" : "FAILED",
        message: answer.message, details: answer.details,
      });
      if (!confirmsBoundResult(committed, work, answer)) {
        lease.invalidate("result_receipt_mismatch");
        return false;
      }
      // A concurrent renew409 can follow this exact transaction's commit.
      // Only its matching durable response resolves that ambiguity.
      lease.stop();
      return true;
    } catch (error) {
      if ([401, 403, 409].includes(error?.status)) {
        lease.invalidate("result_delivery_unconfirmed");
        break;
      }
      if (attempt < 8 && !await lease.wait(Math.min(attempt * 2500, 15_000))) break;
    }
  }
  lease.stop();
  return false;
}

/** Bound jobs keep the exact claim alive through execution and result delivery. */
export async function executeBoundClaim(work, runtime) {
  let context;
  let answer;
  let lease;
  try {
    const readPairings = runtime.readPairings || (() => JSON.parse(fs.readFileSync(path.join(runtime.root,
      "dell-chatgpt-wake-allowlist.json"), "utf8")));
    try {
      context = resolveWorkBinding(work, readPairings());
      if (!context.wakeBinding) throw new Error("Bound worker requires an explicit binding");
    } catch {
      answer = { ok: false, message: "Bound wake binding mismatch", details: { reason: "binding_mismatch" } };
    }
    lease = await new BoundClaimLease(work, runtime).start();
    if (context && !answer) {
      const run = await runBoundChild(context, work, runtime, lease);
      if (!run.terminationConfirmed) {
        lease.stop();
        return { delivered: false, reconciliationRequired: true, reason: "helper_termination_unconfirmed" };
      }
      answer = executionAnswer(context, run);
      if (run.cancelReason) {
        answer.ok = false;
        answer.message = run.cancelReason;
        answer.details.reason = run.cancelReason;
      }
    }
    const delivered = await deliverBoundAnswer(work, runtime, lease, answer);
    return { answer, delivered, reconciliationRequired: !delivered,
      ...(!delivered ? { reason: lease.failure || "result_delivery_unconfirmed" } : {}) };
  } catch {
    lease?.stop();
    return { delivered: false, reconciliationRequired: true, reason: "bound_claim_unavailable" };
  }
}

export async function runWorker() {
  const runtime = loadRuntime();
  while (true) {
    try {
      await request(runtime, "/ai/agent-runtime/presence/" + encodeURIComponent(workerId) + "/heartbeat",
        { health: "healthy", version: "dell-wake-executor-3" });
      const work = await request(runtime, "/ai/agent-runtime/work/claim", { clientId: workerId, leaseSeconds: 300 });
      if (work?.commandId && work?.claimToken) {
        if (record(work.metadata) && Object.hasOwn(work.metadata, "wakeBinding")) {
          const outcome = await executeBoundClaim(work, runtime);
          if (outcome.delivered) console.log("reported command " + work.commandId);
          else {
            console.log("UNDELIVERED " + work.commandId + " reconciliation required");
            // A result/termination ambiguity must not become another claim or
            // a replay of native input. Preserve evidence and stop this loop.
            return;
          }
        } else {
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
      }
    } catch (error) {
      console.log("worker cycle error " + (error?.name || "Error") + " " + String(error?.message || "").slice(0, 100));
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runWorker();

