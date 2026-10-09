import { describe, expect, it } from "vitest";
import {
  AutonomousJobCoordinator,
  type AutonomousJobStore,
} from "../services/aiCoreAutonomousJobCoordinatorService.js";
import type {
  AutonomousJobCommand,
  AutonomousJobResult,
  AutonomousJobStatus,
} from "../services/aiCoreAutonomousJobProtocolService.js";

describe("autonomous coordinator", () => {
  it("rejects completion without deployment and E2E evidence", async () => {
    const store: AutonomousJobStore = {
      enqueueOnce: async (_command: AutonomousJobCommand) => "inserted",
      getStatus: async (_jobId: string): Promise<AutonomousJobStatus> => "VERIFYING",
      applyResultOnce: async (_result: AutonomousJobResult) => "applied",
    };
    const coordinator = new AutonomousJobCoordinator(store);
    const response = await coordinator.receive({
      protocol: "ai-core-autonomous/v1",
      job_id: "CWS-123",
      event_id: "result-1",
      status: "COMPLETED",
      step: "verification",
      result: "passed",
      evidence: [{ kind: "ci", ref: "run-1", observed_at: "2026-10-09T00:00:00Z" }],
      error: null,
      next_action: null,
      attempt: 1,
      requires_boss_approval: false,
    });
    expect(response).toEqual({ accepted: false, reason: "missing_completion_evidence" });
  });
});
