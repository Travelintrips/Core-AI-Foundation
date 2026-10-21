import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { DEV_WAKE_BROWSER_PROFILE } from "./devChatGptWakeBindingService.js";

export const DEV_ASSISTANT_ATTESTATION_VERSION = 1 as const;
export const DEV_BOUND_ASSISTANT_ATTESTATION_VERSION = 2 as const;
export const DEV_ASSISTANT_ATTESTATION_ALGORITHM = "Ed25519" as const;
export const DEV_ASSISTANT_ATTESTATION_KEY_ID = "openclaw-travelintrips-dev-ed25519-v1" as const;
export const DEV_DELL_ASSISTANT_ATTESTATION_KEY_ID = "openclaw-dell-chatgpt-wake-dev-ed25519-v1" as const;
export type DevAttestationWorker = "openclaw-travelintrips-dev" | "openclaw-dell-chatgpt-wake-dev";
export function devAttestationKeyId(workerId: DevAttestationWorker) {
  return workerId === "openclaw-travelintrips-dev" ? DEV_ASSISTANT_ATTESTATION_KEY_ID : DEV_DELL_ASSISTANT_ATTESTATION_KEY_ID;
}

/** Fail closed: public keys are selected only from the authenticated DEV worker identity. */
export function devAssistantPublicKeyForWorker(workerId: string): string | undefined {
  if (workerId === "openclaw-travelintrips-dev") {
    return process.env["AI_CORE_DEV_ASSISTANT_ATTESTATION_PUBLIC_KEY_DER_B64"];
  }
  if (workerId === "openclaw-dell-chatgpt-wake-dev") {
    return process.env["AI_CORE_DEV_DELL_ASSISTANT_ATTESTATION_PUBLIC_KEY_DER_B64"];
  }
  return undefined;
}

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
  bindingFingerprint?: string;
  browserProfile?: string;
};

export type DevAssistantAttestation = {
  version: 1 | 2;
  algorithm: "Ed25519";
  keyId: typeof DEV_ASSISTANT_ATTESTATION_KEY_ID | typeof DEV_DELL_ASSISTANT_ATTESTATION_KEY_ID;
  workerId: DevAttestationWorker;
  conversationId: string;
  eventId: string;
  challenge: string;
  assistantMessageId: string;
  assistantResponseHash: string;
  observedAt: string;
  signature: string;
  bindingFingerprint?: string;
  browserProfile?: string;
};

export type DevAssistantAttestationVerification =
  | { verified: true; reason: "VERIFIED"; evidence: Omit<DevAssistantAttestation, "signature"> & { signatureFingerprint: string } }
  | { verified: false; reason: string };

function validChallengeInput(input: ChallengeInput): boolean {
  const hasWatch = input.watchCommandId !== undefined || input.jobId !== undefined || input.checkpointRevision !== undefined;
  const hasBinding = input.bindingFingerprint !== undefined || input.browserProfile !== undefined;
  return typeof input.ownerChannel === "string" && input.ownerChannel.length === 80 && OWNER.test(input.ownerChannel) &&
    typeof input.targetConversationId === "string" && input.targetConversationId.length === 36 && UUID.test(input.targetConversationId) &&
    typeof input.eventId === "string" && input.eventId.length === 64 && DIGEST.test(input.eventId) &&
    (!hasBinding || (typeof input.bindingFingerprint === "string" && DIGEST.test(input.bindingFingerprint) &&
      typeof input.browserProfile === "string" && input.browserProfile.trim() === input.browserProfile && DEV_WAKE_BROWSER_PROFILE.test(input.browserProfile))) &&
    (!hasWatch || (typeof input.watchCommandId === "string" && UUID.test(input.watchCommandId) &&
      typeof input.jobId === "string" && UUID.test(input.jobId) &&
      Number.isSafeInteger(input.checkpointRevision) && Number(input.checkpointRevision) >= 1));
}

export function deriveDevAssistantChallenge(input: ChallengeInput): string {
  if (!validChallengeInput(input)) throw new Error("DEV_ASSISTANT_ATTESTATION_CONTEXT_INVALID");
  return createHash("sha256").update([
    input.bindingFingerprint ? "dev-chatgpt-assistant-attestation/v2" : "dev-chatgpt-assistant-attestation/v1",
    input.ownerChannel,
    input.targetConversationId.toLowerCase(),
    input.eventId.toLowerCase(),
    input.watchCommandId?.toLowerCase() ?? "",
    input.jobId?.toLowerCase() ?? "",
    input.checkpointRevision === undefined ? "" : String(input.checkpointRevision),
    ...(input.bindingFingerprint ? [input.bindingFingerprint] : []),
  ].join("|")).digest("hex");
}

export function devAssistantAttestationPayload(input: Omit<DevAssistantAttestation, "signature">): string {
  return [
    input.version === 2 ? "dev-chatgpt-assistant-attestation/v2" : "dev-chatgpt-assistant-attestation/v1",
    "keyId=" + input.keyId,
    "workerId=" + input.workerId,
    "conversationId=" + input.conversationId.toLowerCase(),
    "eventId=" + input.eventId.toLowerCase(),
    "challenge=" + input.challenge.toLowerCase(),
    "assistantMessageId=" + input.assistantMessageId.toLowerCase(),
    "assistantResponseHash=" + input.assistantResponseHash.toLowerCase(),
    "observedAt=" + input.observedAt,
    ...(input.version === 2 ? ["bindingFingerprint=" + input.bindingFingerprint, "browserProfile=" + input.browserProfile] : []),
  ].join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function verifyDevAssistantAttestation(input: {
  details: Record<string, unknown>;
  expected: ChallengeInput & { workerId: DevAttestationWorker };
  notBefore: string;
  receivedAt: string;
  publicKeyDerBase64?: string;
}): DevAssistantAttestationVerification {
  const row = asRecord(input.details["attestation"]);
  if (!row) return { verified: false, reason: "ATTESTATION_MISSING" };
  if (!input.publicKeyDerBase64) return { verified: false, reason: "ATTESTATION_PUBLIC_KEY_MISSING" };

  if (!validChallengeInput(input.expected)) return { verified: false, reason: "ATTESTATION_CONTEXT_INVALID" };
  const bound = input.expected.bindingFingerprint !== undefined;
  if (bound && input.expected.workerId !== "openclaw-dell-chatgpt-wake-dev" &&
      input.expected.workerId !== "openclaw-travelintrips-dev") {
    return { verified: false, reason: "ATTESTATION_BOUND_WORKER_INVALID" };
  }
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
    bindingFingerprint: row["bindingFingerprint"],
    browserProfile: row["browserProfile"],
  };
  const version = bound ? DEV_BOUND_ASSISTANT_ATTESTATION_VERSION : DEV_ASSISTANT_ATTESTATION_VERSION;
  if (candidate.version !== version ||
      candidate.algorithm !== DEV_ASSISTANT_ATTESTATION_ALGORITHM ||
      candidate.keyId !== devAttestationKeyId(input.expected.workerId) ||
      candidate.workerId !== input.expected.workerId ||
      candidate.conversationId !== input.expected.targetConversationId.toLowerCase() ||
      candidate.eventId !== input.expected.eventId.toLowerCase() ||
      candidate.challenge !== challenge ||
      candidate.bindingFingerprint !== input.expected.bindingFingerprint ||
      candidate.browserProfile !== input.expected.browserProfile ||
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
    version,
    algorithm: DEV_ASSISTANT_ATTESTATION_ALGORITHM,
    keyId: devAttestationKeyId(input.expected.workerId),
    workerId: input.expected.workerId,
    conversationId: candidate.conversationId,
    eventId: candidate.eventId,
    challenge: candidate.challenge,
    assistantMessageId: candidate.assistantMessageId,
    assistantResponseHash: candidate.assistantResponseHash,
    observedAt: candidate.observedAt,
    ...(bound ? { bindingFingerprint: input.expected.bindingFingerprint, browserProfile: input.expected.browserProfile } : {}),
  };
  const verified = verifySignature(null, Buffer.from(devAssistantAttestationPayload(unsigned), "utf8"), publicKey, signature);
  if (!verified) return { verified: false, reason: "ATTESTATION_SIGNATURE_INVALID" };

  return { verified: true, reason: "VERIFIED", evidence: {
    ...unsigned,
    signatureFingerprint: createHash("sha256").update(signature).digest("hex"),
  } };
}
