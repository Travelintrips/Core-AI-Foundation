import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveDevAssistantChallenge, devAssistantAttestationPayload, DEV_DELL_ASSISTANT_ATTESTATION_KEY_ID, type DevAssistantAttestation } from "../devAssistantAttestation.js";
import { DEV_WAKE_DELL_WORKER, devWakeBindingFingerprint, type DevWakeBinding } from "../devChatGptWakeBindingService.js";
import { devWakeAttestationExpected, verifyDevWakeCommandReceipt } from "../devChatGptWakeEvidenceService.js";

const tuple = { version: 1, accountAlias: "GPT02", ownerChannel: "ai-engine-oauth:" + "d".repeat(64),
  targetConversationId: "22222222-2222-4222-8222-222222222222", workerId: DEV_WAKE_DELL_WORKER,
  browserProfile: "travelincars-dev" } as const;
const wakeBinding: DevWakeBinding = { ...tuple, bindingFingerprint: devWakeBindingFingerprint(tuple) };
const expected = { ownerChannel: tuple.ownerChannel, targetConversationId: tuple.targetConversationId,
  workerId: tuple.workerId, eventId: "b".repeat(64), bindingFingerprint: wakeBinding.bindingFingerprint, browserProfile: tuple.browserProfile };
const metadata = { assignedClientId: tuple.workerId, conversationId: tuple.ownerChannel, targetConversationId: tuple.targetConversationId,
  eventId: expected.eventId, assistantAttestationChallenge: deriveDevAssistantChallenge(expected),
  capability: "chatgpt:wake", explicitWorkerTarget: true, devOnly: true, wakeBinding };
const notBefore = "2026-10-20T10:00:00.000Z";
const receivedAt = "2026-10-20T10:00:30.000Z";

function proof() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const unsigned: Omit<DevAssistantAttestation, "signature"> = { version: 2, algorithm: "Ed25519",
    keyId: DEV_DELL_ASSISTANT_ATTESTATION_KEY_ID, workerId: tuple.workerId, conversationId: tuple.targetConversationId,
    eventId: expected.eventId, challenge: deriveDevAssistantChallenge(expected),
    assistantMessageId: "44444444-4444-4444-8444-444444444444", assistantResponseHash: "c".repeat(64),
    observedAt: "2026-10-20T10:00:20.000Z", bindingFingerprint: wakeBinding.bindingFingerprint, browserProfile: tuple.browserProfile };
  const attestation = { ...unsigned, signature: sign(null, Buffer.from(devAssistantAttestationPayload(unsigned)), privateKey).toString("base64") };
  return { metadata, notBefore, receivedAt, publicKeyDerBase64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    details: { conversationId: tuple.targetConversationId, eventId: expected.eventId, browserConfirmed: true,
      browserPairingVerified: true, chatgptSubmitted: true, verifiedAssistantReply: true, exitCode: 0, attestation } };
}

describe("profile-bound receipt contract", () => {
  it("matches worker challenge vectors including the checkpoint revision", () => {
    expect(deriveDevAssistantChallenge(expected)).toBe("2a4c9bcdf77cb321930750a835f29cd065d70c1ea8b20f8a4c302853b6267a2a");
    expect(deriveDevAssistantChallenge({ ...expected, watchCommandId: "55555555-5555-4555-8555-555555555555",
      jobId: "66666666-6666-4666-8666-666666666666", checkpointRevision: 7 }))
      .toBe("79960f0819bca525e9f2930fc13b4c94b538c06fc0860686b4d051f84d53feec");
    expect(devWakeAttestationExpected(metadata)).toEqual(expected);
    expect(verifyDevWakeCommandReceipt(proof()).verified).toBe(true);
  });

  it("rejects cross-account/profile replay, stripped binding and signed-field tampering", () => {
    const args = proof();
    for (const changed of [
      { ...metadata, conversationId: "ai-engine-oauth:" + "a".repeat(64) },
      { ...metadata, targetConversationId: "11111111-1111-4111-8111-111111111111" },
      { ...metadata, wakeBinding: undefined },
      { ...metadata, wakeBinding: { ...wakeBinding, browserProfile: "other-dev" } },
      { ...metadata, assistantAttestationChallenge: "f".repeat(64) },
      { ...metadata, devContinuity: {} },
    ]) expect(verifyDevWakeCommandReceipt({ ...args, metadata: changed }).verified).toBe(false);
    for (const changed of [{ version: 1 }, { browserProfile: "other-dev" }, { bindingFingerprint: "f".repeat(64) },
      { assistantResponseHash: "d".repeat(64) }, { workerId: "openclaw-travelintrips-dev" }]) {
      expect(verifyDevWakeCommandReceipt({ ...args, details: { ...args.details,
        attestation: { ...args.details.attestation, ...changed } } }).verified).toBe(false);
    }
  });

  it("requires real signed assistant evidence and matching callback fields", () => {
    const args = proof();
    for (const changed of [{ attestation: undefined }, { conversationId: "wrong" }, { verifiedAssistantReply: false },
      { browserPairingVerified: false }, { exitCode: 1 }]) {
      expect(verifyDevWakeCommandReceipt({ ...args, details: { ...args.details, ...changed } }).verified).toBe(false);
    }
    expect(verifyDevWakeCommandReceipt({ ...args, publicKeyDerBase64: proof().publicKeyDerBase64 }).verified).toBe(false);
    expect(verifyDevWakeCommandReceipt({ ...args, receivedAt: "2026-10-20T11:00:00.000Z" }).verified).toBe(false);
  });
});
