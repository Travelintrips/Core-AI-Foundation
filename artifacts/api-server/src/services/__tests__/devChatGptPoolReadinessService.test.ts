// @vitest-environment node
import { describe, expect, it } from "vitest";
import { describeDevGptReadiness } from "../devChatGptPoolReadinessService.js";
import type { DevWakeRuntimeConfig } from "../devChatGptWakeBindingService.js";

const gpt2 = {
  version: 1 as const,
  accountAlias: "GPT02",
  ownerChannel: "ai-engine-oauth:" + "a".repeat(64),
  targetConversationId: "123e4567-e89b-42d3-a456-426614174000",
  workerId: "openclaw-dell-chatgpt-wake-dev" as const,
  browserProfile: "travelincars-dev",
  bindingFingerprint: "f".repeat(64),
};
const config = (
  patch: Partial<Pick<DevWakeRuntimeConfig, "enabled" | "bindings" | "bindingConfigInvalid">> = {},
) => ({
  enabled: true,
  bindings: [gpt2],
  bindingConfigInvalid: false,
  ...patch,
});

describe("redacted DEV GPT account readiness", () => {
  it("shows a configured GPT02 but does NOT claim it is dispatch-ready from heartbeat alone", () => {
    const result = describeDevGptReadiness(config(), new Set(["openclaw-dell-chatgpt-wake-dev"]));
    expect(result).toMatchObject([
      { alias: "GPT02", state: "CONFIGURED_UNVERIFIED", executor: "DELL",
        executorOnline: true, dispatchReady: false },
      { alias: "GPT03", state: "NOT_CONFIGURED", executor: null, dispatchReady: false },
    ]);
    expect(JSON.stringify(result)).not.toContain(gpt2.ownerChannel);
    expect(JSON.stringify(result)).not.toContain(gpt2.targetConversationId);
    expect(JSON.stringify(result)).not.toContain(gpt2.bindingFingerprint);
    expect(JSON.stringify(result)).not.toContain(gpt2.browserProfile);
  });

  it("fails closed on disabled, invalid, missing or offline configuration", () => {
    for (const c of [null, config({ enabled: false }), config({ bindingConfigInvalid: true })]) {
      const result = describeDevGptReadiness(c, new Set(["openclaw-dell-chatgpt-wake-dev"]));
      expect(result.every(item => item.state === "DISABLED" && item.dispatchReady === false)).toBe(true);
    }
    expect(describeDevGptReadiness(config(), new Set())[0]).toMatchObject({
      alias: "GPT02", state: "CONFIGURED_UNVERIFIED", executorOnline: false, dispatchReady: false,
    });
  });

  it("does not mistake a second DELL account binding for independent concurrency", () => {
    const result = describeDevGptReadiness(config({ bindings: [
      gpt2,
      { ...gpt2, accountAlias: "GPT03", browserProfile: "third-session" },
    ] }), new Set(["openclaw-dell-chatgpt-wake-dev"]));
    expect(result.map(item => item.executor)).toEqual(["DELL", "DELL"]);
    expect(result.every(item => !item.dispatchReady)).toBe(true);
  });
});
