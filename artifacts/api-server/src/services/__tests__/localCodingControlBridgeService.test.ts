import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  aiCodingBridgeCommandsTable: {},
  aiCodingBridgePresenceTable: {},
  aiCodingBridgeResponsesTable: {},
}));
vi.mock("../aiEventBusService.js", () => ({ publishSafe: vi.fn() }));

describe("coding control bridge contract", () => {
  it("exports durable command and response primitives", async () => {
    const bridge = await import("../localCodingControlBridgeService.js");
    expect(bridge).toHaveProperty("submitCodingBridgeCommand");
    expect(bridge).toHaveProperty("appendCodingBridgeResponse");
    expect(bridge).toHaveProperty("listPendingCodingBridgeResponses");
    expect(bridge).toHaveProperty("acknowledgeCodingBridgeResponse");
  });

  it("exports external-agent work claim primitives", async () => {
    const bridge = await import("../localCodingControlBridgeService.js");
    expect(bridge).toHaveProperty("claimCodingBridgeCommand");
    expect(bridge).toHaveProperty("renewCodingBridgeCommandClaim");
    expect(bridge).toHaveProperty("completeCodingBridgeCommand");
    expect(bridge).toHaveProperty("getCodingBridgeCommandExecutionState");
  });

  it("exports bounded presence lease primitives", async () => {
    const bridge = await import("../localCodingControlBridgeService.js");
    expect(bridge).toHaveProperty("renewCodingBridgePresence");
    expect(bridge).toHaveProperty("getCodingBridgeAvailability");
  });
});
