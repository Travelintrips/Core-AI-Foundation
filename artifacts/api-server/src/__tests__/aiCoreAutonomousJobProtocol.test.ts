import { describe, expect, it } from "vitest";
import {
  autonomousJobCommandSchema,
  autonomousJobResultSchema,
  canMarkAutonomousJobCompleted,
} from "../services/aiCoreAutonomousJobProtocolService.js";

const base = {
  protocol: "ai-core-autonomous/v1",
  job_id: "CWS-123",
  event_id: "event-1",
  created_at: "2026-10-09T00:00:00Z",
  scope: { repository: "Travelintrips/Core-AI-Foundation", branch: "main", environment: "production", approved_actions: [] },
  acceptance_criteria: ["CI green", "production SHA matches main", "E2E passes"],
  attempt: 1,
  max_attempts: 3,
} as const;

describe("AI Core autonomous job protocol", () => {
  it("accepts a bounded job and rejects unrecognized commands", () => {
    expect(autonomousJobCommandSchema.safeParse({ ...base, command: "JOB_START" }).success).toBe(true);
    expect(autonomousJobCommandSchema.safeParse({ ...base, command: "DISABLE_APPROVAL" }).success).toBe(false);
    expect(autonomousJobCommandSchema.safeParse({ ...base, command: "JOB_FIX", attempt: 4 }).success).toBe(false);
  });

  it("requires evidence for completed results", () => {
    const result = autonomousJobResultSchema.parse({
      protocol: "ai-core-autonomous/v1",
      job_id: "CWS-123",
      event_id: "event-2",
      status: "COMPLETED",
      step: "verify",
      result: "passed",
      evidence: [{ kind: "ci", ref: "run-1", observed_at: "2026-10-09T00:00:00Z" }],
      error: null,
      next_action: null,
      attempt: 1,
      requires_boss_approval: false,
    });
    expect(canMarkAutonomousJobCompleted(result, ["ci", "deployment", "e2e"])).toBe(false);
    expect(canMarkAutonomousJobCompleted(result, ["ci"])).toBe(true);
  });
});
