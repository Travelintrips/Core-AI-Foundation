import { describe, expect, it } from "vitest";
import { assessJobLifecycleReadiness, type LifecycleEvidenceRow } from "../jobLifecycleReadinessService.js";
const row = (id: string, kind: string, commandId = "c1", acknowledgedAt: Date | null = null, sec = 1): LifecycleEvidenceRow => ({
  id, kind, commandId, acknowledgedAt, createdAt: new Date(1700000000000 + sec * 1000),
});
describe("read-only job lifecycle readiness", () => {
  it("fails closed with no responses", () => {
    expect(assessJobLifecycleReadiness([])).toEqual({
      phase: "NO_RESPONSES", latestCheckpointResponseId: null,
      latestCheckpointAcknowledged: false, latestCheckpointAttested: false,
      latestCheckpointReceiverAckVerified: false, blockingResponseId: null,
      needsWorkerHealthAndAuthorization: false, mayAutoResume: false, mayAutoClose: false,
    });
  });
  it("does not resume with missing checkpoint or missing ACK", () => {
    expect(assessJobLifecycleReadiness([row("b", "BLOCKER")]).needsWorkerHealthAndAuthorization).toBe(false);
    const result = assessJobLifecycleReadiness([row("cp", "CHECKPOINT"), row("b", "BLOCKER", "c1", null, 2)]);
    expect(result.phase).toBe("BLOCKED");
    expect(result.latestCheckpointAcknowledged).toBe(false);
    expect(result.needsWorkerHealthAndAuthorization).toBe(false);
  });
  it("does not trust a generic ACK without issuer and receiver verification", () => {
    const result = assessJobLifecycleReadiness([
      row("cp", "CHECKPOINT", "c1", new Date(), 2),
      row("b", "BLOCKER", "c1", null, 3),
    ]);
    expect(result.latestCheckpointAcknowledged).toBe(true);
    expect(result.latestCheckpointAttested).toBe(false);
    expect(result.latestCheckpointReceiverAckVerified).toBe(false);
    expect(result.needsWorkerHealthAndAuthorization).toBe(false);
  });
  it("marks only external review needed for signed, receiver-ACKed same-command checkpoint", () => {
    const result = assessJobLifecycleReadiness([
      row("b", "BLOCKER", "c1", null, 3),
      { ...row("cp", "CHECKPOINT", "c1", new Date(), 2), checkpointAttested: true, receiverAckVerified: true },
    ]);
    expect(result.needsWorkerHealthAndAuthorization).toBe(true);
    expect(result.mayAutoResume).toBe(false);
  });
  it("rejects cross-command checkpoint evidence", () => {
    const result = assessJobLifecycleReadiness([
      row("cp", "CHECKPOINT", "c2", new Date(), 2),
      row("b", "BLOCKER", "c1", null, 3),
    ]);
    expect(result.needsWorkerHealthAndAuthorization).toBe(false);
  });
  it("does not mistake an old blocker for a currently blocked job", () => {
    const result = assessJobLifecycleReadiness([
      row("b", "BLOCKER", "c1", null, 1),
      row("progress", "PROGRESS", "c1", null, 3),
    ]);
    expect(result.phase).toBe("IN_PROGRESS");
    expect(result.blockingResponseId).toBeNull();
  });
  it("terminal reports are not equivalent to verified job closure", () => {
    const result = assessJobLifecycleReadiness([
      row("cp", "CHECKPOINT", "c1", new Date(), 1),
      row("done", "COMPLETED", "c1", null, 2),
    ]);
    expect(result.phase).toBe("TERMINAL_REPORTED");
    expect(result.mayAutoClose).toBe(false);
    expect(result.mayAutoResume).toBe(false);
  });
});
