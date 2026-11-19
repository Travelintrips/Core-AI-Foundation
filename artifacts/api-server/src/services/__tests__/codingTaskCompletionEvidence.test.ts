import { describe, expect, it, vi } from "vitest";
const dbMock = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(), asc: vi.fn(), eq: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  db: dbMock,
  aiCodingTasksTable: { id: "id", status: "status" },
  aiCodingBridgeCommandsTable: { id:"cmdId", metadataJson:"cmdMetadata" },
  aiCodingBridgeResponsesTable: {
    id:"id", kind:"kind", commandId:"commandId",
    taskId:"taskId", createdAt:"createdAt", acknowledgedAt:"acknowledgedAt",
    checkpointJson:"checkpointJson", metadataJson:"metadataJson",
  },
}));
import { getCodingTaskCompletionEvidence } from "../codingTaskCompletionEvidence.js";
function chain(result: unknown) {
  const value: any = { from: () => value, leftJoin: () => value, where: () => value, limit: async () => result,
    orderBy: async () => result };
  return value;
}
describe("read-only task evidence", () => {
  it("fails closed without a task", async () => {
    dbMock.select.mockReturnValueOnce(chain([]));
    expect((await getCodingTaskCompletionEvidence("test")).notificationAuthorized).toBe(false);
  });
  it("rejects ACK from an unrelated command", async () => {
    dbMock.select.mockReturnValueOnce(chain([{status:"COMPLETED"}]))
      .mockReturnValueOnce(chain([{id:"a",kind:"ACK",commandId:"old",createdAt:new Date(),acknowledgedAt:null},
        {id:"b",kind:"COMPLETED",commandId:"new",createdAt:new Date(),acknowledgedAt:null}]));
    const result = await getCodingTaskCompletionEvidence("test");
    expect(result.found).toBe(true);
    if (result.found) expect(result.bridgeCompleted).toBe(false);
  });
  it("rejects completion with no progress", async () => {
    dbMock.select.mockReturnValueOnce(chain([{status:"COMPLETED"}]))
      .mockReturnValueOnce(chain([
        {id:"a",kind:"ACK",commandId:"c"},
        {id:"b",kind:"COMPLETED",commandId:"c"},
      ]));
    const result=await getCodingTaskCompletionEvidence("test");
    if(result.found) expect(result.bridgeCompleted).toBe(false);
  });
  it("rejects failed terminal after completed event", async () => {
    dbMock.select.mockReturnValueOnce(chain([{status:"COMPLETED"}]))
      .mockReturnValueOnce(chain([
        {id:"a",kind:"ACK",commandId:"c"},
        {id:"p",kind:"PROGRESS",commandId:"c"},
        {id:"b",kind:"COMPLETED",commandId:"c"},
        {id:"f",kind:"FAILED",commandId:"c"},
      ]));
    const result=await getCodingTaskCompletionEvidence("test");
    if(result.found) expect(result.bridgeCompleted).toBe(false);
  });
  it("reports completed command while keeping pending parent task unverified", async () => {
    dbMock.select.mockReturnValueOnce(chain([{status:"PENDING"}]))
      .mockReturnValueOnce(chain([
        {id:"a",kind:"ACK",commandId:"c"},
        {id:"p",kind:"PROGRESS",commandId:"c"},
        {id:"b",kind:"COMPLETED",commandId:"c"},
      ]));
    const result=await getCodingTaskCompletionEvidence("test");
    if (!result.found) throw new Error("expected task");
    expect(result.commandLifecycleCompleted).toBe(true);
    expect(result.taskCompletionPending).toBe(true);
    expect(result.bridgeCompleted).toBe(false);
    expect(result.notificationAuthorized).toBe(false);
  });
  it("never grants notification based on bridge completion alone", async () => {
    dbMock.select.mockReturnValueOnce(chain([{status:"COMPLETED"}]))
      .mockReturnValueOnce(chain([{id:"a",kind:"ACK",commandId:"c",createdAt:new Date(),acknowledgedAt:null},
        {id:"p",kind:"PROGRESS",commandId:"c",createdAt:new Date(),acknowledgedAt:null},
        {id:"b",kind:"COMPLETED",commandId:"c",createdAt:new Date(),acknowledgedAt:null}]));
    const result = await getCodingTaskCompletionEvidence("test");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.hasAck).toBe(true);
      expect(result.bridgeCompleted).toBe(true);
      expect(result.notificationAuthorized).toBe(false);
    }
  });
});


describe("checkpoint evidence cannot be promoted by a generic ACK", () => {
  it("rejects generic ACK even if checkpoint row has a timestamp", async () => {
    dbMock.select.mockReturnValueOnce(chain([{ status: "PENDING" }]))
      .mockReturnValueOnce(chain([
        { id: "cp1", kind: "CHECKPOINT", commandId: "cmd1", createdAt: new Date(1000),
          acknowledgedAt: new Date(2000), metadataJson: { verified: true }, checkpointJson: {}, commandMetadata: {} },
        { id: "blocked", kind: "BLOCKER", commandId: "cmd1", createdAt: new Date(3000), acknowledgedAt: null },
      ]));
    const result = await getCodingTaskCompletionEvidence("task");
    if (!result.found) throw new Error("expected task");
    const lifecycle = result.lifecycleByCommand[0];
    expect(lifecycle.latestCheckpointAcknowledged).toBe(true);
    expect(lifecycle.latestCheckpointAttested).toBe(false);
    expect(lifecycle.latestCheckpointReceiverAckVerified).toBe(false);
    expect(lifecycle.needsWorkerHealthAndAuthorization).toBe(false);
  });
  it("accepts only the issuer-attested checkpoint with exact authenticated MCP ACK", async () => {
    const { generateKeyPairSync, createHash } = await import("node:crypto");
    const { issueVerifiedDevSopCheckpoint } = await import("../devSopCheckpointIssuer.js");
    const keys = generateKeyPairSync("ed25519");
    const privateKey = keys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    const intent = { kind: "SOP_CHECKPOINT", status: "PAUSED", jobId: "test-job", commandId: "cmd1",
      correlationId: "corr1", checkpointId: "cp-test", sopVersion: "v1", nextStepId: "step2" };
    const message = JSON.stringify(intent);
    const receipt = issueVerifiedDevSopCheckpoint({ message, intent, verifiedAssistantReceipt: true,
      assistantResponseHash: createHash("sha256").update(message).digest("hex"), commandId: "cmd1",
      correlationId: "corr1", privateKeyPkcs8DerBase64: privateKey,
      issuedAt: "2026-11-07T12:55:00.000Z" });
    const checkpoint = { jobId: receipt.jobId, checkpointId: receipt.checkpointId,
      nextStepId: receipt.nextStepId, sopVersion: receipt.sopVersion };
    const metadata = { verified: true, checkpointVerified: true, verifiedAssistantReply: true,
      jobId: receipt.jobId, sopVersion: receipt.sopVersion,
      checkpointReceipt: receipt, attestation: { algorithm: "Ed25519", signature: receipt.signature } };
    const commandMetadata = { mcpAckResponseId: "cp1", mcpAckConversationId: "trusted-conversation",
      mcpAcknowledgedAt: "2026-11-07T12:55:01.000Z", e2eCode: "MCP_ACK_VERIFIED", deliveryCode: "DELIVERY_CONFIRMED" };
    const responseRows = (commandMetadataOverride = commandMetadata) => [
      { id: "cp1", kind: "CHECKPOINT", commandId: "cmd1", createdAt: new Date(1000),
        acknowledgedAt: new Date(2000), metadataJson: metadata, checkpointJson: checkpoint,
        commandMetadata: commandMetadataOverride },
      { id: "blocked", kind: "BLOCKER", commandId: "cmd1", createdAt: new Date(3000), acknowledgedAt: null },
    ];
    const prior = process.env["AI_CORE_DEV_CHECKPOINT_PRIVATE_KEY_PKCS8_DER_B64"];
    process.env["AI_CORE_DEV_CHECKPOINT_PRIVATE_KEY_PKCS8_DER_B64"] = privateKey;
    try {
      dbMock.select.mockReturnValueOnce(chain([{ status: "PENDING" }]))
        .mockReturnValueOnce(chain(responseRows()));
      const verified = await getCodingTaskCompletionEvidence("task");
      if (!verified.found) throw new Error("expected task");
      expect(verified.lifecycleByCommand[0].latestCheckpointAttested).toBe(true);
      expect(verified.lifecycleByCommand[0].latestCheckpointReceiverAckVerified).toBe(true);
      expect(verified.lifecycleByCommand[0].needsWorkerHealthAndAuthorization).toBe(true);
      expect(verified.lifecycleByCommand[0].mayAutoResume).toBe(false);

      dbMock.select.mockReturnValueOnce(chain([{ status: "PENDING" }]))
        .mockReturnValueOnce(chain(responseRows({ ...commandMetadata, mcpAckResponseId: "some-other-response" })));
      const mismatched = await getCodingTaskCompletionEvidence("task");
      if (!mismatched.found) throw new Error("expected task");
      expect(mismatched.lifecycleByCommand[0].latestCheckpointAttested).toBe(true);
      expect(mismatched.lifecycleByCommand[0].latestCheckpointReceiverAckVerified).toBe(false);
      expect(mismatched.lifecycleByCommand[0].needsWorkerHealthAndAuthorization).toBe(false);
    } finally {
      if (prior === undefined) delete process.env["AI_CORE_DEV_CHECKPOINT_PRIVATE_KEY_PKCS8_DER_B64"];
      else process.env["AI_CORE_DEV_CHECKPOINT_PRIVATE_KEY_PKCS8_DER_B64"] = prior;
    }
  });
});
