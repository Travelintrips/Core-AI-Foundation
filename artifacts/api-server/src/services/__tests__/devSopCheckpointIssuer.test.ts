import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { issueVerifiedDevSopCheckpoint, parseDevSopCheckpointIntent, verifyDevSopCheckpointReceipt } from "../devSopCheckpointIssuer.js";

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
  it("accepts only a single exact DIL escape wrapper around attested raw JSON", () => {
    const wrapped = `<escape>${message}</escape>`;
    expect(parseDevSopCheckpointIntent(wrapped)?.checkpointId).toBe("cp-1");
    const wrappedHash = createHash("sha256").update(wrapped).digest("hex");
    const signed = issue({ message: wrapped, assistantResponseHash: wrappedHash });
    expect(signed.commandId).toBe("cmd-1");
    expect(() => issue({ message: wrapped, assistantResponseHash: hash })).toThrow();
    for (const invalid of [
      `\`\`\`json\n${message}\n\`\`\``,
      `<escape><escape>${message}</escape></escape>`,
      `<escape>${message}</escape>trailing`,
      `<div>${message}</div>`,
      `<escape>${message}</escape><escape>${message}</escape>`,
    ]) expect(parseDevSopCheckpointIntent(invalid)).toBeNull();
  });
  it("never extracts a checkpoint from ordinary replies", () => {
    expect(parseDevSopCheckpointIntent("completed")).toBeNull();
    expect(parseDevSopCheckpointIntent('{"kind":"COMPLETED"}')).toBeNull();
    expect(parseDevSopCheckpointIntent(message)?.checkpointId).toBe("cp-1");
  });
});


describe("DEV checkpoint signature verification for recovery", () => {
  const sample = () => {
    const receipt = issue();
    return {
      receipt, commandId: receipt.commandId,
      issuerPrivateKeyDerBase64: key,
      checkpoint: {
        jobId: receipt.jobId, checkpointId: receipt.checkpointId,
        sopVersion: receipt.sopVersion, nextStepId: receipt.nextStepId,
      },
      responseMetadata: {
        verified: true, checkpointVerified: true, verifiedAssistantReply: true,
        jobId: receipt.jobId, sopVersion: receipt.sopVersion,
        attestation: { algorithm: "Ed25519", signature: receipt.signature },
      },
    };
  };
  it("validates the real issuer signature and exact command fields", () => {
    expect(verifyDevSopCheckpointReceipt(sample())).toBe(true);
  });
  it("rejects an invalid or missing issuer key", () => {
    expect(verifyDevSopCheckpointReceipt({ ...sample(), issuerPrivateKeyDerBase64: undefined })).toBe(false);
    expect(verifyDevSopCheckpointReceipt({ ...sample(), issuerPrivateKeyDerBase64: "ZmFrZQ==" })).toBe(false);
  });
  it("rejects cross-command, tampered checkpoint and forged signature", () => {
    const good = sample();
    expect(verifyDevSopCheckpointReceipt({ ...good, commandId: "other-command" })).toBe(false);
    expect(verifyDevSopCheckpointReceipt({ ...good, checkpoint: { ...good.checkpoint, checkpointId: "fake" } })).toBe(false);
    expect(verifyDevSopCheckpointReceipt({ ...good, receipt: { ...good.receipt, nextStepId: "fake" } })).toBe(false);
    expect(verifyDevSopCheckpointReceipt({ ...good, responseMetadata: { ...good.responseMetadata, attestation: { algorithm: "Ed25519", signature: "bogus" } } })).toBe(false);
  });
  it("rejects unverified worker-supplied checkpoint and malformed receipt", () => {
    const good = sample();
    expect(verifyDevSopCheckpointReceipt({ ...good, responseMetadata: { ...good.responseMetadata, checkpointVerified: false } })).toBe(false);
    expect(verifyDevSopCheckpointReceipt({ ...good, receipt: {} })).toBe(false);
    expect(verifyDevSopCheckpointReceipt({ ...good, receipt: null })).toBe(false);
  });
});
