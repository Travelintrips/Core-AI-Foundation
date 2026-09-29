import { describe, expect, it } from "vitest";
import { hashAgentServiceToken } from "../agentServiceAuth.js";

describe("agentServiceAuth", () => {
  it("hashes agent tokens deterministically without returning the source token", () => {
    const token = "agent_test_0123456789abcdefghijklmnopqrstuvwxyz";
    const first = hashAgentServiceToken(token);
    const second = hashAgentServiceToken(token);

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain(token);
  });

  it("produces distinct hashes for distinct tokens", () => {
    expect(hashAgentServiceToken("agent-a")).not.toBe(hashAgentServiceToken("agent-b"));
  });
});
