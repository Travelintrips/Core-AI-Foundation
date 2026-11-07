import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";
import { issueVerifiedDevSopCheckpoint } from "../devSopCheckpointIssuer.js";
import { verifiedSignedCheckpointMcpEvent } from "../mcpSignedCheckpointEventService.js";
const keys = generateKeyPairSync("ed25519");
const key = keys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
function valid() {
  const intent = { kind: "SOP_CHECKPOINT", status: "PAUSED", jobId: "job1", commandId: "cmd1",
    correlationId: "corr1", checkpointId: "cp1", sopVersion: "v1", nextStepId: "step2" };
  const message = JSON.stringify(intent);
  const receipt = issueVerifiedDevSopCheckpoint({ message, intent, commandId: "cmd1", correlationId: "corr1",
    verifiedAssistantReceipt: true, assistantResponseHash: createHash("sha256").update(message).digest("hex"),
    privateKeyPkcs8DerBase64: key, issuedAt: "2026-11-07T13:30:00.000Z" });
  return { kind: "CHECKPOINT", commandId: "cmd1", issuerPrivateKeyDerBase64: key,
    checkpoint: { jobId: receipt.jobId, checkpointId: receipt.checkpointId,
      sopVersion: receipt.sopVersion, nextStepId: receipt.nextStepId },
    metadata: { verified: true, checkpointVerified: true, verifiedAssistantReply: true,
      jobId: receipt.jobId, sopVersion: receipt.sopVersion, checkpointReceipt: receipt,
      attestation: { algorithm: "Ed25519", signature: receipt.signature } },
  };
}
describe("MCP signed checkpoint event", () => {
  it("accepts the actual issuer-signed checkpoint", () => {
    expect(verifiedSignedCheckpointMcpEvent(valid())).toBe("CHECKPOINT");
  });
  it("rejects worker self-attestation and wrong command identity", () => {
    const good = valid();
    expect(verifiedSignedCheckpointMcpEvent({ ...good, commandId: "other" })).toBeNull();
    expect(verifiedSignedCheckpointMcpEvent({ ...good, metadata: { ...good.metadata, checkpointReceipt: {} } })).toBeNull();
    expect(verifiedSignedCheckpointMcpEvent({ ...good, metadata: { ...good.metadata, verifiedAssistantReply: false } })).toBeNull();
  });
  it("rejects missing key, incorrect kind, tampered checkpoint", () => {
    const good = valid();
    expect(verifiedSignedCheckpointMcpEvent({ ...good, issuerPrivateKeyDerBase64: undefined })).toBeNull();
    expect(verifiedSignedCheckpointMcpEvent({ ...good, kind: "FAILED" })).toBeNull();
    expect(verifiedSignedCheckpointMcpEvent({ ...good, checkpoint: { ...good.checkpoint, nextStepId: "other" } })).toBeNull();
  });
});
