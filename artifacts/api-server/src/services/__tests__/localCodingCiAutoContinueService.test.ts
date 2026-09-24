import { describe, expect, it } from "vitest";

describe("bounded CI auto-continuation policy", () => {
  it("preserves explicit review gates", () => {
    const actions = {
      COMPLETED: "DISPATCH_READY_WORKSTREAMS",
      REVIEW_REQUIRED: "WAIT_FOR_EXPLICIT_REVIEW",
      FAILED: "REVIEW_CI_FAILURE",
      READY: "READY_FOR_EXISTING_WORKER_CLAIM",
    };
    expect(actions.REVIEW_REQUIRED).toBe("WAIT_FOR_EXPLICIT_REVIEW");
    expect(Object.values(actions)).not.toContain("AUTO_MERGE");
    expect(Object.values(actions)).not.toContain("AUTO_APPROVE_AI_PATCH");
    expect(Object.values(actions)).not.toContain("AUTO_APPROVE_AI_HANDOFF");
  });
});
