import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEV_ASSISTANT_ATTESTATION_ALGORITHM,
  DEV_ASSISTANT_ATTESTATION_KEY_ID,
  DEV_ASSISTANT_ATTESTATION_VERSION,
  deriveDevAssistantChallenge,
  devAssistantAttestationPayload,
  verifyDevAssistantAttestation,
  type DevAssistantAttestation,
} from "../devAssistantAttestation.js";

const expected = {
  ownerChannel: "ai-engine-oauth:" + "a".repeat(64),
  targetConversationId: "11111111-1111-4111-8111-111111111111",
  eventId: "b".repeat(64),
  watchCommandId: "22222222-2222-4222-8222-222222222222",
  jobId: "33333333-3333-4333-8333-333333333333",
  checkpointRevision: 1,
  workerId: "openclaw-travelintrips-dev" as const,
};
const observedAt = "2026-10-18T12:00:30.000Z";

function signed(overrides: Partial<DevAssistantAttestation> = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const unsigned = {
    version: DEV_ASSISTANT_ATTESTATION_VERSION,
    algorithm: DEV_ASSISTANT_ATTESTATION_ALGORITHM,
    keyId: DEV_ASSISTANT_ATTESTATION_KEY_ID,
    workerId: expected.workerId,
    conversationId: expected.targetConversationId,
    eventId: expected.eventId,
    challenge: deriveDevAssistantChallenge(expected),
    assistantMessageId: "44444444-4444-4444-8444-444444444444",
    assistantResponseHash: "c".repeat(64),
    observedAt,
    ...overrides,
  } as Omit<DevAssistantAttestation, "signature">;
  const signature = sign(null, Buffer.from(devAssistantAttestationPayload(unsigned), "utf8"), privateKey).toString("base64");
  return {
    details: { attestation: { ...unsigned, signature } },
    publicKeyDerBase64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

describe("DEV assistant response attestation", () => {
  it("derives a stable event-bound challenge and verifies a signed assistant receipt", () => {
    expect(deriveDevAssistantChallenge(expected)).toBe(deriveDevAssistantChallenge({ ...expected }));
    const proof = signed();
    expect(verifyDevAssistantAttestation({
      details: proof.details, expected,
      notBefore: "2026-10-18T12:00:00.000Z", receivedAt: "2026-10-18T12:00:40.000Z",
      publicKeyDerBase64: proof.publicKeyDerBase64,
    })).toMatchObject({ verified: true, reason: "VERIFIED",
      evidence: { challenge: deriveDevAssistantChallenge(expected), assistantResponseHash: "c".repeat(64) } });
  });

  it("rejects replay into another event, tampering, wrong keys and invalid time", () => {
    const proof = signed();
    expect(verifyDevAssistantAttestation({
      details: proof.details, expected: { ...expected, eventId: "d".repeat(64) },
      notBefore: "2026-10-18T12:00:00.000Z", receivedAt: "2026-10-18T12:00:40.000Z",
      publicKeyDerBase64: proof.publicKeyDerBase64,
    }).verified).toBe(false);
    const tampered = structuredClone(proof.details) as { attestation: Record<string, unknown> };
    tampered.attestation["assistantResponseHash"] = "e".repeat(64);
    expect(verifyDevAssistantAttestation({
      details: tampered, expected,
      notBefore: "2026-10-18T12:00:00.000Z", receivedAt: "2026-10-18T12:00:40.000Z",
      publicKeyDerBase64: proof.publicKeyDerBase64,
    }).verified).toBe(false);
    const other = signed();
    expect(verifyDevAssistantAttestation({
      details: proof.details, expected,
      notBefore: "2026-10-18T12:00:00.000Z", receivedAt: "2026-10-18T12:00:40.000Z",
      publicKeyDerBase64: other.publicKeyDerBase64,
    }).verified).toBe(false);
    expect(verifyDevAssistantAttestation({
      details: proof.details, expected,
      notBefore: "2026-10-18T12:02:00.000Z", receivedAt: "2026-10-18T12:02:10.000Z",
      publicKeyDerBase64: proof.publicKeyDerBase64,
    }).verified).toBe(false);
  });

  it("never accepts the legacy verifiedAssistantReply boolean without a signed receipt", () => {
    expect(verifyDevAssistantAttestation({
      details: { verifiedAssistantReply: true }, expected,
      notBefore: "2026-10-18T12:00:00.000Z", receivedAt: "2026-10-18T12:00:40.000Z",
      publicKeyDerBase64: signed().publicKeyDerBase64,
    })).toEqual({ verified: false, reason: "ATTESTATION_MISSING" });
  });
});
