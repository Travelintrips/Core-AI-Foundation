import { describe, expect, it } from "vitest";
import { stageDevChatGptAccountBinding } from "../devChatGptAccountProvisioningService.js";
import { activateDevChatGptSessionBinding } from "../devChatGptSessionActivationService.js";
import { DEV_WAKE_DELL_WORKER, DEV_WAKE_DEFAULT_WORKER, DEV_WAKE_PCHP_WORKER, DEV_WAKE_PC2_WORKER, DEV_WAKE_VMSC_WORKER, parseDevWakeAccountBindings } from "../devChatGptWakeBindingService.js";

const legacy = [{
  ownerChannel: "ai-engine-oauth:" + "1".repeat(64),
  targetConversationId: "11111111-1111-1111-1111-111111111111",
  workerId: DEV_WAKE_DELL_WORKER,
}];

describe("devChatGptAccountProvisioningService", () => {
  it("auto-allocates GPT02 and a dedicated profile, but keeps the binding disabled", () => {
    const result = stageDevChatGptAccountBinding({
      ownerChannel: "ai-engine-oauth:" + "2".repeat(64),
      targetConversationId: "22222222-2222-2222-2222-222222222222",
    }, undefined, legacy);

    expect(result.accountAlias).toBe("GPT02");
    expect(result.browserProfile).toBe("openclaw-gpt02");
    expect(result.enabled).toBe(false);
    expect(JSON.parse(result.registryJson).bindings[0].enabled).toBe(false);
  });

  it("is idempotent for the same owner/target/profile tuple", () => {
    const first = stageDevChatGptAccountBinding({
      ownerChannel: "ai-engine-oauth:" + "2".repeat(64),
      targetConversationId: "22222222-2222-2222-2222-222222222222",
    }, undefined, legacy);

    const second = stageDevChatGptAccountBinding({
      ownerChannel: first.ownerChannel,
      targetConversationId: first.targetConversationId,
      browserProfile: first.browserProfile,
    }, first.registryJson, legacy);

    expect(second.alreadyStaged).toBe(true);
    expect(second.registryJson).toBe(first.registryJson);
  });

  it("allocates the next free alias", () => {
    const registry = JSON.stringify({
      version: 1,
      bindings: [{
        accountAlias: "GPT02",
        ownerChannel: "ai-engine-oauth:" + "2".repeat(64),
        targetConversationId: "22222222-2222-2222-2222-222222222222",
        workerId: DEV_WAKE_DELL_WORKER,
        browserProfile: "openclaw-gpt02",
        enabled: false,
      }],
    });

    const result = stageDevChatGptAccountBinding({
      ownerChannel: "ai-engine-oauth:" + "3".repeat(64),
      targetConversationId: "33333333-3333-3333-3333-333333333333",
    }, registry, legacy);

    expect(result.accountAlias).toBe("GPT03");
    expect(result.browserProfile).toBe("openclaw-gpt03");
  });

  it("moves the same account identity to a new trusted worker session", () => {
    const first = stageDevChatGptAccountBinding({
      accountAlias: "GPT02",
      ownerChannel: "ai-engine-oauth:" + "2".repeat(64),
      targetConversationId: "22222222-2222-2222-2222-222222222222",
      workerId: DEV_WAKE_DELL_WORKER,
      browserProfile: "admcst001-dev",
    }, undefined, legacy);

    const second = stageDevChatGptAccountBinding({
      accountAlias: "GPT02",
      ownerChannel: first.ownerChannel,
      targetConversationId: first.targetConversationId,
      workerId: DEV_WAKE_DEFAULT_WORKER,
      browserProfile: "gpt02-travelintrips",
    }, first.registryJson, legacy);

    expect(second.workerId).toBe(DEV_WAKE_DEFAULT_WORKER);
    expect(second.accountAlias).toBe("GPT02");
    expect(JSON.parse(second.registryJson).bindings).toHaveLength(1);
    expect(JSON.parse(second.registryJson).bindings[0].enabled).toBe(false);
    expect(second.bindingFingerprint).toBe(first.bindingFingerprint);

    const third = stageDevChatGptAccountBinding({
      accountAlias: "GPT02",
      ownerChannel: first.ownerChannel,
      targetConversationId: first.targetConversationId,
      workerId: DEV_WAKE_PC2_WORKER,
      browserProfile: "gpt02-pc2",
    }, second.registryJson, legacy);
    expect(third.workerId).toBe(DEV_WAKE_PC2_WORKER);
    expect(JSON.parse(third.registryJson).bindings).toHaveLength(1);
    expect(third.bindingFingerprint).toBe(first.bindingFingerprint);
  });

  it("stages PCHP as a distinct worker with a dedicated browser profile without duplicating GPT02", () => {
    const first = stageDevChatGptAccountBinding({
      accountAlias: "GPT02", ownerChannel: "ai-engine-oauth:" + "2".repeat(64),
      targetConversationId: "22222222-2222-2222-2222-222222222222",
      workerId: DEV_WAKE_DELL_WORKER, browserProfile: "travelincars-dev",
    }, undefined, legacy);
    const moved = stageDevChatGptAccountBinding({
      accountAlias: "GPT02", ownerChannel: first.ownerChannel,
      targetConversationId: first.targetConversationId,
      workerId: DEV_WAKE_PCHP_WORKER, browserProfile: "pchp-dev-isolated",
    }, first.registryJson, legacy);
    expect(moved.workerId).toBe(DEV_WAKE_PCHP_WORKER);
    expect(moved.browserProfile).toBe("pchp-dev-isolated");
    expect(moved.bindingFingerprint).toBe(first.bindingFingerprint);
    expect(moved.enabled).toBe(false);
    expect(JSON.parse(moved.registryJson).bindings).toHaveLength(1);
  });

  it("preserves the active DELL session while activating the PCHP session for the same GPT02 account", () => {
    const dell = stageDevChatGptAccountBinding({
      accountAlias: "GPT02", ownerChannel: "ai-engine-oauth:" + "2".repeat(64),
      targetConversationId: "22222222-2222-2222-2222-222222222222",
      workerId: DEV_WAKE_DELL_WORKER, browserProfile: "travelincars-dev",
    }, undefined, legacy);
    const dellActive = activateDevChatGptSessionBinding({
      rawRegistry: dell.registryJson, bindingFingerprint: dell.bindingFingerprint, legacyTargets: legacy,
    });
    const pchp = stageDevChatGptAccountBinding({
      accountAlias: "GPT02", ownerChannel: dell.ownerChannel,
      targetConversationId: "33333333-3333-3333-3333-333333333333",
      workerId: DEV_WAKE_PCHP_WORKER, browserProfile: "openclaw",
    }, dellActive.registryJson, legacy);
    expect(pchp.bindingFingerprint).not.toBe(dell.bindingFingerprint);
    const staged = JSON.parse(pchp.registryJson).bindings;
    expect(staged).toHaveLength(2);
    expect(staged[0].enabled).toBe(true);
    expect(staged[1].enabled).toBe(false);
    expect(staged[0].workerId).toBe(DEV_WAKE_DELL_WORKER);
    const both = activateDevChatGptSessionBinding({
      rawRegistry: pchp.registryJson, bindingFingerprint: pchp.bindingFingerprint, legacyTargets: legacy,
    });
    const enabled = JSON.parse(both.registryJson).bindings;
    expect(enabled).toHaveLength(2);
    expect(enabled.every((row: { enabled: boolean }) => row.enabled)).toBe(true);
    const resolved = parseDevWakeAccountBindings(both.registryJson, legacy);
    expect(resolved.map((row) => row.workerId)).toEqual([DEV_WAKE_DELL_WORKER, DEV_WAKE_PCHP_WORKER]);
  });

  it("rejects a second account alias for the existing GPT02 owner", () => {
    const dell = stageDevChatGptAccountBinding({
      accountAlias: "GPT02", ownerChannel: "ai-engine-oauth:" + "2".repeat(64),
      targetConversationId: "22222222-2222-2222-2222-222222222222",
      workerId: DEV_WAKE_DELL_WORKER, browserProfile: "travelincars-dev",
    }, undefined, legacy);
    expect(() => stageDevChatGptAccountBinding({
      accountAlias: "GPT03", ownerChannel: dell.ownerChannel,
      targetConversationId: "33333333-3333-3333-3333-333333333333",
      workerId: DEV_WAKE_PCHP_WORKER, browserProfile: "openclaw",
    }, dell.registryJson, legacy)).toThrow("DEV_CHATGPT_BINDING_CONFLICT");
  });

  it("moves GPT02 to an isolated VMSC runtime without changing account identity", () => {
    const first = stageDevChatGptAccountBinding({
      accountAlias: "GPT02", ownerChannel: "ai-engine-oauth:" + "2".repeat(64),
      targetConversationId: "22222222-2222-2222-2222-222222222222",
      workerId: DEV_WAKE_DELL_WORKER, browserProfile: "travelincars-dev",
    }, undefined, legacy);
    const vmsc = stageDevChatGptAccountBinding({
      accountAlias: "GPT02", ownerChannel: first.ownerChannel,
      targetConversationId: first.targetConversationId, workerId: DEV_WAKE_VMSC_WORKER,
      browserProfile: "gpt02-vmsc",
    }, first.registryJson, legacy);
    expect(vmsc.workerId).toBe(DEV_WAKE_VMSC_WORKER);
    expect(JSON.parse(vmsc.registryJson).bindings).toHaveLength(1);
    expect(vmsc.bindingFingerprint).toBe(first.bindingFingerprint);
    expect(JSON.parse(vmsc.registryJson).bindings[0].browserProfile).toBe("gpt02-vmsc");
  });

  it("rejects attempts to reuse the legacy GPT01 conversation", () => {
    expect(() => stageDevChatGptAccountBinding({
      ownerChannel: "ai-engine-oauth:" + "2".repeat(64),
      targetConversationId: legacy[0]!.targetConversationId,
    }, undefined, legacy)).toThrow("DEV_CHATGPT_BINDING_LEGACY_CONFLICT");
  });
});
