import { describe, expect, it } from "vitest";
import { classifyAiCoreInboxEvent } from "../aiCoreChatInboxService.js";

describe("AI Core Chat inbox lifecycle classification", () => {
  it("maps bridge blockers to BLOCKED", () => {
    expect(classifyAiCoreInboxEvent({
      kind: "BLOCKER",
      message: "Task membutuhkan perhatian.",
    })).toBe("BLOCKED");
  });

  it("maps failed bridge responses to FAILED", () => {
    expect(classifyAiCoreInboxEvent({
      kind: "FAILED",
      message: "Autonomous runtime failed.",
    })).toBe("FAILED");
  });

  it("keeps ordinary completed responses as COMPLETED", () => {
    expect(classifyAiCoreInboxEvent({
      kind: "COMPLETED",
      message: "Coding task selesai dan verification gate lulus.",
    })).toBe("COMPLETED");
  });

  it("recognizes merged and deployed terminal reports", () => {
    expect(classifyAiCoreInboxEvent({
      kind: "COMPLETED",
      message: "Pull request merged successfully.",
    })).toBe("MERGED");

    expect(classifyAiCoreInboxEvent({
      kind: "COMPLETED",
      message: "Production deployment completed successfully.",
    })).toBe("DEPLOYED");
  });

  it("prefers explicit eventType metadata", () => {
    expect(classifyAiCoreInboxEvent({
      kind: "COMPLETED",
      message: "Terminal lifecycle report.",
      metadata: { eventType: "DEPLOYED" },
    })).toBe("DEPLOYED");
  });

  it("ignores non-terminal progress and checkpoint responses", () => {
    expect(classifyAiCoreInboxEvent({
      kind: "PROGRESS",
      message: "Still running.",
    })).toBeNull();

    expect(classifyAiCoreInboxEvent({
      kind: "CHECKPOINT",
      message: "Analysis checkpoint.",
    })).toBeNull();
  });
});
