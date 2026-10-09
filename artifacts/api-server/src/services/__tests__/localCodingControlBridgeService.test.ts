import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  aiCodingBridgeCommandsTable: {},
  aiCodingBridgePresenceTable: {},
  aiCodingBridgeResponsesTable: {},
}));
vi.mock("../aiEventBusService.js", () => ({ publishSafe: vi.fn() }));

describe("coding control bridge lifecycle idempotency", () => {
  it.each(["BLOCKER", "COMPLETED", "FAILED"] as const)(
    "deduplicates %s lifecycle responses before fan-out",
    async (kind) => {
      const bridge = await import("../localCodingControlBridgeService.js");
      expect(bridge.isIdempotentCodingBridgeLifecycleKind(kind)).toBe(true);
    },
  );

  it.each(["ACK", "PROGRESS", "CHECKPOINT"] as const)(
    "does not collapse ordinary %s progress responses",
    async (kind) => {
      const bridge = await import("../localCodingControlBridgeService.js");
      expect(bridge.isIdempotentCodingBridgeLifecycleKind(kind)).toBe(false);
    },
  );

  it("serializes lifecycle persistence with an advisory transaction lock", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../localCodingControlBridgeService.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("if (!created) return response;");
    expect(source).toContain("checkpointJson} =");
  });
});

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

describe("external-agent browser E2E terminal validation", () => {
  it("rejects a false completed browser test with missing callback delivery", async () => {
    const { hasUnverifiedExternalBrowserCompletion } = await import("../localCodingControlBridgeService.js");
    expect(hasUnverifiedExternalBrowserCompletion({
      message: JSON.stringify({
        sourceReplyDeliveryState: "missing",
        terminalReply: { text: "Unable to perform the browser ChatGPT test" },
      }),
    })).toBe(true);
  });

  it("does not change unrelated or successfully delivered work", async () => {
    const { hasUnverifiedExternalBrowserCompletion } = await import("../localCodingControlBridgeService.js");
    expect(hasUnverifiedExternalBrowserCompletion({
      message: "Completed ordinary maintenance",
      details: { sourceReplyDeliveryState: "missing" },
    })).toBe(false);
    expect(hasUnverifiedExternalBrowserCompletion({
      message: "Unable to perform the browser ChatGPT test",
      details: { sourceReplyDeliveryState: "delivered" },
    })).toBe(false);
  });
});
