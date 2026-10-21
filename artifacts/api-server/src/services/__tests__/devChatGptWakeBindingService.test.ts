import { afterEach, describe, expect, it, vi } from "vitest";
import {
  commandMatchesDevWakeTarget, DEV_WAKE_DEFAULT_WORKER, DEV_WAKE_DELL_WORKER, DEV_WAKE_PC2_WORKER, devWakeBindingFingerprint, isOwnedDevWakeProgressCommand,
  parseDevWakeAccountBindings, readDevWakeBinding, resolveConfiguredDevWakeTarget, type DevWakeRuntimeConfig,
} from "../devChatGptWakeBindingService.js";

// Synthetic interop fixture shared with the Python/Node worker tests, never runtime config.
const legacy = { ownerChannel: "ai-engine-oauth:" + "a".repeat(64),
  targetConversationId: "11111111-1111-4111-8111-111111111111", workerId: DEV_WAKE_DELL_WORKER };
const entry = { accountAlias: "GPT02", ownerChannel: "ai-engine-oauth:" + "d".repeat(64),
  targetConversationId: "22222222-2222-4222-8222-222222222222", workerId: DEV_WAKE_DELL_WORKER,
  browserProfile: "travelincars-dev", enabled: true };
const raw = (entries: unknown[] = [entry]) => JSON.stringify({ version: 1, bindings: entries });
afterEach(() => vi.unstubAllEnvs());

describe("exact DEV account binding", () => {
  it("agrees with the worker fingerprint and keeps the legacy pair separate", () => {
    const bindings = parseDevWakeAccountBindings(raw(), legacy);
    expect(bindings[0]!.bindingFingerprint).toBe("4da956549aa62bb6e42bdc4ab13390d2b137d29940e2bb6a89134dfc2f0dbec1");
    const config: DevWakeRuntimeConfig = { enabled: true, legacyTargets: [legacy], bindings, bindingConfigInvalid: false };
    expect(resolveConfiguredDevWakeTarget(config, legacy)).toEqual(legacy);
    expect(resolveConfiguredDevWakeTarget(config, entry)?.wakeBinding).toEqual(bindings[0]);
    expect(resolveConfiguredDevWakeTarget(config, { ...entry, ownerChannel: legacy.ownerChannel })).toBeNull();
    expect(resolveConfiguredDevWakeTarget(config, { ...legacy, ownerChannel: entry.ownerChannel })).toBeNull();
    expect(resolveConfiguredDevWakeTarget({ ...config, enabled: false }, entry)).toBeNull();
  });

  it("is dormant without an explicit enabled exact tuple", () => {
    expect(parseDevWakeAccountBindings(undefined, legacy)).toEqual([]);
    expect(parseDevWakeAccountBindings(raw([{ ...entry, enabled: false }]), legacy)).toEqual([]);
    expect(() => parseDevWakeAccountBindings(raw([{ ...entry, enabled: undefined }]), legacy)).toThrow();
    expect(() => parseDevWakeAccountBindings(raw([{ ...entry, targetConversationId: "" }]), legacy)).toThrow();
    expect(() => parseDevWakeAccountBindings('{"version":2,"bindings":[]}', legacy)).toThrow();
  });

  it.each([
    { accountAlias: "GPT01" }, { ownerChannel: legacy.ownerChannel },
    { targetConversationId: legacy.targetConversationId }, { browserProfile: "OPENCLAW" },
    { workerId: "openclaw-pc-worker-dell-browser" }, { browserProfile: "../Profile 6" },
    { ownerChannel: entry.ownerChannel + "\n" }, { browserProfile: "unsafe|profile" },
  ])("rejects reserved or malformed account data: %j", change => {
    expect(() => parseDevWakeAccountBindings(raw([{ ...entry, ...change }]), legacy)).toThrow();
  });

  it.each(["accountAlias", "ownerChannel", "targetConversationId", "browserProfile"] as const)("rejects duplicate %s even in disabled entries", key => {
    const other = { ...entry, accountAlias: "GPT03", ownerChannel: "ai-engine-oauth:" + "e".repeat(64),
      targetConversationId: "33333333-3333-4333-8333-333333333333", browserProfile: "other-dev", enabled: false,
      [key]: key === "browserProfile" ? entry.browserProfile.toUpperCase() : entry[key] };
    expect(() => parseDevWakeAccountBindings(raw([entry, other]), legacy)).toThrow();
  });

  it("allows multiple verified session locations for the same account identity", () => {
    const backup = { ...entry, workerId: DEV_WAKE_DEFAULT_WORKER, browserProfile: "gpt02-travelintrips" };
    const pc2 = { ...entry, workerId: DEV_WAKE_PC2_WORKER, browserProfile: "gpt02-vmsc" };
    const bindings = parseDevWakeAccountBindings(raw([entry, backup, pc2]), legacy);
    expect(bindings).toHaveLength(3);
    expect(new Set(bindings.map(binding => binding.accountAlias))).toEqual(new Set(["GPT02"]));
    expect(new Set(bindings.map(binding => binding.workerId))).toEqual(new Set([DEV_WAKE_DELL_WORKER, DEV_WAKE_DEFAULT_WORKER, DEV_WAKE_PC2_WORKER]));
    const config: DevWakeRuntimeConfig = { enabled: true, legacyTargets: [legacy], bindings, bindingConfigInvalid: false };
    expect(resolveConfiguredDevWakeTarget(config, entry)).toBeNull();
    expect(resolveConfiguredDevWakeTarget(config, { ...entry, bindingFingerprint: bindings[1]!.bindingFingerprint })?.workerId)
      .toBe(DEV_WAKE_DEFAULT_WORKER);
  });

  it("refuses a profile/fingerprint downgrade and mismatched mirrored fields", () => {
    const wakeBinding = parseDevWakeAccountBindings(raw(), legacy)[0]!;
    const target = { ...entry, wakeBinding };
    const meta = { conversationId: entry.ownerChannel, targetConversationId: entry.targetConversationId,
      assignedClientId: entry.workerId, capability: "chatgpt:wake", explicitWorkerTarget: true, wakeBinding };
    expect(commandMatchesDevWakeTarget(meta, target)).toBe(true);
    expect(commandMatchesDevWakeTarget({ ...meta, wakeBinding: undefined }, target)).toBe(false);
    expect(commandMatchesDevWakeTarget({ ...meta, conversationId: legacy.ownerChannel }, target)).toBe(false);
    expect(readDevWakeBinding({ ...wakeBinding, browserProfile: "other-dev" })).toBeNull();
    const changed = { ...wakeBinding, browserProfile: "other-dev" };
    expect(commandMatchesDevWakeTarget({ ...meta, wakeBinding: { ...changed, bindingFingerprint: devWakeBindingFingerprint(changed) } }, target)).toBe(false);
  });

  it("allows owner-bound historical DELL progress without widening worker dispatch", () => {
    const wakeBinding = parseDevWakeAccountBindings(raw(), legacy)[0]!;
    const command = { source: "ai-core", commandType: "EXTERNAL_AGENT_WORK", metadataJson: {
      conversationId: entry.ownerChannel, targetConversationId: entry.targetConversationId, assignedClientId: entry.workerId,
      eventId: "b".repeat(64), assistantAttestationChallenge: "c".repeat(64),
      capability: "chatgpt:wake", explicitWorkerTarget: true, devOnly: true, wakeBinding,
    } };
    expect(isOwnedDevWakeProgressCommand(command, entry.ownerChannel)).toBe(true);
    expect(isOwnedDevWakeProgressCommand(command, legacy.ownerChannel)).toBe(false);
    for (const change of [{ assignedClientId: "openclaw-pc-worker-dell-browser" }, { capability: "tools:bounded" },
      { devOnly: false }, { explicitWorkerTarget: false }, { targetConversationId: legacy.targetConversationId }]) {
      expect(isOwnedDevWakeProgressCommand({ ...command, metadataJson: { ...command.metadataJson, ...change } }, entry.ownerChannel)).toBe(false);
    }
  });
});
