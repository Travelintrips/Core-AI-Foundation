import { describe, expect, it } from "vitest";
import { mayReadSignedCheckpointFromMcpSubscription as permitted } from "../mcpCheckpointSubscriptionPolicy.js";
describe("MCP checkpoint subscription policy", () => {
  it("needs an active explicit CHECKPOINT opt-in", () => {
    expect(permitted({ state: "ACTIVE", eventTypes: ["CHECKPOINT"] })).toBe(true);
    expect(permitted({ state: "ACTIVE", eventTypes: ["FAILED", "CHECKPOINT"] })).toBe(true);
  });
  it.each(["EXPIRED", "UNSUBSCRIBED", "NOT_SUBSCRIBED", "UNAVAILABLE"])("rejects %s even if selected", state => {
    expect(permitted({ state, eventTypes: ["CHECKPOINT"] })).toBe(false);
  });
  it("keeps legacy terminal-only subscriptions unchanged", () => {
    expect(permitted({ state: "ACTIVE", eventTypes: ["COMPLETED", "FAILED", "BLOCKED", "MERGED", "DEPLOYED"] })).toBe(false);
    expect(permitted({ state: "ACTIVE", eventTypes: undefined })).toBe(false);
    expect(permitted({ state: "ACTIVE", eventTypes: "CHECKPOINT" })).toBe(false);
  });
});
