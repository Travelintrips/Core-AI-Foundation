import { createPublicKey, verify } from "node:crypto";

/** DEV-only, read-only receiver proof verification; not an ACK writer. */
export interface NativeCheckpointAckEvidence {
  version: 1;
  commandId: string;
  responseId: string;
  eventId: string;
  conversationId: string;
  workerId: string;
  browserProfile: string;
  bindingFingerprint: string;
  readerTargetId: string;
  originalTargetId: string;
  replySha256: string;
  observedAt: string;
  signatureBase64: string;
}

export type NativeCheckpointAckExpectation = {
  commandId: string;
  responseId: string;
  eventId: string;
  conversationId: string;
  workerId: string;
  browserProfile: string;
  bindingFingerprint: string;
  /** Original and temporary reader targets must both be present in the live CDP capture. */
  originalTargetId: string;
  readerTargetId: string;
  replySha256: string;
  checkpointCreatedAt: Date;
  now: Date;
  workerPublicKeyDerBase64?: string;
  tokenOwner: string;
  devHost: boolean;
  browserObservationVerified: boolean;
};

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const hex64 = /^[0-9a-f]{64}$/i;
const tab = /^[0-9a-f]{32}$/i;
const owner = /^ai-engine-oauth:[0-9a-f]{64}$/i;
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/;

/** Signed payload includes every field; no caller-supplied subset may be ignored. */
export function nativeCheckpointAckPayload(e: NativeCheckpointAckEvidence): string {
  return ["ai-core-dev-native-checkpoint-ack/v1",e.commandId,e.responseId,e.eventId,
    e.conversationId,e.workerId,e.browserProfile,e.bindingFingerprint,
    e.readerTargetId,e.originalTargetId,e.replySha256,e.observedAt].join("\n");
}

export function verifyNativeCheckpointAckEvidence(
  evidence: NativeCheckpointAckEvidence, expected: NativeCheckpointAckExpectation,
): boolean {
  try {
    if (!expected.devHost || !expected.browserObservationVerified ||
      expected.tokenOwner !== expected.workerId ||
      evidence.version !== 1 || !uuid.test(evidence.commandId) ||
      !uuid.test(evidence.responseId) || !hex64.test(evidence.eventId) ||
      !owner.test(evidence.conversationId) || !identifier.test(evidence.workerId) ||
      !identifier.test(evidence.browserProfile) || !hex64.test(evidence.bindingFingerprint) ||
      !hex64.test(evidence.replySha256) || !tab.test(evidence.readerTargetId) ||
      !tab.test(evidence.originalTargetId) ||
      evidence.originalTargetId === evidence.readerTargetId) return false;
    for (const field of ["commandId", "responseId", "eventId", "conversationId",
      "workerId", "browserProfile", "bindingFingerprint", "readerTargetId",
      "originalTargetId", "replySha256"] as const) {
      if (evidence[field] !== expected[field]) return false;
    }
    const observed = Date.parse(evidence.observedAt);
    const checkpoint = expected.checkpointCreatedAt.getTime();
    const now = expected.now.getTime();
    if (!Number.isFinite(observed) || !Number.isFinite(checkpoint) || !Number.isFinite(now) ||
      observed < checkpoint || observed > now + 10_000 || now - observed > 300_000) return false;
    if (!expected.workerPublicKeyDerBase64) return false;
    const keyBytes = Buffer.from(expected.workerPublicKeyDerBase64, "base64");
    if (keyBytes.toString("base64") !== expected.workerPublicKeyDerBase64) return false;
    const publicKey = createPublicKey({ key: keyBytes, format: "der", type: "spki" });
    if (publicKey.asymmetricKeyType !== "ed25519") return false;
    if (typeof evidence.signatureBase64 !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(evidence.signatureBase64)) return false;
    const sig = Buffer.from(evidence.signatureBase64, "base64");
    return sig.length === 64 &&
      verify(null, Buffer.from(nativeCheckpointAckPayload(evidence)), publicKey, sig);
  } catch {
    return false;
  }
}
