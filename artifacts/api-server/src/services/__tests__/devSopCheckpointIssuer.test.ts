import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { issueVerifiedDevSopCheckpoint, parseDevSopCheckpointIntent } from "../devSopCheckpointIssuer.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const key = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const intent = {
  kind: "SOP_CHECKPOINT", status: "PAUSED", jobId: "job-1",
  commandId: "cmd-1", correlationId: "corr-1", checkpointId: "cp-1",
  sopVersion: "v1", nextStepId: "step-2",
};
const message = JSON.stringify(intent);
const hash = createHash("sha256").update(message).digest("hex");
const issue = (options: Partial<Parameters<typeof issueVerifiedDevSopCheckpoint>[0]> = {}) =>
  issueVerifiedDevSopCheckpoint({
    message, intent, verifiedAssistantReceipt: true,
    assistantResponseHash: hash, commandId: "cmd-1", correlationId: "corr-1",
    privateKeyPkcs8DerBase64: key, issuedAt: "2026-10-27T08:00:00.000Z", ...options,
  });

describe("DEV checkpoint issuer", () => {
  it("signs exactly the canonical checkpoint bound to the command", () => {
    const r = issue();
    const text = ["ai-core-dev-checkpoint/v1", r.jobId, r.commandId, r.correlationId,
      r.checkpointId, r.sopVersion, r.nextStepId, r.issuedAt].join("\n");
    expect(verify(null, Buffer.from(text), publicKey, Buffer.from(r.signature, "base64"))).toBe(true);
  });
  it("rejects unverified, tampered, or cross-command messages", () => {
    expect(() => issue({ verifiedAssistantReceipt: false })).toThrow();
    expect(() => issue({ assistantResponseHash: "f".repeat(64) })).toThrow();
    expect(() => issue({ commandId: "cmd-2" })).toThrow();
    expect(() => issue({ privateKeyPkcs8DerBase64: undefined })).toThrow();
  });
  it("never extracts a checkpoint from ordinary replies", () => {
    expect(parseDevSopCheckpointIntent("completed")).toBeNull();
    expect(parseDevSopCheckpointIntent('{"kind":"COMPLETED"}')).toBeNull();
    expect(parseDevSopCheckpointIntent(message)?.checkpointId).toBe("cp-1");
  });
});
