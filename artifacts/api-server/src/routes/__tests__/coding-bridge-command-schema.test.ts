import { describe, expect, it } from "vitest";
import { codingBridgeCommandSchema } from "../coding-bridge-command-schema.js";

const command = {
  externalCommandId: "pc-safe:issue:Travelintrips/Core-AI-Foundation:1194",
  instruction: "ping",
  source: "chatgpt-github-pc-safe",
  commandType: "EXTERNAL_AGENT_WORK",
  assignedClientId: "openclaw-pc-worker-2",
  metadata: { safePcAction: "PING", conversationId: "pc-safe-issue-1194" },
};

describe("coding bridge command routing contract", () => {
  it("preserves the top-level worker assignment for persistence and claim", () => {
    const parsed = codingBridgeCommandSchema.parse(command);
    expect(parsed.assignedClientId).toBe("openclaw-pc-worker-2");
    expect(parsed.metadata).toEqual(command.metadata);
  });

  it("rejects an empty explicit worker target", () => {
    expect(codingBridgeCommandSchema.safeParse({
      ...command,
      assignedClientId: "  ",
    }).success).toBe(false);
  });

  it("preserves unassigned legacy commands without implicit worker routing", () => {
    const { assignedClientId: _target, ...legacy } = command;
    const parsed = codingBridgeCommandSchema.parse(legacy);
    expect(parsed.assignedClientId).toBeUndefined();
  });
});
