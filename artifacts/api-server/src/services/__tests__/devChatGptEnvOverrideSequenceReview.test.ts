import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stageDevChatGptAccountBinding } from "../devChatGptAccountProvisioningService.js";
import {
  DEV_WAKE_DELL_WORKER,
  loadDevWakeRuntimeConfig,
  parseDevWakeAccountBindings,
  resolveConfiguredDevWakeTargets,
} from "../devChatGptWakeBindingService.js";

/**
 * Issue #1516: pure, synthetic, review-only tests for precedence and ordering.
 * No real ChatGPT owner, target, fingerprint, URL, credentials or registry
 * values belong in this public file. No database writes / browser operations.
 */
const fakeDatabase = vi.hoisted(() => ({
  rows: [] as Array<{ key: string; value: string }>,
  reads: 0,
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: async () => {
      fakeDatabase.reads += 1;
      return { rows: fakeDatabase.rows };
    },
  },
}));

const owner = (hex: string) => "ai-engine-oauth:" + hex.repeat(64);
const target = (hex: string) =>
  [hex.repeat(8), hex.repeat(4), hex.repeat(4), hex.repeat(4), hex.repeat(12)].join("-");

const legacyTargets = [
  { ownerChannel: owner("1"), targetConversationId: target("1"), workerId: DEV_WAKE_DELL_WORKER },
  { ownerChannel: owner("9"), targetConversationId: target("1"), workerId: DEV_WAKE_DELL_WORKER },
];

const additional = {
  accountAlias: "GPT02",
  ownerChannel: owner("2"),
  targetConversationId: target("2"),
  workerId: DEV_WAKE_DELL_WORKER,
  browserProfile: "synthetic-dedicated-dev",
  enabled: true,
};
const storedOriginal = JSON.stringify({ version: 1, bindings: [additional] });
const conflictingEnv = JSON.stringify({
  version: 1,
  bindings: [{ ...additional, targetConversationId: legacyTargets[0]!.targetConversationId }],
});

function setSyntheticDbRegistry(registry: string): void {
  fakeDatabase.rows = [
    { key: "dev.chatgpt_wake.enabled", value: "true" },
    { key: "dev.chatgpt_wake.owner_channel", value: legacyTargets.map((item) => item.ownerChannel).join(",") },
    { key: "dev.chatgpt_wake.gpt01_conversation_id", value: legacyTargets[0]!.targetConversationId },
    { key: "dev.chatgpt_wake.worker_id", value: DEV_WAKE_DELL_WORKER },
    { key: "dev.chatgpt_wake.account_bindings", value: registry },
  ];
}

function stageDisabled(): string {
  const next = stageDevChatGptAccountBinding({
    accountAlias: "GPT02",
    ownerChannel: additional.ownerChannel,
    targetConversationId: target("4"),
    workerId: additional.workerId,
    browserProfile: additional.browserProfile,
  }, storedOriginal, legacyTargets);
  expect(next.enabled).toBe(false);
  return next.registryJson;
}

describe("DEV additional-account env/DB source precedence and migration sequence (#1516)", () => {
  beforeEach(() => {
    fakeDatabase.reads = 0;
    setSyntheticDbRegistry(storedOriginal);
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ENABLED", "true");
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CHANNELS", legacyTargets.map((item) => item.ownerChannel).join(","));
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CONVERSATIONS", legacyTargets[0]!.targetConversationId);
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_WORKER_ID", DEV_WAKE_DELL_WORKER);
    vi.stubEnv("AI_CORE_DEV_CHATGPT_ALIAS_GPT01_CONVERSATION_ID", legacyTargets[0]!.targetConversationId);
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON", conflictingEnv);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a legacy GPT01 target collision even when the DB binding is otherwise valid", async () => {
    expect(parseDevWakeAccountBindings(storedOriginal, legacyTargets)).toHaveLength(1);
    expect(() => parseDevWakeAccountBindings(conflictingEnv, legacyTargets))
      .toThrow("DEV_CHATGPT_BINDING_LEGACY_CONFLICT");
    const runtime = await loadDevWakeRuntimeConfig("dev.cstlogistic.co.id");
    expect(runtime.enabled).toBe(true);
    expect(runtime.bindingConfigInvalid).toBe(true);
    expect(runtime.legacyTargets).toHaveLength(2);
    expect(runtime.bindings).toEqual([]);
    expect(fakeDatabase.reads).toBeGreaterThan(0);
  });

  it("does not bypass a bad env override by silently using an enabled DB binding", async () => {
    const runtime = await loadDevWakeRuntimeConfig("dev.cstlogistic.co.id");
    expect(runtime.bindingConfigInvalid).toBe(true);
    expect(resolveConfiguredDevWakeTargets(runtime, {
      ownerChannel: additional.ownerChannel,
      targetConversationId: additional.targetConversationId,
    })).toEqual([]);
    expect(runtime.legacyTargets.map((item) => item.ownerChannel))
      .toEqual(legacyTargets.map((item) => item.ownerChannel));
  });

  it("canonical staging turns an existing synthetic binding off without changing GPT01", () => {
    const originalLegacy = JSON.stringify(legacyTargets);
    const staged = stageDisabled();
    expect(JSON.parse(staged).bindings).toEqual([
      { ...additional, targetConversationId: target("4"), enabled: false },
    ]);
    expect(JSON.stringify(legacyTargets)).toBe(originalLegacy);
    expect(parseDevWakeAccountBindings(staged, legacyTargets)).toEqual([]);
  });

  it("accepts a staged disabled env override with both legacy GPT01 owners preserved", async () => {
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON", stageDisabled());
    const runtime = await loadDevWakeRuntimeConfig("dev.cstlogistic.co.id");
    expect(runtime.bindingConfigInvalid).toBe(false);
    expect(runtime.bindings).toHaveLength(0);
    expect(runtime.legacyTargets).toEqual(legacyTargets);
  });

  it("proves clearing the env override before DB staging exposes the stale enabled binding", async () => {
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON", "");
    const runtime = await loadDevWakeRuntimeConfig("dev.cstlogistic.co.id");
    expect(runtime.bindingConfigInvalid).toBe(false);
    expect(runtime.legacyTargets).toHaveLength(2);
    expect(runtime.bindings).toHaveLength(1);
    expect(runtime.bindings[0]!.targetConversationId).toBe(additional.targetConversationId);
    expect(resolveConfiguredDevWakeTargets(runtime, {
      ownerChannel: additional.ownerChannel,
      targetConversationId: additional.targetConversationId,
    })).toHaveLength(1);
  });

  it("allows clearing the env override only after the DB value is staged disabled", async () => {
    setSyntheticDbRegistry(stageDisabled());
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON", "");
    const runtime = await loadDevWakeRuntimeConfig("dev.cstlogistic.co.id");
    expect(runtime.bindingConfigInvalid).toBe(false);
    expect(runtime.bindings).toEqual([]);
    expect(runtime.legacyTargets).toHaveLength(2);
    expect(resolveConfiguredDevWakeTargets(runtime, {
      ownerChannel: additional.ownerChannel,
      targetConversationId: target("4"),
    })).toEqual([]);
  });

  it("keeps a malformed replacement override fail-closed even after DB staging", async () => {
    setSyntheticDbRegistry(stageDisabled());
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON", conflictingEnv);
    const runtime = await loadDevWakeRuntimeConfig("dev.cstlogistic.co.id");
    expect(runtime.bindingConfigInvalid).toBe(true);
    expect(runtime.bindings).toEqual([]);
    expect(runtime.legacyTargets).toHaveLength(2);
  });
});
