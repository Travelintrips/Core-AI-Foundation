import { describe, expect, it } from "vitest";
import { stageDevChatGptAccountBinding } from "../devChatGptAccountProvisioningService.js";
import { DEV_WAKE_DELL_WORKER, DEV_WAKE_DEFAULT_WORKER, DEV_WAKE_PC2_WORKER } from "../devChatGptWakeBindingService.js";

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

  it("allows the same account identity to stage a second trusted worker session", () => {
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
    expect(JSON.parse(second.registryJson).bindings).toHaveLength(2);

    const third = stageDevChatGptAccountBinding({
      accountAlias: "GPT02",
      ownerChannel: first.ownerChannel,
      targetConversationId: first.targetConversationId,
      workerId: DEV_WAKE_PC2_WORKER,
      browserProfile: "gpt02-vmsc",
    }, second.registryJson, legacy);
    expect(third.workerId).toBe(DEV_WAKE_PC2_WORKER);
    expect(JSON.parse(third.registryJson).bindings).toHaveLength(3);
  });

  it("rejects attempts to reuse the legacy GPT01 conversation", () => {
    expect(() => stageDevChatGptAccountBinding({
      ownerChannel: "ai-engine-oauth:" + "2".repeat(64),
      targetConversationId: legacy[0]!.targetConversationId,
    }, undefined, legacy)).toThrow("DEV_CHATGPT_BINDING_LEGACY_CONFLICT");
  });
});
