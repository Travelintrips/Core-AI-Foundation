import { createHash } from "node:crypto";

export const DEV_WAKE_DEFAULT_WORKER = "openclaw-travelintrips-dev" as const;
export const DEV_WAKE_DELL_WORKER = "openclaw-dell-chatgpt-wake-dev" as const;
export const DEV_WAKE_PCHP_WORKER = "openclaw-pchp-dev" as const;
export const DEV_WAKE_PC2_WORKER = "openclaw-pc-worker-2" as const;
export const DEV_WAKE_VMSC_WORKER = "openclaw-vmsc-chatgpt-wake-dev" as const;
export type DevWakeWorker = typeof DEV_WAKE_DEFAULT_WORKER | typeof DEV_WAKE_DELL_WORKER | typeof DEV_WAKE_PCHP_WORKER | typeof DEV_WAKE_PC2_WORKER | typeof DEV_WAKE_VMSC_WORKER;
const OWNER = /^ai-engine-oauth:[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;
export const DEV_WAKE_BROWSER_PROFILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export type DevWakeBinding = {
  version: 1;
  accountAlias: string;
  ownerChannel: string;
  targetConversationId: string;
  workerId: DevWakeWorker;
  browserProfile: string;
  bindingFingerprint: string;
};
export type DevWakeTarget = {
  ownerChannel: string;
  targetConversationId: string;
  workerId: DevWakeWorker;
  wakeBinding?: DevWakeBinding;
};
export type DevWakeRuntimeConfig = {
  enabled: boolean;
  legacyTargets: DevWakeTarget[];
  bindings: DevWakeBinding[];
  bindingConfigInvalid: boolean;
  attestationPublicKeyDerB64?: string;
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function isTrustedDevWakeRequestHost(requestHost?: string): boolean {
  const host = requestHost?.trim().toLowerCase().replace(/:\d+$/, "") ?? "";
  return host === "dev-aicore.cstlogistic.co.id" || host === "dev.cstlogistic.co.id";
}
export function isDevWakeRuntime(requestHost?: string): boolean {
  return process.env["APP_ENV"] === "development" || isTrustedDevWakeRequestHost(requestHost);
}

/**
 * Stable account identity. Worker/profile are runtime session locations and must
 * not change the account fingerprint when the same ChatGPT account moves PCs.
 */
export function devWakeBindingFingerprint(binding: Omit<DevWakeBinding, "bindingFingerprint">): string {
  return createHash("sha256").update([
    "dev-chatgpt-account-binding/v2", binding.accountAlias, binding.ownerChannel,
    binding.targetConversationId,
  ].join("|")).digest("hex");
}

function validTuple(value: Record<string, unknown>): boolean {
  return ["accountAlias", "ownerChannel", "targetConversationId", "browserProfile"].every(key =>
    typeof value[key] === "string" && value[key].trim() === value[key]) &&
    value["version"] === 1 && typeof value["accountAlias"] === "string" &&
    /^GPT[0-9]{2,4}$/.test(value["accountAlias"]) && value["accountAlias"] !== "GPT01" &&
    typeof value["ownerChannel"] === "string" && OWNER.test(value["ownerChannel"]) &&
    typeof value["targetConversationId"] === "string" && UUID.test(value["targetConversationId"]) &&
    (value["workerId"] === DEV_WAKE_DELL_WORKER || value["workerId"] === DEV_WAKE_DEFAULT_WORKER || value["workerId"] === DEV_WAKE_PCHP_WORKER || value["workerId"] === DEV_WAKE_PC2_WORKER || value["workerId"] === DEV_WAKE_VMSC_WORKER) &&
    typeof value["browserProfile"] === "string" && DEV_WAKE_BROWSER_PROFILE.test(value["browserProfile"]);
}

/** Untrusted metadata is never a configuration source or a profile fallback. */
export function readDevWakeBinding(value: unknown): DevWakeBinding | null {
  if (!record(value) || !validTuple(value) || typeof value["bindingFingerprint"] !== "string" ||
      !DIGEST.test(value["bindingFingerprint"])) return null;
  const binding = value as DevWakeBinding;
  return devWakeBindingFingerprint(binding) === binding.bindingFingerprint ? { ...binding } : null;
}

/** Reserve GPT01 and every existing owner of its one target/profile. */
export function parseDevWakeAccountBindings(raw: string | undefined, legacy: DevWakeTarget | DevWakeTarget[] | null): DevWakeBinding[] {
  if (!raw?.trim()) return [];
  const legacyTargets = Array.isArray(legacy) ? legacy : legacy ? [legacy] : [];
  const config: unknown = JSON.parse(raw);
  if (!record(config) || config["version"] !== 1 || !Array.isArray(config["bindings"]) ||
      config["bindings"].length > 16 || Object.keys(config).some(key => !["version", "bindings"].includes(key))) {
    throw new Error("DEV_CHATGPT_BINDING_CONFIG_INVALID");
  }
  const active: DevWakeBinding[] = [];
  const aliasToOwner = new Map<string, string>();
  const ownerToAlias = new Map<string, string>();
  const targetToAlias = new Map<string, string>();
  const sessionKeys = new Set<string>();
  for (const row of config["bindings"]) {
    if (!record(row) || typeof row["enabled"] !== "boolean" ||
        Object.keys(row).some(key => !["accountAlias", "ownerChannel", "targetConversationId", "workerId", "browserProfile", "enabled"].includes(key)) ||
        !validTuple({ ...row, version: 1 })) throw new Error("DEV_CHATGPT_BINDING_CONFIG_INVALID");
    const tuple = { version: 1, accountAlias: row["accountAlias"], ownerChannel: row["ownerChannel"],
      targetConversationId: row["targetConversationId"], workerId: row["workerId"], browserProfile: row["browserProfile"] } as Omit<DevWakeBinding, "bindingFingerprint">;
    if (legacyTargets.some(target => tuple.ownerChannel === target.ownerChannel || tuple.targetConversationId === target.targetConversationId) ||
        (tuple.browserProfile.toLowerCase() === "openclaw" && tuple.workerId !== DEV_WAKE_PCHP_WORKER)) throw new Error("DEV_CHATGPT_BINDING_LEGACY_CONFLICT");

    // A stable account can have concurrent, independently verified sessions
    // on different workers and target conversations. Never merge different
    // owners under one alias or allow one conversation to route twice.
    const aliasOwner = aliasToOwner.get(tuple.accountAlias);
    const ownerAlias = ownerToAlias.get(tuple.ownerChannel);
    if ((aliasOwner && aliasOwner !== tuple.ownerChannel) ||
        (ownerAlias && ownerAlias !== tuple.accountAlias) ||
        targetToAlias.has(tuple.targetConversationId)) {
      throw new Error("DEV_CHATGPT_BINDING_CONFLICT");
    }
    aliasToOwner.set(tuple.accountAlias, tuple.ownerChannel);
    ownerToAlias.set(tuple.ownerChannel, tuple.accountAlias);
    targetToAlias.set(tuple.targetConversationId, tuple.accountAlias);

    // A browser profile is local to a worker. Reusing the same worker/profile
    // for two account identities would make account proof ambiguous.
    const sessionKey = tuple.workerId + "|" + tuple.browserProfile.toLowerCase();
    if (sessionKeys.has(sessionKey)) throw new Error("DEV_CHATGPT_BINDING_CONFLICT");
    sessionKeys.add(sessionKey);

    if (row["enabled"]) active.push({ ...tuple, bindingFingerprint: devWakeBindingFingerprint(tuple) });
  }
  return active;
}

async function loadCentralDevWakeSettings(requestHost?: string): Promise<Record<string, string>> {
  if (!isDevWakeRuntime(requestHost)) return {};
  try {
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`
      SELECT key, value FROM ai_platform.ai_settings
      WHERE is_secret IS FALSE AND category = 'guardrail' AND key IN (
        'dev.chatgpt_wake.enabled', 'dev.chatgpt_wake.owner_channel',
        'dev.chatgpt_wake.gpt01_conversation_id', 'dev.chatgpt_wake.worker_id',
        'dev.chatgpt_wake.dell_attestation_public_key_der_b64', 'dev.chatgpt_wake.account_bindings'
      )
    `);
    const settings: Record<string, string> = {};
    for (const raw of result.rows ?? []) {
      if (record(raw) && typeof raw["key"] === "string" && typeof raw["value"] === "string") settings[raw["key"]] = raw["value"];
    }
    return settings;
  } catch { return {}; }
}

/** Read revocable gates on every boundary; never write settings or register accounts. */
export async function loadDevWakeRuntimeConfig(requestHost?: string): Promise<DevWakeRuntimeConfig> {
  const central = await loadCentralDevWakeSettings(requestHost);
  const setting = (env: string, key: string): string => process.env[env]?.trim() || central[key]?.trim() || "";
  const channels = [...new Set(setting("AI_CORE_DEV_BROWSER_WAKE_CHANNELS", "dev.chatgpt_wake.owner_channel").split(",").map(x => x.trim()).filter(Boolean))];
  const conversations = setting("AI_CORE_DEV_BROWSER_WAKE_CONVERSATIONS", "dev.chatgpt_wake.gpt01_conversation_id").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  const configuredWorker = setting("AI_CORE_DEV_BROWSER_WAKE_WORKER_ID", "dev.chatgpt_wake.worker_id") || DEV_WAKE_DEFAULT_WORKER;
  if (configuredWorker !== DEV_WAKE_DEFAULT_WORKER && configuredWorker !== DEV_WAKE_DELL_WORKER && configuredWorker !== DEV_WAKE_PC2_WORKER && configuredWorker !== DEV_WAKE_VMSC_WORKER) throw new Error("DEV_CHATGPT_WAKE_WORKER_INVALID");
  const aliasTarget = process.env["AI_CORE_DEV_CHATGPT_ALIAS_GPT01_CONVERSATION_ID"]?.trim().toLowerCase();
  // Existing owners may share GPT01. Preserve each exact owner, but never expand multiple targets.
  const legacyTargets: DevWakeTarget[] = channels.length > 0 && conversations.length === 1 &&
    channels.every(channel => OWNER.test(channel)) && UUID.test(conversations[0]!) && (!aliasTarget || aliasTarget === conversations[0])
    ? channels.map(ownerChannel => ({ ownerChannel, targetConversationId: conversations[0]!, workerId: configuredWorker })) : [];
  let bindings: DevWakeBinding[] = [];
  let bindingConfigInvalid = false;
  try {
    bindings = parseDevWakeAccountBindings(setting("AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON", "dev.chatgpt_wake.account_bindings"), legacyTargets);
    // Do not activate additions if the protected baseline cannot be identified.
    if (bindings.length && !legacyTargets.length) { bindings = []; bindingConfigInvalid = true; }
  } catch { bindingConfigInvalid = true; }
  return {
    enabled: isDevWakeRuntime(requestHost) && setting("AI_CORE_DEV_BROWSER_WAKE_ENABLED", "dev.chatgpt_wake.enabled") === "true",
    legacyTargets, bindings, bindingConfigInvalid,
    attestationPublicKeyDerB64: setting("AI_CORE_DEV_DELL_ASSISTANT_ATTESTATION_PUBLIC_KEY_DER_B64", "dev.chatgpt_wake.dell_attestation_public_key_der_b64") || undefined,
  };
}

export function resolveConfiguredDevWakeTargets(config: DevWakeRuntimeConfig, input: {
  ownerChannel: string; targetConversationId: string;
}): DevWakeTarget[] {
  if (!config.enabled || typeof input.ownerChannel !== "string" || input.ownerChannel.length !== 80 || !OWNER.test(input.ownerChannel) ||
      typeof input.targetConversationId !== "string" || input.targetConversationId.length !== 36 || !UUID.test(input.targetConversationId.toLowerCase())) return [];
  const target = input.targetConversationId.toLowerCase();
  const legacy = config.legacyTargets.filter(value => value.ownerChannel === input.ownerChannel && value.targetConversationId === target);
  const bound = config.bindings
    .filter(binding => binding.ownerChannel === input.ownerChannel && binding.targetConversationId === target)
    .map(wakeBinding => ({ ownerChannel: wakeBinding.ownerChannel, targetConversationId: target,
      workerId: wakeBinding.workerId, wakeBinding }));
  return [...legacy, ...bound];
}

export function resolveConfiguredDevWakeTarget(config: DevWakeRuntimeConfig, input: {
  ownerChannel: string; targetConversationId: string; bindingFingerprint?: string;
}): DevWakeTarget | null {
  const targets = resolveConfiguredDevWakeTargets(config, input);
  if (input.bindingFingerprint) {
    return targets.find(target => target.wakeBinding?.bindingFingerprint === input.bindingFingerprint) ?? null;
  }
  return targets.length === 1 ? targets[0]! : null;
}

export function commandMatchesDevWakeTarget(metadata: unknown, target: DevWakeTarget): boolean {
  if (!record(metadata) || metadata["conversationId"] !== target.ownerChannel ||
      metadata["targetConversationId"] !== target.targetConversationId || metadata["assignedClientId"] !== target.workerId ||
      metadata["capability"] !== "chatgpt:wake" || metadata["explicitWorkerTarget"] !== true) return false;
  if (!target.wakeBinding) return metadata["wakeBinding"] === undefined;
  const binding = readDevWakeBinding(metadata["wakeBinding"]);
  return !!binding &&
    binding.bindingFingerprint === target.wakeBinding.bindingFingerprint &&
    binding.accountAlias === target.wakeBinding.accountAlias &&
    binding.ownerChannel === target.wakeBinding.ownerChannel &&
    binding.targetConversationId === target.wakeBinding.targetConversationId &&
    binding.workerId === target.wakeBinding.workerId &&
    binding.browserProfile === target.wakeBinding.browserProfile;
}

export async function allowedDevWakeOwners(requestHost?: string): Promise<string[]> {
  try {
    const config = await loadDevWakeRuntimeConfig(requestHost);
    return config.enabled ? [...config.legacyTargets.map(target => target.ownerChannel), ...config.bindings.map(binding => binding.ownerChannel)] : [];
  } catch { return []; }
}

/** Historical progress needs exact ownership, not a dispatch permission or active wake flag. */
export function isOwnedDevWakeProgressCommand(command: { source: string; commandType: string; metadataJson: unknown }, ownerChannel: string): boolean {
  const metadata = command.metadataJson;
  if (ownerChannel.length !== 80 || !OWNER.test(ownerChannel) || command.source !== "ai-core" || command.commandType !== "EXTERNAL_AGENT_WORK" ||
      !record(metadata) || (metadata["assignedClientId"] !== DEV_WAKE_DELL_WORKER && metadata["assignedClientId"] !== DEV_WAKE_DEFAULT_WORKER && metadata["assignedClientId"] !== DEV_WAKE_PCHP_WORKER && metadata["assignedClientId"] !== DEV_WAKE_PC2_WORKER && metadata["assignedClientId"] !== DEV_WAKE_VMSC_WORKER) ||
      metadata["conversationId"] !== ownerChannel || metadata["devOnly"] !== true ||
      metadata["capability"] !== "chatgpt:wake" || metadata["explicitWorkerTarget"] !== true ||
      typeof metadata["targetConversationId"] !== "string" || metadata["targetConversationId"].length !== 36 || !UUID.test(metadata["targetConversationId"]) ||
      typeof metadata["eventId"] !== "string" || metadata["eventId"].length !== 64 || !DIGEST.test(metadata["eventId"]) ||
      typeof metadata["assistantAttestationChallenge"] !== "string" || metadata["assistantAttestationChallenge"].length !== 64 || !DIGEST.test(metadata["assistantAttestationChallenge"])) return false;
  if (metadata["wakeBinding"] === undefined) return true;
  const binding = readDevWakeBinding(metadata["wakeBinding"]);
  return !!binding && binding.ownerChannel === ownerChannel && binding.targetConversationId === metadata["targetConversationId"] && binding.workerId === metadata["assignedClientId"];
}
