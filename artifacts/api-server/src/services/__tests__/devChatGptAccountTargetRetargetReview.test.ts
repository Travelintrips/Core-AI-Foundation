import { describe, expect, it } from "vitest";
import { stageDevChatGptAccountBinding } from "../devChatGptAccountProvisioningService.js";
import {
  DEV_WAKE_DELL_WORKER,
  DEV_WAKE_VMSC_WORKER,
  devWakeBindingFingerprint,
  parseDevWakeAccountBindings,
} from "../devChatGptWakeBindingService.js";

/**
 * Synthetic fixtures only. Do not add real owner channels, ChatGPT URLs,
 * fingerprints, credentials or registry values to this public test file.
 *
 * Regression tests for the REVIEW-ONLY DEV target reconciliation (#1516).
 * These pure-function tests do not contact a database or perform migration.
 */
const owner = (digit: string) => "ai-engine-oauth:" + digit.repeat(64);
const conversation = (digit: string) =>
  [digit.repeat(8), digit.repeat(4), digit.repeat(4), digit.repeat(4), digit.repeat(12)].join("-");

const legacy = [
  { ownerChannel: owner("1"), targetConversationId: conversation("1"), workerId: DEV_WAKE_DELL_WORKER },
  { ownerChannel: owner("9"), targetConversationId: conversation("1"), workerId: DEV_WAKE_DELL_WORKER },
];

const originalGpt02 = {
  accountAlias: "GPT02",
  ownerChannel: owner("2"),
  targetConversationId: conversation("2"),
  workerId: DEV_WAKE_DELL_WORKER,
  browserProfile: "dedicated-dev-profile",
  enabled: true,
};

const otherGpt03 = {
  accountAlias: "GPT03",
  ownerChannel: owner("3"),
  targetConversationId: conversation("3"),
  workerId: DEV_WAKE_VMSC_WORKER,
  browserProfile: "isolated-third-profile",
  enabled: false,
};

const originalRegistry = JSON.stringify({
  version: 1,
  bindings: [originalGpt02, otherGpt03],
});

describe("review-only DEV account binding target reconciliation", () => {
  it("replaces only the exact account identity and disables its changed destination", () => {
    const originalLegacy = JSON.stringify(legacy);
    const result = stageDevChatGptAccountBinding({
      accountAlias: "GPT02",
      ownerChannel: originalGpt02.ownerChannel,
      targetConversationId: conversation("4"),
      workerId: originalGpt02.workerId,
      browserProfile: originalGpt02.browserProfile,
    }, originalRegistry, legacy);

    const parsed = JSON.parse(result.registryJson);
    expect(result.alreadyStaged).toBe(false);
    expect(result.enabled).toBe(false);
    expect(parsed.version).toBe(1);
    expect(parsed.bindings).toHaveLength(2);
    expect(parsed.bindings[0]).toEqual({
      ...originalGpt02,
      targetConversationId: conversation("4"),
      enabled: false,
    });
    expect(parsed.bindings[1]).toEqual(otherGpt03);
    expect(parsed.bindings.some((entry: { targetConversationId: string }) =>
      entry.targetConversationId === conversation("2"))).toBe(false);
    expect(JSON.stringify(legacy)).toBe(originalLegacy);
    expect(parseDevWakeAccountBindings(result.registryJson, legacy)).toEqual([]);
  });

  it("changes the v2 fingerprint when the target changes while keeping owner/worker/profile", () => {
    const result = stageDevChatGptAccountBinding({
      accountAlias: originalGpt02.accountAlias,
      ownerChannel: originalGpt02.ownerChannel,
      targetConversationId: conversation("4"),
      workerId: originalGpt02.workerId,
      browserProfile: originalGpt02.browserProfile,
    }, originalRegistry, legacy);

    const oldFingerprint = devWakeBindingFingerprint({
      version: 1,
      ...originalGpt02,
    });
    const proposedFingerprint = devWakeBindingFingerprint({
      version: 1,
      ...originalGpt02,
      targetConversationId: conversation("4"),
    });

    expect(result.bindingFingerprint).toBe(proposedFingerprint);
    expect(result.bindingFingerprint).not.toBe(oldFingerprint);
    expect(result.ownerChannel).toBe(originalGpt02.ownerChannel);
    expect(result.workerId).toBe(originalGpt02.workerId);
    expect(result.browserProfile).toBe(originalGpt02.browserProfile);
  });

  it("is idempotent only once the new tuple is staged disabled", () => {
    const input = {
      accountAlias: originalGpt02.accountAlias,
      ownerChannel: originalGpt02.ownerChannel,
      targetConversationId: conversation("4"),
      workerId: originalGpt02.workerId,
      browserProfile: originalGpt02.browserProfile,
    };
    const first = stageDevChatGptAccountBinding(input, originalRegistry, legacy);
    const second = stageDevChatGptAccountBinding(input, first.registryJson, legacy);

    expect(JSON.parse(first.registryJson).bindings[0].enabled).toBe(false);
    expect(second.alreadyStaged).toBe(true);
    expect(second.registryJson).toBe(first.registryJson);
    expect(second.bindingFingerprint).toBe(first.bindingFingerprint);
  });

  it("fails closed for a target collision with another account", () => {
    expect(() => stageDevChatGptAccountBinding({
      accountAlias: originalGpt02.accountAlias,
      ownerChannel: originalGpt02.ownerChannel,
      targetConversationId: otherGpt03.targetConversationId,
      workerId: originalGpt02.workerId,
      browserProfile: originalGpt02.browserProfile,
    }, originalRegistry, legacy)).toThrow("DEV_CHATGPT_BINDING_CONFLICT");
  });

  it("rejects retargeting to either existing GPT01 owner's legacy destination", () => {
    expect(() => stageDevChatGptAccountBinding({
      accountAlias: originalGpt02.accountAlias,
      ownerChannel: originalGpt02.ownerChannel,
      targetConversationId: legacy[0]!.targetConversationId,
      workerId: originalGpt02.workerId,
      browserProfile: originalGpt02.browserProfile,
    }, originalRegistry, legacy)).toThrow("DEV_CHATGPT_BINDING_LEGACY_CONFLICT");
  });
});
