import { afterEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn(async () => ({ rows: [] }));
const dispatchExternalAgentWork = vi.fn();
const getExternalAgentRegistrySnapshot = vi.fn(async () => []);
const resolveVerifiedDevWakeTarget = vi.fn();
const queueDevBrowserWake = vi.fn();

vi.mock("@workspace/db", () => ({
  db: { execute },
}));

vi.mock("../externalAgentDispatchService.js", () => ({
  ExternalAgentDispatchError: class ExternalAgentDispatchError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
  dispatchExternalAgentWork,
}));

vi.mock("../externalAgentRegistryService.js", () => ({
  getExternalAgentRegistrySnapshot,
}));

vi.mock("../devChatGptWakeService.js", () => ({
  resolveVerifiedDevWakeTarget,
  queueDevBrowserWake,
}));

import { dispatchDirectChatGptAccountWork } from "../directChatGptAccountRouterService.js";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("direct GPT02 portable account routing", () => {
  it("routes travelincars/GPT02 to the healthy verified session location instead of a fixed PC2 worker", async () => {
    vi.stubEnv("NODE_ENV", "development");

    getExternalAgentRegistrySnapshot.mockResolvedValue([
      {
        clientId: "openclaw-pc-worker-dev",
        eligible: false,
        reportedHealth: "unknown",
      },
      {
        clientId: "openclaw-vmsc-chatgpt-wake-dev",
        eligible: true,
        reportedHealth: "healthy",
      },
    ]);

    resolveVerifiedDevWakeTarget.mockResolvedValue({
      ownerChannel: "ai-engine-oauth:" + "a".repeat(64),
      targetConversationId: "6ad87510-6dd8-83ec-a064-14e4a3438d46",
      workerId: "openclaw-vmsc-chatgpt-wake-dev",
      wakeBinding: {
        version: 1,
        accountAlias: "GPT02",
        ownerChannel: "ai-engine-oauth:" + "a".repeat(64),
        targetConversationId: "6ad87510-6dd8-83ec-a064-14e4a3438d46",
        workerId: "openclaw-vmsc-chatgpt-wake-dev",
        browserProfile: "gpt02-vmsc",
        bindingFingerprint: "b".repeat(64),
      },
    });

    queueDevBrowserWake.mockResolvedValue({
      commandId: "wake-command-1",
      clientId: "openclaw-vmsc-chatgpt-wake-dev",
      created: true,
    });

    const result = await dispatchDirectChatGptAccountWork({
      target: "travelincars",
      instruction: "lanjutkan job GPT02",
      requestHost: "dev-aicore.cstlogistic.co.id",
    });

    expect(resolveVerifiedDevWakeTarget).toHaveBeenCalledWith(
      "GPT02",
      "dev-aicore.cstlogistic.co.id",
      undefined,
    );
    expect(queueDevBrowserWake).toHaveBeenCalledWith(expect.objectContaining({
      targetConversationId: "6ad87510-6dd8-83ec-a064-14e4a3438d46",
      expectedWorkerId: "openclaw-vmsc-chatgpt-wake-dev",
      expectedBindingFingerprint: "b".repeat(64),
      instruction: "lanjutkan job GPT02",
    }));
    expect(dispatchExternalAgentWork).not.toHaveBeenCalled();
    expect(result.dispatched[0]).toMatchObject({
      account: "travelincars",
      workerId: "openclaw-vmsc-chatgpt-wake-dev",
      browserProfile: "gpt02-vmsc",
      portableAccountBinding: true,
      status: "RECEIVED",
    });
  });
});
