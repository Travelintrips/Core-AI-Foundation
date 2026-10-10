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

describe("evidence-qualified runtime status", () => {
  it("keeps a successful browser subprocess separate from verified delivery", async () => {
    const { classifyBridgeCompletion } = await import("../localCodingControlBridgeService.js");
    expect(classifyBridgeCompletion({
      status: "COMPLETED",
      details: { browserConfirmed: true, sourceReplyDeliveryState: "missing", replayInvalid: true },
    })).toEqual({
      statusCode: "JOB_COMPLETED",
      deliveryCode: "UNKNOWN_UNVERIFIED",
      e2eCode: "UNKNOWN_UNVERIFIED",
    });
  });

  it("allows independently checked SSH output without inferring callback success", async () => {
    const { classifyBridgeCompletion } = await import("../localCodingControlBridgeService.js");
    expect(classifyBridgeCompletion({
      status: "COMPLETED",
      details: { mode: "ssh-readonly-hostinger", sshVerified: true, exitCode: 0 },
    })).toEqual({
      statusCode: "RESULT_VERIFIED",
      deliveryCode: "UNKNOWN_UNVERIFIED",
      e2eCode: "UNKNOWN_UNVERIFIED",
    });
  });

  it("does not classify a failed worker as completed", async () => {
    const { classifyBridgeCompletion } = await import("../localCodingControlBridgeService.js");
    expect(classifyBridgeCompletion({ status: "FAILED" }).statusCode).toBe("FAILED");
  });
});

describe("browser status code normalization", () => {
  const valid = {
    chatgptSubmitted: true,
    verifiedAssistantReply: true,
    exitCode: 0,
    eventId: "githubci-38053595144-1",
    conversationId: "6ac8d2eb-db50-83ec-b53e-3c4a0f87ba2b",
    evidenceFingerprint: "a".repeat(64),
    verifiedAt: "2026-10-10T12:56:19.738Z",
  };
  it("confirms delivery and E2E only with bounded browser receipt", async () => {
    const { classifyBridgeCompletion } = await import("../localCodingControlBridgeService.js");
    expect(classifyBridgeCompletion({ status: "COMPLETED", details: valid })).toEqual({
      statusCode: "JOB_COMPLETED", deliveryCode: "DELIVERY_CONFIRMED", e2eCode: "E2E_VERIFIED",
    });
  });
  it("does not infer delivery from a worker exit or partial claimed receipt", async () => {
    const { classifyBridgeCompletion } = await import("../localCodingControlBridgeService.js");
    for (const details of [
      { exitCode: 0 },
      { ...valid, verifiedAssistantReply: false },
      { ...valid, evidenceFingerprint: "" },
      { ...valid, conversationId: "" },
      { ...valid, exitCode: 1 },
    ]) {
      expect(classifyBridgeCompletion({ status: "COMPLETED", details }).deliveryCode).toBe("UNKNOWN_UNVERIFIED");
      expect(classifyBridgeCompletion({ status: "COMPLETED", details }).e2eCode).toBe("UNKNOWN_UNVERIFIED");
    }
    expect(classifyBridgeCompletion({ status: "FAILED", details: valid }).e2eCode).toBe("UNKNOWN_UNVERIFIED");
  });
});
