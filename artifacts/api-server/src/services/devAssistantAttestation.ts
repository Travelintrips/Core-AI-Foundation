import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

export const DEV_ASSISTANT_ATTESTATION_VERSION = 1 as const;
export const DEV_ASSISTANT_ATTESTATION_ALGORITHM = "Ed25519" as const;
export const DEV_ASSISTANT_ATTESTATION_KEY_ID = "openclaw-travelintrips-dev-ed25519-v1" as const;

const DIGEST = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const OWNER = /^ai-engine-oauth:[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type ChallengeInput = {
  ownerChannel: string;
  targetConversationId: string;
  eventId: string;
  watchCommandId?: string;
  jobId?: string;
  checkpointRevision?: number;
};

export type DevAssistantAttestation = {
  version: 1;
  algorithm: "Ed25519";
  keyId: typeof DEV_ASSISTANT_ATTESTATION_KEY_ID;
  workerId: "openclaw-travelintrips-dev";
  conversationId: string;
  eventId: string;
  challenge: string;
  assistantMessageId: string;
  assistantResponseHash: string;
  observedAt: string;
  signature: string;
};

export type DevAssistantAttestationVerification =
  | { verified: true; reason: "VERIFIED"; evidence: Omit<DevAssistantAttestation, "signature"> & { signatureFingerprint: string } }
  | { verified: false; reason: string };

function validChallengeInput(input: ChallengeInput): boolean {
  const hasWatch = input.watchCommandId !== undefined || input.jobId !== undefined || input.checkpointRevision !== undefined;
  return OWNER.test(input.ownerChannel) && UUID.test(input.targetConversationId) && DIGEST.test(input.eventId) &&
    (!hasWatch || (typeof input.watchCommandId === "string" && UUID.test(input.watchCommandId) &&
      typeof input.jobId === "string" && UUID.test(input.jobId) &&
      Number.isSafeInteger(input.checkpointRevision) && Number(input.checkpointRevision) >= 1));
}

export function deriveDevAssistantChallenge(input: ChallengeInput): string {
  if (!validChallengeInput(input)) throw new Error("DEV_ASSISTANT_ATTESTATION_CONTEXT_INVALID");
  return createHash("sha256").update([
    "dev-chatgpt-assistant-attestation/v1",
    input.ownerChannel,
    input.targetConversationId.toLowerCase(),
    input.eventId.toLowerCase(),
    input.watchCommandId?.toLowerCase() ?? "",
    input.jobId?.toLowerCase() ?? "",
    input.checkpointRevision === undefined ? "" : String(input.checkpointRevision),
  ].join("|")).digest("hex");
}

export function devAssistantAttestationPayload(input: Omit<DevAssistantAttestation, "signature">): string {
  return [
    "dev-chatgpt-assistant-attestation/v1",
    "keyId=" + input.keyId,
    "workerId=" + input.workerId,
    "conversationId=" + input.conversationId.toLowerCase(),
    "eventId=" + input.eventId.toLowerCase(),
    "challenge=" + input.challenge.toLowerCase(),
    "assistantMessageId=" + input.assistantMessageId.toLowerCase(),
    "assistantResponseHash=" + input.assistantResponseHash.toLowerCase(),
    "observedAt=" + input.observedAt,
  ].join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function verifyDevAssistantAttestation(input: {
  details: Record<string, unknown>;
  expected: ChallengeInput & { workerId: "openclaw-travelintrips-dev" };
  notBefore: string;
  receivedAt: string;
  publicKeyDerBase64?: string;
}): DevAssistantAttestationVerification {
  const row = asRecord(input.details["attestation"]);
  if (!row) return { verified: false, reason: "ATTESTATION_MISSING" };
  if (!input.publicKeyDerBase64) return { verified: false, reason: "ATTESTATION_PUBLIC_KEY_MISSING" };

  const challenge = deriveDevAssistantChallenge(input.expected);
  const candidate = {
    version: row["version"],
    algorithm: row["algorithm"],
    keyId: row["keyId"],
    workerId: row["workerId"],
    conversationId: row["conversationId"],
    eventId: row["eventId"],
    challenge: row["challenge"],
    assistantMessageId: row["assistantMessageId"],
    assistantResponseHash: row["assistantResponseHash"],
    observedAt: row["observedAt"],
    signature: row["signature"],
  };
  if (candidate.version !== DEV_ASSISTANT_ATTESTATION_VERSION ||
      candidate.algorithm !== DEV_ASSISTANT_ATTESTATION_ALGORITHM ||
      candidate.keyId !== DEV_ASSISTANT_ATTESTATION_KEY_ID ||
      candidate.workerId !== input.expected.workerId ||
      candidate.conversationId !== input.expected.targetConversationId.toLowerCase() ||
      candidate.eventId !== input.expected.eventId.toLowerCase() ||
      candidate.challenge !== challenge ||
      typeof candidate.assistantMessageId !== "string" || !UUID.test(candidate.assistantMessageId) ||
      typeof candidate.assistantResponseHash !== "string" || !DIGEST.test(candidate.assistantResponseHash) ||
      typeof candidate.observedAt !== "string" || !ISO.test(candidate.observedAt) ||
      typeof candidate.signature !== "string") {
    return { verified: false, reason: "ATTESTATION_FIELDS_INVALID" };
  }

  const observedMs = Date.parse(candidate.observedAt);
  const notBeforeMs = Date.parse(input.notBefore);
  const receivedMs = Date.parse(input.receivedAt);
  if (!Number.isFinite(observedMs) || !Number.isFinite(notBeforeMs) || !Number.isFinite(receivedMs) ||
      observedMs < notBeforeMs - 60_000 || observedMs > receivedMs + 60_000 ||
      receivedMs - observedMs > 10 * 60_000) {
    return { verified: false, reason: "ATTESTATION_TIME_INVALID" };
  }

  let signature: Buffer;
  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    signature = Buffer.from(candidate.signature, "base64");
    if (signature.length !== 64 || signature.toString("base64") !== candidate.signature) {
      return { verified: false, reason: "ATTESTATION_SIGNATURE_ENCODING_INVALID" };
    }
    const keyBytes = Buffer.from(input.publicKeyDerBase64, "base64");
    if (keyBytes.length < 32 || keyBytes.toString("base64") !== input.publicKeyDerBase64) {
      return { verified: false, reason: "ATTESTATION_PUBLIC_KEY_INVALID" };
    }
    publicKey = createPublicKey({ key: keyBytes, format: "der", type: "spki" });
  } catch {
    return { verified: false, reason: "ATTESTATION_CRYPTO_INPUT_INVALID" };
  }

  const unsigned: Omit<DevAssistantAttestation, "signature"> = {
    version: DEV_ASSISTANT_ATTESTATION_VERSION,
    algorithm: DEV_ASSISTANT_ATTESTATION_ALGORITHM,
    keyId: DEV_ASSISTANT_ATTESTATION_KEY_ID,
    workerId: input.expected.workerId,
    conversationId: candidate.conversationId,
    eventId: candidate.eventId,
    challenge: candidate.challenge,
    assistantMessageId: candidate.assistantMessageId,
    assistantResponseHash: candidate.assistantResponseHash,
    observedAt: candidate.observedAt,
  };
  const verified = verifySignature(null, Buffer.from(devAssistantAttestationPayload(unsigned), "utf8"), publicKey, signature);
  if (!verified) return { verified: false, reason: "ATTESTATION_SIGNATURE_INVALID" };

  return { verified: true, reason: "VERIFIED", evidence: {
    ...unsigned,
    signatureFingerprint: createHash("sha256").update(signature).digest("hex"),
  } };
}
