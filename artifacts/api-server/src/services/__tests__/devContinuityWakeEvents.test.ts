import { describe, expect, it, vi } from "vitest";
import { DEV_CONTINUITY_WORKER, devContinuityResultFromCommittedCommand, emitDevContinuityWakeResult, subscribeDevContinuityWakeResults } from "../devContinuityWakeEvents.js";

function committed() {
  const owner = "ai-engine-oauth:" + "a".repeat(64);
  const eventId = "b".repeat(64);
  return { id: "11111111-1111-4111-8111-111111111111", source: "ai-core", commandType: "EXTERNAL_AGENT_WORK",
    authenticatedWorkerId: DEV_CONTINUITY_WORKER, status: "COMPLETED" as const,
    metadata: { assignedClientId: DEV_CONTINUITY_WORKER, completedBy: DEV_CONTINUITY_WORKER,
      capability: "chatgpt:wake", explicitWorkerTarget: true, conversationId: owner, eventId,
      devContinuity: { parentWatchCommandId: "22222222-2222-4222-8222-222222222222", ownerChannel: owner, eventId, jobId: "job-1" } },
    details: { ownerChannel: "untrusted-callback-owner", jobId: "untrusted-callback-job" } };
}

describe("authenticated continuity callback event boundary", () => {
  it("derives ownership and association exclusively from the committed command", () => {
    const row = committed();
    expect(devContinuityResultFromCommittedCommand(row)).toMatchObject({
      ownerChannel: row.metadata.conversationId, jobId: "job-1", childCommandId: row.id,
      parentWatchCommandId: row.metadata.devContinuity.parentWatchCommandId, eventId: row.metadata.eventId,
    });
  });

  it.each(["source", "commandType", "authenticatedWorkerId"] as const)("rejects a mismatched %s", key => {
    expect(devContinuityResultFromCommittedCommand({ ...committed(), [key]: "untrusted" })).toBeNull();
  });

  it.each(["assignedClientId", "completedBy", "capability", "conversationId", "eventId", "explicitWorkerTarget"] as const)("rejects mismatched committed metadata %s", key => {
    const row = committed();
    expect(devContinuityResultFromCommittedCommand({ ...row, metadata: { ...row.metadata, [key]: "untrusted" } })).toBeNull();
  });

  it("awaits subscribed persistence and removes the exact listener on shutdown", async () => {
    const event = devContinuityResultFromCommittedCommand(committed())!;
    const listener = vi.fn(async () => { await Promise.resolve(); });
    const unsubscribe = subscribeDevContinuityWakeResults(listener);
    await emitDevContinuityWakeResult(event);
    expect(listener).toHaveBeenCalledExactlyOnceWith(event);
    unsubscribe(); await emitDevContinuityWakeResult(event);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
