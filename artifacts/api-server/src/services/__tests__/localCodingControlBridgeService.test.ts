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

  it("verifies deterministic PC hostname without treating it as callback ACK", async () => {
    const { classifyBridgeCompletion } = await import("../localCodingControlBridgeService.js");
    const proof = {
      runtime: "openclaw-pc", mode: "model-free-hostname",
      workerId: "openclaw-pc-worker", hostname: "Travelintrips",
      verified: true, modelInvoked: false, exitCode: 0,
    };
    expect(classifyBridgeCompletion({ status: "COMPLETED", details: proof })).toEqual({
      statusCode: "RESULT_VERIFIED",
      deliveryCode: "UNKNOWN_UNVERIFIED",
      e2eCode: "UNKNOWN_UNVERIFIED",
    });
    expect(classifyBridgeCompletion({ status: "COMPLETED", details: { ...proof, hostname: "DELL" } }).statusCode)
      .toBe("JOB_COMPLETED");
    expect(classifyBridgeCompletion({ status: "COMPLETED", details: { ...proof, modelInvoked: true } }).statusCode)
      .toBe("JOB_COMPLETED");
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
  it("classifies a direct OpenClaw ChatGPT receipt as verified without MCP fields", async () => {
    const { classifyBridgeCompletion } = await import("../localCodingControlBridgeService.js");
    const directReceipt = {
      runtime: "openclaw-pc2-browser",
      eventId: "174da253-63d1-4d18-ad20-c71398126a22",
      conversationId: "6ad866a0-47ec-83ec-9604-c81b2618a5f4",
      chatgptSubmitted: true,
      verifiedAssistantReply: true,
      evidenceFingerprint: "8f5b1e84fc715f6c5decb3e23fda6784aefe0be36e44d70034f1c5e378a109d9",
      verifiedAt: "2026-10-21T07:22:36.242Z",
      exitCode: 0,
    };
    expect(classifyBridgeCompletion({ status: "COMPLETED", details: directReceipt })).toEqual({
      statusCode: "JOB_COMPLETED",
      deliveryCode: "DELIVERY_CONFIRMED",
      e2eCode: "E2E_VERIFIED",
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

describe("callback PROCESSING visibility", () => {
  it("keeps nonterminal dispatched callbacks visible until they complete", async () => {
    const { classifyCallbackProcessingState } = await import("../localCodingControlBridgeService.js");
    expect(classifyCallbackProcessingState({ status: "PENDING" })).toBe("QUEUED");
    expect(classifyCallbackProcessingState({ status: "QUEUED" })).toBe("QUEUED");
    expect(classifyCallbackProcessingState({ status: "PROCESSING" })).toBe("PROCESSING");
    expect(classifyCallbackProcessingState({ status: "RUNNING" })).toBe("PROCESSING");
    expect(classifyCallbackProcessingState({ status: "COMPLETED" })).toBe("COMPLETED");
    expect(classifyCallbackProcessingState({ status: "FAILED" })).toBe("FAILED");
    expect(classifyCallbackProcessingState({ status: "CANCELLED" })).toBe("FAILED");
  });
});


describe("verified MCP handshake evidence", () => {
  it("requires owner-bound MCP ACK and a valid Ed25519 assistant receipt", async () => {
    const { generateKeyPairSync, sign } = await import("node:crypto");
    const bridge = await import("../localCodingControlBridgeService.js");
    const attestationModule = await import("../devAssistantAttestation.js");
    const ownerChannel = "ai-engine-oauth:" + "a".repeat(64);
    const targetConversationId = "6ad4e0a7-9964-83ec-81a6-9db5eb8457ae";
    const eventId = "b".repeat(64);
    const workerId = "openclaw-dell-chatgpt-wake-dev" as const;
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    vi.stubEnv("AI_CORE_DEV_DELL_ASSISTANT_ATTESTATION_PUBLIC_KEY_DER_B64",
      publicKey.export({ format: "der", type: "spki" }).toString("base64"));
    const commandReceivedAt = "2026-10-20T00:00:00.000Z";
    const responseCreatedAt = "2026-10-20T00:00:30.000Z";
    const responseId = "22222222-2222-4222-8222-222222222222";
    const expected = { ownerChannel, targetConversationId, eventId, workerId };
    const unsigned = {
      version: attestationModule.DEV_ASSISTANT_ATTESTATION_VERSION,
      algorithm: attestationModule.DEV_ASSISTANT_ATTESTATION_ALGORITHM,
      keyId: attestationModule.DEV_DELL_ASSISTANT_ATTESTATION_KEY_ID,
      workerId,
      conversationId: targetConversationId,
      eventId,
      challenge: attestationModule.deriveDevAssistantChallenge(expected),
      assistantMessageId: "33333333-3333-4333-8333-333333333333",
      assistantResponseHash: "c".repeat(64),
      observedAt: "2026-10-20T00:00:20.000Z",
    } as const;
    const attestation = {
      ...unsigned,
      signature: sign(null, Buffer.from(attestationModule.devAssistantAttestationPayload(unsigned), "utf8"), privateKey).toString("base64"),
    };
    const base = {
      commandId: "11111111-1111-4111-8111-111111111111",
      commandReceivedAt,
      commandMetadata: {
        assignedClientId: workerId, completedBy: workerId,
        conversationId: ownerChannel, mcpAckConversationId: ownerChannel,
        targetConversationId, eventId, capability: "chatgpt:wake",
        assistantAttestationChallenge: attestationModule.deriveDevAssistantChallenge(expected),
        explicitWorkerTarget: true, deliveryCode: "DELIVERY_CONFIRMED",
        e2eCode: "MCP_ACK_VERIFIED", mcpAckResponseId: responseId,
      },
      responseId,
      responseMetadata: {
        deliveryCode: "DELIVERY_CONFIRMED", e2eCode: "E2E_VERIFIED",
        browserConfirmed: true, browserPairingVerified: true,
        chatgptSubmitted: true, verifiedAssistantReply: true, exitCode: 0,
        conversationId: targetConversationId, eventId, attestation,
      },
      responseCreatedAt,
      acknowledgedAt: "2026-10-20T00:00:31.000Z",
    };
    expect(bridge.verifyMcpHandshakeEvidenceRow(ownerChannel, base)).toMatchObject({
      browserWakeVerified: true, conversationAckVerified: true,
      targetConversationId, workerId, eventId,
    });
    expect(bridge.verifyMcpHandshakeEvidenceRow(ownerChannel, {
      ...base, responseMetadata: { ...base.responseMetadata, eventId: "d".repeat(64) },
    })).toBeNull();
    expect(bridge.verifyMcpHandshakeEvidenceRow(ownerChannel, {
      ...base, commandMetadata: { ...base.commandMetadata, mcpAckConversationId: "ai-engine-oauth:" + "f".repeat(64) },
    })).toBeNull();
    expect(bridge.verifyMcpHandshakeEvidenceRow(ownerChannel, {
      ...base, responseMetadata: { ...base.responseMetadata, attestation: { ...attestation, signature: "A".repeat(88) } },
    })).toBeNull();
    vi.unstubAllEnvs();
  });
});
