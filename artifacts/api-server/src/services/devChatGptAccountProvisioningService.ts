import {
  DEV_WAKE_DELL_WORKER,
  DEV_WAKE_DEFAULT_WORKER,
  DEV_WAKE_PCHP_WORKER,
  DEV_WAKE_PC2_WORKER,
  DEV_WAKE_VMSC_WORKER,
  DEV_WAKE_BROWSER_PROFILE,
  devWakeBindingFingerprint,
  parseDevWakeAccountBindings,
  type DevWakeTarget,
  type DevWakeWorker,
} from "./devChatGptWakeBindingService.js";

const OWNER = /^ai-engine-oauth:[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

type StoredBindingRow = {
  accountAlias: string;
  ownerChannel: string;
  targetConversationId: string;
  workerId: DevWakeWorker;
  browserProfile: string;
  enabled: boolean;
};

type BindingRegistry = {
  version: 1;
  bindings: StoredBindingRow[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRegistry(raw: string | undefined): BindingRegistry {
  if (!raw?.trim()) return { version: 1, bindings: [] };
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed["version"] !== 1 || !Array.isArray(parsed["bindings"])) {
    throw new Error("DEV_CHATGPT_PROVISIONING_REGISTRY_INVALID");
  }
  return {
    version: 1,
    bindings: parsed["bindings"].map((row) => {
      if (!isRecord(row)) throw new Error("DEV_CHATGPT_PROVISIONING_REGISTRY_INVALID");
      return row as unknown as StoredBindingRow;
    }),
  };
}

function normalizeAlias(value: string | undefined, registry: BindingRegistry): string {
  if (value?.trim()) {
    const alias = value.trim().toUpperCase();
    if (!/^GPT[0-9]{2,4}$/.test(alias) || alias === "GPT01") {
      throw new Error("DEV_CHATGPT_PROVISIONING_ALIAS_INVALID");
    }
    return alias;
  }
  const used = new Set(["GPT01", ...registry.bindings.map((row) => row.accountAlias)]);
  for (let number = 2; number <= 9999; number += 1) {
    const alias = "GPT" + String(number).padStart(2, "0");
    if (!used.has(alias)) return alias;
  }
  throw new Error("DEV_CHATGPT_PROVISIONING_ALIAS_EXHAUSTED");
}

export type StageDevChatGptAccountInput = {
  accountAlias?: string;
  ownerChannel: string;
  targetConversationId: string;
  browserProfile?: string;
  workerId?: DevWakeWorker;
};

export type StageDevChatGptAccountResult = {
  accountAlias: string;
  ownerChannel: string;
  targetConversationId: string;
  workerId: DevWakeWorker;
  browserProfile: string;
  bindingFingerprint: string;
  enabled: false;
  registryJson: string;
  alreadyStaged: boolean;
};

export function stageDevChatGptAccountBinding(input: StageDevChatGptAccountInput, rawRegistry: string | undefined, legacyTargets: DevWakeTarget[]): StageDevChatGptAccountResult {
  const registry = parseRegistry(rawRegistry);
  // Validate the entire stored registry before any idempotent early return.
  // Disabled rows are still authorization data and must fail closed if malformed.
  parseDevWakeAccountBindings(JSON.stringify(registry), legacyTargets);
  const ownerChannel = input.ownerChannel.trim();
  const targetConversationId = input.targetConversationId.trim().toLowerCase();
  if (!OWNER.test(ownerChannel)) throw new Error("DEV_CHATGPT_PROVISIONING_OWNER_INVALID");
  if (!UUID.test(targetConversationId)) throw new Error("DEV_CHATGPT_PROVISIONING_CONVERSATION_INVALID");

  const existingByOwner = registry.bindings.find((row) => row.ownerChannel === ownerChannel);
  const accountAlias = normalizeAlias(input.accountAlias ?? existingByOwner?.accountAlias, registry);
  const workerId = input.workerId ?? existingByOwner?.workerId ?? DEV_WAKE_DELL_WORKER;
  if (workerId !== DEV_WAKE_DELL_WORKER && workerId !== DEV_WAKE_DEFAULT_WORKER && workerId !== DEV_WAKE_PCHP_WORKER && workerId !== DEV_WAKE_PC2_WORKER && workerId !== DEV_WAKE_VMSC_WORKER) {
    throw new Error("DEV_CHATGPT_PROVISIONING_WORKER_INVALID");
  }
  const browserProfile = (input.browserProfile?.trim() || existingByOwner?.browserProfile || ("openclaw-" + accountAlias.toLowerCase()));
  if (!DEV_WAKE_BROWSER_PROFILE.test(browserProfile) || (browserProfile.toLowerCase() === "openclaw" && workerId !== DEV_WAKE_PCHP_WORKER)) {
    throw new Error("DEV_CHATGPT_PROVISIONING_PROFILE_INVALID");
  }

  const exact = registry.bindings.find((row) =>
    row.accountAlias === accountAlias &&
    row.ownerChannel === ownerChannel &&
    row.targetConversationId === targetConversationId &&
    row.workerId === workerId &&
    row.browserProfile === browserProfile
  );

  if (exact) {
    const tuple = {
      version: 1 as const,
      accountAlias,
      ownerChannel,
      targetConversationId,
      workerId,
      browserProfile,
    };
    return {
      ...tuple,
      bindingFingerprint: devWakeBindingFingerprint(tuple),
      enabled: false,
      registryJson: JSON.stringify(registry),
      alreadyStaged: true,
    };
  }

  const replacement = {
    accountAlias,
    ownerChannel,
    targetConversationId,
    workerId,
    browserProfile,
    enabled: false,
  };
  // Re-provisioning the same target moves that session, preserving migration
  // semantics. A different target gets its own disabled session without
  // disabling the existing DELL account binding.
  const existingIdentityIndex = registry.bindings.findIndex((row) =>
    row.targetConversationId === targetConversationId
  );
  const nextBindings = [...registry.bindings];
  if (existingIdentityIndex >= 0) nextBindings[existingIdentityIndex] = replacement;
  else nextBindings.push(replacement);
  const next: BindingRegistry = { version: 1, bindings: nextBindings };

  // Every session is independently revalidated; a new target does not
  // replace an already activated session for the same account.
  parseDevWakeAccountBindings(JSON.stringify(next), legacyTargets);

  const tuple = {
    version: 1 as const,
    accountAlias,
    ownerChannel,
    targetConversationId,
    workerId,
    browserProfile,
  };
  return {
    ...tuple,
    bindingFingerprint: devWakeBindingFingerprint(tuple),
    enabled: false,
    registryJson: JSON.stringify(next),
    alreadyStaged: false,
  };
}
