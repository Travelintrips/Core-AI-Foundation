import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reconcile: vi.fn(), queue: vi.fn() }));
vi.mock("../devContinuityWatchRepository.js", () => ({
  DevContinuityWatchError: class extends Error { code = "WATCH_ERROR"; },
  devContinuityWatchRepository: { reconcile: mocks.reconcile },
}));
vi.mock("../devChatGptWakeService.js", () => ({
  isDevBrowserWakeAllowed: () => true, queueDevBrowserWake: mocks.queue,
}));
vi.mock("../devContinuityWakeEvents.js", () => ({ subscribeDevContinuityWakeResults: () => () => {} }));
import { getDevContinuityWatchStatus, stopDevContinuityWatchRuntime } from "../devContinuityWatchService.js";

const ownerChannel = "ai-engine-oauth:" + "a".repeat(64);
const jobId = "11111111-1111-4111-8111-111111111111";
const watch = { ownerChannel, jobId, commandId: "watch", targetConversationId: "22222222-2222-4222-8222-222222222222",
  checkpointSha: "c".repeat(40), revision: 1, state: "BLOCKED", wakeCount: 1,
  lastProgressAt: "2026-10-18T00:00:00.000Z", deadlineAt: "2026-10-18T00:01:00.000Z",
  expiresAt: "2026-10-18T00:15:00.000Z", triggeredAt: "2026-10-18T00:01:00.000Z",
  wakeEventId: "e".repeat(64), wakeCommandId: "child" };

describe("continuity status evidence", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENV", "development"); vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AI_CORE_DEV_CONTINUITY_ENABLED", "true"); vi.clearAllMocks();
  });
  afterEach(() => { stopDevContinuityWatchRuntime(); vi.unstubAllEnvs(); });

  it("does not report delivery or reply from raw flags rejected by repository verification", async () => {
    mocks.reconcile.mockResolvedValue({ ...watch, evidence: { resultCode: "UNKNOWN_UNVERIFIED",
      browserConfirmed: true, chatgptSubmitted: true, verifiedAssistantReply: true,
      failureReason: "BROWSER_EVIDENCE_INCOMPLETE" } });
    const result = await getDevContinuityWatchStatus({ ownerChannel, jobId });
    expect(result.browserDelivered).toBe(false); expect(result.verifiedAssistantReply).toBe(false);
    expect(result.workCompleted).toBe(false); expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("separates validated delivery, assistant reply and tracked work completion", async () => {
    mocks.reconcile.mockResolvedValue({ ...watch, state: "WAKE_CONFIRMED",
      evidence: { resultCode: "DELIVERY_CONFIRMED", verifiedAssistantReply: false } });
    const result = await getDevContinuityWatchStatus({ ownerChannel, jobId });
    expect(result.browserDelivered).toBe(true); expect(result.verifiedAssistantReply).toBe(false);
    expect(result.workCompleted).toBe(false); expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("retains validated delivery evidence after a completion checkpoint", async () => {
    mocks.reconcile.mockResolvedValue({ ...watch, state: "COMPLETED",
      evidence: { resultCode: "DELIVERY_CONFIRMED", verifiedAssistantReply: true } });
    const result = await getDevContinuityWatchStatus({ ownerChannel, jobId });
    expect(result.browserDelivered).toBe(true); expect(result.verifiedAssistantReply).toBe(true);
    expect(result.workCompleted).toBe(true);
  });

  it.each(["production", "disabled"])("does not read or mutate watches when %s", async gate => {
    if (gate === "production") vi.stubEnv("NODE_ENV", "production");
    else vi.stubEnv("AI_CORE_DEV_CONTINUITY_ENABLED", "false");
    await expect(getDevContinuityWatchStatus({ ownerChannel, jobId })).rejects.toThrow("DEV_CONTINUITY_DENIED");
    expect(mocks.reconcile).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled();
  });
});
